import type { WebReadLadderResult } from '../../../webread/definitions/readLadder';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export const DEFAULT_WEB_SEARCH_CACHE_TTL_MS = 15 * MINUTE_MS;
export const RECENT_WEB_SEARCH_CACHE_TTL_MS = 5 * MINUTE_MS;
export const DYNAMIC_WEB_DOCUMENT_CACHE_TTL_MS = 5 * MINUTE_MS;
export const RECENT_WEB_DOCUMENT_CACHE_TTL_MS = 15 * MINUTE_MS;
export const STABLE_WEB_DOCUMENT_CACHE_TTL_MS = 24 * HOUR_MS;

export function resolveWebSearchCacheTtlMs(recencyDays: number | undefined): number {
  return recencyDays === undefined ? DEFAULT_WEB_SEARCH_CACHE_TTL_MS : RECENT_WEB_SEARCH_CACHE_TTL_MS;
}

function isRecentlyPublished(publishedAt: string | undefined, nowMs: number): boolean {
  if (!publishedAt) return false;
  const publishedAtMs = Date.parse(publishedAt);
  return Number.isFinite(publishedAtMs) && nowMs - publishedAtMs <= 7 * 24 * HOUR_MS;
}

export function resolveWebDocumentCacheTtlMs(
  result: WebReadLadderResult,
  nowMs: number = Date.now(),
): number {
  const document = result.readResult;
  const url = new URL(document.finalUrl);
  const mimeType = document.contentType.split(';', 1)[0]?.trim().toLowerCase();

  // 首页、Feed 与结构化接口通常承载实时列表，不能沿用文章正文的长 TTL。
  if (
    url.pathname === '/'
    || mimeType === 'application/json'
    || mimeType === 'application/rss+xml'
    || mimeType === 'application/atom+xml'
  ) {
    return DYNAMIC_WEB_DOCUMENT_CACHE_TTL_MS;
  }
  if (isRecentlyPublished(document.publishedAt, nowMs)) {
    return RECENT_WEB_DOCUMENT_CACHE_TTL_MS;
  }
  return STABLE_WEB_DOCUMENT_CACHE_TTL_MS;
}

