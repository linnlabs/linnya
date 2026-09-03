export type WebSearchSourceType = 'official' | 'news' | 'forum' | 'academic' | 'social' | 'other';

/** 搜索 Provider 输出的稳定业务结果；未知评分保持缺省，不伪造数值。 */
export interface SearchResult {
  query: string;
  provider: string;
  rank: number;
  url: string;
  canonicalUrl: string;
  title: string;
  snippet: string;
  siteName?: string;
  publishedAt?: string;
  language?: string;
  sourceType?: WebSearchSourceType;
  providerScore?: number;
  normalizedScore?: number;
  cached: boolean;
  latencyMs: number;
}
