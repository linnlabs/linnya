import type { WebSearchServiceRequest } from '../definitions/webSearchService';
import { jinaSearch } from '../../../../infra/adapters/web-search/jinaSearchAdapter';
import { createSearchResults } from '../functions/createSearchResults';
import type { WebSearchConditionReport, WebSearchParams, WebSearchProvider, WebSearchResult } from './types';
import { describeSearchConditions, toEndpointIdentity } from '../functions/searchConditions';

const MAX_JINA_SNIPPET_CHARS = 1_200;

export class JinaSearchProvider implements WebSearchProvider {
  readonly name = 'jina_search';
  private readonly apiBase: string;
  private readonly apiKey: string;

  constructor(config: WebSearchServiceRequest) {
    this.apiBase = config.baseUrl;
    this.apiKey = config.apiKey ?? '';
    if (!this.apiKey) throw new Error('Jina Search API Key 未配置。');
    this.endpoint = toEndpointIdentity(config.baseUrl, this.name);
  }
  readonly endpoint: string;

  describeConditions(params: WebSearchParams): WebSearchConditionReport[] {
    return describeSearchConditions(params, {
      site: { execution: 'applied', detail: 'via site: operator' },
      recency_days: 'unsupported',
      language: 'unsupported',
      objective: 'unsupported',
    });
  }

  async search(params: WebSearchParams): Promise<WebSearchResult[]> {
    const effectiveQuery = params.site ? `site:${params.site} ${params.query}` : params.query;
    const result = await jinaSearch({
      apiBase: this.apiBase,
      apiKey: this.apiKey,
      query: effectiveQuery,
      signal: params.signal,
    });
    return createSearchResults({
      query: params.query,
      provider: this.name,
      cached: false,
      latencyMs: result.tookMs,
      candidates: result.items.slice(0, params.topK ?? 10).map((item) => ({
        title: item.title,
        url: item.url,
        snippet: (item.description || item.content).slice(0, MAX_JINA_SNIPPET_CHARS),
      })),
    });
  }
}
