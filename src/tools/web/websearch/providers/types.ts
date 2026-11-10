/**
 * @file providers/types.ts
 * @description Web Search Provider 统一接口与返回结构
 *
 * 设计目标：
 * - 隔离不同搜索 API（Serper/Tavily/Bing 等）的认证、请求、返回结构差异
 * - 统一输出稳定的 WebSearchResult 结构，工具层只负责拼装与 citations 格式化
 */

import type { SearchResult } from '../../definitions/searchResult';

/** Provider 已完成统一映射后的搜索结果。 */
export type WebSearchResult = SearchResult;

/** Provider 搜索参数 */
export interface WebSearchParams {
  /** 执行级取消信号，用于终止正在进行的网络请求，不属于搜索语义。 */
  signal?: AbortSignal;
  /** 搜索查询词 */
  query: string;
  /** 最大返回结果数（默认由 provider 决定） */
  topK?: number;
  /** 时间范围限定（天数，如 7/30） */
  recencyDays?: number;
  /** 站点限定（如 "wikipedia.org"） */
  site?: string;
  /** 语言限定（如 "zh-CN"） */
  language?: string;
}

export type WebSearchConditionName = 'site' | 'recency_days' | 'language';

/**
 * applied：服务按条件过滤或接收该字段；preference：只作为排序偏好，结果可能不满足；
 * unsupported：本服务忽略该条件。
 */
export type WebSearchConditionExecution = 'applied' | 'preference' | 'unsupported';

export interface WebSearchConditionReport {
  readonly condition: WebSearchConditionName;
  readonly value: string;
  readonly execution: WebSearchConditionExecution;
  /** 例如时间窗被取整到“过去一周”。 */
  readonly detail?: string;
}

/** Web Search Provider 抽象接口 */
export interface WebSearchProvider {
  /** Provider 名称标识（用于日志和调试） */
  readonly name: string;
  /** 服务端点身份（自托管地址等），进入缓存键；不得含凭据。 */
  readonly endpoint?: string;
  /** 本次条件在该服务上的实际执行方式；未实现时观察结果标为未报告。 */
  describeConditions?(params: WebSearchParams): WebSearchConditionReport[];
  /** 执行搜索，返回统一结构的结果列表 */
  search(params: WebSearchParams): Promise<WebSearchResult[]>;
}
