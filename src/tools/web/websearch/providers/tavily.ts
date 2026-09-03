import type { WebSearchServiceRequest } from '../definitions/webSearchService';
import { tavilySearch } from '../../../../infra/adapters/web-search/tavilySearchAdapter';
import { createSearchResults } from '../functions/createSearchResults';
import type { WebSearchParams, WebSearchProvider, WebSearchResult } from './types';

const MAX_TAVILY_SNIPPET_CHARS = 1_200;

export class TavilyProvider implements WebSearchProvider {
  readonly name = 'tavily';
  private readonly apiBase: string;
  private readonly apiKey: string;

  constructor(config: WebSearchServiceRequest) {
    this.apiBase = config.baseUrl;
    this.apiKey = config.apiKey ?? '';
    if (!this.apiKey) throw new Error('Tavily API Key 未配置。');
  }

  async search(params: WebSearchParams): Promise<WebSearchResult[]> {
    const result = await tavilySearch({
      apiBase: this.apiBase,
      apiKey: this.apiKey,
      query: params.query,
      topK: params.topK ?? 10,
      site: params.site,
      recencyDays: params.recencyDays,
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
