import { normalizeUrl } from '../../../websearch/citations/normalizeUrl';
import type { WebDocumentCacheRouteIdentity } from '../definitions/webCache';

function normalizeQuery(query: string): string {
  return query.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function createWebSearchCacheKey(params: {
  query: string;
  provider: string;
  topK: number;
  recencyDays?: number;
}): string {
  return JSON.stringify({
    query: normalizeQuery(params.query),
    provider: params.provider.trim().toLowerCase(),
    topK: params.topK,
    recencyDays: params.recencyDays ?? null,
  });
}

/** 发请求前并不知道 contentHash，因此规范 URL + 读取路由共同组成查找 key。 */
export function createWebDocumentCacheKey(params: {
  url: string;
  route: WebDocumentCacheRouteIdentity;
}): string {
  return JSON.stringify({
    url: normalizeUrl(params.url),
    route: {
      version: params.route.version,
      providers: params.route.providers.map((provider) => provider.trim().toLowerCase()),
    },
  });
}
