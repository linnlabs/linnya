/**
 * @file types.ts
 * @description RevisionStore 的类型定义（与实现拆分，降低单文件复杂度）。
 *
 * 架构说明：
 * - CanonicalPendingSession：由后端 pendingRevisions 快照直接构建的唯一事实源。
 *   全局统计、文档级接受/拒绝、块级是否有 pending 都从这里派生。
 *   不依赖 doc mark 投影或块可见性，虚拟化不会影响它。
 * - BlockRevisionState / activeRevisions：mark 投影层的运行时状态，
 *   用于块级 UI（指示器/工具栏/撤销恢复）的详细交互。
 */

import type { Ref, ComputedRef } from 'vue'
import type { PendingRevisionDTO as WorkspacePendingRevisionDTO } from '../../../../../shared/ipc/workspaceGateway'
import type { PendingOperation } from '../utils/pending/pendingMeta'

// ==================== Canonical Pending Session（唯一事实源） ====================

/**
 * 由后端 pendingRevisions 快照直接构建的 canonical session。
 *
 * 语义：
 * - 只要存在于 canonicalPendingSessions 中，就代表该块有未决修订。
 * - 接受/拒绝后从 canonicalPendingSessions 中移除。
 * - 不受 undo/redo、块可见性、doc mark 扫描的影响。
 */
export interface CanonicalPendingSession {
  /** 后端 pending revision 的 ID */
  pendingId: string
  /** 目标块 ID */
  blockId: string
  /** 操作类型（insert / update / delete） */
  operation: PendingOperation
  /** 投影到文档后的 revisionId（通常格式: `ai-${pendingId}`） */
  revisionId: string
  /** 后端 pending 的 createdAt */
  createdAt: number
  /**
   * Diff 统计，由 mark 投影完成后回填。
   * 全局统计在此字段缺失时将该块的 +/- 统计视为 0（块数量仍计入）。
   */
  diffStats?: {
    insertCount: number
    deleteCount: number
  }
}

// ==================== Mark 投影层（块级 UI 运行时） ====================

/** 修订状态 */
export type RevisionStatus = 'pending' | 'applied' | 'discarded'

/** 单个块的修订状态（mark 投影层，用于块级 UI 详细交互） */
export interface BlockRevisionState {
  /** 块 ID（RootBlock 的 attrs.id） */
  blockId: string
  /** 修订会话 ID */
  revisionId: string
  /** 修订状态 */
  status: RevisionStatus
  /**
   * 该修订会话对应的 pending operation（仅 workspace pending 场景可靠）。
   * - insert：新插入块（拒绝时应删除整个块，而不是留下空块）
   * - update/delete：对已有块的修订
   */
  operation?: PendingOperation
  /** 原版本 ID（来自 markdown_block_versions） */
  fromVersionId?: string
  /** AI 建议版本 ID */
  toVersionId?: string
  /** Diff 统计 */
  diffStats?: {
    insertCount: number
    deleteCount: number
  }
  /** 创建时间 */
  createdAt: number
}

/** 启动修订的参数 */
export interface StartRevisionParams {
  blockId: string
  revisionId: string
  /** 修订来源的操作类型（workspace pending 注入时提供） */
  operation?: PendingOperation
  /**
   * 创建时间（优先使用后端 pending_revisions 的 createdAt）。
   *
   * 中文说明：
   * - UI 的 RevisionIndicator 需要展示"每个块自己的修订时间"；
   * - 如果每次注入都用 Date.now() 覆盖，会导致所有块时间一致，且随着最后一次注入一起变化。
   */
  createdAt?: number
  fromVersionId?: string
  toVersionId?: string
  diffStats?: {
    insertCount: number
    deleteCount: number
  }
}

export interface BlockRevisionActionOptions {
  deferBackendClear?: boolean
  deferSave?: boolean
  /**
   * 是否为块级交互执行 hydrate/pin 握手。
   * 文档级 fallback 批处理会关闭它，避免为大量块创建不必要 DOM。
   */
  hydrateForInteraction?: boolean
}

export interface PendingProjectionResult {
  requestedCount: number
  batchCount: number
  projectedCount: number
  skippedCount: number
  failedCount: number
  totalMs: number
  flushMs: number
  errors?: Array<{ blockIds: string[]; message: string }>
}

/** 文档级 Apply All 的端到端结果，不把“后端已提交”误写成前端完成。 */
export type DocumentApplyAllStatus = 'applied' | 'blocked' | 'reload-required'

// ==================== Store 接口 ====================

/** Store 返回类型 */
export interface RevisionStore {
  // ---- Canonical 事实源 ----
  /** 由后端 pendingRevisions 快照构建，keyed by blockId */
  canonicalPendingSessions: Ref<Record<string, CanonicalPendingSession>>
  /** canonical 层：有待处理修订的块数量（不受虚拟化影响） */
  canonicalPendingBlockCount: ComputedRef<number>
  /** canonical 层：是否有任何待处理修订（不受虚拟化影响） */
  canonicalHasAnyPending: ComputedRef<boolean>
  /** canonical 层：聚合的 +/- 统计（不受虚拟化影响） */
  canonicalPendingStats: ComputedRef<{ insertCount: number; deleteCount: number }>
  /** mark 投影层：已经真实投影到编辑器中的块数量 */
  activeRevisionCount: ComputedRef<number>
  /** 大文档首开暂缓行内 revisionMark 投影时为 true */
  pendingProjectionDeferred: ComputedRef<boolean>
  /** canonical 层：判断指定块是否有待处理修订（不受虚拟化影响） */
  hasCanonicalPending: (blockId: string) => boolean
  /** canonical 层：获取指定块的 canonical session（不受虚拟化影响） */
  getCanonicalSession: (blockId: string) => CanonicalPendingSession | null

  // ---- 方法 ----
  startRevision: (params: StartRevisionParams) => void
  getRevisionState: (blockId: string) => BlockRevisionState | null
  hasPendingRevision: (blockId: string) => boolean
  acceptAllRevisions: (blockId: string, options?: BlockRevisionActionOptions) => Promise<void>
  rejectAllRevisions: (blockId: string, options?: BlockRevisionActionOptions) => Promise<void>
  /** 文档级：接受当前文档中所有块的待处理修订 */
  acceptAllRevisionsInDocument: () => Promise<DocumentApplyAllStatus>
  /** 文档级：拒绝当前文档中所有块的待处理修订 */
  rejectAllRevisionsInDocument: () => Promise<DocumentApplyAllStatus>
  acceptSingleRevision: (blockId: string, from: number, to: number) => Promise<void>
  rejectSingleRevision: (blockId: string, from: number, to: number) => Promise<void>
  clearRevision: (blockId: string) => void
  clearAllRevisions: () => void
  updateDiffStats: (blockId: string, insertCount: number, deleteCount: number) => void

  /** 清理后端中指定块的 pending revision 记录 */
  clearBackendPendingForBlock: (blockId: string) => Promise<void>

  /** 注入后端 pendingRevisions（全量快照语义；大文档只重建 canonical，mark 后续按需投影） */
  setWorkspacePendingRevisions: (pending: WorkspacePendingRevisionDTO[]) => void

  /** 将指定 canonical-only pending 块按需投影成 revisionMark */
  projectPendingRevisionsForBlocks: (blockIds: string[]) => Promise<PendingProjectionResult>

  /** 查找 block 的 rootBlock 位置 */
  findRootBlockPos: (blockId: string) => number | null

  /**
   * 全文档对账：扫描所有 rootBlock 的 marks，与 canonical sessions 比较。
   * 用途：undo/redo 后同步 canonical + 后端，保证全局统计和持久化一致。
   */
  reconcileCanonicalWithDocument: () => void
}
