import { computed, onBeforeUnmount, shallowRef, unref, type ComputedRef, type Ref } from 'vue'
import type { Editor } from '@tiptap/core'
import {
  getRevisionToolbarRuntimeSnapshot,
  subscribeRevisionToolbarRuntimeState,
} from './runtime/revisionToolbarRuntimeState'
import { useRevisionStore } from './store/useRevisionStore'
import {
  readRevisionIndicatorSummary,
  type RevisionIndicatorSummary,
} from './functions/readRevisionIndicatorSummary'

/**
 * Revision feature 的只读运行态。
 *
 * 中文说明：Revision overlay 负责判断“工具栏是否应该显示”，Host 只订阅结果。
 * 这样能避免把 hover / selection / pending 的组合规则复制到 BlockChromeHost。
 */
export function useRevisionToolbarRootBlockIds(): Ref<readonly string[]> {
  const blockIds = shallowRef(getRevisionToolbarRuntimeSnapshot().toolbarBlockIds)
  const unsubscribe = subscribeRevisionToolbarRuntimeState((snapshot) => {
    blockIds.value = snapshot.toolbarBlockIds
  })

  onBeforeUnmount(() => {
    unsubscribe()
  })

  return blockIds
}

/**
 * 有 canonical pending 的块列表。
 *
 * 中文说明：修订状态行是文档流里的常驻 pending header，不能绑定到 hover /
 * focus 这类 active chrome 来源。Host 只会再与当前 hydrated window 求交集。
 */
export function useRevisionIndicatorRootBlockIds(editor: Editor): ComputedRef<readonly string[]> {
  const revisionStore = useRevisionStore(editor)
  return computed(() => Object.keys(revisionStore.canonicalPendingSessions.value))
}

/**
 * Host 修订指示条的块级只读摘要。
 *
 * 中文说明：这里只读 canonical pending 事实源，不在 Host 渲染过程中触发
 * `getRevisionState()` 的文档扫描，也不执行 mark 投影。工具栏和接受/拒绝操作会在后续
 * surface 中继续通过 Revision feature 的编排入口处理。
 */
export function useRevisionIndicatorSummary(
  editor: Editor,
  blockId: Ref<string | null | undefined> | ComputedRef<string | null | undefined>
): ComputedRef<RevisionIndicatorSummary> {
  const revisionStore = useRevisionStore(editor)

  return computed(() => {
    const currentBlockId = unref(blockId)
    if (!currentBlockId) return readRevisionIndicatorSummary(null)
    return readRevisionIndicatorSummary(revisionStore.getCanonicalSession(currentBlockId))
  })
}

export { readRevisionIndicatorSummary }
export type { RevisionIndicatorSummary }
