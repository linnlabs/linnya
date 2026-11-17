/**
 * @file citation/services/citationKbSearchService.ts
 * @description Citation KB 搜索服务（Phase 2）
 *
 * 职责：
 * - 并发调用多个 KB 的搜索接口
 * - 聚合、去重、排序搜索结果
 * - 为 CitationPanel 提供统一的搜索入口
 *
 * 设计说明：
 * - 通过 Editor 窄端口消费当前项目的插件搜索候选
 * - 不重复造轮子，只做薄封装与结果收敛
 */

import { getKnowledgeCitationSearchPort } from '../../../ports/knowledgeCitationSearchPort'
import type { CitationKbSearchItem } from '../definitions/knowledgeCitationSearch'
export type { CitationKbSearchItem } from '../definitions/knowledgeCitationSearch'
import { resolveCurrentEditorMessage } from '../../../functions/resolveCurrentEditorMessage'
import type { EditorMessageResolver } from '../../../definitions/editorMessages'

/**
 * 多 KB 搜索请求参数
 */
export interface CitationKbSearchRequest {
  projectId: string
  signal: AbortSignal
  /** 要搜索的 KB ID 列表 */
  kbIds: string[]
  /** KB ID 到名称的映射（UI 展示用） */
  kbIdToName: Record<string, string>
  /** 搜索关键词 */
  query: string
  /** UI 文案解析器，用于让调用方控制当前语言 */
  editorMessage?: EditorMessageResolver
  /** 每个 KB 取多少候选（默认 5） */
  topKPerKb?: number
  /** 最终返回条数（默认 15） */
  topKFinal?: number
}

/**
 * 多 KB 搜索结果
 */
export interface CitationKbSearchResult {
  /** 搜索结果列表（已去重、排序、截断） */
  results: CitationKbSearchItem[]
  /** 按 KB 维度的错误信息（kbId -> 错误消息） */
  errorsByKbId: Record<string, string>
  /** 是否有部分失败 */
  hasPartialFailure: boolean
}

/**
 * 截断文本生成 snippet
 * @param text 原始文本
 * @param maxLength 最大长度（默认 200）
 */
function truncateToSnippet(text: string, maxLength = 200): string {
  if (!text || text.length <= maxLength) {
    return text || ''
  }
  return text.slice(0, maxLength).trim() + '...'
}

/**
 * 在多个知识库中搜索并聚合结果
 *
 * 算法说明（与 phase2.md 对齐）：
 * 1. 并发请求：对每个 kbId 调用 searchInKnowledgeBase
 * 2. 收敛结构：把每条结果映射成 CitationKbSearchItem
 * 3. 去重规则：按 (docId, blockId) 去重；保留 score 更高的一条
 * 4. 排序：按 score desc
 * 5. 截断：取前 topKFinal 条
 *
 * 错误处理：
 * - 单个 KB 搜索失败不影响其它 KB 的结果
 * - 返回 errorsByKbId 以便 UI 展示失败原因
 */
export async function searchInMultipleKbs(
  request: CitationKbSearchRequest
): Promise<CitationKbSearchResult> {
  const {
    projectId,
    signal,
    kbIds,
    kbIdToName,
    query,
    topKPerKb = 5,
    topKFinal = 15,
  } = request
  const editorMessage = request.editorMessage ?? resolveCurrentEditorMessage
  signal.throwIfAborted()

  if (!kbIds || kbIds.length === 0) {
    return {
      results: [],
      errorsByKbId: {},
      hasPartialFailure: false,
    }
  }

  if (!query || query.trim().length === 0) {
    return {
      results: [],
      errorsByKbId: {},
      hasPartialFailure: false,
    }
  }

  const trimmedQuery = query.trim()

  // 并发请求所有 KB
  const searchPromises = kbIds.map(async (kbId) => {
    try {
      const rawResults = await getKnowledgeCitationSearchPort().searchLibrary({
        projectId,
        kbId,
        query: trimmedQuery,
        topK: topKPerKb,
      }, signal)
      signal.throwIfAborted()

      return {
        kbId,
        success: true,
        items: rawResults.map(item => ({
          kbId,
          kbName: kbIdToName[kbId] || kbId,
          docId: item.docId || '',
          docTitle: item.docTitle || editorMessage('editor.citation.fallback.unknownDocument'),
          blockId: item.blockId,
          page: item.page,
          score: item.score || 0,
          text: item.text || '',
          snippet: truncateToSnippet(item.text || ''),
        })),
        error: null,
      }
    } catch (error) {
      signal.throwIfAborted()
      console.error(`[citationKbSearchService] KB ${kbId} 搜索失败:`, error)
      const message = error instanceof Error && error.message.trim().length > 0
        ? error.message
        : editorMessage('editor.citation.kb.searchFailed')
      return {
        kbId,
        success: false,
        items: [],
        error: message,
      }
    }
  })

  const searchResults = await Promise.all(searchPromises)
  signal.throwIfAborted()

  // 收集错误
  const errorsByKbId: Record<string, string> = {}
  for (const result of searchResults) {
    if (!result.success && result.error) {
      errorsByKbId[result.kbId] = result.error
    }
  }

  // 聚合所有成功的结果
  const allItems: CitationKbSearchItem[] = []
  for (const result of searchResults) {
    if (result.success) {
      allItems.push(...result.items)
    }
  }

  // 去重：按 (docId, blockId) 去重，保留 score 更高的
  const dedupeMap = new Map<string, CitationKbSearchItem>()
  for (const item of allItems) {
    const key = `${item.docId}::${item.blockId || ''}`
    const existing = dedupeMap.get(key)
    if (!existing || item.score > existing.score) {
      dedupeMap.set(key, item)
    }
  }

  // 排序：按 score desc
  const sortedItems = Array.from(dedupeMap.values())
    .sort((a, b) => b.score - a.score)

  // 截断
  const finalItems = sortedItems.slice(0, topKFinal)

  return {
    results: finalItems,
    errorsByKbId,
    hasPartialFailure: Object.keys(errorsByKbId).length > 0,
  }
}

/**
 * 导出服务对象（便于后续扩展）
 */
export const citationKbSearchService = {
  searchInMultipleKbs,
}
