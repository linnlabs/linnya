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
import {
  createWebUpstreamHttpError,
  webHttpFetch,
  WebHttpError,
  type WebHttpResponse,
} from '../web-http/webHttpFetch';
import {
  assertAllowedWebUrl,
  resolveAndAssertPublicHost,
  type ResolvedWebHost,
} from '../../../tools/web/shared/urlPolicy';

export const LOCAL_HTTP_TIMEOUT_MS = 12_000;
export const LOCAL_HTTP_MAX_BODY_BYTES = 5 * 1024 * 1024;
export const LOCAL_HTTP_MAX_REDIRECTS = 5;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

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
  let currentUrl = assertAllowedWebUrl(rawUrl);
  let redirectCount = 0;

  while (true) {
    const elapsedMs = Date.now() - startedAt;
    const remainingMs = timeoutMs - elapsedMs;
    if (remainingMs <= 0) {
      throw new WebHttpError('timeout', `本地网页抓取在 ${timeoutMs}ms 后超时。`);
    }

    const resolved = await resolveWithinBudget({
      url: currentUrl,
      signal: options.signal,
      timeoutMs: remainingMs,
      resolveHost,
    });
    const dispatcher = dispatcherFactory(resolved);
    let response: WebHttpResponse;
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
    } finally {
      await dispatcher.close();
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get('location');
      if (!location) {
        throw new WebHttpError('invalid_response', `网页返回 ${response.status}，但缺少 Location。`, {
          status: response.status,
        });
      }
      if (redirectCount >= maxRedirects) {
        throw new WebHttpError('http_error', `网页重定向次数超过上限 ${maxRedirects}。`, {
          status: response.status,
        });
      }
      currentUrl = assertAllowedWebUrl(new URL(location, currentUrl).toString());
      redirectCount += 1;
      continue;
    }

    const etag = readOptionalHeader(response, 'etag');
    const lastModified = readOptionalHeader(response, 'last-modified');
    if (response.status === 304 && options.validators) {
      return {
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
        ...(etag ? { etag } : {}),
        ...(lastModified ? { lastModified } : {}),
      };
    }
    if (!response.ok) throw createWebUpstreamHttpError('本地网页抓取', response);
    const contentType = response.headers.get('content-type')?.trim() || 'application/octet-stream';
    const decoded = decodeBody(response);
    return {
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
      ...(etag ? { etag } : {}),
      ...(lastModified ? { lastModified } : {}),
    };
  }
}
