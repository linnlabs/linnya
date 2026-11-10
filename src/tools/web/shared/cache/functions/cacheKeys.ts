import { normalizeUrl } from '../../../websearch/citations/normalizeUrl';
import type { WebDocumentCacheRouteIdentity } from '../definitions/webCache';

function normalizeQuery(query: string): string {
  return query.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** 同名服务可能指向不同实例（自托管 SearXNG、改过地址的 BYOK），端点必须进入键。 */
export function createWebSearchCacheKey(params: {
  query: string;
  provider: string;
  endpoint?: string;
  topK: number;
  recencyDays?: number;
  site?: string;
  language?: string;
}): string {
  return JSON.stringify({
    query: normalizeQuery(params.query),
    provider: params.provider.trim().toLowerCase(),
    endpoint: params.endpoint ?? null,
    topK: params.topK,
    recencyDays: params.recencyDays ?? null,
    site: params.site?.trim().toLowerCase() ?? null,
    language: params.language?.trim().toLowerCase() ?? null,
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
