import type { WebSearchServiceRequest } from '../definitions/webSearchService';
import { tavilySearch } from '../../../../infra/adapters/web-search/tavilySearchAdapter';
import { createSearchResults } from '../functions/createSearchResults';
import type { WebSearchConditionReport, WebSearchParams, WebSearchProvider, WebSearchResult } from './types';
import { bucketRecency, describeBucketedRecency, describeSearchConditions, toEndpointIdentity } from '../functions/searchConditions';

const MAX_TAVILY_SNIPPET_CHARS = 1_200;

export class TavilyProvider implements WebSearchProvider {
  readonly name = 'tavily';
  private readonly apiBase: string;
  private readonly apiKey: string;

  constructor(config: WebSearchServiceRequest) {
    this.apiBase = config.baseUrl;
    this.apiKey = config.apiKey ?? '';
    if (!this.apiKey) throw new Error('Tavily API Key 未配置。');
    this.endpoint = toEndpointIdentity(config.baseUrl, this.name);
  }
  readonly endpoint: string;

  describeConditions(params: WebSearchParams): WebSearchConditionReport[] {
    return describeSearchConditions(params, {
      site: 'applied',
      recency_days: describeBucketedRecency(params.recencyDays),
      language: 'unsupported',
    });
  }

  async search(params: WebSearchParams): Promise<WebSearchResult[]> {
    const result = await tavilySearch({
      apiBase: this.apiBase,
      apiKey: this.apiKey,
      query: params.query,
      topK: params.topK ?? 10,
      site: params.site,
      timeRange: bucketRecency(params.recencyDays),
      signal: params.signal,
    });
    return createSearchResults({
      query: params.query,
      provider: this.name,
      cached: false,
      latencyMs: result.tookMs,
      candidates: result.items.map((item) => ({
        title: item.title,
        url: item.url,
        snippet: item.content.slice(0, MAX_TAVILY_SNIPPET_CHARS),
        ...(item.score !== undefined ? { providerScore: item.score } : {}),
      })),
    });
  }
}
