/**
 * Tagging Feature
 *
 * 中文说明：
 * - 这是 MindMap 的打标功能模块
 * - 用于展示节点的 status/confidence 状态（Issue Tree 场景）
 * - 与 Evidence Feature 协作：Refuted 感叹号点击后展开证据列表
 *
 * 导出内容：
 * - installMindMapTaggingFeature：feature 安装函数
 * - useMindMapTaggingStore：状态 store
 * - 类型和常量
 */

// Services
export { installMindMapTaggingFeature } from './services/installTaggingFeature'

// Store
export {
  useMindMapTaggingStore,
  NodeStatusValues,
  ConfidenceValues,
  STATUS_DISPLAY_MAP,
  CONFIDENCE_DISPLAY_MAP,
  type StatusDisplayConfig,
  type NodeTaggingCacheEntry,
  type NodeStatusValue,
  type ConfidenceValue,
} from './domain/store/taggingStore'

// UI Components
export { TaggingBadgeAddon } from './ui'
export {
  CONFIDENCE_COLORS,
  KIND_COLORS,
  STATUS_COLORS,
  TAGGING_KIND_DISPLAY_MAP,
  getTaggingKindDisplayConfig,
  type TaggingChipColors,
  type TaggingKindDisplayConfig,
} from './ui'
