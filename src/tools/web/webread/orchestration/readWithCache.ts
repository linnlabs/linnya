import { Logger } from '@shared/logger';
import type {
  WebCacheStatus,
  WebDocumentCacheRouteIdentity,
} from '../../shared/cache/definitions/webCache';
import { createWebDocumentCacheKey } from '../../shared/cache/functions/cacheKeys';
import { resolveWebDocumentCacheTtlMs } from '../../shared/cache/functions/cacheTtl';
import type { WebCacheRuntime } from '../../shared/cache/webCacheFactory';
import type { WebReadLadderResult } from '../definitions/readLadder';
import {
  DEFAULT_WEB_READ_CONFIG,
  type WebReadConfig,
} from '../definitions/webReadConfig';
import type { WebReadParams, WebReadProvider } from '../providers/types';
import { readWebPageWithLadder } from './readLadder';

const logger = new Logger('WebReadCache');
// 正文抽取器或 DOM 规范化语义变化时必须升级，避免 24 小时稳定页面缓存
// 继续返回旧算法结果。
// 10：快照保存上限从 5 万字提高到 50 万字，旧条目可能在 5 万字处截断。
// 11：保存正文主要图片候选与页面版权声明，旧条目没有这两项。
const WEB_READ_CACHE_ROUTE_VERSION = 11;
const DEFAULT_LOCAL_PROVIDER_IDENTITY = 'local_http';
const DEFAULT_RENDER_PROVIDER_IDENTITY = 'local_render';

export interface CachedWebReadResult {
  ladderResult: WebReadLadderResult;
  cacheStatus: WebCacheStatus;
}

function asCacheHit(result: WebReadLadderResult, storedAtMs: number): WebReadLadderResult {
  return {
    ...result,
    readResult: {
      ...result.readResult,
      cacheAgeSeconds: Math.max(0, Math.floor((Date.now() - storedAtMs) / 1_000)),
    },
  };
}

export function resolveWebReadCacheRouteIdentity(dependencies: {
  config: WebReadConfig;
  provider?: WebReadProvider;
  renderProvider?: WebReadProvider | null;
  managedProvider?: WebReadProvider | null;
}): WebDocumentCacheRouteIdentity {
  const renderEnabled = dependencies.renderProvider === undefined
    ? dependencies.config.renderEnabled
    : dependencies.renderProvider !== null;
  const managedIdentity = dependencies.managedProvider === null
    || (dependencies.managedProvider === undefined && dependencies.config.managedReader === 'none')
    ? 'none'
    : dependencies.managedProvider?.name ?? dependencies.config.managedReader;
  return {
    version: WEB_READ_CACHE_ROUTE_VERSION,
    providers: [
      dependencies.provider?.name ?? DEFAULT_LOCAL_PROVIDER_IDENTITY,
      ...(renderEnabled
        ? [dependencies.renderProvider?.name ?? DEFAULT_RENDER_PROVIDER_IDENTITY]
        : []),
      managedIdentity,
    ],
  };
}

export async function readWebPageWithCache(
  params: WebReadParams & {
    /**
     * 续读（offset / find）要读同一份快照：已过期但仍保留的快照直接使用，不重新抓取，
     * 否则页面变化后偏移会错位。快照已被清理时照常抓取。
     */
    readonly acceptStaleSnapshot?: boolean;
  },
  dependencies: {
    provider?: WebReadProvider;
    renderProvider?: WebReadProvider | null;
    managedProvider?: WebReadProvider | null;
    config?: WebReadConfig;
    runtime: WebCacheRuntime;
  },
): Promise<CachedWebReadResult> {
  const config = dependencies.config ?? DEFAULT_WEB_READ_CONFIG;
  const route = resolveWebReadCacheRouteIdentity({
    config,
    ...(dependencies.provider ? { provider: dependencies.provider } : {}),
    ...(dependencies.renderProvider !== undefined
      ? { renderProvider: dependencies.renderProvider }
      : {}),
    ...(dependencies.managedProvider !== undefined
      ? { managedProvider: dependencies.managedProvider }
      : {}),
  });
  const key = createWebDocumentCacheKey({ url: params.url, route });
  let cacheAvailable = true;
  let staleResult: WebReadLadderResult | undefined;
  try {
    const cached = await dependencies.runtime.cache.readDocument(key);
    if (cached.state === 'fresh') {
      return {
        ladderResult: asCacheHit(cached.value, cached.storedAtMs),
        cacheStatus: 'hit',
      };
    }
    if (cached.state === 'stale') {
      if (params.acceptStaleSnapshot) {
        return {
          ladderResult: asCacheHit(cached.value, cached.storedAtMs),
          cacheStatus: 'hit',
        };
      }
      staleResult = cached.value;
    }
  } catch (error: unknown) {
    cacheAvailable = false;
    logger.warn('[readWebPageWithCache] URL 缓存读取失败，本次绕过缓存', {
      operation: 'read',
      cacheStatus: 'bypass',
      error,
    });
  }

  const inFlightKey = `${dependencies.runtime.cache.namespace}:document:${key}`;
  const staleDocument = staleResult?.readResult;
  const canRevalidate = staleResult !== undefined
    && staleResult.selectedProvider === staleResult.initialProvider
    && staleDocument?.renderMode === 'http'
    && (staleDocument.etag !== undefined || staleDocument.lastModified !== undefined);
  const coalesced = await dependencies.runtime.documentRequests.run(
    inFlightKey,
    params.signal,
    async (sharedSignal) => {
      const ladderResult = await readWebPageWithLadder(
        {
          url: params.url,
          maxChars: params.maxChars,
          signal: sharedSignal,
          ...(canRevalidate && staleDocument
            ? {
                revalidation: {
                  ...(staleDocument.etag ? { etag: staleDocument.etag } : {}),
                  ...(staleDocument.lastModified
                    ? { lastModified: staleDocument.lastModified }
                    : {}),
                  cachedResult: staleDocument,
                },
              }
            : {}),
        },
        {
          ...(dependencies.provider ? { provider: dependencies.provider } : {}),
          ...(dependencies.renderProvider !== undefined
            ? { renderProvider: dependencies.renderProvider }
            : {}),
          ...(dependencies.managedProvider !== undefined
            ? { managedProvider: dependencies.managedProvider }
            : {}),
          config,
        },
      );
      // 原文件只在调用/in-flight 内持有。公共正文缓存不保存二进制或会话物理路径。
      if (cacheAvailable && !ladderResult.readResult.filePayload) {
        try {
          const ttlMs = resolveWebDocumentCacheTtlMs(ladderResult);
          await dependencies.runtime.cache.writeDocument({ key, value: ladderResult, ttlMs });
          const finalUrlKey = createWebDocumentCacheKey({
            url: ladderResult.readResult.finalUrl,
            route,
          });
          if (finalUrlKey !== key) {
            await dependencies.runtime.cache.writeDocument({ key: finalUrlKey, value: ladderResult, ttlMs });
          }
        } catch (error: unknown) {
          cacheAvailable = false;
          logger.warn('[readWebPageWithCache] URL 缓存写入失败', {
            operation: 'read',
            cacheStatus: 'bypass',
            error,
          });
        }
      }
      return ladderResult;
    },
  );

  return {
    ladderResult: coalesced.value,
    cacheStatus: coalesced.joinedExistingRequest
      ? 'coalesced'
      : cacheAvailable && !coalesced.value.readResult.filePayload ? (canRevalidate ? 'revalidated' : 'miss') : 'bypass',
  };
}
