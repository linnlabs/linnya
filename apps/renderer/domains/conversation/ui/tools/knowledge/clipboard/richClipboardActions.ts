/**
 * @file richClipboardActions.ts
 * @description 对话侧“复制 / 导出”为公共工具函数（供 visual-row 操作行 / UiCardGroup 复用）
 *
 * 约束（中文，重要）：
 * - 不做 markdown -> html 的二次转换，避免与渲染层产生差异；
 * - 复制优先写入 `text/html + text/plain`，让表格/列表保持结构；
 * - 引用水合依赖渲染产物中 `ConversationCitationNode` 输出的 `data-citation-ref/data-turn-id`；
 * - 失败语义显式化：返回结构化结果，由调用方决定 UI 提示。
 */

import type { SearchResultCitation } from '@app/schemas'
import {
  projectConversationCitationsToEditorHtml,
  type ConversationCitationEditorProjectionStats,
} from '../../../../features/citation-presentation'
import {
  saveTurnAnswerAsDocument,
  type SaveTurnAnswerAsDocumentResult,
} from '../export/saveTurnAnswerAsDocument'
import type { ConversationMessageResolver } from '../../../../definitions/conversationMessages'

// ============================================================================
// 抽取已渲染 HTML（复用 Conversation 渲染层真实 DOM）
// ============================================================================

export interface ExtractRenderedAnswerHtmlParams {
  /**
   * 容器元素（按需回答渲染宿主 / UiCardGroup 根容器）
   */
  containerEl: HTMLElement | null
  /**
   * 复制片段 scope（用于调试 / 未来粘贴区分）
   */
  copyScope: string
  /** 仅抽取明确归属当前操作行的回答；省略时保留 card 级多回答语义。 */
  answerMessageIds?: readonly string[]
}

/**
 * 从已渲染 DOM 中提取“回答区域”的 HTML。
 *
 * 说明：
 * - `.message-type-final_answer` 来自 `Message.vue` 的 messageClasses；
 * - `.markstream-message-renderer` 来自 `MarkstreamRenderer.vue`；
 * - 最终返回的是一个 HTML 片段（非完整 document）。
 */
export function extractRenderedAnswerHtml(params: ExtractRenderedAnswerHtmlParams): string {
  const { containerEl, copyScope, answerMessageIds } = params
  if (!containerEl) return ''

  const targetMessageIds = answerMessageIds ? new Set(answerMessageIds) : null
  const answerRenderRoots = Array.from(
    containerEl.querySelectorAll<HTMLElement>(
      '.message-type-final_answer .markstream-message-renderer'
    )
  ).filter(root => {
    if (!targetMessageIds) return true
    const messageElement = root.closest<HTMLElement>('[data-conversation-message-id]')
    return (
      messageElement !== null &&
      targetMessageIds.has(messageElement.dataset.conversationMessageId ?? '')
    )
  })
  if (answerRenderRoots.length === 0) return ''

  const chunks: string[] = []
  for (const root of answerRenderRoots) {
    const html = root.innerHTML.trim()
    if (!html) continue
    chunks.push(`<div data-linnya-copy-scope="${copyScope}">${html}</div>`)
  }

  // 用分隔块保留“多条 final_answer”之间的自然间距
  return chunks.join('<div style="height: 12px"></div>')
}

// ============================================================================
// 富剪贴板复制（text/html + text/plain）+ 引用水合
// ============================================================================

export interface CopyRenderedAnswersToClipboardParams {
  /** 容器元素（用于抽取渲染 HTML） */
  containerEl: HTMLElement | null
  /** 纯文本内容（用于 text/plain） */
  plainText: string
  /** 复制片段 scope */
  copyScope: string
  answerMessageIds?: readonly string[]
  /** 引用查找函数（注入以避免直接依赖 store） */
  findCitationByRef: (turnId: string, ref: string) => SearchResultCitation | null
  /** 生成 citationId（每次复制生成新的 CitationNode 实例） */
  generateCitationId: () => string
  /** 对话域文案解析器（由 UI 按当前语言注入） */
  conversationMessage: ConversationMessageResolver
}

export interface CopyRenderedAnswersToClipboardResult {
  /** 是否成功写入剪贴板 */
  success: boolean
  /** 实际是否写入了 text/html（富剪贴板） */
  wroteHtml: boolean
  /** 引用水合统计信息（可用于日志） */
  hydrationStats?: ConversationCitationEditorProjectionStats
  /** 失败原因（成功时为空） */
  error?: string
}

export async function copyRenderedAnswersToClipboard(
  params: CopyRenderedAnswersToClipboardParams
): Promise<CopyRenderedAnswersToClipboardResult> {
  const {
    containerEl,
    plainText,
    copyScope,
    answerMessageIds,
    findCitationByRef,
    generateCitationId,
    conversationMessage,
  } = params

  const content = plainText
  if (!content || !content.trim()) {
    return {
      success: false,
      wroteHtml: false,
      error: conversationMessage('conversation.turn.copy.noContent'),
    }
  }

  const renderedHtmlRaw = extractRenderedAnswerHtml({ containerEl, copyScope, answerMessageIds })

  const canWriteRichClipboard =
    typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function'

  // 默认使用原始 HTML；若支持富剪贴板，则对引用节点做水合
  let finalHtml = renderedHtmlRaw
  let hydrationStats: ConversationCitationEditorProjectionStats | undefined
  if (canWriteRichClipboard && renderedHtmlRaw.trim()) {
    const hydrated = projectConversationCitationsToEditorHtml({
      renderedHtml: renderedHtmlRaw,
      findCitationByRef,
      generateCitationId,
    })
    finalHtml = hydrated.html
    hydrationStats = hydrated.stats
  }

  try {
    if (canWriteRichClipboard) {
      const items: Record<string, Blob> = {
        'text/plain': new Blob([content], { type: 'text/plain' }),
      }
      if (finalHtml.trim()) {
        items['text/html'] = new Blob([finalHtml], { type: 'text/html' })
      }
      await navigator.clipboard.write([new ClipboardItem(items)])
      return { success: true, wroteHtml: !!finalHtml.trim(), hydrationStats }
    }

    // 降级：至少保证纯文本可用
    await navigator.clipboard.writeText(content)
    return { success: true, wroteHtml: false }
  } catch (e) {
    console.error('[richClipboardActions] 复制渲染回答失败:', e)
    return {
      success: false,
      wroteHtml: false,
      hydrationStats,
      error: conversationMessage('conversation.turn.export.copyFailed'),
    }
  }
}

// ============================================================================
// 另存为工作区文档（复用 saveTurnAnswerAsDocument）
// ============================================================================

export interface ExportRenderedAnswersAsDocumentParams {
  /** 容器元素（用于抽取渲染 HTML） */
  containerEl: HTMLElement | null
  /** 纯文本内容（用于标题推导） */
  plainText: string
  /** 复制片段 scope（复用抽取函数） */
  copyScope: string
  answerMessageIds?: readonly string[]
  /** 引用查找函数（注入以避免直接依赖 store） */
  findCitationByRef: (turnId: string, ref: string) => SearchResultCitation | null
  /** 生成 citationId（每次导出生成新的 CitationNode 实例） */
  generateCitationId: () => string
  /** 对话域文案解析器（由 UI 按当前语言注入） */
  conversationMessage: ConversationMessageResolver
}

export interface ExportRenderedAnswersAsDocumentResult extends SaveTurnAnswerAsDocumentResult {
  /** 仅用于诊断：是否成功抽取到渲染 HTML */
  extractedHtml: boolean
}

export async function exportRenderedAnswersAsDocument(
  params: ExportRenderedAnswersAsDocumentParams
): Promise<ExportRenderedAnswersAsDocumentResult> {
  const {
    containerEl,
    plainText,
    copyScope,
    answerMessageIds,
    findCitationByRef,
    generateCitationId,
    conversationMessage,
  } = params

  const content = plainText
  if (!content || !content.trim()) {
    return {
      success: false,
      error: conversationMessage('conversation.turn.export.noContent'),
      extractedHtml: false,
    }
  }

  const renderedHtml = extractRenderedAnswerHtml({ containerEl, copyScope, answerMessageIds })
  if (!renderedHtml.trim()) {
    return {
      success: false,
      error: conversationMessage('conversation.turn.export.renderedHtmlMissing'),
      extractedHtml: false,
    }
  }

  const result = await saveTurnAnswerAsDocument({
    answerContent: content,
    renderedHtml,
    findCitationByRef,
    generateCitationId,
    conversationMessage,
  })

  return { ...result, extractedHtml: true }
}
