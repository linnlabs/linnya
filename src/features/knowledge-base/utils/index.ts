/**
 * @file src/knowledge-base/utils/index.ts
 *
 * @brief 知识库工具函数模块导出
 *
 * @description
 * 导出知识库搜索、排序和文本处理函数。
 */

export { formatSearchResultsForLLM } from './searchUtils';
export { 
  rrfFusion, 
  applyIntelligentLayeredSorting 
} from './ranking';
