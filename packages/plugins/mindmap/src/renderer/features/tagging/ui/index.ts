/**
 * Tagging Feature UI Components
 *
 * 中文说明：
 * - 导出 Tagging Feature 的 UI 组件
 * - 主要组件：TaggingBadgeAddon（节点打标徽章）
 */

export { default as TaggingBadgeAddon } from './TaggingBadgeAddon.vue'
export {
  CONFIDENCE_COLORS,
  KIND_COLORS,
  STATUS_COLORS,
  TAGGING_KIND_DISPLAY_MAP,
  getTaggingKindDisplayConfig,
  type TaggingChipColors,
  type TaggingKindDisplayConfig,
} from './taggingChipPresentation'
