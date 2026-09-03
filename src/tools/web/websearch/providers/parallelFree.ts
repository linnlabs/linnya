import type { WebSearchServiceRequest } from '../definitions/webSearchService';
import {
  parallelFreeSearch,
  type ParallelFreeSearchDependencies,
} from '../../../../infra/adapters/web-search/parallelFreeSearchAdapter';
import { createSearchResults } from '../functions/createSearchResults';
import type { WebSearchParams, WebSearchProvider, WebSearchResult } from './types';

const MAX_DENSE_SNIPPET_CHARS = 1_200;

function buildSearchQuery(params: WebSearchParams): string {
  return params.site ? `site:${params.site} ${params.query}` : params.query;
}

function buildObjective(params: WebSearchParams): string {
  const parts = [params.query];
  if (params.site) parts.push(`优先查找 ${params.site} 域名中的资料。`);
  if (params.recencyDays) parts.push(`优先查找最近 ${params.recencyDays} 天发布或更新的资料。`);
  if (params.language) parts.push(`优先返回 ${params.language} 内容。`);
  return parts.join(' ');
}

export class ParallelFreeProvider implements WebSearchProvider {
  readonly name = 'parallel_free';
  private readonly apiBase: string;

  constructor(
    config: Pick<WebSearchServiceRequest, 'baseUrl'> = { baseUrl: '' },
    private readonly dependencies: ParallelFreeSearchDependencies = {},
  ) {
    this.apiBase = config.baseUrl;
  }

  async search(params: WebSearchParams): Promise<WebSearchResult[]> {
    const result = await parallelFreeSearch({
      query: buildObjective(params),
      searchQuery: buildSearchQuery(params),
      apiBase: this.apiBase,
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
        snippet: item.excerpts.join('\n\n').slice(0, MAX_DENSE_SNIPPET_CHARS),
        ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
      })),
    });
  }
}
