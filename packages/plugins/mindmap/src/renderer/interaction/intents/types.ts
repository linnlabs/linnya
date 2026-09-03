/**
 * MindMap Intent 体系 — 核心类型定义
 *
 * 中文说明：
 * - 本文件定义 Intent 层的所有核心类型
 * - 遵循 contracts.md：payload 只允许业务字段，禁止 DOM/Topic/MouseEvent 泄漏
 * - Intent 是"用户意图"的抽象表达，可序列化、可回放、可诊断
 *
 * 设计原则：
 * - payload 可序列化（未来用于回放/诊断/协同）
 * - 只含业务字段：nodeId/nodeIds/arrowId/summaryId/deltaX/deltaY/clientX/clientY
 * - 禁止字段：Topic/HTMLElement/domId/MouseEvent/PointerEvent/WheelEvent
 *
 * @module interaction/intents/types
 */

import type { CommandSource } from '../../domain/commands/types'

// ============================================================================
// IntentSource — 意图来源（用于可观测与路由决策）
// ============================================================================

/**
 * 意图来源类型
 *
 * 中文说明：
 * - 与 CommandSource 对齐，但更精细地区分交互入口
 * - 用于日志追踪、诊断、未来的回放
 */
export type IntentSource =
  | 'keyboard' // 键盘触发（快捷键）
  | 'click' // 鼠标单击
  | 'dblclick' // 鼠标双击
  | 'wheel' // 滚轮
  | 'contextmenu' // 右键菜单
  | 'drag' // 拖拽（预留，Phase 3）
  | 'selection' // 选择引擎产出
  | 'api' // API 调用
  | 'unknown' // 未知来源

/**
 * IntentSource 到 CommandSource 的映射
 *
 * 中文说明：
 * - IntentDispatcher 调用 command 时使用此映射
 * - 保证 Intent 和 Command 的 source 可追溯
 */
export function intentSourceToCommandSource(source: IntentSource): CommandSource {
  switch (source) {
    case 'keyboard':
      return 'hotkey'
    case 'click':
    case 'dblclick':
    case 'wheel':
    case 'drag':
      return 'mouse'
    case 'contextmenu':
      return 'contextMenu'
    case 'selection':
      return 'feature'
    case 'api':
      return 'script'
    default:
      return 'unknown'
  }
}

// ============================================================================
// IntentMeta — 意图元信息
// ============================================================================

/**
 * 意图元信息
 *
 * 中文说明：
 * - traceId：贯穿 intent -> command -> operation 的唯一标识
 * - source：意图来源
 * - timestamp：意图生成时间戳
 */
export interface IntentMeta {
  /** 追踪 ID（贯穿整个链路） */
  traceId: string
  /** 意图来源 */
  source: IntentSource
  /** 时间戳 */
  timestamp: number
}

/**
 * 生成追踪 ID
 *
 * 中文说明：
 * - 格式：intent_{timestamp}_{random}
 * - 用于关联 intent -> command -> operation
 */
export function generateTraceId(): string {
  return `intent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 创建 IntentMeta
 */
export function createIntentMeta(source: IntentSource): IntentMeta {
  return {
    traceId: generateTraceId(),
    source,
    timestamp: Date.now(),
  }
}

// ============================================================================
// Intent 命名规范（分域）
// ============================================================================

/**
 * 节点层意图名称
 */
export type NodeIntentName =
  | 'node:toggleExpand' // 切换展开/折叠
  | 'node:expandAll' // 递归展开（Ctrl+click expander）
  | 'node:collapseAll' // 递归折叠（Ctrl+click expander）
  | 'node:select' // 选中节点
  | 'node:selectMany' // 选中多个节点
  | 'node:addChild' // 添加子节点
  | 'node:insertSiblingBefore' // 在前插入兄弟
  | 'node:insertSiblingAfter' // 在后插入兄弟
  | 'node:insertParent' // 插入父节点
  | 'node:remove' // 删除节点
  | 'node:moveUp' // 向上移动
  | 'node:moveDown' // 向下移动
  | 'node:navigate' // 导航到节点（方向键）

/**
 * 选择层意图名称
 */
export type SelectionIntentName =
  | 'selection:clear' // 清空选区
  | 'selection:changed' // 选区变化（桥接 selection engine 输出）

/**
 * 画布层意图名称
 */
export type CanvasIntentName =
  | 'canvas:pan' // 平移
  | 'canvas:zoom' // 缩放
  | 'canvas:zoomIn' // 放大
  | 'canvas:zoomOut' // 缩小
  | 'canvas:resetZoom' // 重置缩放
  | 'canvas:toCenter' // 居中

/**
 * UI 行为意图名称
 */
export type UIIntentName =
  | 'ui:beginEdit' // 开始编辑
  | 'ui:openContextMenu' // 打开右键菜单

/**
 * Arrow 意图名称
 */
export type ArrowIntentName =
  | 'arrow:select' // 选中 arrow
  | 'arrow:edit' // 编辑 arrow label
  | 'arrow:remove' // 删除 arrow

/**
 * Summary 意图名称
 */
export type SummaryIntentName =
  | 'summary:select' // 选中 summary
  | 'summary:edit' // 编辑 summary
  | 'summary:remove' // 删除 summary

/**
 * 所有意图名称联合类型
 */
export type IntentName =
  | NodeIntentName
  | SelectionIntentName
  | CanvasIntentName
  | UIIntentName
  | ArrowIntentName
  | SummaryIntentName

// ============================================================================
// Intent Payloads — 各类意图的 payload 定义（严格类型安全）
// ============================================================================

/**
 * 节点意图 Payloads
 *
 * 中文说明：
 * - 所有字段必须是可序列化的业务字段
 * - 禁止 DOM 元素、Event 对象等
 */
export interface NodeIntentPayloads {
  'node:toggleExpand': { nodeId: string }
  'node:expandAll': { nodeId: string }
  'node:collapseAll': { nodeId: string }
  'node:select': { nodeId: string }
  'node:selectMany': { nodeIds: string[]; replace?: boolean }
  'node:addChild': { nodeId: string; edit?: boolean }
  'node:insertSiblingBefore': { nodeId: string; edit?: boolean }
  'node:insertSiblingAfter': { nodeId: string; edit?: boolean }
  'node:insertParent': { nodeId: string; edit?: boolean }
  'node:remove': { nodeIds?: string[] } // 不传则删除当前选中
  'node:moveUp': { nodeId?: string } // 不传则移动当前节点
  'node:moveDown': { nodeId?: string }
  'node:navigate': {
    direction: 'up' | 'down' | 'left' | 'right'
    nodeId?: string // 从哪个节点开始导航，不传则从当前节点
  }
}

/**
 * 选择意图 Payloads
 */
export interface SelectionIntentPayloads {
  'selection:clear': Record<string, never>
  'selection:changed': {
    addedNodeIds: string[]
    removedNodeIds: string[]
  }
}

/**
 * 画布意图 Payloads
 */
export interface CanvasIntentPayloads {
  'canvas:pan': {
    deltaX: number
    deltaY: number
  }
  'canvas:zoom': {
    scale: number
    /** 缩放中心点（Client 坐标，如 event.clientX） */
    centerX?: number
    centerY?: number
  }
  'canvas:zoomIn': {
    centerX?: number
    centerY?: number
  }
  'canvas:zoomOut': {
    centerX?: number
    centerY?: number
  }
  'canvas:resetZoom': Record<string, never>
  'canvas:toCenter': Record<string, never>
}

/**
 * UI 意图 Payloads
 */
export interface UIIntentPayloads {
  'ui:beginEdit': { nodeId: string }
  'ui:openContextMenu': {
    clientX: number
    clientY: number
    targetType: 'node' | 'canvas' | 'arrow' | 'summary'
    targetId?: string
  }
}

/**
 * Arrow 意图 Payloads
 */
export interface ArrowIntentPayloads {
  'arrow:select': { arrowId: string }
  'arrow:edit': { arrowId: string }
  'arrow:remove': { arrowId?: string } // 不传则删除当前选中
}

/**
 * Summary 意图 Payloads
 */
export interface SummaryIntentPayloads {
  'summary:select': { summaryId: string }
  'summary:edit': { summaryId: string }
  'summary:remove': { summaryId?: string }
}

/**
 * 所有意图 Payloads 联合
 */
export interface IntentPayloads
  extends NodeIntentPayloads,
    SelectionIntentPayloads,
    CanvasIntentPayloads,
    UIIntentPayloads,
    ArrowIntentPayloads,
    SummaryIntentPayloads {}

// ============================================================================
// Intent — 意图对象（泛型安全）
// ============================================================================

/**
 * 意图对象
 *
 * 中文说明：
 * - name：意图名称（类型安全）
 * - payload：意图载荷（类型安全，与 name 关联）
 * - meta：意图元信息
 *
 * @template N 意图名称类型
 */
export interface Intent<N extends IntentName = IntentName> {
  /** 意图名称 */
  name: N
  /** 意图载荷（类型安全） */
  payload: N extends keyof IntentPayloads ? IntentPayloads[N] : never
  /** 意图元信息 */
  meta: IntentMeta
}

/**
 * 创建意图对象的工厂函数
 *
 * 中文说明：
 * - 类型安全地创建 Intent
 * - 自动生成 traceId 和 timestamp
 *
 * @param name 意图名称
 * @param payload 意图载荷
 * @param source 意图来源
 * @returns Intent 对象
 */
export function createIntent<N extends IntentName>(
  name: N,
  payload: N extends keyof IntentPayloads ? IntentPayloads[N] : never,
  source: IntentSource
): Intent<N> {
  return {
    name,
    payload,
    meta: createIntentMeta(source),
  }
}

// ============================================================================
// Intent Handler — 意图处理器类型
// ============================================================================

/**
 * 意图处理结果
 */
export type IntentHandleResult =
  | { handled: true; commandResult?: { ok: boolean; txId?: string } }
  | { handled: false; reason?: string }

/**
 * 意图处理器函数类型
 *
 * 中文说明：
 * - 由 IntentDispatcher 调用
 * - 返回处理结果，用于可观测
 */
export type IntentHandler<N extends IntentName = IntentName> = (
  intent: Intent<N>
) => IntentHandleResult

// ============================================================================
// Type Guards — 类型守卫
// ============================================================================

/**
 * 检查是否是节点意图
 */
export function isNodeIntent(name: IntentName): name is NodeIntentName {
  return name.startsWith('node:')
}

/**
 * 检查是否是选择意图
 */
export function isSelectionIntent(name: IntentName): name is SelectionIntentName {
  return name.startsWith('selection:')
}

/**
 * 检查是否是画布意图
 */
export function isCanvasIntent(name: IntentName): name is CanvasIntentName {
  return name.startsWith('canvas:')
}

/**
 * 检查是否是 UI 意图
 */
export function isUIIntent(name: IntentName): name is UIIntentName {
  return name.startsWith('ui:')
}

/**
 * 检查是否是 Arrow 意图
 */
export function isArrowIntent(name: IntentName): name is ArrowIntentName {
  return name.startsWith('arrow:')
}

/**
 * 检查是否是 Summary 意图
 */
export function isSummaryIntent(name: IntentName): name is SummaryIntentName {
  return name.startsWith('summary:')
}
