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
const WEB_READ_CACHE_ROUTE_VERSION = 4;
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
  params: WebReadParams,
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
    if (cached.state === 'stale') staleResult = cached.value;
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
          ...params,
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
      if (cacheAvailable) {
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
      : cacheAvailable ? (canRevalidate ? 'revalidated' : 'miss') : 'bypass',
  };
}
