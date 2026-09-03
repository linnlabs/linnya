/**
 * @file serializeRevisionBaselineForSave.ts
 * @description 将当前编辑器内容序列化为可落库的基线文档。
 *
 * Revision 的 pending 投影只属于前端交互视图，`content_json` 必须始终保存基线内容。
 * 因此所有保存入口在写入后端前，都必须通过这里统一剥离 revisionMark 投影。
 */

import type { Editor } from '@tiptap/core'
import type { CanonicalPendingSession } from '../store/types'
import { useRevisionStore } from '../store/useRevisionStore'
import { stripWorkspacePendingFromJSON } from '../utils/stripPendingFromJSON'

type JSONNode = Record<string, unknown>

function stringifyEditorJSON(content: JSONNode): string {
  const replacer = (_key: string, value: unknown) => {
    if (value instanceof Map) {
      return Object.fromEntries(value)
    }
    if (value instanceof Set) {
      return Array.from(value)
    }
    if (value instanceof Date) {
      return value.toISOString()
    }
    if (typeof value === 'function' || typeof value === 'symbol') {
      return undefined
    }
    if (value instanceof ArrayBuffer) {
      return Array.from(new Uint8Array(value))
    }
    if (ArrayBuffer.isView(value)) {
      return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
    }
    return value
  }

  try {
    return JSON.stringify(content, replacer)
  } catch (error) {
    console.error('[serializeRevisionBaselineForSave] Failed to serialize editor content', error)
    return JSON.stringify(content)
  }
}

export function serializeRevisionBaselineForSave(editor: Editor): string {
  let content = editor.getJSON() as JSONNode
  let canonicalSessions: Record<string, CanonicalPendingSession> = {}

  // 保存前先做一次 canonical 对账，避免 undo 恢复的离屏块投影残留到 content_json。
  try {
    const revisionStore = useRevisionStore(editor)
    revisionStore.reconcileCanonicalWithDocument()
    canonicalSessions = revisionStore.canonicalPendingSessions.value
  } catch {
    // Revision store 未初始化时，strip 函数仍会清理孤儿 revisionMark。
  }

  content = stripWorkspacePendingFromJSON(content, canonicalSessions)
  return stringifyEditorJSON(content)
}
