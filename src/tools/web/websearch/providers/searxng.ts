import type { WebSearchServiceRequest } from '../definitions/webSearchService';
import {
  searxngSearch,
  type SearXNGSearchDependencies,
} from '../../../../infra/adapters/web-search/searxngSearchAdapter';
import { createSearchResults } from '../functions/createSearchResults';
import type { WebSearchParams, WebSearchProvider, WebSearchResult } from './types';

export class SearXNGProvider implements WebSearchProvider {
  readonly name = 'searxng';
  private readonly apiBase: string;

  constructor(
    config: Pick<WebSearchServiceRequest, 'baseUrl'>,
    private readonly dependencies: SearXNGSearchDependencies = {},
  ) {
    this.apiBase = config.baseUrl;
  }

  async search(params: WebSearchParams): Promise<WebSearchResult[]> {
    const query = params.site ? `site:${params.site} ${params.query}` : params.query;
    const result = await searxngSearch({
      apiBase: this.apiBase,
      query,
      language: params.language,
      recencyDays: params.recencyDays,
      signal: params.signal,
    }, this.dependencies);
    return createSearchResults({
      query: params.query,
      provider: this.name,
      cached: false,
      latencyMs: result.tookMs,
      candidates: result.items.slice(0, params.topK ?? 10).map((item) => ({
        url: item.url,
        title: item.title,
        snippet: item.snippet,
        ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
        ...(item.score !== undefined ? { providerScore: item.score } : {}),
      })),
    });
  }
}
