/**
 * @file src/features/knowledge-base/application/searchService.ts
 *
 * @brief SearchService 的对外稳定导出入口（Barrel）。
 *
 * 说明：
 * - 历史上该文件承载了全部实现，导致文件过长；
 * - 现已按职责拆分到 `application/search/*`，该文件只负责 re-export，
 *   以保持对外 import 路径稳定、降低跨模块耦合。
 */

export type {
  RankedRetrievedPoint,
  SearchRanker,
  SearchService,
  SearchServiceOptions,
} from './search/types';

export { DefaultSearchRanker } from './search/defaultSearchRanker';
export { DefaultSearchService } from './search/defaultSearchService';