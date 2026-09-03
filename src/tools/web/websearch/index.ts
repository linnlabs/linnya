/**
 * @file src/tools/websearch/index.ts
 * @description 联网搜索工具模块入口
 */

import { WebSearchTool } from './WebSearchTool';

/** 联网搜索工具类列表（用于 allToolClasses 注册） */
export const webSearchToolClasses = [WebSearchTool] as const;
