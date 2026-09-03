/**
 * @file citation/adapters/knowledgeBaseCitationAdapter.ts
 * @description KB 搜索结果 -> CitationNodeAttrs 映射适配器（Phase 2）
 *
 * 职责：
 * - 将 KB 搜索结果转换为 CitationNode 所需的 attrs 结构
 * - 保持类型安全，避免运行时错误
 */

import type { CitationNodeAttrs } from '../types'
import type { CitationKbSearchItem } from '../services/citationKbSearchService'
import { resolveCurrentEditorMessage } from '../../../functions/resolveCurrentEditorMessage'

/**
 * 将 KB 搜索结果转换为 CitationNodeAttrs
 *
 * @param item KB 搜索结果项
 * @returns CitationNodeAttrs（不含 citationId，由 CitationNode 自动生成）
 */
export function convertKbResultToCitationAttrs(
  item: CitationKbSearchItem,
  options: { readonly unknownDocumentTitle?: string } = {}
): Omit<CitationNodeAttrs, 'citationId'> {
  const blockId = item.blockId?.trim()
  if (!blockId) {
    throw new Error(
      `[knowledgeBaseCitationAdapter] Knowledge 引用缺少精确 blockId: kbId=${item.kbId}, docId=${item.docId}`
    )
  }

  const unknownDocumentTitle =
    options.unknownDocumentTitle ??
    resolveCurrentEditorMessage('editor.citation.fallback.unknownDocument')

  return {
    sourceType: 'knowledge_base',
    // sourceId 使用 docId（与 phase2.md 对齐）
    sourceId: item.docId,
    // 中文说明：kbId 用于“查看来源/跳转到知识库”精确定位（多知识库场景必需）
    kbId: item.kbId,
    blockId,
    title: item.docTitle || unknownDocumentTitle,
    snippet: item.snippet || item.text || '',
    // 预留字段暂不填充
    authors: undefined,
    date: undefined,
    url: undefined,
    containerTitle: undefined,
  }
}

/**
 * 导出适配器对象（便于后续扩展）
 */
export const knowledgeBaseCitationAdapter = {
  convertKbResultToCitationAttrs,
}
