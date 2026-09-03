import { Logger } from '@shared/logger';
import type { WebCacheStatus } from '../../shared/cache/definitions/webCache';
import { createWebSearchCacheKey } from '../../shared/cache/functions/cacheKeys';
import { resolveWebSearchCacheTtlMs } from '../../shared/cache/functions/cacheTtl';
import type { WebCacheRuntime } from '../../shared/cache/webCacheFactory';
import type { WebSearchParams, WebSearchProvider, WebSearchResult } from '../providers/types';

const logger = new Logger('WebSearchCache');

export interface CachedWebSearchResult {
  results: WebSearchResult[];
  cacheStatus: WebCacheStatus;
}

function asCacheHit(results: WebSearchResult[], tookMs: number): WebSearchResult[] {
  return results.map((result) => ({ ...result, cached: true, latencyMs: tookMs }));
}

export async function searchWebWithCache(args: {
  params: WebSearchParams & { topK: number };
  provider: WebSearchProvider;
  runtime: WebCacheRuntime;
}): Promise<CachedWebSearchResult> {
  const startedAt = Date.now();
  const key = createWebSearchCacheKey({
    query: args.params.query,
    provider: args.provider.name,
    topK: args.params.topK,
    recencyDays: args.params.recencyDays,
  });

  let cacheAvailable = true;
  try {
    const cached = await args.runtime.cache.readSearch(key);
    if (cached.state === 'fresh') {
      return {
        results: asCacheHit(cached.value, Date.now() - startedAt),
        cacheStatus: 'hit',
      };
    }
  } catch (error: unknown) {
    cacheAvailable = false;
    logger.warn('[searchWebWithCache] 查询缓存读取失败，本次绕过缓存', {
      operation: 'search',
      provider: args.provider.name,
      cacheStatus: 'bypass',
      error,
    });
  }

  const inFlightKey = `${args.runtime.cache.namespace}:search:${key}`;
  const coalesced = await args.runtime.searchRequests.run(
    inFlightKey,
    args.params.signal,
    async (sharedSignal) => {
      const results = await args.provider.search({ ...args.params, signal: sharedSignal });
      if (cacheAvailable) {
        try {
          await args.runtime.cache.writeSearch({
            key,
            value: results,
            ttlMs: resolveWebSearchCacheTtlMs(args.params.recencyDays),
          });
        } catch (error: unknown) {
          cacheAvailable = false;
          logger.warn('[searchWebWithCache] 查询缓存写入失败', {
            operation: 'search',
            provider: args.provider.name,
            cacheStatus: 'bypass',
            error,
          });
        }
      }
      return results;
    },
  );

  return {
    results: coalesced.value,
    cacheStatus: coalesced.joinedExistingRequest
      ? 'coalesced'
      : cacheAvailable ? 'miss' : 'bypass',
  };
}
