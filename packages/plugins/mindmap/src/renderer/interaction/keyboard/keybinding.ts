/**
 * MindMap 键位绑定归一化
 *
 * 中文说明：
 * - 统一把 KeyboardEvent 归一化为 binding 字符串
 * - 支持跨平台修饰键（Mod = Ctrl/Cmd）
 * - 支持序列键解析（如 "Ctrl+K Ctrl+0"）
 *
 * 设计原则：
 * - 不依赖 event.key 的裸字符串（不同键盘布局可能不同）
 * - 修饰键顺序固定：Ctrl+Alt+Shift+Meta+Key
 * - 大小写不敏感（内部统一小写处理）
 *
 * @module interaction/keyboard/keybinding
 */

// ============================================================================
// 平台检测
// ============================================================================

/**
 * 检测是否是 Mac 平台
 */
export const isMac =
  typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)

// ============================================================================
// 修饰键常量
// ============================================================================

/**
 * 修饰键类型
 */
export type ModifierKey = 'ctrl' | 'alt' | 'shift' | 'meta'

/**
 * 修饰键映射（用于归一化）
 */
const MODIFIER_ALIASES: Record<string, ModifierKey> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  shift: 'shift',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
  win: 'meta',
  windows: 'meta',
  super: 'meta',
}

/**
 * Mod 在不同平台的映射
 * - Mac: Meta (Cmd)
 * - Windows/Linux: Ctrl
 */
export const MOD_KEY: ModifierKey = isMac ? 'meta' : 'ctrl'

// ============================================================================
// KeyBinding 类型
// ============================================================================

/**
 * 解析后的单个键绑定
 */
export interface ParsedKeyBinding {
  /** 修饰键集合 */
  modifiers: Set<ModifierKey>
  /** 主键（小写） */
  key: string
  /** 原始字符串 */
  raw: string
}

/**
 * 解析后的键绑定序列（支持多段组合）
 */
export interface ParsedKeySequence {
  /** 键绑定序列 */
  bindings: ParsedKeyBinding[]
  /** 原始字符串 */
  raw: string
}

// ============================================================================
// 特殊键名映射
// ============================================================================

/**
 * 特殊键名归一化映射
 *
 * 中文说明：
 * - 统一不同浏览器/系统的键名差异
 * - 例如 " " -> "space", "Escape" -> "escape"
 */
const KEY_ALIASES: Record<string, string> = {
  ' ': 'space',
  spacebar: 'space',
  esc: 'escape',
  return: 'enter',
  del: 'delete',
  ins: 'insert',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  plus: '=',
  minus: '-',
}

/**
 * 归一化键名
 */
function normalizeKey(key: string): string {
  const lower = key.toLowerCase()
  return KEY_ALIASES[lower] ?? lower
}

// ============================================================================
// 解析函数
// ============================================================================

/**
 * 解析单个键绑定字符串
 *
 * 中文说明：
 * - 输入示例："Ctrl+Shift+A", "Mod+Enter", "F2"
 * - Mod 会根据平台转换为 Ctrl 或 Meta
 *
 * @param binding 键绑定字符串
 * @returns 解析结果
 */
export function parseKeyBinding(binding: string): ParsedKeyBinding {
  const parts = binding.split('+').map(p => p.trim().toLowerCase())
  const modifiers = new Set<ModifierKey>()
  let key = ''

  for (const part of parts) {
    // 处理 Mod 特殊标记
    if (part === 'mod') {
      modifiers.add(MOD_KEY)
      continue
    }

    // 检查是否是修饰键
    const modifier = MODIFIER_ALIASES[part]
    if (modifier) {
      modifiers.add(modifier)
      continue
    }

    // 否则是主键
    key = normalizeKey(part)
  }

  return {
    modifiers,
    key,
    raw: binding,
  }
}

/**
 * 解析键绑定序列
 *
 * 中文说明：
 * - 支持多段组合键，用空格分隔
 * - 输入示例："Ctrl+K Ctrl+0", "Mod+Shift+P"
 *
 * @param sequence 键绑定序列字符串
 * @returns 解析结果
 */
export function parseKeySequence(sequence: string): ParsedKeySequence {
  const parts = sequence.split(/\s+/).filter(Boolean)
  const bindings = parts.map(parseKeyBinding)

  return {
    bindings,
    raw: sequence,
  }
}

// ============================================================================
// 从 KeyboardEvent 提取绑定
// ============================================================================

/**
 * 从 KeyboardEvent 提取当前按键绑定
 *
 * 中文说明：
 * - 用于与注册的 binding 进行匹配
 * - 修饰键顺序固定，保证匹配一致性
 *
 * @param event 键盘事件
 * @returns 解析后的键绑定
 */
export function extractKeyBinding(event: KeyboardEvent): ParsedKeyBinding {
  const modifiers = new Set<ModifierKey>()

  if (event.ctrlKey) modifiers.add('ctrl')
  if (event.altKey) modifiers.add('alt')
  if (event.shiftKey) modifiers.add('shift')
  if (event.metaKey) modifiers.add('meta')

  // 归一化键名
  const key = normalizeKey(event.key)

  return {
    modifiers,
    key,
    raw: keyBindingToString({ modifiers, key, raw: '' }),
  }
}

// ============================================================================
// 绑定匹配
// ============================================================================

/**
 * 检查两个键绑定是否匹配
 *
 * @param a 键绑定 A
 * @param b 键绑定 B
 * @returns 是否匹配
 */
export function keyBindingsMatch(a: ParsedKeyBinding, b: ParsedKeyBinding): boolean {
  // 主键必须相同
  if (a.key !== b.key) return false

  // 修饰键必须完全相同
  if (a.modifiers.size !== b.modifiers.size) return false

  for (const mod of a.modifiers) {
    if (!b.modifiers.has(mod)) return false
  }

  return true
}

// ============================================================================
// 序列化
// ============================================================================

/**
 * 将键绑定转换为规范化字符串
 *
 * 中文说明：
 * - 用于日志、调试、配置存储
 * - 修饰键顺序固定：Ctrl+Alt+Shift+Meta+Key
 *
 * @param binding 键绑定
 * @returns 规范化字符串
 */
export function keyBindingToString(binding: ParsedKeyBinding): string {
  const parts: string[] = []

  // 固定顺序添加修饰键
  if (binding.modifiers.has('ctrl')) parts.push('Ctrl')
  if (binding.modifiers.has('alt')) parts.push('Alt')
  if (binding.modifiers.has('shift')) parts.push('Shift')
  if (binding.modifiers.has('meta')) parts.push('Meta')

  // 添加主键（首字母大写）
  if (binding.key) {
    const key = binding.key.charAt(0).toUpperCase() + binding.key.slice(1)
    parts.push(key)
  }

  return parts.join('+')
}

/**
 * 将键序列转换为规范化字符串
 *
 * @param sequence 键序列
 * @returns 规范化字符串
 */
export function keySequenceToString(sequence: ParsedKeySequence): string {
  return sequence.bindings.map(keyBindingToString).join(' ')
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 检查是否是纯修饰键按下
 *
 * 中文说明：
 * - 用于过滤单独的 Ctrl/Alt/Shift/Meta 按下
 * - 这些不应触发快捷键
 */
export function isModifierOnlyKey(event: KeyboardEvent): boolean {
  const key = event.key.toLowerCase()
  return ['control', 'alt', 'shift', 'meta', 'os'].includes(key)
}

/**
 * 检查是否是可编辑元素
 *
 * 中文说明：
 * - 用于判断是否应该跳过快捷键处理
 * - 在 input/textarea/contenteditable 中，大多数快捷键应该透传
 */
export function isEditableElement(element: Element | null): boolean {
  if (!element) return false

  const tagName = element.tagName.toLowerCase()
  if (tagName === 'input' || tagName === 'textarea') {
    return true
  }

  if (element.getAttribute('contenteditable') === 'true') {
    return true
  }

  // 检查父元素
  const parent = element.closest('[contenteditable="true"]')
  return parent !== null
}

/**
 * 快速检查事件是否可能匹配某个绑定
 *
 * 中文说明：
 * - 用于快速过滤，避免不必要的完整匹配
 * - 只检查主键
 */
export function quickMatchKey(event: KeyboardEvent, binding: ParsedKeyBinding): boolean {
  return normalizeKey(event.key) === binding.key
}
