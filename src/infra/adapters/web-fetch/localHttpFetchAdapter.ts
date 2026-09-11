/**
 * 本地网页 GET 抓取适配器。
 *
 * 每一跳都执行 URL 字面策略与 DNS 解析策略，并通过 Undici dispatcher 将实际连接
 * 固定到已校验 IP。只做“先解析再放行”仍存在 DNS rebinding 时间差，不能作为完整
 * 的桌面端 SSRF 边界。
 */

import { isIP } from 'node:net';
import iconv from 'iconv-lite';
import { Agent, buildConnector, type Dispatcher } from 'undici';
import { Logger } from '../../../shared/logger';
import {
  createWebUpstreamHttpError,
  webHttpFetch,
  WebHttpError,
  type WebHttpResponse,
  withWebHttpErrorDiagnostics,
} from '../web-http/webHttpFetch';
import {
  assertAllowedWebUrl,
  resolveAndAssertPublicHost,
  type ResolvedWebHost,
} from '../../../tools/web/shared/urlPolicy';

export const LOCAL_HTTP_TIMEOUT_MS = 12_000;
export const LOCAL_HTTP_MAX_BODY_BYTES = 5 * 1024 * 1024;
export const LOCAL_HTTP_MAX_REDIRECTS = 5;
export const LOCAL_HTTP_MAX_TRANSIENT_RETRIES = 1;
export const LOCAL_HTTP_RETRY_BACKOFF_MS = 250;
export const LOCAL_HTTP_MAX_RETRY_DELAY_MS = 1_000;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const logger = new Logger('LocalHttpFetch');

export interface LocalHttpFetchResult {
  notModified: boolean;
  status: number;
  finalUrl: string;
  contentType: string;
  mimeType: string;
  charset: string;
  bodyText: string;
  rawLength: number;
  tookMs: number;
  redirectCount: number;
  attemptCount: number;
  retryCount: number;
  etag?: string;
  lastModified?: string;
}

export interface LocalHttpFetchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBodyBytes?: number;
  maxRedirects?: number;
  validators?: {
    etag?: string;
    lastModified?: string;
  };
}

export interface LocalHttpFetchDependencies {
  resolveHost?: (url: URL) => Promise<ResolvedWebHost>;
  httpFetch?: typeof webHttpFetch;
  createDispatcher?: (resolved: ResolvedWebHost) => Dispatcher;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
}

function createPinnedDispatcher(resolved: ResolvedWebHost): Dispatcher {
  const connect = buildConnector({});
  let cursor = 0;
  return new Agent({
    connect(options, callback) {
      const selected = resolved.addresses[cursor % resolved.addresses.length];
      cursor += 1;
      connect({
        ...options,
        hostname: selected.address,
        host: selected.address,
        servername: isIP(resolved.hostname) === 0 ? resolved.hostname : undefined,
      }, callback);
    },
  });
}

function createAbortError(): WebHttpError {
  return new WebHttpError('aborted', '本地网页抓取已由调用方取消。');
}

async function resolveWithinBudget(args: {
  url: URL;
  signal?: AbortSignal;
  timeoutMs: number;
  resolveHost: (url: URL) => Promise<ResolvedWebHost>;
}): Promise<ResolvedWebHost> {
  if (args.signal?.aborted) throw createAbortError();

  return new Promise<ResolvedWebHost>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new WebHttpError('timeout', `本地网页 DNS 校验在 ${args.timeoutMs}ms 后超时。`));
    }, args.timeoutMs);
    const abort = (): void => {
      cleanup();
      reject(createAbortError());
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      args.signal?.removeEventListener('abort', abort);
    };
    args.signal?.addEventListener('abort', abort, { once: true });
    args.resolveHost(args.url).then(
      (resolved) => {
        cleanup();
        resolve(resolved);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function readCharset(contentType: string, bodyData: Uint8Array): string {
  const headerMatch = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(contentType);
  if (headerMatch?.[1] && iconv.encodingExists(headerMatch[1])) return headerMatch[1].toLowerCase();

  const prefix = Buffer.from(bodyData.subarray(0, 4_096)).toString('latin1');
  const metaMatch = /<meta[^>]+charset\s*=\s*["']?([^\s"'/>]+)/i.exec(prefix)
    ?? /<meta[^>]+content\s*=\s*["'][^"']*charset=([^\s"';>]+)/i.exec(prefix);
  if (metaMatch?.[1] && iconv.encodingExists(metaMatch[1])) return metaMatch[1].toLowerCase();
  return 'utf-8';
}

function decodeBody(response: WebHttpResponse): { bodyText: string; charset: string } {
  const contentType = response.headers.get('content-type') ?? '';
  const charset = readCharset(contentType, response.bodyData);
  return {
    bodyText: iconv.decode(Buffer.from(response.bodyData), charset),
    charset,
  };
}

function readMimeType(contentType: string): string {
  return (contentType.split(';', 1)[0] ?? '').trim().toLowerCase() || 'application/octet-stream';
}

function readOptionalHeader(response: WebHttpResponse, name: string): string | undefined {
  const value = response.headers.get(name)?.trim();
  return value || undefined;
}

function retryDelayMs(error: WebHttpError): number {
  return Math.min(
    LOCAL_HTTP_MAX_RETRY_DELAY_MS,
    Math.max(LOCAL_HTTP_RETRY_BACKOFF_MS, error.retryAfterMs ?? 0),
  );
}

function isTransientRetryCandidate(error: WebHttpError): boolean {
  if (error.challengeDetected) return false;
  return error.kind === 'timeout'
    || error.kind === 'network_error'
    || error.kind === 'rate_limited'
    || error.kind === 'http_5xx';
}

function sleepWithSignal(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(createAbortError());
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    const abort = (): void => {
      cleanup();
      reject(createAbortError());
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export async function localHttpFetch(
  rawUrl: string,
  options: LocalHttpFetchOptions = {},
  dependencies: LocalHttpFetchDependencies = {},
): Promise<LocalHttpFetchResult> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? LOCAL_HTTP_TIMEOUT_MS;
  const maxBodyBytes = options.maxBodyBytes ?? LOCAL_HTTP_MAX_BODY_BYTES;
  const maxRedirects = options.maxRedirects ?? LOCAL_HTTP_MAX_REDIRECTS;
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0) {
    throw new Error('localHttpFetch.maxRedirects 必须是非负整数。');
  }

  const resolveHost = dependencies.resolveHost ?? resolveAndAssertPublicHost;
  const httpFetch = dependencies.httpFetch ?? webHttpFetch;
  const dispatcherFactory = dependencies.createDispatcher ?? createPinnedDispatcher;
  const sleep = dependencies.sleep ?? sleepWithSignal;
  let currentUrl = assertAllowedWebUrl(rawUrl);
  let redirectCount = 0;
  let attemptCount = 0;
  let retryCount = 0;

  while (true) {
    const elapsedMs = Date.now() - startedAt;
    const remainingMs = timeoutMs - elapsedMs;
    if (remainingMs <= 0) {
      throw new WebHttpError('timeout', `本地网页抓取在 ${timeoutMs}ms 后超时。`, {
        url: currentUrl.toString(),
        redirectCount,
        attempt: attemptCount,
        retryCount,
      });
    }

    let resolved: ResolvedWebHost;
    try {
      resolved = await resolveWithinBudget({
        url: currentUrl,
        signal: options.signal,
        timeoutMs: remainingMs,
        resolveHost,
      });
    } catch (error: unknown) {
      if (error instanceof WebHttpError) {
        throw withWebHttpErrorDiagnostics(error, {
          url: currentUrl.toString(),
          redirectCount,
          attempt: attemptCount,
          retryCount,
        });
      }
      throw error;
    }
    const dispatcher = dispatcherFactory(resolved);
    let response: WebHttpResponse;
    let deferredRetryDelayMs: number | undefined;
    attemptCount += 1;
    try {
      const headers: Record<string, string> = {
        Accept: 'text/html,application/xhtml+xml,text/plain,application/json,application/xml;q=0.9,*/*;q=0.1',
        'User-Agent': 'Linnya-WebReader/1.0',
      };
      if (options.validators?.etag) headers['If-None-Match'] = options.validators.etag;
      if (options.validators?.lastModified) headers['If-Modified-Since'] = options.validators.lastModified;
      response = await httpFetch({
        url: currentUrl,
        method: 'GET',
        headers,
        signal: options.signal,
        timeoutMs: Math.max(1, timeoutMs - (Date.now() - startedAt)),
        maxBodyBytes,
        redirect: 'manual',
        dispatcher,
      });
    } catch (error: unknown) {
      if (!(error instanceof WebHttpError)) throw error;
      const diagnosed = withWebHttpErrorDiagnostics(error, {
        url: currentUrl.toString(),
        redirectCount,
        attempt: attemptCount,
        retryCount,
      });
      const remainingAfterFailure = timeoutMs - (Date.now() - startedAt);
      if (retryCount < LOCAL_HTTP_MAX_TRANSIENT_RETRIES
        && isTransientRetryCandidate(diagnosed)
        && remainingAfterFailure > LOCAL_HTTP_RETRY_BACKOFF_MS) {
        retryCount += 1;
        logger.warn('[localHttpFetch] 瞬态失败，执行有界重试', {
          url: currentUrl.origin,
          kind: diagnosed.kind,
          status: diagnosed.status,
          attempt: attemptCount,
          retryCount,
        });
        deferredRetryDelayMs = Math.min(retryDelayMs(diagnosed), remainingAfterFailure - 1);
      } else {
        throw diagnosed;
      }
      throw diagnosed;
    } finally {
      await dispatcher.close();
    }
    if (deferredRetryDelayMs !== undefined) {
      await sleep(deferredRetryDelayMs, options.signal);
      continue;
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get('location');
      if (!location) {
        throw new WebHttpError('invalid_response', `网页返回 ${response.status}，但缺少 Location。`, {
          status: response.status,
          url: currentUrl.toString(),
          redirectCount,
          attempt: attemptCount,
          retryCount,
        });
      }
      if (redirectCount >= maxRedirects) {
        throw new WebHttpError('http_error', `网页重定向次数超过上限 ${maxRedirects}。`, {
          status: response.status,
          url: currentUrl.toString(),
          redirectCount,
          attempt: attemptCount,
          retryCount,
        });
      }
      currentUrl = assertAllowedWebUrl(new URL(location, currentUrl).toString());
      redirectCount += 1;
      continue;
    }

    const etag = readOptionalHeader(response, 'etag');
    const lastModified = readOptionalHeader(response, 'last-modified');
    if (response.status === 304 && options.validators) {
      const result: LocalHttpFetchResult = {
        notModified: true,
        status: 304,
        finalUrl: currentUrl.toString(),
        contentType: '',
        mimeType: '',
        charset: '',
        bodyText: '',
        rawLength: 0,
        tookMs: Date.now() - startedAt,
        redirectCount,
        attemptCount,
        retryCount,
        ...(etag ? { etag } : {}),
        ...(lastModified ? { lastModified } : {}),
      };
      logger.info('[localHttpFetch] 条件请求完成', {
        url: currentUrl.origin,
        status: result.status,
        redirectCount,
        attemptCount,
        retryCount,
      });
      return result;
    }
    if (!response.ok) {
      const upstreamError = withWebHttpErrorDiagnostics(
        createWebUpstreamHttpError('本地网页抓取', response),
        {
          url: currentUrl.toString(),
          redirectCount,
          attempt: attemptCount,
          retryCount,
        },
      );
      const remainingAfterFailure = timeoutMs - (Date.now() - startedAt);
      if (retryCount < LOCAL_HTTP_MAX_TRANSIENT_RETRIES
        && isTransientRetryCandidate(upstreamError)
        && remainingAfterFailure > LOCAL_HTTP_RETRY_BACKOFF_MS) {
        retryCount += 1;
        logger.warn('[localHttpFetch] 上游瞬态状态，执行有界重试', {
          url: currentUrl.origin,
          kind: upstreamError.kind,
          status: upstreamError.status,
          attempt: attemptCount,
          retryCount,
        });
        await sleep(Math.min(retryDelayMs(upstreamError), remainingAfterFailure - 1), options.signal);
        continue;
      }
      throw upstreamError;
    }
    const contentType = response.headers.get('content-type')?.trim() || 'application/octet-stream';
    const decoded = decodeBody(response);
    const result: LocalHttpFetchResult = {
      notModified: false,
      status: response.status,
      finalUrl: currentUrl.toString(),
      contentType,
      mimeType: readMimeType(contentType),
      charset: decoded.charset,
      bodyText: decoded.bodyText,
      rawLength: response.bodyData.byteLength,
      tookMs: Date.now() - startedAt,
      redirectCount,
      attemptCount,
      retryCount,
      ...(etag ? { etag } : {}),
      ...(lastModified ? { lastModified } : {}),
    };
    logger.info('[localHttpFetch] 读取完成', {
      url: result.finalUrl.split('?')[0],
      status: result.status,
      redirectCount,
      attemptCount,
      retryCount,
    });
    return result;
  }
}
