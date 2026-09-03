/**
 * @file BlockHistory/index.ts
 * @description 块级版本历史功能模块导出
 */

// Store
export { useBlockHistoryStore } from './store/useBlockHistoryStore'
export type {
  BlockHistoryStore,
  BlockHistoryUiState,
  HistoryViewMode,
} from './store/useBlockHistoryStore'

// 只读运行态
export {
  useBlockVersionHandleSummary,
  useHistoryModeRootBlockIds,
} from './readModel'
export type { BlockVersionHandleSummary } from './definitions/blockVersionHandleSummary'
export {
  findSelectedBlockHistoryVersion,
  readCurrentBlockHistoryVersionLabel,
  readDeleteBlockHistoryVersionDialogMessage,
  readSelectedBlockHistoryVersionLabel,
  shouldPromptBeforeBlockHistoryRestore,
} from './functions/readBlockHistoryPanelState'

export {
  ensureBlockHistoryLoadedForRootBlockId,
  type EnsureBlockHistoryLoadedFailureReason,
  type EnsureBlockHistoryLoadedForRootBlockIdInput,
  type EnsureBlockHistoryLoadedResult,
} from './orchestration/ensureBlockHistoryLoadedForRootBlockId'
export {
  toggleBlockHistoryForRootBlockId,
  type BlockHistoryToggleStore,
  type BlockHistoryVersionForToggle,
  type ToggleBlockHistoryFailureReason,
  type ToggleBlockHistoryForRootBlockIdInput,
  type ToggleBlockHistoryForRootBlockIdResult,
} from './orchestration/toggleBlockHistoryForRootBlockId'
export {
  restoreBlockHistoryVersionForRootBlock,
  type RestoreBlockHistoryVersionFailureReason,
  type RestoreBlockHistoryVersionForRootBlockInput,
  type RestoreBlockHistoryVersionMode,
  type RestoreBlockHistoryVersionResult,
} from './orchestration/restoreBlockHistoryVersionForRootBlock'

// UI 组件
export { default as HistorySideBySide } from './ui/HistorySideBySide.vue'
export { default as HistoryOverlay } from './ui/HistoryOverlay.vue'
export { default as HistoryTimeline } from './ui/HistoryTimeline.vue'

// 工具函数
export {
  extractLinesFromContentJson,
  computeLineDiff,
  extractLinesFromText,
  getNodePlainText,
  type VersionLine,
  type LineDiffResult,
} from './utils/lineExtractor'

export {
  createScrollSyncer,
  useScrollSync,
  scrollIntoViewIfNeeded,
  getScrollRatioDiff,
  type ScrollSyncMode,
  type ScrollSyncOptions,
  type ScrollSyncer,
} from './utils/scrollSync'

// 重导出 Gateway 类型（方便外部使用）
export type {
  BlockVersion,
  BlockVersionMetadata,
  BlockVersionOriginType,
  CreateBlockVersionParams,
} from '../../../../shared/ipc/blockHistoryGateway'
