/**
 * useDocumentRevisionToolbar.ts
 *
 * 文档级修订工具栏状态与操作：
 * - 计算当前文档是否需要显示"拒绝全部 / 接受全部"工具栏
 * - 聚合所有 pending 修订的统计信息（块数量 / 插入 / 删除）
 * - 暴露文档级接受 / 拒绝全部修订的方法
 *
 * 设计原则：
 * - 统计与操作统一基于 canonicalPendingSessions（唯一事实源），不受虚拟化影响
 * - 保持 EditorContent.vue 只做 UI 组合，复杂逻辑收敛到 composable 中
 */

import { computed, type ComputedRef, type Ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import {
  useRevisionStore,
  type RevisionStore,
} from '../store/useRevisionStore'
import { getFlag } from '../../../ui/services/editorFeatureFlags'
import { useNotificationStore } from '@/app/notification'
import { resolveCurrentEditorMessage } from '../../../functions/resolveCurrentEditorMessage'
import type { DocumentApplyAllStatus } from '../store/types'

/** 入参类型：从上层注入编辑器实例引用 */
export interface UseDocumentRevisionToolbarOptions {
  editor: Ref<Editor | null> | undefined
}

/** 返回类型：供 UI 使用的状态与操作 */
export interface UseDocumentRevisionToolbarResult {
  /** 是否显示文档级修订工具栏 */
  showRevisionGlobalToolbar: ComputedRef<boolean>
  /** 存在待处理修订的块数量 */
  pendingRevisionBlockCount: ComputedRef<number>
  /** 聚合后的插入 / 删除统计 */
  globalRevisionStats: ComputedRef<{
    insertCount: number
    deleteCount: number
  }>
  /** 是否暂缓了行内 revisionMark 投影 */
  isPendingProjectionDeferred: ComputedRef<boolean>
  /** 文档级：接受当前文档中所有块的待处理修订 */
  handleAcceptAllRevisionsInDocument: () => Promise<void>
  /** 文档级：拒绝当前文档中所有块的待处理修订 */
  handleRejectAllRevisionsInDocument: () => Promise<void>
}

export function useDocumentRevisionToolbar(
  options: UseDocumentRevisionToolbarOptions,
): UseDocumentRevisionToolbarResult {
  const { editor } = options
  const notificationStore = useNotificationStore()

  function reportDocumentApplyAllResult(status: DocumentApplyAllStatus): void {
    if (status !== 'reload-required') return
    notificationStore.show(
      resolveCurrentEditorMessage('editor.revision.error.reloadRequired'),
      'error',
      0
    )
  }

  const revisionStore = computed<RevisionStore | null>(() => {
    const instance = editor?.value
    if (!instance) return null
    return useRevisionStore(instance)
  })

  /**
   * 是否展示文档级修订工具栏
   *
   * 至少有两个及以上 pending 块时显示，避免只有一个块时与块级工具栏重复。
   * 基于 canonical 层，不受虚拟化影响。
   */
  const showRevisionGlobalToolbar = computed<boolean>(() => {
    const store = revisionStore.value
    if (!store) return false
    return store.canonicalPendingBlockCount.value > 1
  })

  /** 存在待处理修订的块数量（基于 canonical 层，不受虚拟化影响） */
  const pendingRevisionBlockCount = computed<number>(() => {
    const store = revisionStore.value
    if (!store) return 0
    return store.canonicalPendingBlockCount.value
  })

  /**
   * 聚合所有 pending 修订的插入 / 删除数量
   *
   * 基于 canonical 层的 diffStats。
   * diffStats 在 mark 投影完成后由 applier 回填，投影完成前按 0 处理。
   */
  const globalRevisionStats = computed<{ insertCount: number; deleteCount: number }>(() => {
    const store = revisionStore.value
    if (!store) {
      return { insertCount: 0, deleteCount: 0 }
    }
    return store.canonicalPendingStats.value
  })

  /** 大文档首开暂缓行内投影时，用户看不到逐块 diff，需要在 UI 上明确提示。 */
  const isPendingProjectionDeferred = computed<boolean>(() => {
    const store = revisionStore.value
    return store?.pendingProjectionDeferred.value ?? false
  })

  /** 文档级：接受所有 pending 修订 */
  async function handleAcceptAllRevisionsInDocument(): Promise<void> {
    const store = revisionStore.value
    if (!store) return
    try {
      const status = await store.acceptAllRevisionsInDocument()
      reportDocumentApplyAllResult(status)
      if (status === 'applied' && getFlag('revisionDebugLogging')) {
        console.log('[useDocumentRevisionToolbar] 文档级：已接受所有待处理修订')
      }
    } catch (error) {
      console.error('[useDocumentRevisionToolbar] 文档级接受修订失败:', error)
    }
  }

  /** 文档级：拒绝所有 pending 修订 */
  async function handleRejectAllRevisionsInDocument(): Promise<void> {
    const store = revisionStore.value
    if (!store) return
    try {
      const status = await store.rejectAllRevisionsInDocument()
      reportDocumentApplyAllResult(status)
      if (status === 'applied' && getFlag('revisionDebugLogging')) {
        console.log('[useDocumentRevisionToolbar] 文档级：已拒绝所有待处理修订')
      }
    } catch (error) {
      console.error('[useDocumentRevisionToolbar] 文档级拒绝修订失败:', error)
    }
  }

  return {
    showRevisionGlobalToolbar,
    pendingRevisionBlockCount,
    globalRevisionStats,
    isPendingProjectionDeferred,
    handleAcceptAllRevisionsInDocument,
    handleRejectAllRevisionsInDocument,
  }
}
