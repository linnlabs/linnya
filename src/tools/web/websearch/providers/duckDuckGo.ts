import type { WebSearchServiceRequest } from '../definitions/webSearchService';
import {
  duckDuckGoSearch,
  type DuckDuckGoSearchDependencies,
} from '../../../../infra/adapters/web-search/duckDuckGoSearchAdapter';
import { createSearchResults } from '../functions/createSearchResults';
import type { WebSearchConditionReport, WebSearchParams, WebSearchProvider, WebSearchResult } from './types';
import { describeBucketedRecency, describeSearchConditions, toEndpointIdentity } from '../functions/searchConditions';

export class DuckDuckGoProvider implements WebSearchProvider {
  readonly name = 'duckduckgo';
  private readonly apiBase: string;

  constructor(
    config: Pick<WebSearchServiceRequest, 'baseUrl'> = { baseUrl: '' },
    private readonly dependencies: DuckDuckGoSearchDependencies = {},
  ) {
    this.apiBase = config.baseUrl;
    this.endpoint = toEndpointIdentity(config.baseUrl, this.name);
  }
  readonly endpoint: string;

  /** 语言只能映射成中文或英文地区，其他语言不生效。 */
  describeConditions(params: WebSearchParams): WebSearchConditionReport[] {
    const language = params.language?.toLowerCase() ?? '';
    return describeSearchConditions(params, {
      site: { execution: 'applied', detail: 'via site: operator' },
      recency_days: describeBucketedRecency(params.recencyDays),
      language: language.startsWith('zh') || language.startsWith('en')
        ? { execution: 'preference', detail: 'as search region' }
        : 'unsupported',
    });
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
