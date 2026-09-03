/**
 * MindMap Intent 路由器
 *
 * 中文说明：
 * - 将 RawEvent（click/dblclick/wheel）转换为 Intent
 * - 遵循 contracts.md：payload 不泄漏 DOM/Event
 * - 只做事件识别和 Intent 生成，不做副作用
 *
 * 设计原则：
 * - 从 DOM 事件中提取业务 ID（nodeId/arrowId/summaryId）
 * - 生成可序列化的 Intent payload
 * - 由 IntentDispatcher 统一处理副作用
 *
 * Phase 2 边界：
 * - 节点的"单击选择"由 Selection 引擎负责，不强行迁入 Intent
 * - 只处理：expander、SVG label、双击编辑、滚轮
 *
 * @module interaction/intents/intentRouter
 */

import type { MindMapInstance } from '../../domain/types'
import type { Expander, Topic } from '../../domain/types/dom'
import type { Intent, IntentName } from './types'
import { createIntent } from './types'
import { isTopic } from '../../shared/utils'

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 路由结果
 */
export type RouteResult<N extends IntentName = IntentName> =
  | { matched: true; intent: Intent<N> }
  | { matched: false }

/**
 * 从 DOM 元素提取的目标信息
 */
interface ClickTarget {
  type: 'expander' | 'topic' | 'arrow-label' | 'summary-label' | 'arrow-svg' | 'summary-svg' | 'other'
  nodeId?: string
  arrowId?: string
  summaryId?: string
  element?: Element
}

// ============================================================================
// DOM 分析辅助函数
// ============================================================================

/**
 * 从事件目标分析点击类型
 *
 * 中文说明：
 * - 识别点击的是什么元素
 * - 提取业务 ID（nodeId/arrowId/summaryId）
 * - 不返回 DOM 元素引用（只返回 ID）
 */
function analyzeClickTarget(target: EventTarget | null, mind: MindMapInstance): ClickTarget {
  if (!(target instanceof Element)) {
    return { type: 'other' }
  }

  // 检查 expander
  const expander = target.closest('mm-expander') as Expander | null
  if (expander) {
    const topic = expander.previousSibling as Topic | null
    const nodeId = topic?.nodeObj?.id
    return { type: 'expander', nodeId, element: expander }
  }

  // 检查 Topic
  if (target instanceof HTMLElement && isTopic(target)) {
    const topic = target as Topic
    const nodeId = topic.nodeObj?.id
    return { type: 'topic', nodeId, element: target }
  }

  // 检查 SVG label（arrow/summary 的文字标签）
  const label = target.closest('.svg-label') as HTMLElement | null
  if (label) {
    const id = label.dataset.svgId
    const type = label.dataset.type
    if (id && type === 'arrow') {
      return { type: 'arrow-label', arrowId: id, element: label }
    }
    if (id && type === 'summary') {
      return { type: 'summary-label', summaryId: id, element: label }
    }
  }

  // 检查 SVG 容器（topiclinks = arrow）
  const topiclinksContainer = target.closest('.topiclinks')
  if (topiclinksContainer) {
    const svgGroup = target.closest('g')
    if (svgGroup?.id) {
      return { type: 'arrow-svg', arrowId: svgGroup.id, element: svgGroup }
    }
  }

  // 检查 Summary 容器
  const summaryContainer = target.closest('.summary')
  if (summaryContainer) {
    const svgGroup = target.closest('g')
    if (svgGroup?.id) {
      return { type: 'summary-svg', summaryId: svgGroup.id, element: svgGroup }
    }
  }

  return { type: 'other' }
}

// ============================================================================
// Click Intent 路由
// ============================================================================

/**
 * 路由 click 事件到 Intent
 *
 * 中文说明：
 * - 只处理 expander 点击和 SVG label/容器点击
 * - Topic 点击由 Selection 引擎处理，不生成 Intent
 *
 * @param event 鼠标事件
 * @param mind MindMap 实例
 * @returns 路由结果
 */
export function routeClickToIntent(
  event: MouseEvent,
  mind: MindMapInstance
): RouteResult {
  // 只处理左键点击
  if (event.button !== 0) {
    return { matched: false }
  }

  const targetInfo = analyzeClickTarget(event.target, mind)

  switch (targetInfo.type) {
    case 'expander': {
      if (!targetInfo.nodeId) return { matched: false }

      if (event.ctrlKey || event.metaKey) {
        // Ctrl/Cmd+click：递归展开/折叠
        const intent = createIntent(
          'node:expandAll',
          { nodeId: targetInfo.nodeId },
          'click'
        )
        return { matched: true, intent }
      } else {
        // 普通 click：单层展开/折叠
        const intent = createIntent(
          'node:toggleExpand',
          { nodeId: targetInfo.nodeId },
          'click'
        )
        return { matched: true, intent }
      }
    }

    case 'arrow-label':
    case 'arrow-svg': {
      if (!targetInfo.arrowId) return { matched: false }
      const intent = createIntent(
        'arrow:select',
        { arrowId: targetInfo.arrowId },
        'click'
      )
      return { matched: true, intent }
    }

    case 'summary-label':
    case 'summary-svg': {
      if (!targetInfo.summaryId) return { matched: false }
      const intent = createIntent(
        'summary:select',
        { summaryId: targetInfo.summaryId },
        'click'
      )
      return { matched: true, intent }
    }

    // Topic 点击由 Selection 引擎处理
    case 'topic':
    case 'other':
    default:
      return { matched: false }
  }
}

// ============================================================================
// DblClick Intent 路由
// ============================================================================

/**
 * 路由 dblclick 事件到 Intent
 *
 * 中文说明：
 * - 处理双击编辑：Topic、arrow label、summary
 *
 * @param event 鼠标事件
 * @param mind MindMap 实例
 * @returns 路由结果
 */
export function routeDblClickToIntent(
  event: MouseEvent,
  mind: MindMapInstance
): RouteResult {
  if (!mind.editable) {
    return { matched: false }
  }

  const targetInfo = analyzeClickTarget(event.target, mind)

  switch (targetInfo.type) {
    case 'topic': {
      if (!targetInfo.nodeId) return { matched: false }
      const intent = createIntent(
        'ui:beginEdit',
        { nodeId: targetInfo.nodeId },
        'dblclick'
      )
      return { matched: true, intent }
    }

    case 'arrow-label':
    case 'arrow-svg': {
      if (!targetInfo.arrowId) return { matched: false }
      const intent = createIntent(
        'arrow:edit',
        { arrowId: targetInfo.arrowId },
        'dblclick'
      )
      return { matched: true, intent }
    }

    case 'summary-label':
    case 'summary-svg': {
      if (!targetInfo.summaryId) return { matched: false }
      const intent = createIntent(
        'summary:edit',
        { summaryId: targetInfo.summaryId },
        'dblclick'
      )
      return { matched: true, intent }
    }

    default:
      return { matched: false }
  }
}

// ============================================================================
// Wheel Intent 路由
// ============================================================================

/**
 * 路由 wheel 事件到 Intent
 *
 * 中文说明：
 * - Ctrl/Meta+wheel：缩放
 * - Shift+wheel：横向平移
 * - 普通 wheel：自由平移
 *
 * @param event 滚轮事件
 * @param mind MindMap 实例（用于获取 container 边界）
 * @returns 路由结果
 */
export function routeWheelToIntent(
  event: WheelEvent,
  mind: MindMapInstance
): RouteResult {
  if (event.ctrlKey || event.metaKey) {
    // 缩放
    // 使用 client 坐标，因为 mind.scale 内部会减去 container 的 rect.left/top
    const centerX = event.clientX
    const centerY = event.clientY

    if (event.deltaY < 0) {
      const intent = createIntent(
        'canvas:zoomIn',
        { centerX, centerY },
        'wheel'
      )
      return { matched: true, intent }
    } else {
      const intent = createIntent(
        'canvas:zoomOut',
        { centerX, centerY },
        'wheel'
      )
      return { matched: true, intent }
    }
  } else if (event.shiftKey) {
    // 横向平移
    const intent = createIntent(
      'canvas:pan',
      { deltaX: event.deltaY, deltaY: 0 },
      'wheel'
    )
    return { matched: true, intent }
  } else {
    // 自由平移
    const intent = createIntent(
      'canvas:pan',
      { deltaX: event.deltaX, deltaY: event.deltaY },
      'wheel'
    )
    return { matched: true, intent }
  }
}

// ============================================================================
// 统一路由入口
// ============================================================================

/**
 * IntentRouter 类
 *
 * 中文说明：
 * - 统一管理事件到 Intent 的路由
 * - 可扩展：后续可添加更多事件类型
 */
export class IntentRouter {
  private mind: MindMapInstance

  constructor(mind: MindMapInstance) {
    this.mind = mind
  }

  /**
   * 路由 click 事件
   */
  routeClick(event: MouseEvent): RouteResult {
    return routeClickToIntent(event, this.mind)
  }

  /**
   * 路由 dblclick 事件
   */
  routeDblClick(event: MouseEvent): RouteResult {
    return routeDblClickToIntent(event, this.mind)
  }

  /**
   * 路由 wheel 事件
   */
  routeWheel(event: WheelEvent): RouteResult {
    return routeWheelToIntent(event, this.mind)
  }
}

/**
 * 创建 IntentRouter
 */
export function createIntentRouter(mind: MindMapInstance): IntentRouter {
  return new IntentRouter(mind)
}
