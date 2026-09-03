/**
 * MindMap 键盘系统 — 模块导出
 *
 * 中文说明：
 * - 统一导出键盘系统相关的类型、工具、组件
 * - 作为 Phase 2 键盘治理的核心基础设施
 *
 * @module interaction/keyboard
 */

// ============================================================================
// keybinding 导出
// ============================================================================

export {
  // 平台检测
  isMac,
  MOD_KEY,
  // 解析
  parseKeyBinding,
  parseKeySequence,
  extractKeyBinding,
  // 匹配
  keyBindingsMatch,
  // 序列化
  keyBindingToString,
  keySequenceToString,
  // 工具
  isModifierOnlyKey,
  isEditableElement,
  quickMatchKey,
} from './keybinding'

export type { ModifierKey, ParsedKeyBinding, ParsedKeySequence } from './keybinding'

// ============================================================================
// KeymapRegistry 导出
// ============================================================================

export {
  KeymapRegistry,
  createKeymapRegistry,
  // 预设条件
  whenNotEditing,
  whenHasSelection,
  whenHasArrow,
  whenHasSummary,
  whenHasAnySelection,
  whenInLayer,
  whenAll,
  whenAny,
  // Intent 辅助
  createIntentRun,
} from './KeymapRegistry'

export type {
  KeymapWhen,
  KeymapRun,
  KeymapContext,
  KeymapItem,
  LayerConfig,
} from './KeymapRegistry'

// ============================================================================
// defaultKeymap 导出
// ============================================================================

export { createDefaultKeymap } from './defaultKeymap'

// ============================================================================
// 安装入口导出
// ============================================================================

export {
  installMindMapKeymap,
  installAndExtend,
} from './installMindMapKeymap'

export type {
  InstallKeymapOptions,
  InstallKeymapResult,
  MindMapWithKeyboard,
} from './installMindMapKeymap'
