/**
 * @file providers/serper.ts
 * @description Serper Provider，只负责搜索参数与统一结果映射。
 */

import type { WebSearchServiceRequest } from '../definitions/webSearchService';
import { serperSearch } from '../../../../infra/adapters/web-search/serperSearchAdapter';
import type { WebSearchProvider, WebSearchParams, WebSearchResult } from './types';
import { createSearchResults } from '../functions/createSearchResults';

export class SerperProvider implements WebSearchProvider {
  readonly name = 'serper';
  private readonly apiBase: string;
  private readonly apiKey: string;
  constructor(config: WebSearchServiceRequest) {
    this.apiBase = config.baseUrl;
    this.apiKey = config.apiKey ?? '';
    if (!this.apiKey) {
      throw new Error('Serper API Key 未配置。');
    }
  }

  async search(params: WebSearchParams): Promise<WebSearchResult[]> {
    const effectiveQuery = params.site ? `site:${params.site} ${params.query}` : params.query;
    const result = await serperSearch({
      apiBase: this.apiBase,
      apiKey: this.apiKey,
      request: {
        query: effectiveQuery,
        topK: params.topK ?? 10,
        language: params.language,
      },
      signal: params.signal,
    });

    return createSearchResults({
      query: params.query,
      provider: this.name,
      cached: false,
      latencyMs: result.tookMs,
      candidates: result.organic.map((item) => ({
        title: item.title,
        url: item.link,
        snippet: item.snippet,
        ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
      })),
    });
  }
}
