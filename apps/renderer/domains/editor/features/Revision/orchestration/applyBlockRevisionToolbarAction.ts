import type { Editor } from '@tiptap/core'
import { useRevisionStore } from '../store/useRevisionStore'

export type BlockRevisionToolbarAction = 'accept' | 'reject'

export interface ApplyBlockRevisionToolbarActionParams {
  editor: Editor
  blockId: string
  action: BlockRevisionToolbarAction
}

/**
 * 执行块级修订工具栏动作。
 *
 * 中文说明：Host 只负责承载轻 UI，真正的接受 / 拒绝语义仍然由 Revision
 * feature 内部统一处理。这里作为窄编排入口，避免 BlockChromeHost 直接知道
 * RevisionStore 的动作细节，也避免把旧 useBlockRevision composable 搬进 Host。
 */
export async function applyBlockRevisionToolbarAction(
  params: ApplyBlockRevisionToolbarActionParams
): Promise<void> {
  const blockId = params.blockId.trim()
  if (!blockId) return

  const revisionStore = useRevisionStore(params.editor)
  if (!revisionStore.hasCanonicalPending(blockId) && !revisionStore.hasPendingRevision(blockId)) {
    return
  }

  if (params.action === 'accept') {
    await revisionStore.acceptAllRevisions(blockId)
    return
  }

  await revisionStore.rejectAllRevisions(blockId)
}
