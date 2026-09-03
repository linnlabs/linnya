/**
 * MindMap 键盘注册表
 *
 * 中文说明：
 * - 可注册、可治理的键盘快捷键系统
 * - 支持优先级、条件检查、序列键、层级作用域
 * - 替代原有的 key -> function 简单映射
 *
 * 设计原则：
 * - 结构化注册：每个快捷键有 id/priority/when/binding
 * - 冲突可治理：通过 priority 决定执行顺序
 * - 序列键支持：如 Ctrl+K Ctrl+0
 * - 层级/作用域：面板/模态可临时接管键盘
 *
 * @module interaction/keyboard/KeymapRegistry
 */

import type { MindMapInstance } from '../../domain/types'
import type { Intent, IntentName } from '../intents/types'
import { createIntent } from '../intents/types'
import {
  parseKeySequence,
  extractKeyBinding,
  keyBindingsMatch,
  keySequenceToString,
  isModifierOnlyKey,
  type ParsedKeySequence,
  type ParsedKeyBinding,
} from './keybinding'

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 快捷键条件检查函数
 *
 * 中文说明：
 * - 返回 true 表示条件满足，可执行
 * - 用于实现"仅在选中节点时"、"仅在非编辑状态时"等逻辑
 */
export type KeymapWhen = (ctx: KeymapContext) => boolean

/**
 * 快捷键执行函数
 *
 * 中文说明：
 * - 返回 true 表示已处理，阻止后续匹配
 * - 返回 false 表示未处理，继续匹配下一个
 */
export type KeymapRun = (ctx: KeymapContext, event: KeyboardEvent) => boolean | void

/**
 * 快捷键上下文
 *
 * 中文说明：
 * - 传递给 when/run 函数
 * - 包含 mind 实例和当前状态
 */
export interface KeymapContext {
  /** MindMap 实例 */
  mind: MindMapInstance
  /** 是否正在编辑（输入框/contenteditable） */
  isEditing: boolean
  /** 当前选中的节点数量 */
  selectionCount: number
  /** 是否有选中的节点 */
  hasSelection: boolean
  /** 是否有选中的 arrow */
  hasArrow: boolean
  /** 是否有选中的 summary */
  hasSummary: boolean
  /** 当前活跃的层级 */
  activeLayer: string | null
}

/**
 * 快捷键注册项
 */
export interface KeymapItem {
  /** 唯一标识（用于冲突定位与覆盖） */
  id: string
  /** 优先级（数值越大越优先，默认 0） */
  priority?: number
  /** 键位绑定（支持序列键，如 "Ctrl+K Ctrl+0"） */
  binding: string
  /** 条件检查（返回 true 才执行） */
  when?: KeymapWhen
  /** 执行函数 */
  run: KeymapRun
  /** 所属层级（用于模态/面板临时接管） */
  layer?: string
  /** 描述（用于文档/调试） */
  description?: string
}

/**
 * 内部存储的快捷键项（包含解析后的绑定）
 */
interface RegisteredKeymapItem extends KeymapItem {
  parsedSequence: ParsedKeySequence
  priority: number
}

/**
 * 层级配置
 */
export interface LayerConfig {
  /** 层级 ID */
  id: string
  /** 优先级（数值越大越优先） */
  priority: number
  /** 是否独占（为 true 时阻止下层键盘事件） */
  exclusive?: boolean
}

// ============================================================================
// 内置条件（预设 when 函数）
// ============================================================================

/**
 * 预设条件：非编辑状态
 */
export const whenNotEditing: KeymapWhen = ctx => !ctx.isEditing

/**
 * 预设条件：有选中节点
 */
export const whenHasSelection: KeymapWhen = ctx => ctx.hasSelection

/**
 * 预设条件：有选中 arrow
 */
export const whenHasArrow: KeymapWhen = ctx => ctx.hasArrow

/**
 * 预设条件：有选中 summary
 */
export const whenHasSummary: KeymapWhen = ctx => ctx.hasSummary

/**
 * 预设条件：有选中内容（节点/arrow/summary）
 */
export const whenHasAnySelection: KeymapWhen = ctx =>
  ctx.hasSelection || ctx.hasArrow || ctx.hasSummary

/**
 * 预设条件：在指定层级
 */
export const whenInLayer =
  (layer: string): KeymapWhen =>
  ctx =>
    ctx.activeLayer === layer

/**
 * 组合多个条件（全部满足）
 */
export function whenAll(...conditions: KeymapWhen[]): KeymapWhen {
  return ctx => conditions.every(cond => cond(ctx))
}

/**
 * 组合多个条件（任一满足）
 */
export function whenAny(...conditions: KeymapWhen[]): KeymapWhen {
  return ctx => conditions.some(cond => cond(ctx))
}

// ============================================================================
// KeymapRegistry 类
// ============================================================================

/**
 * 键盘注册表
 *
 * 中文说明：
 * - 管理所有快捷键的注册、匹配、执行
 * - 支持序列键（chord）状态管理
 * - 支持层级（layer）临时接管
 */
export class KeymapRegistry {
  private mind: MindMapInstance
  private items: Map<string, RegisteredKeymapItem> = new Map()
  private layers: Map<string, LayerConfig> = new Map()
  private activeLayerId: string | null = null

  // 序列键状态
  private pendingSequence: ParsedKeyBinding[] = []
  private sequenceTimeout: ReturnType<typeof setTimeout> | null = null
  private readonly SEQUENCE_TIMEOUT_MS = 2000

  // 调试
  private debugEnabled = false

  constructor(mind: MindMapInstance) {
    this.mind = mind
  }

  // ============================================================================
  // 注册 API
  // ============================================================================

  /**
   * 注册快捷键
   *
   * 中文说明：
   * - 返回 dispose 函数，用于注销
   * - 支持覆盖（相同 id 会替换）
   *
   * @param item 快捷键配置
   * @returns dispose 函数
   */
  register(item: KeymapItem): () => void {
    const parsedSequence = parseKeySequence(item.binding)

    const registered: RegisteredKeymapItem = {
      ...item,
      parsedSequence,
      priority: item.priority ?? 0,
    }

    this.items.set(item.id, registered)

    if (this.debugEnabled) {
      console.debug(
        `[KeymapRegistry] registered: ${item.id} -> ${keySequenceToString(parsedSequence)}`
      )
    }

    return () => this.unregister(item.id)
  }

  /**
   * 批量注册快捷键
   *
   * @param items 快捷键配置数组
   * @returns dispose 函数（注销所有）
   */
  registerMany(items: KeymapItem[]): () => void {
    const disposers = items.map(item => this.register(item))
    return () => disposers.forEach(d => d())
  }

  /**
   * 注销快捷键
   *
   * @param id 快捷键 ID
   */
  unregister(id: string): void {
    const deleted = this.items.delete(id)
    if (this.debugEnabled && deleted) {
      console.debug(`[KeymapRegistry] unregistered: ${id}`)
    }
  }

  /**
   * 检查快捷键是否已注册
   */
  has(id: string): boolean {
    return this.items.has(id)
  }

  /**
   * 获取已注册的快捷键项
   */
  get(id: string): KeymapItem | undefined {
    return this.items.get(id)
  }

  /**
   * 获取所有已注册的快捷键
   */
  getAll(): KeymapItem[] {
    return Array.from(this.items.values())
  }

  // ============================================================================
  // 层级 API
  // ============================================================================

  /**
   * 注册层级
   *
   * 中文说明：
   * - 用于模态/面板临时接管键盘
   * - 例如：ReferenceInsertPanel 打开时注册 'modal:referenceInsert' 层级
   *
   * @param config 层级配置
   * @returns dispose 函数
   */
  registerLayer(config: LayerConfig): () => void {
    this.layers.set(config.id, config)
    return () => this.unregisterLayer(config.id)
  }

  /**
   * 注销层级
   */
  unregisterLayer(layerId: string): void {
    this.layers.delete(layerId)
    if (this.activeLayerId === layerId) {
      this.activeLayerId = null
    }
  }

  /**
   * 激活层级
   *
   * 中文说明：
   * - 激活后，该层级的快捷键优先响应
   * - 如果层级是 exclusive，则阻止下层键盘事件
   */
  activateLayer(layerId: string): void {
    if (!this.layers.has(layerId)) {
      console.warn(`[KeymapRegistry] layer not registered: ${layerId}`)
      return
    }
    this.activeLayerId = layerId
    if (this.debugEnabled) {
      console.debug(`[KeymapRegistry] layer activated: ${layerId}`)
    }
  }

  /**
   * 停用层级
   */
  deactivateLayer(layerId: string): void {
    if (this.activeLayerId === layerId) {
      this.activeLayerId = null
      if (this.debugEnabled) {
        console.debug(`[KeymapRegistry] layer deactivated: ${layerId}`)
      }
    }
  }

  /**
   * 获取当前活跃层级
   */
  getActiveLayer(): string | null {
    return this.activeLayerId
  }

  // ============================================================================
  // 解析与匹配
  // ============================================================================

  /**
   * 处理键盘事件
   *
   * 中文说明：
   * - 核心入口：由事件监听器调用
   * - 处理序列键状态
   * - 匹配并执行快捷键
   *
   * @param event 键盘事件
   * @param ctx 上下文（由调用方提供）
   * @returns 是否已处理
   */
  handleKeyDown(event: KeyboardEvent, ctx: KeymapContext): boolean {
    // 跳过纯修饰键
    if (isModifierOnlyKey(event)) {
      return false
    }

    const currentBinding = extractKeyBinding(event)

    // 更新序列状态
    this.pendingSequence.push(currentBinding)
    this.resetSequenceTimeout()

    // 查找匹配的快捷键
    const matches = this.findMatches(this.pendingSequence, ctx)
    if (matches.length > 0) {
      for (const item of matches) {
        // 执行快捷键
        // 中文说明：
        // - run 返回 false：表示“本条不处理，继续尝试下一条匹配”（用于 priority 链式 fallback）
        // - run 返回 true/void：表示“已处理，停止后续匹配”
        const result = item.run(ctx, event)
        if (result !== false) {
          // 已处理，清空序列
          this.clearSequence()
          return true
        }
      }
    }

    // 检查是否有可能的序列延续
    const hasPotentialMatch = this.hasPotentialMatch(this.pendingSequence)

    if (!hasPotentialMatch) {
      // 没有匹配且没有潜在匹配，清空序列
      this.clearSequence()
    }

    return false
  }

  /**
   * 查找匹配的快捷键（按优先级降序）
   *
   * 中文说明：
   * - 按优先级排序
   * - 检查 when 条件
   * - 检查 layer 匹配
   */
  private findMatches(
    currentSequence: ParsedKeyBinding[],
    ctx: KeymapContext
  ): RegisteredKeymapItem[] {
    // 获取所有匹配的项（未排序）
    const candidates: RegisteredKeymapItem[] = []

    for (const item of this.items.values()) {
      // 检查序列长度
      if (item.parsedSequence.bindings.length !== currentSequence.length) {
        continue
      }

      // 检查每个绑定是否匹配
      let allMatch = true
      for (let i = 0; i < currentSequence.length; i++) {
        if (!keyBindingsMatch(currentSequence[i], item.parsedSequence.bindings[i])) {
          allMatch = false
          break
        }
      }

      if (!allMatch) continue

      // 检查 layer
      if (item.layer) {
        if (ctx.activeLayer !== item.layer) continue
      }

      // 检查 when 条件
      if (item.when && !item.when(ctx)) {
        continue
      }

      candidates.push(item)
    }

    if (candidates.length === 0) {
      return []
    }

    // 如果活跃层级是独占的，则只允许该层级的快捷键响应（屏蔽无 layer 的全局快捷键）
    let finalCandidates = candidates
    if (ctx.activeLayer) {
      const layerConfig = this.layers.get(ctx.activeLayer)
      if (layerConfig?.exclusive) {
        finalCandidates = candidates.filter(c => c.layer === ctx.activeLayer)
        if (finalCandidates.length === 0) {
          return []
        }
      }
    }

    // 按优先级排序（降序）
    finalCandidates.sort((a, b) => b.priority - a.priority)

    return finalCandidates
  }

  /**
   * 检查是否有潜在的序列匹配
   *
   * 中文说明：
   * - 用于判断是否应该等待后续按键
   * - 例如：用户按下 Ctrl+K，检查是否有 Ctrl+K X 的序列
   */
  private hasPotentialMatch(currentSequence: ParsedKeyBinding[]): boolean {
    for (const item of this.items.values()) {
      // 序列必须比当前更长
      if (item.parsedSequence.bindings.length <= currentSequence.length) {
        continue
      }

      // 检查前缀是否匹配
      let prefixMatch = true
      for (let i = 0; i < currentSequence.length; i++) {
        if (!keyBindingsMatch(currentSequence[i], item.parsedSequence.bindings[i])) {
          prefixMatch = false
          break
        }
      }

      if (prefixMatch) {
        return true
      }
    }

    return false
  }

  // ============================================================================
  // 序列键状态管理
  // ============================================================================

  /**
   * 清空序列状态
   */
  private clearSequence(): void {
    this.pendingSequence = []
    if (this.sequenceTimeout) {
      clearTimeout(this.sequenceTimeout)
      this.sequenceTimeout = null
    }
  }

  /**
   * 重置序列超时
   */
  private resetSequenceTimeout(): void {
    if (this.sequenceTimeout) {
      clearTimeout(this.sequenceTimeout)
    }
    this.sequenceTimeout = setTimeout(() => {
      if (this.debugEnabled && this.pendingSequence.length > 0) {
        console.debug('[KeymapRegistry] sequence timeout, clearing')
      }
      this.clearSequence()
    }, this.SEQUENCE_TIMEOUT_MS)
  }

  /**
   * 获取当前待处理的序列（调试用）
   */
  getPendingSequence(): ParsedKeyBinding[] {
    return [...this.pendingSequence]
  }

  // ============================================================================
  // 工具方法
  // ============================================================================

  /**
   * 启用调试模式
   */
  enableDebug(): void {
    this.debugEnabled = true
  }

  /**
   * 禁用调试模式
   */
  disableDebug(): void {
    this.debugEnabled = false
  }

  /**
   * 创建上下文
   *
   * 中文说明：
   * - 从 mind 实例提取当前状态
   * - 由事件处理器调用
   */
  createContext(isEditing: boolean): KeymapContext {
    const { mind } = this
    return {
      mind,
      isEditing,
      selectionCount: mind.currentNodes?.length ?? 0,
      hasSelection: (mind.currentNodes?.length ?? 0) > 0,
      hasArrow: mind.currentArrow !== null,
      hasSummary: mind.currentSummary !== null,
      activeLayer: this.activeLayerId,
    }
  }

  /**
   * 销毁
   */
  dispose(): void {
    this.items.clear()
    this.layers.clear()
    this.clearSequence()
    this.activeLayerId = null
  }
}

// ============================================================================
// Intent 辅助函数
// ============================================================================

/**
 * 创建返回 Intent 的 run 函数
 *
 * 中文说明：
 * - 用于快速创建从键盘触发 Intent 的快捷键
 * - 自动注入 source='keyboard'
 *
 * @param dispatcher IntentDispatcher 实例
 * @param intentName Intent 名称
 * @param getPayload 获取 payload 的函数
 */
export function createIntentRun<N extends IntentName>(
  dispatcher: { dispatch: (intent: Intent<N>) => unknown },
  intentName: N,
  getPayload: (ctx: KeymapContext) => N extends keyof import('../intents/types').IntentPayloads
    ? import('../intents/types').IntentPayloads[N]
    : never
): KeymapRun {
  return ctx => {
    const payload = getPayload(ctx)
    const intent = createIntent(intentName, payload, 'keyboard')
    dispatcher.dispatch(intent)
    return true
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建 KeymapRegistry
 */
export function createKeymapRegistry(mind: MindMapInstance): KeymapRegistry {
  return new KeymapRegistry(mind)
}
