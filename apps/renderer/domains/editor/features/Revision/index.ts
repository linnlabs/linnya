/**
 * @file Revision/index.ts
 * @description AI 修订模式功能模块导出
 */

// Store
export { useRevisionStore } from './store/useRevisionStore'
export type {
  RevisionStore,
  BlockRevisionState,
  RevisionStatus,
  StartRevisionParams,
  CanonicalPendingSession,
} from './store/types'

// Utils - Diff 计算
export {
  computeTextDiff,
  computeTextDiffWithPositions,
  computeDiffStats,
  detectStructuralChange,
} from './utils/diffUtils'
export type { DiffType, DiffSegment, DiffResult, DiffStats } from './utils/diffUtils'

// Utils - Diff 应用
export {
  applyDiffToDocument,
  applyRichDiffToDocument,
  extractBlockText,
  clearBlockRevisionMarks,
} from './utils/diffApplier'
export type { ApplyDiffParams, ApplyRichDiffParams, ApplyDiffResult } from './utils/diffApplier'

// Utils - 文档 Span 抽取（Phase 1 新增）
export {
  linearizeRootBlock,
  linearizeNode,
} from './utils/linearizeBlock'
export type { LinearizeResult } from './utils/linearizeBlock'

// Utils - Rich Diff（Phase 1 新增）
export {
  computeRichDiff,
  computeRichDiffFromText,
  hasFormatChanges,
} from './utils/richDiff'
export type { RichDiffSegment, RichDiffResult } from './utils/richDiff'

// Utils - Pending Revisions
// ----------------------------------------------------------------------------
// 说明（中文）：
// 当前主线是：后端 block pending -> 前端 canonical pending -> revisionMark 投影。
// revisionMark 只是 UI/交互投影层，不再是独立事实源；保存时会统一剥离。
// ----------------------------------------------------------------------------

// Pending Revisions（Workspace）注入：由 pending 快照驱动投影
export type { PendingRevisionDTO as WorkspacePendingRevisionDTO } from '../../../../shared/ipc/workspaceGateway'

// UI 组件
export { default as RevisionToolbar } from './ui/RevisionToolbar.vue'
export { default as RevisionMarkPopup } from './ui/RevisionMarkPopup.vue'
export { default as RevisionIndicator } from './ui/RevisionIndicator.vue'
export { default as RevisionGlobalToolbar } from './ui/RevisionGlobalToolbar.vue'
export { useDocumentRevisionToolbar } from './ui/useDocumentRevisionToolbar'
export { useRevisionToolbarRootBlockIds } from './readModel'
export {
  applyBlockRevisionToolbarAction,
  type BlockRevisionToolbarAction,
} from './orchestration/applyBlockRevisionToolbarAction'
export {
  setupShellPendingProjectionBridge,
  type ShellPendingProjectionBridgeOptions,
} from './orchestration/shellPendingProjection/setupShellPendingProjectionBridge'

// Block lifecycle 集成
export { setupRevisionBlockEventHandler } from './blockLifecycle/RevisionBlockEventHandler'
