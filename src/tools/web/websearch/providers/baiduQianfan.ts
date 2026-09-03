/**
 * @file src/tools/websearch/providers/baiduQianfan.ts
 * @description 百度千帆 web_search Provider 实现
 */

import type { WebSearchServiceRequest } from '../definitions/webSearchService';
import type { WebSearchParams, WebSearchProvider, WebSearchResult } from './types';
import {
  baiduQianfanWebSearch,
  type BaiduQianfanSearchRecencyFilter,
} from '../../../../infra/adapters/web-search/baiduQianfanWebSearchAdapter';
import { createSearchResults } from '../functions/createSearchResults';

const DEFAULT_BLOCKED_HOSTS = new Set<string>(['baijiahao.baidu.com']);

function toRecencyFilter(recencyDays: number | undefined): BaiduQianfanSearchRecencyFilter | undefined {
  if (typeof recencyDays !== 'number' || !Number.isFinite(recencyDays) || recencyDays <= 0) return undefined;

  // 中文备注：千帆接口使用离散枚举；这里按“最接近且不低估”映射。
  if (recencyDays <= 7) return 'week';
  if (recencyDays <= 30) return 'month';
  if (recencyDays <= 180) return 'semiyear';
  if (recencyDays <= 365) return 'year';
  return undefined;
}

export class BaiduQianfanProvider implements WebSearchProvider {
  readonly name = 'baidu_qianfan_web_search';
  private readonly apiBase: string;
  private readonly apiKey: string;
  constructor(config: WebSearchServiceRequest) {
    this.apiBase = config.baseUrl;
    this.apiKey = config.apiKey ?? '';
    if (!this.apiKey) {
      throw new Error(
        '百度千帆 web_search API Key 未配置。'
      );
    }
  }

  async search(params: WebSearchParams): Promise<WebSearchResult[]> {
    const { query, topK = 10, site, recencyDays } = params;

    const parsed = await baiduQianfanWebSearch({
      apiBase: this.apiBase,
      apiKey: this.apiKey,
      request: {
        query,
        topK,
        site,
        recencyFilter: toRecencyFilter(recencyDays),
      },
      signal: params.signal,
    });

    const candidates = parsed.references
      .filter((ref) => ref.type === 'web')
      .filter((ref) => {
        try {
          const host = new URL(ref.url).hostname;
          return !DEFAULT_BLOCKED_HOSTS.has(host);
        } catch {
          // URL 解析失败则不过滤（让工具层仍能返回该条，便于暴露上游异常数据）
          return true;
        }
      })
      .map((ref) => ({
        title: ref.title,
        url: ref.url,
        snippet: ref.content,
        ...(ref.date ? { publishedAt: ref.date } : {}),
      }));
    return createSearchResults({
      query,
      provider: this.name,
      cached: false,
      latencyMs: parsed.tookMs,
      candidates,
    });
  }
}
