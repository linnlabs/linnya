/**
 * @file src/tools/knowledgebase/search/index.ts
 *
 * @brief 知识库搜索工具导出文件
 *
 * @description
 * 导出统一的知识库搜索工具：
 * 1. KnowledgeSearchTool - 统一搜索工具，支持全库搜索和单文档搜索
 * 
 * 这个工具使 Agent 能够在知识库中高效检索相关信息。
 */

// 导出工具类
export { KnowledgeSearchTool } from './KnowledgeSearchTool';
export { SearchInKnowledgeBaseTool } from './SearchInKnowledgeBaseTool';

// 导出工具类数组，用于批量注册
import { KnowledgeSearchTool } from './KnowledgeSearchTool';
import { SearchInKnowledgeBaseTool } from './SearchInKnowledgeBaseTool';

/**
 * 导出所有搜索工具类数组
 */
export const searchToolClasses = [
  KnowledgeSearchTool,
  SearchInKnowledgeBaseTool,
] as const;
