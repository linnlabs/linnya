import type { Transaction } from 'prosemirror-state'

/**
 * 视觉事务的统一标记。
 *
 * 中文说明：
 * - pending revisionMark 投影、RootBlock hydrate/dehydrate、citation 派生刷新都只是“把已有状态渲染出来”；
 * - 它们不代表用户编辑，因此不能进入 undo/redo history；
 * - 否则 1 万块文档会把每次投影前后的大文档状态留在 history 里，内存会快速膨胀。
 */
export const EDITOR_EPHEMERAL_TRANSACTION_META = 'editorEphemeralTransaction'

export type EditorEphemeralTransactionReason =
  | 'pending-revision-projection'
  | 'render-virtualization'
  | 'citation-derivation'
  | 'document-load-projection'

export function markEphemeralTransaction(
  tr: Transaction,
  reason: EditorEphemeralTransactionReason
): Transaction {
  tr.setMeta('addToHistory', false)
  tr.setMeta(EDITOR_EPHEMERAL_TRANSACTION_META, reason)
  return tr
}

export function markPendingRevisionProjectionTransaction(tr: Transaction): Transaction {
  tr.setMeta('pendingRevisionApply', true)
  return markEphemeralTransaction(tr, 'pending-revision-projection')
}

export function getPendingRevisionProjectionTransactionMeta(): Record<string, unknown> {
  return {
    pendingRevisionApply: true,
    addToHistory: false,
    [EDITOR_EPHEMERAL_TRANSACTION_META]: 'pending-revision-projection',
  }
}

export function markCitationDerivationTransaction(tr: Transaction): Transaction {
  tr.setMeta('forceCitationDerivation', true)
  return markEphemeralTransaction(tr, 'citation-derivation')
}

/**
 * direct-state 装载完成、EditorView 切换之前的通用投影钩子。
 * 领域插件可以响应该 meta 修正派生文档结构，但 loader 不依赖任何具体领域。
 */
export function markDocumentLoadProjectionTransaction(tr: Transaction): Transaction {
  tr.setMeta('documentLoadProjection', true)
  return markEphemeralTransaction(tr, 'document-load-projection')
}

export function markRenderVirtualizationTransaction(tr: Transaction): Transaction {
  return markEphemeralTransaction(tr, 'render-virtualization')
}
