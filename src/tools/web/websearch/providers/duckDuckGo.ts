import type { WebSearchServiceRequest } from '../definitions/webSearchService';
import {
  duckDuckGoSearch,
  type DuckDuckGoSearchDependencies,
} from '../../../../infra/adapters/web-search/duckDuckGoSearchAdapter';
import { createSearchResults } from '../functions/createSearchResults';
import type { WebSearchParams, WebSearchProvider, WebSearchResult } from './types';

export class DuckDuckGoProvider implements WebSearchProvider {
  readonly name = 'duckduckgo';
  private readonly apiBase: string;

  constructor(
    config: Pick<WebSearchServiceRequest, 'baseUrl'> = { baseUrl: '' },
    private readonly dependencies: DuckDuckGoSearchDependencies = {},
  ) {
    this.apiBase = config.baseUrl;
  }

  async search(params: WebSearchParams): Promise<WebSearchResult[]> {
    const query = params.site ? `site:${params.site} ${params.query}` : params.query;
    const result = await duckDuckGoSearch({
      query,
      language: params.language,
      recencyDays: params.recencyDays,
      apiBase: this.apiBase,
      signal: params.signal,
    }, this.dependencies);
    return createSearchResults({
      query: params.query,
      provider: this.name,
      cached: false,
      latencyMs: result.tookMs,
      candidates: result.items.slice(0, params.topK ?? 10),
    });
  }
}
