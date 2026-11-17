/**
 * @file src/tools/knowledgebase/assemble/index.ts
 * @description 知识库“结果组装”工具导出
 */

export { AssembleDocumentsTool } from './AssembleDocumentsTool';

import { AssembleDocumentsTool } from './AssembleDocumentsTool';

/**
 * 导出所有组装工具类数组
 */
// 中文备注：
// - AssembleDocumentsTool：deep_search 的内部收口工具（工具结束后可 terminateRun）。
// - Knowledge/Web 证据由正式生产者在返回 Agent 前自动捕获，不再注册额外物化工具。
export const assembleToolClasses = [AssembleDocumentsTool] as const;
