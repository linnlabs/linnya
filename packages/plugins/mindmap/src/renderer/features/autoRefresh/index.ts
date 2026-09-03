/**
 * @file 自动刷新 Feature 导出入口
 *
 * 中文说明：
 * - 统一导出 autoRefresh feature 的公共 API
 * - 外部模块只需从此入口导入
 *
 * @see packages/plugins/mindmap/src/renderer/features/autoRefresh/README.md
 */

// 安装入口
export {
  installMindMapAutoRefreshFeature,
  setAutoRefreshDebug,
} from './services/installAutoRefreshFeature'

// 核心 API
export {
  requestRefresh,
  cancelAllPendingRefresh,
  getPendingRefreshCount,
} from './services/mindMapAutoRefreshService'

// 触发器（供 conversation 层使用）
export {
  clearMindMapEvidenceRefreshDedupeCache,
  isMindMapEvidenceToolName,
  useMindMapEvidenceRefreshTrigger,
  type UseMindMapEvidenceRefreshTriggerParams,
} from './services/mindMapEvidenceRefreshTrigger'

// 类型导出
export type {
  RefreshRequest,
  RefreshResult,
  RefreshReason,
  GateBlockReason,
  GateCheckResult,
} from './domain/types'
