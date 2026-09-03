/**
 * blockRevisionActionResolver.ts
 *
 * 块级修订操作的前置解析器。
 *
 * 中文说明：
 * - RevisionStore 负责业务事务（命令、保存、清后端）；
 * - 本文件只负责把“用户要操作某块”转换成一个可执行的 pending revision state；
 * - 虚拟化场景下，canonical 是事实源，active revision 只是当前窗口的投影。
 */

import type { Ref } from 'vue'
import type { Editor } from '@tiptap/core'
import type {
  BlockRevisionActionOptions,
  BlockRevisionState,
  PendingProjectionResult,
} from './types'
import { hydrateRootBlockForInteraction } from '../../RenderVirtualization'

const REVISION_INTERACTION_PIN_MS = 800

export interface ResolvePendingBlockRevisionForActionParams {
  editor: Editor
  blockId: string
  options?: BlockRevisionActionOptions
  activeRevisions: Ref<Record<string, BlockRevisionState>>
  hasCanonicalPending: (blockId: string) => boolean
  projectPendingRevisionsForBlocks: (blockIds: string[]) => Promise<PendingProjectionResult>
  getRevisionState: (blockId: string) => BlockRevisionState | null
}

export async function resolvePendingBlockRevisionForAction(
  params: ResolvePendingBlockRevisionForActionParams
): Promise<BlockRevisionState | null> {
  if (params.options?.hydrateForInteraction !== false) {
    const hydrateResult = await hydrateRootBlockForInteraction(params.editor, params.blockId, {
      temporaryPinMs: REVISION_INTERACTION_PIN_MS,
    })
    if (!hydrateResult.ok) {
      console.warn('[RevisionStore] 块级修订操作 hydrate 失败，将继续尝试基于 doc 状态执行:', {
        blockId: params.blockId,
        reason: hydrateResult.reason,
      })
    }
  }

  let state = params.activeRevisions.value[params.blockId]
  if (state?.status === 'pending') return state

  if (params.hasCanonicalPending(params.blockId)) {
    // 中文说明：大文档会延迟 revisionMark materialize，块级操作前必须补齐这个窗口。
    await params.projectPendingRevisionsForBlocks([params.blockId])
    state = params.activeRevisions.value[params.blockId] ?? params.getRevisionState(params.blockId)
  }

  return state?.status === 'pending' ? state : null
}
