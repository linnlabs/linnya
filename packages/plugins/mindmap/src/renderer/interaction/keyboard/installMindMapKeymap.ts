/**
 * MindMap 键盘系统安装入口
 *
 * 中文说明：
 * - 安装 KeymapRegistry 到 MindMap 实例
 * - 绑定键盘事件监听
 * - 注册默认快捷键
 * - 返回 dispose 函数
 *
 * 使用方式：
 * ```ts
 * const dispose = installMindMapKeymap(mind, dispatcher)
 * // 在销毁时调用
 * dispose()
 * ```
 *
 * @module interaction/keyboard/installMindMapKeymap
 */

import type { MindMapInstance } from '../../domain/types'
import { KeymapRegistry, createKeymapRegistry, type KeymapItem } from './KeymapRegistry'
import { isEditableElement } from './keybinding'
import { createDefaultKeymap } from './defaultKeymap'
import { IntentDispatcher } from '../intents/intentDispatcher'

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 安装选项
 */
export interface InstallKeymapOptions {
  /**
   * IntentDispatcher 实例
   * 如果不传，会自动创建
   */
  dispatcher?: IntentDispatcher

  /**
   * 是否注册默认快捷键
   * @default true
   */
  registerDefaultKeymap?: boolean

  /**
   * 额外的快捷键配置
   */
  extraKeymap?: KeymapItem[]

  /**
   * 快捷键覆盖配置
   * - key: 快捷键 ID
   * - value: false 表示禁用，或新的 KeymapItem 配置（覆盖）
   */
  overrides?: Record<string, false | Partial<KeymapItem>>

  /**
   * 是否启用调试模式
   * @default false
   */
  debug?: boolean
}

/**
 * 安装结果
 */
export interface InstallKeymapResult {
  /** KeymapRegistry 实例 */
  registry: KeymapRegistry
  /** IntentDispatcher 实例 */
  dispatcher: IntentDispatcher
  /** 销毁函数 */
  dispose: () => void
}

// ============================================================================
// 安装函数
// ============================================================================

/**
 * 安装 MindMap 键盘系统
 *
 * 中文说明：
 * - 创建 KeymapRegistry 和 IntentDispatcher（如果未传入）
 * - 绑定键盘事件到 mind.container
 * - 注册默认快捷键（可配置）
 * - 返回 dispose 函数用于清理
 *
 * @param mind MindMap 实例
 * @param options 安装选项
 * @returns 安装结果
 */
export function installMindMapKeymap(
  mind: MindMapInstance,
  options: InstallKeymapOptions = {}
): InstallKeymapResult {
  const {
    dispatcher: providedDispatcher,
    registerDefaultKeymap = true,
    extraKeymap = [],
    overrides = {},
    debug = false,
  } = options

  // 创建 IntentDispatcher（如果未传入）
  const dispatcher = providedDispatcher ?? new IntentDispatcher(mind)

  // 创建 KeymapRegistry
  const registry = createKeymapRegistry(mind)

  if (debug) {
    registry.enableDebug()
  }

  // 注册默认快捷键
  const disposers: Array<() => void> = []

  if (registerDefaultKeymap) {
    const defaultKeymap = createDefaultKeymap(dispatcher)

    // 应用覆盖配置
    const finalKeymap = defaultKeymap
      .filter(item => {
        const override = overrides[item.id]
        // false 表示禁用
        if (override === false) return false
        return true
      })
      .map(item => {
        const override = overrides[item.id]
        if (override) {
          return { ...item, ...override }
        }
        return item
      })

    const disposeDefault = registry.registerMany(finalKeymap)
    disposers.push(disposeDefault)
  }

  // 注册额外快捷键
  if (extraKeymap.length > 0) {
    const disposeExtra = registry.registerMany(extraKeymap)
    disposers.push(disposeExtra)
  }

  // 绑定键盘事件
  const handleKeyDown = (event: KeyboardEvent) => {
    // 检查是否可编辑
    if (!mind.editable) return

    // 检查是否在可编辑元素中
    const isEditing = isEditableElement(event.target as Element)

    // 创建上下文
    const ctx = registry.createContext(isEditing)

    // 处理键盘事件
    const handled = registry.handleKeyDown(event, ctx)

    if (handled) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  // 绑定到 container
  mind.container.addEventListener('keydown', handleKeyDown)
  disposers.push(() => {
    mind.container.removeEventListener('keydown', handleKeyDown)
  })

  // 返回结果
  return {
    registry,
    dispatcher,
    dispose: () => {
      disposers.forEach(d => d())
      registry.dispose()
      dispatcher.dispose()
    },
  }
}

// ============================================================================
// 扩展 MindMapInstance 类型（可选）
// ============================================================================

/**
 * 带键盘系统的 MindMap 实例
 *
 * 中文说明：
 * - 用于类型提示
 * - 实际扩展在安装后通过赋值完成
 */
export interface MindMapWithKeyboard extends MindMapInstance {
  /** KeymapRegistry 实例 */
  keymapRegistry?: KeymapRegistry
  /** IntentDispatcher 实例 */
  intentDispatcher?: IntentDispatcher
}

/**
 * 安装键盘系统并扩展 mind 实例
 *
 * 中文说明：
 * - 便捷方法：安装后自动把 registry/dispatcher 挂载到 mind
 * - 方便在其他地方访问
 *
 * @param mind MindMap 实例
 * @param options 安装选项
 * @returns 销毁函数
 */
export function installAndExtend(
  mind: MindMapWithKeyboard,
  options: InstallKeymapOptions = {}
): () => void {
  const result = installMindMapKeymap(mind, options)

  // 扩展 mind 实例
  mind.keymapRegistry = result.registry
  mind.intentDispatcher = result.dispatcher

  // 包装 dispose，清理扩展属性
  return () => {
    result.dispose()
    delete mind.keymapRegistry
    delete mind.intentDispatcher
  }
}
