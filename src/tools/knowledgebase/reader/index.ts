/**
 * @file src/tools/knowledgebase/reader/index.ts
 *
 * @brief 知识库阅读工具导出文件
 *
 * @description
 * 导出所有知识库阅读工具类：
 * 1. ListKnowledgeBaseTool - 列出当前项目可访问的知识库及其文档
 * 2. KnowledgeReadTool - 按稳定 chunk 范围阅读文档内容
 *
 * 这些工具使 Agent 能够深度阅读和理解知识库中的具体内容。
 */

// 导出所有工具类
export { ListKnowledgeBaseTool } from './ListKnowledgeBaseTool';
export { KnowledgeReadTool } from './KnowledgeReadTool';

// 导出工具类数组，用于批量注册
import { ListKnowledgeBaseTool } from './ListKnowledgeBaseTool';
import { KnowledgeReadTool } from './KnowledgeReadTool';

/**
 * 导出所有阅读工具类数组
 */
export const readerToolClasses = [ListKnowledgeBaseTool, KnowledgeReadTool] as const;
