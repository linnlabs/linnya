/**
 * Pending Revision 相关的类型定义
 * 提供所有与 pending revision 应用相关的类型接口
 */

import type { Editor } from '@tiptap/core'

/**
 * Pending revision 操作类型
 */
export type PendingRevisionOperation = 'update' | 'insert' | 'delete'

/**
 * 数据库中的 pending revision DTO
 */
export interface PendingRevisionDTO {
  id: string
  conversationId: string
  blockId: string | null
  operation: PendingRevisionOperation
  originalMarkdown: string | null
  newMarkdown: string | null
  createdAt?: number
  metadata?: Record<string, unknown>
  metaJson?: string | null
}

/**
 * 解析后的 pending revision（增加 shouldRetry）
 */
export interface ParsedPendingRevision extends PendingRevisionDTO {
  shouldRetry: boolean
}

/**
 * 单条应用的详细结果
 */
export interface ApplyDetail {
  id: string
  success: boolean
  operation: PendingRevisionOperation
  blockId: string | null
  reason?: string
}

/**
 * 批量应用 pending revisions 的结果
 */
export interface ApplyPendingRevisionsResult {
  successIds: string[]
  failedIds: string[]
  details: ApplyDetail[]
}

/**
 * 应用器函数类型
 */
export type RevisionApplier = (
  editor: Editor,
  revision: PendingRevisionDTO
) => { success: boolean; reason?: string }

