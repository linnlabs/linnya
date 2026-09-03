/**
 * @file saveTurnAnswerAsDocument.ts
 * @description 将对话轮次的回答内容另存为工作区文档
 *
 * Phase 2 职责：
 * - 从对话侧提取回答内容（HTML）
 * - 水合引用节点为编辑器 CitationNode DOM（支持 KB/Web）
 * - 委托 app-level workspace document export port 创建、打开、插入并保存
 *
 * 设计原则：
 * - 复用 CitationNode HTML 投影能力
 * - conversation domain 只表达“把 HTML 另存为工作区 Markdown 文档”的意图
 * - 失败语义显式化（数据缺失/保存失败必须明确提示）
 */

import type { SearchResultCitation } from '@app/schemas'
import { projectConversationCitationsToEditorHtml } from '../../../../features/citation-presentation'
import { getWorkspaceDocumentExportPort } from '../../../../../../shared/ports/workspaceDocumentExportPort'
import type { ConversationMessageResolver } from '../../../../definitions/conversationMessages'

/**
 * 另存参数
 */
export interface SaveTurnAnswerAsDocumentParams {
  /** 回答内容（纯文本，用于文件名提取） */
  answerContent: string
  /** 渲染后的 HTML（来自对话渲染层） */
  renderedHtml: string
  /** 引用查找函数（注入以避免直接依赖 store） */
  findCitationByRef: (turnId: string, ref: string) => SearchResultCitation | null
  /** 生成 citationId */
  generateCitationId: () => string
  /** 对话域文案解析器（由 UI / 编排层按当前语言注入） */
  conversationMessage: ConversationMessageResolver
}

/**
 * 另存结果
 */
export interface SaveTurnAnswerAsDocumentResult {
  /** 是否成功 */
  success: boolean
  /** 文档 ID（成功时返回） */
  documentId?: string
  /** 错误信息（失败时返回） */
  error?: string
  /** 水合统计信息（用于调试） */
  hydrationStats?: {
    total: number
    hydrated: number
    missing: Array<{ turnId: string; ref: string }>
  }
}

/**
 * 从回答内容中提取文档标题
 *
 * 策略（按优先级）：
 * 1. 报告第一行 `# 标题`（若存在）
 * 2. 兜底：`Deep Research 报告 - YYYY-MM-DD HHmm`
 */
function extractDocumentTitle(
  answerContent: string,
  conversationMessage: ConversationMessageResolver
): string {
  // 尝试提取 Markdown 一级标题
  const lines = answerContent.trim().split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('# ')) {
      const title = trimmed.substring(2).trim()
      if (title) return title
    }
  }

  // 兜底：使用时间戳
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10) // YYYY-MM-DD
  const timeStr = now.toTimeString().slice(0, 5).replace(':', '') // HHmm
  return conversationMessage('conversation.turn.saveAsDocument.defaultTitle', {
    date: dateStr,
    time: timeStr,
  })
}

/**
 * 将 Markdown 可能包含的内联语法清理为适合作为“工作区文件名”的纯文本。
 *
 * 约束（中文）：
 * - 工作区树节点名称应是纯文本，不应包含 Markdown 语法（例如 `**bold**`、`[text](url)`）
 * - 需要剔除跨平台不安全的文件名字符（/ \\ : * ? \" < > |）
 */
function sanitizeWorkspaceDocumentName(raw: string): string {
  const input = raw.trim()
  if (!input) return ''

  let s = input

  // 1) 图片/链接：![alt](url) / [text](url) -> alt/text
  s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')

  // 2) 行内代码：`code` -> code
  s = s.replace(/`([^`]+)`/g, '$1')

  // 3) 常见强调/删除线：**x**、__x__、*x*、_x_、~~x~~
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1')
  s = s.replace(/__([^_]+)__/g, '$1')
  s = s.replace(/\*([^*]+)\*/g, '$1')
  s = s.replace(/_([^_]+)_/g, '$1')
  s = s.replace(/~~([^~]+)~~/g, '$1')

  // 4) 轻量去 HTML 标签（避免标题里混入 <em> 等）
  s = s.replace(/<[^>]+>/g, '')

  // 5) 剔除跨平台不安全字符，避免创建/展示异常
  s = s.replace(/[\\/:*?"<>|]/g, ' ')

  // 6) 合并空白
  s = s.replace(/\s+/g, ' ').trim()

  return s
}

/**
 * 将对话轮次的回答内容另存为工作区文档
 *
 * @param params - 另存参数
 * @returns 另存结果
 */
export async function saveTurnAnswerAsDocument(
  params: SaveTurnAnswerAsDocumentParams
): Promise<SaveTurnAnswerAsDocumentResult> {
  const {
    answerContent,
    renderedHtml,
    findCitationByRef,
    generateCitationId,
    conversationMessage,
  } = params

  try {
    // -------------------------------------------------------------------------
    // 步骤 1：水合引用节点（复用 Phase 1）
    // -------------------------------------------------------------------------
    console.log('[saveTurnAnswerAsDocument] 开始水合引用节点...')
    const { html: hydratedHtml, stats } = projectConversationCitationsToEditorHtml({
      renderedHtml,
      findCitationByRef,
      generateCitationId,
    })

    console.log('[saveTurnAnswerAsDocument] 引用水合完成', {
      识别到的引用节点: stats.total,
      成功水合: stats.hydrated,
      失败数量: stats.missing.length,
    })

    // 如果有引用未能水合，打印警告（但不阻止另存）
    if (stats.missing.length > 0) {
      console.warn('[saveTurnAnswerAsDocument] 以下引用未能水合（元数据缺失）:', stats.missing)
    }

    // -------------------------------------------------------------------------
    // 步骤 2：创建新文档、打开、插入 HTML 并保存
    // -------------------------------------------------------------------------
    // 文档名必须是纯文本（不带 Markdown 语法）
    const rawTitle = extractDocumentTitle(answerContent, conversationMessage)
    const documentTitle = sanitizeWorkspaceDocumentName(rawTitle) || rawTitle

    console.log('[saveTurnAnswerAsDocument] 委托 workspace 导出文档...', {
      title: documentTitle,
    })

    const saveResult = await getWorkspaceDocumentExportPort().saveHtmlAsMarkdownDocument({
      name: documentTitle,
      html: hydratedHtml,
    })

    if (!saveResult.success) {
      console.error('[saveTurnAnswerAsDocument] workspace 文档导出失败:', saveResult.error)
      return {
        success: false,
        documentId: saveResult.documentId,
        error: conversationMessage('conversation.turn.saveAsDocument.failed'),
        hydrationStats: stats,
      }
    }

    console.log('[saveTurnAnswerAsDocument] 另存为文档完成', {
      documentId: saveResult.documentId,
    })

    return {
      success: true,
      documentId: saveResult.documentId,
      hydrationStats: stats,
    }
  } catch (error) {
    console.error('[saveTurnAnswerAsDocument] 另存失败:', error)
    return {
      success: false,
      error: conversationMessage('conversation.turn.saveAsDocument.failed'),
    }
  }
}
