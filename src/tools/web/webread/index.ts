/**
 * @file src/tools/webread/index.ts
 * @description 网页正文读取工具模块入口
 */

import { WebReadTool } from './WebReadTool';

/** 网页读取工具类列表（用于 allToolClasses 注册） */
export const webReadToolClasses = [WebReadTool] as const;
