import type { WebReadLadderResult } from '../../../webread/definitions/readLadder';
import type { WebSearchResult } from '../../../websearch/providers/types';

export type { WebCacheStatus } from '@app/schemas';

export interface WebCacheEntry<T> {
  value: T;
  storedAtMs: number;
  expiresAtMs: number;
}

export type WebCacheLookup<T> =
  | { state: 'miss' }
  | ({ state: 'fresh' | 'stale' } & WebCacheEntry<T>);

export type WebSearchCacheValue = WebSearchResult[];
export type WebDocumentCacheValue = WebReadLadderResult;

/**
 * 正文缓存保存的是整条读取阶梯的最终结果，因此缓存身份必须描述整条路由，
 * 不能只用 URL 或最终命中的 Provider。
 */
export interface WebDocumentCacheRouteIdentity {
  readonly version: number;
  readonly providers: readonly string[];
}

export interface WebCacheWrite<T> {
  key: string;
  value: T;
  ttlMs: number;
}
