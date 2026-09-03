/**
 * MindMap Intent 派发器
 *
 * 中文说明：
 * - 将 Intent 路由到 Command 或 UI 事件（bus.fire）
 * - 统一注入 meta（source/traceId）到 command
 * - 保证 intent -> command -> operation 的链路可追溯
 *
 * 设计原则：
 * - 单一职责：只负责路由，不负责 Intent 生成
 * - 可扩展：通过 handler 注册机制支持 feature 扩展
 * - 可观测：每次 dispatch 都有日志输出
 *
 * @module interaction/intents/intentDispatcher
 */

import type { MindMapInstance } from '../../domain/types'
import type { CustomSvg, Topic } from '../../domain/types/dom'
import type { SummarySvgGroup } from '../../presentation/render/summary'
import type { CommandMeta } from '../../domain/commands/types'
import type {
  Intent,
  IntentName,
  IntentHandleResult,
  IntentPayloads,
  NodeIntentName,
  CanvasIntentName,
  UIIntentName,
  ArrowIntentName,
  SummaryIntentName,
  SelectionIntentName,
} from './types'
import { intentSourceToCommandSource } from './types'
import { getIntentLogger } from './intentLogger'

// ============================================================================
// IntentDispatcher 类
// ============================================================================

/**
 * Intent 派发器
 *
 * 中文说明：
 * - 绑定到 MindMapInstance
 * - 将 Intent 映射到 Command 或 UI 事件
 * - 支持 handler 注册（用于 feature 扩展）
 */
export class IntentDispatcher {
  private mind: MindMapInstance
  private customHandlers: Map<IntentName, (intent: Intent) => IntentHandleResult> = new Map()
  private logger = getIntentLogger()

  constructor(mind: MindMapInstance) {
    this.mind = mind
  }

  /**
   * 注册自定义 Intent 处理器
   *
   * 中文说明：
   * - 用于 feature 扩展
   * - 返回 dispose 函数
   */
  registerHandler<N extends IntentName>(
    name: N,
    handler: (intent: Intent<N>) => IntentHandleResult
  ): () => void {
    this.customHandlers.set(name, handler as (intent: Intent) => IntentHandleResult)
    return () => {
      this.customHandlers.delete(name)
    }
  }

  /**
   * 派发 Intent
   *
   * 中文说明：
   * - 核心入口：所有 Intent 都通过此方法派发
   * - 自动日志记录
   * - 按 intent 类型路由到对应处理器
   */
  dispatch<N extends IntentName>(intent: Intent<N>): IntentHandleResult {
    this.logger.intentDispatching(intent as Intent)

    try {
      // 优先使用自定义处理器
      const customHandler = this.customHandlers.get(intent.name)
      if (customHandler) {
        const result = customHandler(intent)
        this.logger.intentHandled(intent as Intent, result)
        return result
      }

      // 内置路由
      const result = this.routeIntent(intent)
      this.logger.intentHandled(intent as Intent, result)
      return result
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      this.logger.intentError(intent as Intent, err)
      return { handled: false, reason: `error: ${err.message}` }
    }
  }

  /**
   * 内置 Intent 路由
   */
  private routeIntent<N extends IntentName>(intent: Intent<N>): IntentHandleResult {
    const name = intent.name

    // 按域路由
    if (name.startsWith('node:')) {
      return this.handleNodeIntent(intent as Intent<NodeIntentName>)
    }
    if (name.startsWith('selection:')) {
      return this.handleSelectionIntent(intent as Intent<SelectionIntentName>)
    }
    if (name.startsWith('canvas:')) {
      return this.handleCanvasIntent(intent as Intent<CanvasIntentName>)
    }
    if (name.startsWith('ui:')) {
      return this.handleUIIntent(intent as Intent<UIIntentName>)
    }
    if (name.startsWith('arrow:')) {
      return this.handleArrowIntent(intent as Intent<ArrowIntentName>)
    }
    if (name.startsWith('summary:')) {
      return this.handleSummaryIntent(intent as Intent<SummaryIntentName>)
    }

    return { handled: false, reason: `unknown intent: ${name}` }
  }

  /**
   * 创建 CommandMeta（统一注入 traceId 和 source）
   */
  private createCommandMeta(intent: Intent): Partial<CommandMeta> {
    return {
      source: intentSourceToCommandSource(intent.meta.source),
      traceId: intent.meta.traceId,
      timestamp: intent.meta.timestamp,
    }
  }

  // ============================================================================
  // Node Intent 处理
  // ============================================================================

  private handleNodeIntent(intent: Intent<NodeIntentName>): IntentHandleResult {
    const meta = this.createCommandMeta(intent)
    const { mind } = this

    switch (intent.name) {
      case 'node:toggleExpand': {
        const payload = intent.payload as IntentPayloads['node:toggleExpand']
        const result = mind.commands.node.toggleExpand({ nodeId: payload.nodeId }, meta)
        return { handled: true, commandResult: result }
      }

      case 'node:expandAll': {
        const payload = intent.payload as IntentPayloads['node:expandAll']
        // expandNodeAll 暂时直接调用实例方法（Phase 1 未命令化）
        const topic = this.findTopicByNodeId(payload.nodeId)
        if (topic) {
          mind.expandNodeAll(topic)
          return { handled: true }
        }
        return { handled: false, reason: 'node not found' }
      }

      case 'node:collapseAll': {
        const payload = intent.payload as IntentPayloads['node:collapseAll']
        const topic = this.findTopicByNodeId(payload.nodeId)
        if (topic) {
          // collapseAll 通过 expandNodeAll 的 toggle 行为实现
          // 当节点已展开时，expandNodeAll 会折叠
          if (topic.nodeObj?.expanded !== false) {
            mind.expandNodeAll(topic)
          }
          return { handled: true }
        }
        return { handled: false, reason: 'node not found' }
      }

      case 'node:select': {
        const payload = intent.payload as IntentPayloads['node:select']
        const result = mind.commands.node.select({ nodeId: payload.nodeId }, meta)
        return { handled: true, commandResult: result }
      }

      case 'node:selectMany': {
        const payload = intent.payload as IntentPayloads['node:selectMany']
        const result = mind.commands.node.selectMany(
          { nodeIds: payload.nodeIds, replace: payload.replace },
          meta
        )
        return { handled: true, commandResult: result }
      }

      case 'node:addChild': {
        const payload = intent.payload as IntentPayloads['node:addChild']
        const result = mind.commands.node.addChild(
          { nodeId: payload.nodeId, edit: payload.edit },
          meta
        )
        return { handled: true, commandResult: result }
      }

      case 'node:insertSiblingBefore': {
        const payload = intent.payload as IntentPayloads['node:insertSiblingBefore']
        const result = mind.commands.node.insertSiblingBefore(
          { nodeId: payload.nodeId, edit: payload.edit },
          meta
        )
        return { handled: true, commandResult: result }
      }

      case 'node:insertSiblingAfter': {
        const payload = intent.payload as IntentPayloads['node:insertSiblingAfter']
        const result = mind.commands.node.insertSiblingAfter(
          { nodeId: payload.nodeId, edit: payload.edit },
          meta
        )
        return { handled: true, commandResult: result }
      }

      case 'node:insertParent': {
        const payload = intent.payload as IntentPayloads['node:insertParent']
        const result = mind.commands.node.insertParent(
          { nodeId: payload.nodeId, edit: payload.edit },
          meta
        )
        return { handled: true, commandResult: result }
      }

      case 'node:remove': {
        const payload = intent.payload as IntentPayloads['node:remove']
        if (payload.nodeIds && payload.nodeIds.length > 0) {
          const result = mind.commands.node.removeByIds({ nodeIds: payload.nodeIds }, meta)
          return { handled: true, commandResult: result }
        } else {
          const result = mind.commands.node.removeSelected({}, meta)
          return { handled: true, commandResult: result }
        }
      }

      case 'node:moveUp': {
        // moveUpNode 暂未命令化，直接调用实例方法
        mind.moveUpNode()
        return { handled: true }
      }

      case 'node:moveDown': {
        mind.moveDownNode()
        return { handled: true }
      }

      case 'node:navigate': {
        // 导航暂时直接调用实例方法（Phase 1 未命令化）
        // Phase 2 先 intent 化入口，保留原实现
        const payload = intent.payload as IntentPayloads['node:navigate']
        // TODO: 实现导航逻辑的 intent 化（当前仍由 defaultHotkeys 处理）
        this.logger.warn(
          intent.meta.traceId,
          intent.name,
          intent.meta.source,
          `navigate ${payload.direction} not yet intent-dispatched (fallback to direct call)`
        )
        return { handled: false, reason: 'navigation not yet intent-dispatched' }
      }

      default:
        return { handled: false, reason: `unhandled node intent: ${intent.name}` }
    }
  }

  // ============================================================================
  // Selection Intent 处理
  // ============================================================================

  private handleSelectionIntent(intent: Intent<SelectionIntentName>): IntentHandleResult {
    const meta = this.createCommandMeta(intent)

    switch (intent.name) {
      case 'selection:clear': {
        const result = this.mind.commands.selection.clear({}, meta)
        return { handled: true, commandResult: result }
      }

      case 'selection:changed': {
        // selection:changed 是桥接事件，不调用 command
        // 仅用于可观测（selection engine 的输出）
        const payload = intent.payload as IntentPayloads['selection:changed']
        this.mind.bus.fire('state:selectionChanged' as keyof import('../../shared/utils/events/eventBus').EventMap, {
          addedNodeIds: payload.addedNodeIds,
          removedNodeIds: payload.removedNodeIds,
          traceId: intent.meta.traceId,
          source: intent.meta.source,
        })
        return { handled: true }
      }

      default:
        return { handled: false, reason: `unhandled selection intent: ${intent.name}` }
    }
  }

  // ============================================================================
  // Canvas Intent 处理
  // ============================================================================

  private handleCanvasIntent(intent: Intent<CanvasIntentName>): IntentHandleResult {
    const { mind } = this

    switch (intent.name) {
      case 'canvas:pan': {
        const payload = intent.payload as IntentPayloads['canvas:pan']
        // 中文说明（修复）：
        // - 之前使用 container.scrollBy 会受限于容器尺寸（放大后无法滚动到边缘之外）
        // - 改为使用 mind.move() 修改 transform，支持无限画布滚动
        // - 方向取反：scrollBy(正) 是向下滚，move(负) 是向上推（内容上移，看到下方）
        mind.move(-payload.deltaX, -payload.deltaY)
        return { handled: true }
      }

      case 'canvas:zoom': {
        const payload = intent.payload as IntentPayloads['canvas:zoom']
        const offset =
          payload.centerX !== undefined && payload.centerY !== undefined
            ? { x: payload.centerX, y: payload.centerY }
            : undefined
        mind.scale(payload.scale, offset)
        return { handled: true }
      }

      case 'canvas:zoomIn': {
        const payload = intent.payload as IntentPayloads['canvas:zoomIn']
        const offset =
          payload.centerX !== undefined && payload.centerY !== undefined
            ? { x: payload.centerX, y: payload.centerY }
            : undefined
        mind.scale(mind.scaleVal + mind.scaleSensitivity, offset)
        return { handled: true }
      }

      case 'canvas:zoomOut': {
        const payload = intent.payload as IntentPayloads['canvas:zoomOut']
        const offset =
          payload.centerX !== undefined && payload.centerY !== undefined
            ? { x: payload.centerX, y: payload.centerY }
            : undefined
        mind.scale(mind.scaleVal - mind.scaleSensitivity, offset)
        return { handled: true }
      }

      case 'canvas:resetZoom': {
        mind.scale(1)
        return { handled: true }
      }

      case 'canvas:toCenter': {
        mind.toCenter()
        return { handled: true }
      }

      default:
        return { handled: false, reason: `unhandled canvas intent: ${intent.name}` }
    }
  }

  // ============================================================================
  // UI Intent 处理
  // ============================================================================

  private handleUIIntent(intent: Intent<UIIntentName>): IntentHandleResult {
    const { mind } = this

    switch (intent.name) {
      case 'ui:beginEdit': {
        const payload = intent.payload as IntentPayloads['ui:beginEdit']
        const topic = this.findTopicByNodeId(payload.nodeId)
        if (topic) {
          mind.beginEdit(topic)
          return { handled: true }
        }
        // 没有指定 nodeId 或找不到，尝试编辑当前节点
        if (mind.currentNode) {
          mind.beginEdit()
          return { handled: true }
        }
        return { handled: false, reason: 'no node to edit' }
      }

      case 'ui:openContextMenu': {
        const payload = intent.payload as IntentPayloads['ui:openContextMenu']
        // 通过 bus 广播，由 ContextMenu 组件监听
        mind.bus.fire('ui:openContextMenu', {
          nodeId: payload.targetType === 'node' ? payload.targetId : undefined,
          x: payload.clientX,
          y: payload.clientY,
          trigger: intent.meta.source === 'keyboard' ? 'keyboard' : 'mouse',
        })
        return { handled: true }
      }

      default:
        return { handled: false, reason: `unhandled ui intent: ${intent.name}` }
    }
  }

  // ============================================================================
  // Arrow Intent 处理
  // ============================================================================

  private handleArrowIntent(intent: Intent<ArrowIntentName>): IntentHandleResult {
    const { mind } = this

    switch (intent.name) {
      case 'arrow:select': {
        const payload = intent.payload as IntentPayloads['arrow:select']
        const arrow = document.getElementById(payload.arrowId) as CustomSvg | null
        if (arrow) {
          mind.selectArrow(arrow)
          return { handled: true }
        }
        return { handled: false, reason: 'arrow not found' }
      }

      case 'arrow:edit': {
        const payload = intent.payload as IntentPayloads['arrow:edit']
        const arrow = document.getElementById(payload.arrowId) as CustomSvg | null
        if (arrow) {
          mind.editArrowLabel(arrow)
          return { handled: true }
        }
        return { handled: false, reason: 'arrow not found' }
      }

      case 'arrow:remove': {
        const payload = intent.payload as IntentPayloads['arrow:remove']
        if (payload.arrowId) {
          // TODO: removeArrow by id（当前 API 只支持删除 currentArrow）
          this.logger.warn(
            intent.meta.traceId,
            intent.name,
            intent.meta.source,
            'removeArrow by id not supported, using currentArrow'
          )
        }
        mind.removeArrow()
        return { handled: true }
      }

      default:
        return { handled: false, reason: `unhandled arrow intent: ${intent.name}` }
    }
  }

  // ============================================================================
  // Summary Intent 处理
  // ============================================================================

  private handleSummaryIntent(intent: Intent<SummaryIntentName>): IntentHandleResult {
    const { mind } = this

    switch (intent.name) {
      case 'summary:select': {
        const payload = intent.payload as IntentPayloads['summary:select']
        const summary = document.getElementById(payload.summaryId) as SummarySvgGroup | null
        if (summary) {
          mind.selectSummary(summary)
          return { handled: true }
        }
        return { handled: false, reason: 'summary not found' }
      }

      case 'summary:edit': {
        const payload = intent.payload as IntentPayloads['summary:edit']
        // editSummary 需要 summary 对象
        if (mind.currentSummary && mind.currentSummary.summaryObj.id === payload.summaryId) {
          mind.editSummary(mind.currentSummary)
          return { handled: true }
        }
        // 先选中再编辑
        const summary = document.getElementById(payload.summaryId) as SummarySvgGroup | null
        if (summary) {
          mind.selectSummary(summary)
          if (mind.currentSummary) {
            mind.editSummary(mind.currentSummary)
            return { handled: true }
          }
        }
        return { handled: false, reason: 'summary not found' }
      }

      case 'summary:remove': {
        const payload = intent.payload as IntentPayloads['summary:remove']
        const summaryId = payload.summaryId ?? mind.currentSummary?.summaryObj?.id
        if (summaryId) {
          mind.removeSummary(summaryId)
          return { handled: true }
        }
        return { handled: false, reason: 'no summary to remove' }
      }

      default:
        return { handled: false, reason: `unhandled summary intent: ${intent.name}` }
    }
  }

  // ============================================================================
  // 工具方法
  // ============================================================================

  /**
   * 通过 nodeId 查找 Topic 元素
   *
   * 中文说明：
   * - 使用 nodeId -> domId 转换（遵循 contracts.md）
   * - 仅在需要调用未命令化的实例方法时使用
   */
  private findTopicByNodeId(nodeId: string): Topic | null {
    try {
      return this.mind.findEle(nodeId)
    } catch (error) {
      return null
    }
  }

  /**
   * 销毁
   */
  dispose(): void {
    this.customHandlers.clear()
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建 IntentDispatcher
 */
export function createIntentDispatcher(mind: MindMapInstance): IntentDispatcher {
  return new IntentDispatcher(mind)
}
