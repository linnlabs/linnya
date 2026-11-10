/**
 * @file providers/serper.ts
 * @description Serper Provider，只负责搜索参数与统一结果映射。
 */

import type { WebSearchServiceRequest } from '../definitions/webSearchService';
import { serperSearch } from '../../../../infra/adapters/web-search/serperSearchAdapter';
import type { WebSearchConditionReport, WebSearchParams, WebSearchProvider, WebSearchResult } from './types';
import { bucketRecency, describeBucketedRecency, describeSearchConditions, toEndpointIdentity } from '../functions/searchConditions';
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
    this.endpoint = toEndpointIdentity(config.baseUrl, this.name);
  }
  readonly endpoint: string;

  /** site 用查询运算符；hl 只是界面语言，影响排序但不筛选结果语言。 */
  describeConditions(params: WebSearchParams): WebSearchConditionReport[] {
    return describeSearchConditions(params, {
      site: { execution: 'applied', detail: 'via site: operator' },
      recency_days: describeBucketedRecency(params.recencyDays),
      language: 'preference',
    });
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
        timeRange: bucketRecency(params.recencyDays),
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
