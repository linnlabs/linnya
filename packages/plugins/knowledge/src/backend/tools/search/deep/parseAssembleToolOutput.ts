/**
 * @file src/tools/knowledgebase/search/deep/parseAssembleToolOutput.ts
 * @description 解析 assemble_documents 的 tool_output 为搜索证据事实
 *
 * 注意：
 * - 这里不做“静默兜底”：结构不符合预期必须抛错暴露根因（避免错误引用进入上层）。
 */

import { AssembleDocumentsToolOutputSchema } from '@app/schemas';
import type { KnowledgeSearchDocument } from '../types';

export function parseAssembleToolOutputToDocuments(toolOutput: string): KnowledgeSearchDocument[] {
  const parsed = JSON.parse(toolOutput) as unknown;
  const output = AssembleDocumentsToolOutputSchema.parse(parsed);
  return output.data.kept.map(item => ({
    doc_id: item.doc_id,
    block_id: item.block_id,
    doc_name: item.doc_name,
    snippet: item.snippet,
  }));
}

/**
 * 从 assemble_documents 的 tool_output 中提取 summary（用于上层 knowledge_search 的执行摘要）
 *
 * 重要约束：
 * - summary 属于“工具压缩机制”的输入，不应被写入 observation（避免污染上层 AI）
 * - 这里不做“猜测式兜底”：结构不符合预期时直接返回 undefined，由上层决定是否降级摘要
 */
export function parseAssembleToolOutputSummary(toolOutput: string): string | undefined {
  const parsed = JSON.parse(toolOutput) as unknown;
  return AssembleDocumentsToolOutputSchema.parse(parsed).data.summary;
}
