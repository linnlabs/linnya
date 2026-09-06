/**
 * Web 能力统一 HTTP 出站入口。
 *
 * 超时、父级取消合并、响应读取与错误合同均由 Web 调用域独立拥有；
 * 等出现第三个真实复用方时再考虑下沉到全局 shared。
 */

import { Logger } from '@shared/logger';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import {
  fetch as undiciFetch,
  type BodyInit,
  type Dispatcher,
  type HeadersInit,
  type RequestRedirect,
} from 'undici';

const logger = new Logger('WebHttpFetch');

export type WebHttpErrorKind =
  | 'timeout'
  | 'aborted'
  | 'body_too_large'
  | 'network_error'
  | 'rate_limited'
  | 'auth'
  | 'http_5xx'
  | 'http_error'
  | 'invalid_response';

export class WebHttpError extends Error {
  readonly kind: WebHttpErrorKind;
  readonly cause?: unknown;
  readonly status?: number;
  readonly url?: string;
  readonly contentType?: string;
  readonly bodyPreview?: string;
  readonly retryAfterMs?: number;
  readonly redirectCount?: number;
  readonly attempt?: number;
  readonly retryCount?: number;

  constructor(kind: WebHttpErrorKind, message: string, options?: {
    cause?: unknown;
    status?: number;
    url?: string;
    contentType?: string;
    bodyPreview?: string;
    retryAfterMs?: number;
    redirectCount?: number;
    attempt?: number;
    retryCount?: number;
  }) {
    super(message);
    this.name = 'WebHttpError';
    this.kind = kind;
    this.cause = options?.cause;
    this.status = options?.status;
    this.url = options?.url;
    this.contentType = options?.contentType;
    this.bodyPreview = options?.bodyPreview;
    this.retryAfterMs = options?.retryAfterMs;
    this.redirectCount = options?.redirectCount;
    this.attempt = options?.attempt;
    this.retryCount = options?.retryCount;
  }
}

export interface WebHttpFetchArgs {
  url: string | URL;
  method: string;
  headers?: HeadersInit;
  body?: BodyInit;
  signal?: AbortSignal;
  timeoutMs: number;
  maxBodyBytes: number;
  /** 本地抓取使用 manual，确保每一跳重定向都重新执行 URL 与 DNS 策略。 */
  redirect?: RequestRedirect;
  /** 允许本地抓取把连接固定到已通过策略校验的 DNS 结果。 */
  dispatcher?: Dispatcher;
}

export interface WebHttpHeaders {
  get(name: string): string | null;
}

export interface WebHttpResponse {
  status: number;
  statusText: string;
  ok: boolean;
  bodyText: string;
  /** 受 maxBodyBytes 约束的解压后原始响应字节，供 HTML charset 解码使用。 */
  bodyData: Uint8Array;
  headers: WebHttpHeaders;
  tookMs: number;
}

export function createWebUpstreamHttpError(provider: string, response: WebHttpResponse): WebHttpError {
  const kind: WebHttpErrorKind = response.status === 429
    ? 'rate_limited'
    : response.status === 401 || response.status === 403
      ? 'auth'
      : response.status >= 500
        ? 'http_5xx'
        : 'http_error';
  const errorPreview = response.bodyText.trim().slice(0, 1_000);
  return new WebHttpError(
    kind,
    `${provider} 请求失败: ${response.status} ${response.statusText}${errorPreview ? ` - ${errorPreview}` : ''}`,
    {
      status: response.status,
      contentType: response.headers.get('content-type')?.trim() || undefined,
      bodyPreview: errorPreview.slice(0, 512),
      retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
    },
  );
}

/** 解析 HTTP Retry-After；调用方负责施加更小的实际等待上限。 */
export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.floor(seconds * 1_000);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, timestamp - Date.now());
}

export function withWebHttpErrorDiagnostics(
  error: WebHttpError,
  diagnostics: Pick<WebHttpError, 'url' | 'redirectCount' | 'attempt' | 'retryCount'>,
): WebHttpError {
  return new WebHttpError(error.kind, error.message, {
    cause: error.cause,
    status: error.status,
    contentType: error.contentType,
    bodyPreview: error.bodyPreview,
    retryAfterMs: error.retryAfterMs,
    ...diagnostics,
  });
}

function createTimeoutAbortSignal(args: {
  parentSignal?: AbortSignal;
  timeoutMs: number;
}): { signal: AbortSignal; didTimeout: () => boolean; cleanup: () => void } {
  const controller = new AbortController();
  let timedOut = false;

  const abortFromParent = (): void => {
    controller.abort(args.parentSignal?.reason ?? new Error('aborted'));
  };

  if (args.parentSignal?.aborted) {
    abortFromParent();
  } else {
    args.parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`Web HTTP request timed out after ${args.timeoutMs}ms`));
  }, args.timeoutMs);

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      args.parentSignal?.removeEventListener('abort', abortFromParent);
    },
  };
}

function toLogUrl(rawUrl: string | URL): string {
  try {
    const url = rawUrl instanceof URL ? new URL(rawUrl) : new URL(rawUrl);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return String(rawUrl).split('?')[0] ?? '';
  }
}

async function readBodyWithLimit(body: NodeReadableStream | null, maxBodyBytes: number): Promise<{
  bodyText: string;
  bodyData: Uint8Array;
  bodyBytes: number;
}> {
  if (!body) {
    return { bodyText: '', bodyData: new Uint8Array(), bodyBytes: 0 };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bodyBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk: unknown = value;
      if (!(chunk instanceof Uint8Array)) {
        throw new WebHttpError('invalid_response', 'Web HTTP 响应流返回了非字节数据。');
      }

      bodyBytes += chunk.byteLength;
      if (bodyBytes > maxBodyBytes) {
        await reader.cancel('response body exceeded maxBodyBytes');
        throw new WebHttpError(
          'body_too_large',
          `Web HTTP 响应体超过上限 ${maxBodyBytes} 字节。`
        );
      }
      chunks.push(chunk);
    }
    const bodyData = new Uint8Array(bodyBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bodyData.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { bodyText: new TextDecoder().decode(bodyData), bodyData, bodyBytes };
  } finally {
    reader.releaseLock();
  }
}

export async function webHttpFetch(args: WebHttpFetchArgs): Promise<WebHttpResponse> {
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
    throw new Error('webHttpFetch.timeoutMs 必须是正数。');
  }
  if (!Number.isFinite(args.maxBodyBytes) || args.maxBodyBytes <= 0) {
    throw new Error('webHttpFetch.maxBodyBytes 必须是正数。');
  }

  const startedAt = Date.now();
  const logUrl = toLogUrl(args.url);
  const { signal, didTimeout, cleanup } = createTimeoutAbortSignal({
    parentSignal: args.signal,
    timeoutMs: args.timeoutMs,
  });

  try {
    const response = await undiciFetch(args.url, {
      method: args.method,
      headers: args.headers,
      body: args.body,
      signal,
      redirect: args.redirect,
      dispatcher: args.dispatcher,
    });
    const { bodyText, bodyData, bodyBytes } = await readBodyWithLimit(response.body, args.maxBodyBytes);
    const tookMs = Date.now() - startedAt;

    logger.info('[webHttpFetch] 请求完成', {
      url: logUrl,
      method: args.method,
      status: response.status,
      tookMs,
      bodyBytes,
    });

    return {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      bodyText,
      bodyData,
      headers: response.headers,
      tookMs,
    };
  } catch (error: unknown) {
    const normalizedError = (() => {
      if (error instanceof WebHttpError) return error;
      if (didTimeout()) {
        return new WebHttpError('timeout', `Web HTTP 请求在 ${args.timeoutMs}ms 后超时。`, { cause: error });
      }
      if (args.signal?.aborted) {
        return new WebHttpError('aborted', 'Web HTTP 请求已由调用方取消。', { cause: error });
      }
      return new WebHttpError('network_error', 'Web HTTP 网络请求失败。', { cause: error });
    })();

    logger.error('[webHttpFetch] 请求失败', {
      url: logUrl,
      method: args.method,
      tookMs: Date.now() - startedAt,
      kind: normalizedError.kind,
      error: normalizedError,
    });
    throw normalizedError;
  } finally {
    cleanup();
  }
}
