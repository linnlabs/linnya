/**
 * @file src/tools/webread/index.ts
 * @description 网页正文读取工具模块入口
 */

import { WebReadTool } from './WebReadTool';
export { WEB_READ_SERVICE_DEFINITIONS } from './definitions/webReadService';

/** 网页读取工具类列表（用于 allToolClasses 注册） */
export const webReadToolClasses = [WebReadTool] as const;
