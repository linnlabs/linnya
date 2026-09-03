/**
 * @file useRevisionStore.ts
 * @description AI 修订模式的状态管理
 *
 * 架构：
 * - canonicalPendingSessions：由后端 pendingRevisions 快照直接构建的唯一事实源。
 *   全局统计、文档级接受/拒绝、块级是否有 pending 都从这里派生。
 *   不受 undo/redo、块可见性、doc mark 扫描的影响。
 * - activeRevisions：mark 投影层的运行时状态，用于块级 UI 详细交互。
 */

import { ref, computed } from 'vue'
import type { Editor } from '@tiptap/core'
import type { RevisionChangeType } from '../../../extensions/revision/RevisionMark'
import { useFileStore } from '../../../../../shared/stores/file'
import type { PendingRevisionDTO as WorkspacePendingRevisionDTO } from '../../../../../shared/ipc/workspaceGateway'
import type {
  RevisionStore,
  BlockRevisionState,
  StartRevisionParams,
  CanonicalPendingSession,
  DocumentApplyAllStatus,
  PendingProjectionResult,
} from './types'
import { findRootBlockPosById } from '../utils/pending/pendingRevisionHelpers'
import { createBackendPendingApi } from './backendPending'
import { scanBlockForRevisions } from './revisionMarkScan'
import { updateDiffStats as updateDiffStatsImpl, updateDiffStatsAfterSingleAction as updateDiffStatsAfterSingleActionImpl } from './diffStats'
import { setWorkspacePendingRevisionsImpl } from './workspacePending'
import { requestSave } from '../../../../workspace/services/file-manager/index'
import { parsePendingMeta } from '../utils/pending/pendingMeta'
import { getFlag } from '../../../ui/services/editorFeatureFlags'
import { applyAllPendingInBackend } from './documentApplyAll'
import { projectPendingRevisionsForBlocks as projectPendingRevisionsForBlocksImpl } from './pendingProjectionWindow'
import { createRevisionReconciliation } from './revisionReconciliation'
import { createRevisionBlockActions } from './revisionBlockActions'

// ==================== 类型定义 ====================

const PENDING_PROJECTION_PUBLIC_BATCH_SIZE = 20

/**
 * 扩展后的 Editor 类型，包含修订相关命令
 * 这些命令在 `RevisionCommands.js` 中注册为 Tiptap RawCommands
 */
interface EditorWithRevisionCommands extends Editor {
  _isPendingRevisionBatch?: boolean
  commands: Editor['commands'] & {
    acceptAllRevisionsInBlock: (blockPos: number, revisionId: string) => boolean
    rejectAllRevisionsInBlock: (blockPos: number, revisionId: string) => boolean
    clearBlockRevisionMarks: (blockPos: number, revisionId?: string | null) => boolean
  }
}

// ✅ 类型已拆分到 `store/types.ts`，这里仅保留实现。

// ==================== 单例管理 ====================
const storeInstances = new WeakMap<Editor, RevisionStore>()

/**
 * 获取或创建修订状态 Store
 *
 * 这是一个基于 Editor 实例的单例模式。
 * 在应用的不同部分（组件、菜单 Provider），只要能访问到同一个 editor 实例，
 * 就能获取到同一个 Store 实例，从而实现状态共享。
 *
 * @param editor - Editor 实例
 * @returns 修订状态 Store
 */
export function useRevisionStore(editor: Editor): RevisionStore {
  if (!storeInstances.has(editor)) {
    // 这里做一次类型收窄，避免使用 any 断言
    storeInstances.set(editor, createRevisionStore(editor as EditorWithRevisionCommands))
  }
  return storeInstances.get(editor)!
}

// ---------------------------------------------------------------------------
// ✅ 向后兼容：历史上部分调用方会从 `store/useRevisionStore.ts` 直接 import 类型。
// 现在类型已拆到 `store/types.ts`，这里做一次 re-export，避免大范围改动。
// ---------------------------------------------------------------------------
export type {
  RevisionStore,
  BlockRevisionState,
  BlockRevisionActionOptions,
  RevisionStatus,
  StartRevisionParams,
  CanonicalPendingSession,
  DocumentApplyAllStatus,
  PendingProjectionResult,
} from './types'

/**
 * 创建修订状态 Store 的内部实现
 */
function createRevisionStore(editor: EditorWithRevisionCommands): RevisionStore {
  // ---- Canonical 事实源（由后端 pendingRevisions 快照直接构建，不受虚拟化影响） ----
  const canonicalPendingSessions = ref<Record<string, CanonicalPendingSession>>({})

  // ---- Mark 投影层（块级 UI 运行时状态） ----
  const activeRevisions = ref<Record<string, BlockRevisionState>>({})
  const fileStore = useFileStore()
  const backendPendingApi = createBackendPendingApi(fileStore)
  const docRevisionScanCache = new WeakMap<object, Map<string, { blockPos: number | null; scanResult: ReturnType<typeof scanBlockForRevisions> | null }>>()
  const missingCanonicalRecoveryLogged = new Set<string>()

  function getCachedBlockRevisionScan(blockId: string): { blockPos: number | null; scanResult: ReturnType<typeof scanBlockForRevisions> | null } {
    const doc = editor.state.doc
    let docCache = docRevisionScanCache.get(doc)
    if (!docCache) {
      docCache = new Map()
      docRevisionScanCache.set(doc, docCache)
    }

    const cached = docCache.get(blockId)
    if (cached) return cached

    const blockPos = findRootBlockPosById(editor, blockId)
    const scanResult = blockPos != null ? scanBlockForRevisions(editor, blockPos) : null
    const entry = { blockPos, scanResult }
    docCache.set(blockId, entry)
    return entry
  }

  const clearPendingRevisionInBackend = backendPendingApi.clearPendingRevisionInBackend
  const clearAllPendingRevisionsInBackend = backendPendingApi.clearAllPendingRevisionsInBackend

  // ---- Shadow DTO Cache：保留原始 DTO，供 undo 后恢复后端同步用 ----
  const pendingDTOShadow = new Map<string, WorkspacePendingRevisionDTO>()
  const projectingPendingBlockIds = new Set<string>()

  const reconciliation = createRevisionReconciliation({
    editor,
    canonicalPendingSessions,
    activeRevisions,
    pendingDTOShadow,
    hasCanonicalPending,
    clearPendingRevisionInBackend,
    setPendingRevisionsBatchInBackend: backendPendingApi.setPendingRevisionsBatchInBackend,
  })

  // 在 store 创建时注册事务监听器
  reconciliation.registerTransactionListener()

  /**
   * 触发一次"静默保存"（不弹"已保存"提示）。
   *
   * 设计背景（重要）：
   * - workspace pending 的"真实正文"存储在 content_json；
   * - 你点击接受/拒绝时，编辑器内容会变化，同时我们会清理后端 pending；
   * - 如果不立刻保存，存在窗口期：pending 已清，但 content_json 仍是旧的 → 崩溃/刷新就会丢失用户决策。
   *
   * 因此这里把"接受/拒绝"提升为一次小事务：应用到 editor → 立即保存 → 保存成功再清 pending。
   */
  async function saveDocumentSilently(): Promise<boolean> {
    try {
      return await requestSave('auto')
    } catch (e) {
      console.error('[RevisionStore] saveDocumentSilently: 保存失败:', e)
      return false
    }
  }

  function clearPendingRuntimeCaches(): void {
    clearAllRevisions()
    pendingDTOShadow.clear()
    projectingPendingBlockIds.clear()
    reconciliation.clear()
  }

  // ==================== Canonical 层计算属性 ====================

  /** canonical 层：有待处理修订的块数量（keyed by blockId，每个 blockId 最多一条） */
  const canonicalPendingBlockCount = computed(() => {
    return Object.keys(canonicalPendingSessions.value).length
  })

  /** canonical 层：是否有任何待处理修订 */
  const canonicalHasAnyPending = computed(() => {
    return Object.keys(canonicalPendingSessions.value).length > 0
  })

  /** canonical 层：聚合 +/- 统计（diffStats 未回填的块按 0 处理） */
  const canonicalPendingStats = computed(() => {
    let insertCount = 0
    let deleteCount = 0
    for (const session of Object.values(canonicalPendingSessions.value)) {
      if (session.diffStats) {
        insertCount += session.diffStats.insertCount
        deleteCount += session.diffStats.deleteCount
      }
    }
    return { insertCount, deleteCount }
  })

  /** mark 投影层：已经真实投影到编辑器中的块数量 */
  const activeRevisionCount = computed(() => {
    return Object.keys(activeRevisions.value).length
  })

  /**
   * 大文档首开暂缓行内投影时，canonical 有数据但 active 为空。
   * 中文说明：此时全局 Accept/Reject All 仍然可用，但用户还看不到逐块行内 diff，
   * UI 层必须把批量操作标成高风险动作，避免误点。
   */
  const pendingProjectionDeferred = computed(() => {
    return canonicalPendingBlockCount.value > 0 && activeRevisionCount.value === 0
  })

  function hasCanonicalPending(blockId: string): boolean {
    return blockId in canonicalPendingSessions.value
  }

  function getCanonicalSession(blockId: string): CanonicalPendingSession | null {
    return canonicalPendingSessions.value[blockId] ?? null
  }

  function waitForNextAnimationFrame(): Promise<void> {
    if (typeof requestAnimationFrame === 'function') {
      return new Promise((resolve) => requestAnimationFrame(() => resolve()))
    }
    return new Promise((resolve) => setTimeout(resolve, 0))
  }

  function uniqueBlockIds(blockIds: string[]): string[] {
    const seen = new Set<string>()
    const result: string[] = []
    for (const blockId of blockIds) {
      if (typeof blockId !== 'string' || blockId.length === 0 || seen.has(blockId)) continue
      seen.add(blockId)
      result.push(blockId)
    }
    return result
  }

  function createEmptyProjectionResult(requestedCount: number): PendingProjectionResult {
    return {
      requestedCount,
      batchCount: 0,
      projectedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      totalMs: 0,
      flushMs: 0,
    }
  }

  function getProjectionErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  async function projectPendingRevisionsForBlocks(blockIds: string[]): Promise<PendingProjectionResult> {
    const startedAt = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()
    const requestedBlockIds = uniqueBlockIds(blockIds)
    const aggregate = createEmptyProjectionResult(requestedBlockIds.length)

    for (let index = 0; index < requestedBlockIds.length; index += PENDING_PROJECTION_PUBLIC_BATCH_SIZE) {
      const batch = requestedBlockIds.slice(index, index + PENDING_PROJECTION_PUBLIC_BATCH_SIZE)
      try {
        const result = await projectPendingRevisionsForBlocksImpl({
          editor,
          blockIds: batch,
          canonicalPendingSessions,
          activeRevisions,
          pendingDTOShadow,
          projectingBlockIds: projectingPendingBlockIds,
          maxBatchSize: PENDING_PROJECTION_PUBLIC_BATCH_SIZE,
        })
        aggregate.batchCount += result.batchCount
        aggregate.projectedCount += result.projectedCount
        aggregate.skippedCount += result.skippedCount
        aggregate.failedCount += result.failedCount
        aggregate.flushMs += result.flushMs
        if (result.errors?.length) {
          aggregate.errors = [...(aggregate.errors ?? []), ...result.errors]
        }
      } catch (error) {
        const message = getProjectionErrorMessage(error)
        aggregate.failedCount += batch.length
        aggregate.errors = [
          ...(aggregate.errors ?? []),
          { blockIds: batch, message },
        ]
        console.error('[RevisionStore] pending 投影窗口失败:', { blockIds: batch, error })
      }

      if (index + PENDING_PROJECTION_PUBLIC_BATCH_SIZE < requestedBlockIds.length) {
        await waitForNextAnimationFrame()
      }
    }

    const endedAt = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()
    aggregate.totalMs = Math.round((endedAt - startedAt) * 10) / 10
    aggregate.flushMs = Math.round(aggregate.flushMs * 10) / 10
    return aggregate
  }

  // ==================== 方法 ====================

  /**
   * 启动一个新的修订会话
   */
  function startRevision(params: StartRevisionParams): void {
    const { blockId, revisionId, operation, fromVersionId, toVersionId, diffStats, createdAt } = params

    if (getFlag('revisionDebugLogging')) {
      console.log('[RevisionStore] startRevision:', { blockId, revisionId, diffStats })
    }

    const existing = activeRevisions.value[blockId]
    const shouldReuseExistingCreatedAt =
      existing != null && existing.revisionId === revisionId && typeof existing.createdAt === 'number'
    const finalCreatedAt =
      typeof createdAt === 'number'
        ? createdAt
        : shouldReuseExistingCreatedAt
          ? existing.createdAt
          : Date.now()

    activeRevisions.value[blockId] = {
      blockId,
      revisionId,
      status: 'pending',
      operation,
      fromVersionId,
      toVersionId,
      diffStats,
      createdAt: finalCreatedAt,
    }

    // 同步回填 canonical session 的 diffStats（applier 调用 startRevision 时已经计算好了 diff）
    const canonicalSession = canonicalPendingSessions.value[blockId]
    if (canonicalSession && diffStats) {
      canonicalPendingSessions.value[blockId] = {
        ...canonicalSession,
        diffStats,
      }
    }
  }

  async function clearBackendPendingForBlock(blockId: string): Promise<void> {
    await clearPendingRevisionInBackend(blockId)
  }

  /**
   * 获取块的修订状态
   * 注意：status 会根据当前文档中的 revisionMark 动态"校正"，
   * 这样在用户执行撤销/重做后，Store 状态可以自动与文档保持一致。
   */
  function getRevisionState(blockId: string): BlockRevisionState | null {
    let current = activeRevisions.value[blockId]

    // 仅在 canonical 已存在时，允许用文档 mark 恢复投影层缓存。
    // 如果 mark 存在但 canonical 缺失，则这是孤儿投影，不再作为合法修订状态。
    if (!current) {
      const { blockPos, scanResult } = getCachedBlockRevisionScan(blockId)
      if (blockPos != null && scanResult) {
        if (hasCanonicalPending(blockId)) {
          // canonical 存在但 activeRevisions 缺失（可能被虚拟化回收），从 mark 恢复投影层缓存
          current = {
            blockId,
            revisionId: scanResult.revisionId,
            status: 'pending',
            diffStats: scanResult.diffStats,
            createdAt: Date.now(),
          }
          activeRevisions.value[blockId] = current
        } else if (!missingCanonicalRecoveryLogged.has(blockId)) {
          missingCanonicalRecoveryLogged.add(blockId)
          console.warn('[RevisionStore] getRevisionState: 文档存在 orphan revisionMark，但 canonical 缺失', {
            blockId,
            revisionId: scanResult.revisionId,
            canonicalBlockCount: Object.keys(canonicalPendingSessions.value).length,
          })
        }
      }
    }

    if (!current) return null

    const { revisionId, status } = current
    const { blockPos, scanResult: recoveredFromDoc } = getCachedBlockRevisionScan(blockId)

    if (blockPos == null) {
      return current
    }

    const hasMarks = recoveredFromDoc?.revisionId === revisionId

    // 情况 1：文档里有对应 revisionId 的标记，但状态不是 pending -> 说明经历过撤销，应恢复为 pending
    if (hasMarks && status !== 'pending') {
      if (getFlag('revisionDebugLogging')) {
        console.log('[RevisionStore] getRevisionState: 状态校正 -> pending', blockId)
      }
      const nextState: BlockRevisionState = {
        ...current,
        status: 'pending',
        diffStats: recoveredFromDoc?.diffStats ?? current.diffStats,
      }
      activeRevisions.value[blockId] = nextState

      // 同步恢复 canonical session（undo 场景：canonical 已被 accept/reject 清除）
      if (!hasCanonicalPending(blockId)) {
        const shadowDTO = pendingDTOShadow.get(blockId)
        if (shadowDTO) {
          const meta = parsePendingMeta(typeof shadowDTO.metaJson === 'string' ? shadowDTO.metaJson : null, shadowDTO.operation)
          canonicalPendingSessions.value = {
            ...canonicalPendingSessions.value,
            [blockId]: {
              pendingId: shadowDTO.id,
              blockId,
              operation: meta.operation ?? 'update',
              revisionId,
              createdAt: typeof shadowDTO.createdAt === 'number' ? shadowDTO.createdAt : Date.now(),
              diffStats: recoveredFromDoc?.diffStats,
            },
          }
          // 异步写回后端
          reconciliation.markBackendWritePending(blockId)
          reconciliation.scheduleBackendSync()
        }
      }

      return nextState
    }

    // 情况 2：文档里已经没有标记，但状态还是 pending。
    //
    // 中文说明：
    // getRevisionState 是 UI 高频读取函数，不能在“读取状态”时删除 canonical 或清后端。
    // 在渲染虚拟化 + 懒投影下，mark 缺失可能只是短暂状态差、placeholder 未 hydrate、
    // 或批量投影中的缓存半拍；真正的接受/拒绝由 revisionBlockActions 明确清理，
    // undo/redo 对账由 revisionReconciliation 在事务边界集中处理。
    // 这里如果直接 clearPendingRevisionInBackend，会造成“待处理修订数量自己下降”。
    if (!hasMarks && status === 'pending') {
      if (getFlag('revisionDebugLogging')) {
        console.log('[RevisionStore] getRevisionState: pending 状态暂未扫描到 revisionMark，保持 canonical 不变', blockId)
      }

      return current
    }

    // 情况 3：仍有标记，状态是 pending，但统计与文档不一致时进行矫正
    if (hasMarks && recoveredFromDoc?.diffStats) {
      const { insertCount = 0, deleteCount = 0 } = current.diffStats || { insertCount: 0, deleteCount: 0 }
      const { insertCount: realInsert, deleteCount: realDelete } = recoveredFromDoc.diffStats
      if (insertCount !== realInsert || deleteCount !== realDelete) {
        const nextState: BlockRevisionState = {
          ...current,
          diffStats: {
            insertCount: realInsert,
            deleteCount: realDelete,
          },
        }
        activeRevisions.value[blockId] = nextState
        return nextState
      }
    }

    return current
  }

  /**
   * 检查块是否有待处理的修订
   */
  function hasPendingRevision(blockId: string): boolean {
    // 优先检查 canonical 层（不受虚拟化影响），再兜底 mark 投影层
    if (hasCanonicalPending(blockId)) return true
    const state = getRevisionState(blockId)
    return state?.status === 'pending'
  }

  /**
   * 将后端 pendingRevisions 注入 Store（全量快照语义）。
   *
   * 流程：
   * 1. 先由 workspacePending.ts 构建 canonical sessions
   * 2. 再执行 mark 投影（applier）
   * 3. applier 通过 startRevision 回填 diffStats 到 canonical session
   */
  function setWorkspacePendingRevisions(pending: WorkspacePendingRevisionDTO[]): void {
    missingCanonicalRecoveryLogged.clear()
    setWorkspacePendingRevisionsImpl({
      editor,
      activeRevisions,
      canonicalPendingSessions,
      pending,
      startRevision,
      pendingDTOShadow,
    })
  }

  const blockActions = createRevisionBlockActions({
    editor,
    activeRevisions,
    canonicalPendingSessions,
    hasCanonicalPending,
    projectPendingRevisionsForBlocks,
    getRevisionState,
    saveDocumentSilently,
    clearPendingRevisionInBackend,
    applyPendingRevisionInBackend: backendPendingApi.applyPendingRevisionInBackend,
    updateDiffStatsAfterSingleAction,
  })

  /**
   * 文档级：接受当前文档中所有块的待处理修订
   *
   * 关键变化：遍历来源从 activeRevisions 改为 canonicalPendingSessions，
   * 确保即使有离屏块（虚拟化未投影 mark），也能被覆盖。
   */
  async function acceptAllRevisionsInDocument(): Promise<DocumentApplyAllStatus> {
    if (getFlag('enableBackendPendingApply')) {
      return applyAllPendingInBackend({
        editor,
        documentId: backendPendingApi.getCurrentDocumentId(),
        mode: 'accept',
        setDirty: fileStore.setDirty.bind(fileStore),
        clearRuntimeCaches: clearPendingRuntimeCaches,
        pendingCountBefore: canonicalPendingBlockCount.value,
      })
    }

    const canonicalBlockIds = Object.keys(canonicalPendingSessions.value)

    for (const blockId of canonicalBlockIds) {
      await blockActions.acceptAllRevisions(blockId, {
        deferBackendClear: true,
        deferSave: true,
        hydrateForInteraction: false,
      })
    }

    const saved = await saveDocumentSilently()
    if (saved) {
      await clearAllPendingRevisionsInBackend()
      return 'applied'
    } else {
      console.warn('[RevisionStore] acceptAllRevisionsInDocument: 保存失败，已跳过清理后端 pending')
      return 'blocked'
    }
  }

  /**
   * 文档级：拒绝当前文档中所有块的待处理修订
   *
   * 关键变化：同 acceptAllRevisionsInDocument，遍历来源改为 canonicalPendingSessions。
   */
  async function rejectAllRevisionsInDocument(): Promise<DocumentApplyAllStatus> {
    if (getFlag('enableBackendPendingApply')) {
      return applyAllPendingInBackend({
        editor,
        documentId: backendPendingApi.getCurrentDocumentId(),
        mode: 'reject',
        setDirty: fileStore.setDirty.bind(fileStore),
        clearRuntimeCaches: clearPendingRuntimeCaches,
        pendingCountBefore: canonicalPendingBlockCount.value,
      })
    }

    const canonicalBlockIds = Object.keys(canonicalPendingSessions.value)

    for (const blockId of canonicalBlockIds) {
      await blockActions.rejectAllRevisions(blockId, {
        deferBackendClear: true,
        deferSave: true,
        hydrateForInteraction: false,
      })
    }

    const saved = await saveDocumentSilently()
    if (saved) {
      await clearAllPendingRevisionsInBackend()
      return 'applied'
    } else {
      console.warn('[RevisionStore] rejectAllRevisionsInDocument: 保存失败，已跳过清理后端 pending')
      return 'blocked'
    }
  }

  /**
   * 清除块的修订状态
   */
  function clearRevision(blockId: string): void {
    delete activeRevisions.value[blockId]
    delete canonicalPendingSessions.value[blockId]
  }

  /**
   * 清除所有修订状态
   */
  function clearAllRevisions(): void {
    activeRevisions.value = {}
    canonicalPendingSessions.value = {}
    projectingPendingBlockIds.clear()
  }

  function findRootBlockPos(blockId: string): number | null {
    return findRootBlockPosById(editor, blockId)
  }

  /**
   * 更新 Diff 统计
   */
  function updateDiffStats(blockId: string, insertCount: number, deleteCount: number): void {
    updateDiffStatsImpl(activeRevisions, blockId, insertCount, deleteCount)
    // 同步更新 canonical session 的 diffStats
    const canonicalSession = canonicalPendingSessions.value[blockId]
    if (canonicalSession) {
      canonicalPendingSessions.value[blockId] = {
        ...canonicalSession,
        diffStats: { insertCount, deleteCount },
      }
    }
  }

  /**
   * 单个操作后更新 diffStats
   */
  function updateDiffStatsAfterSingleAction(
    blockId: string,
    changeType: RevisionChangeType,
    action: 'accept' | 'reject'
  ): void {
    updateDiffStatsAfterSingleActionImpl(activeRevisions, blockId, changeType, action)
    // 同步回填 canonical session（从 activeRevisions 取最新值）
    const updatedState = activeRevisions.value[blockId]
    const canonicalSession = canonicalPendingSessions.value[blockId]
    if (canonicalSession && updatedState?.diffStats) {
      canonicalPendingSessions.value[blockId] = {
        ...canonicalSession,
        diffStats: { ...updatedState.diffStats },
      }
    }
  }

  return {
    // Canonical 事实源
    canonicalPendingSessions,
    canonicalPendingBlockCount,
    canonicalHasAnyPending,
    canonicalPendingStats,
    activeRevisionCount,
    pendingProjectionDeferred,
    hasCanonicalPending,
    getCanonicalSession,

    // 方法
    startRevision,
    getRevisionState,
    hasPendingRevision,
    acceptAllRevisions: blockActions.acceptAllRevisions,
    rejectAllRevisions: blockActions.rejectAllRevisions,
    acceptAllRevisionsInDocument,
    rejectAllRevisionsInDocument,
    acceptSingleRevision: blockActions.acceptSingleRevision,
    rejectSingleRevision: blockActions.rejectSingleRevision,
    clearRevision,
    clearAllRevisions,
    updateDiffStats,
    clearBackendPendingForBlock,
    setWorkspacePendingRevisions,
    projectPendingRevisionsForBlocks,
    findRootBlockPos,
    reconcileCanonicalWithDocument: reconciliation.reconcileCanonicalWithDocument,
  }
}

export default useRevisionStore
