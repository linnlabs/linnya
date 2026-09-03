import type { MindMapData, NodeObj } from '../types/index'
import type { MindMapHistoryResetReason, MindMapInstance } from '../types/index'
import type { Operation, OperationType } from '../../shared/utils/events/eventBus'
import { restoreSelectionFromSnapshot } from './selectionRestore'

/**
 * 历史记录项
 *
 * 中文说明：
 * - 记录单次操作的前后状态
 * - Phase 1 新增 commandMeta 字段，用于关联"这次 undo/redo 对应哪个命令"
 */
type History = {
  prev: MindMapData
  next: MindMapData
  currentSelected: string[]
  operation: OperationType
  currentTarget:
    | {
        type: 'summary' | 'arrow'
        value: string
      }
    | {
        type: 'nodes'
        value: string[]
      }
  /** 命令元信息（Phase 1：可观测性关联） */
  commandMeta?: {
    /** 事务 ID */
    txId?: string
    /** 命令名称 */
    commandName?: string
    /** 命令来源 */
    source?: string
    /** 结构版本号 */
    structureRevision?: number
    /** 外部追踪 ID */
    traceId?: string
    /** 操作时间戳 */
    timestamp?: number
  }
}

const calcCurentObject = function (operation: Operation): History['currentTarget'] {
  switch (operation.name) {
    case 'createSummary':
    case 'removeSummary':
    case 'finishEditSummary':
      return { type: 'summary', value: operation.obj.id }
    case 'createArrow':
    case 'removeArrow':
    case 'finishEditArrowLabel':
      return { type: 'arrow', value: operation.obj.id }
    case 'removeNodes':
    case 'copyNodes':
      return { type: 'nodes', value: operation.objs.map((obj: NodeObj) => obj.id) }
    case 'moveNodeBefore':
    case 'moveNodeAfter':
    case 'moveNodeIn':
      // 中文说明：这些操作带 objs（本次操作影响的一组节点）
      // 注意：`moveNodeIn` 在 Operation 联合类型中存在两种形态（obj / objs），必须做类型缩窄
      if ('objs' in operation) {
        return { type: 'nodes', value: operation.objs.map((obj: NodeObj) => obj.id) }
      }
      return { type: 'nodes', value: [operation.obj.id] }
    default:
      // 中文说明：其它 node 操作通常带单个 obj
      return { type: 'nodes', value: [operation.obj.id] }
  }
}

export default function (mind: MindMapInstance) {
  let history = [] as History[]
  let currentIndex = -1
  let current = mind.getData()
  let currentSelectedNodes: NodeObj[] = []

  const resetHistoryBaseline = function (reason: MindMapHistoryResetReason) {
    void reason
    history = []
    currentIndex = -1
    current = mind.getData()
    currentSelectedNodes = mind.currentNodes.map(node => node.nodeObj)
  }

  mind.resetHistoryBaseline = resetHistoryBaseline

  mind.undo = function () {
    // 操作是删除时，undo 恢复内容，应选中操作的目标
    // 操作是新增时，undo 删除内容，应选中当前选中节点
    if (currentIndex > -1) {
      const h = history[currentIndex]
      current = h.prev
      mind.refresh(h.prev)
      // 中文说明：selection 恢复走语义化策略，禁止 try/catch 静默吞异常
      restoreSelectionFromSnapshot(
        mind,
        {
          operation: h.operation,
          currentTarget: h.currentTarget,
          currentSelected: h.currentSelected,
          commandMeta: h.commandMeta,
        },
        'undo'
      )
      currentIndex--
    }
  }
  mind.redo = function () {
    if (currentIndex < history.length - 1) {
      currentIndex++
      const h = history[currentIndex]
      current = h.next
      mind.refresh(h.next)
      // 中文说明：selection 恢复走语义化策略，禁止 try/catch 静默吞异常
      restoreSelectionFromSnapshot(
        mind,
        {
          operation: h.operation,
          currentTarget: h.currentTarget,
          currentSelected: h.currentSelected,
          commandMeta: h.commandMeta,
        },
        'redo'
      )
    }
  }
  /**
   * 处理 operation 事件，创建历史记录
   *
   * 中文说明：
   * - Phase 1 新增：从 operation.meta 提取命令元信息并保存
   * - 便于诊断"这次 undo 对应哪个命令"
   */
  const handleOperation = function (operation: Operation) {
    if (operation.name === 'beginEdit') return
    history = history.slice(0, currentIndex + 1)
    const next = mind.getData()

    // 从 operation.meta 提取命令元信息（如果存在）
    const meta = (operation as { meta?: History['commandMeta'] }).meta
    const commandMeta: History['commandMeta'] = meta
      ? {
          txId: meta.txId,
          commandName: meta.commandName,
          source: meta.source,
          structureRevision: meta.structureRevision,
          traceId: meta.traceId,
          timestamp: meta.timestamp,
        }
      : undefined

    const item: History = {
      prev: current,
      operation: operation.name,
      currentSelected: currentSelectedNodes.map(n => n.id),
      currentTarget: calcCurentObject(operation),
      next,
      commandMeta,
    }
    history.push(item)
    current = next
    currentIndex = history.length - 1
  }
  /**
   * 处理选中节点变化
   */
  const handleSelectNodes = function () {
    currentSelectedNodes = mind.currentNodes.map(n => n.nodeObj)
  }

  // 注册事件监听
  mind.bus.addListener('operation', handleOperation)
  // 中文说明：监听新事件名（state:*），旧事件名仍会通过 bus 桥接双发
  mind.bus.addListener('state:selectNodes', handleSelectNodes)
  // 中文说明：仅监听 selectNodes 会导致“清空选区/仅取消选择”时快照过期
  // 这里同时监听 unselectNodes，确保 currentSelectedNodes 与 mind.currentNodes 同步
  mind.bus.addListener('state:unselectNodes', handleSelectNodes)

  /**
   * 中文说明（Phase 2 变更）：
   * - undo/redo 的 keydown 监听已迁移到 KeymapRegistry
   * - 通过 defaultKeymap.ts 注册，调用 mind.undo/mind.redo
   * - 此处不再直接监听 keydown，避免多处监听冲突
   */

  return () => {
    mind.bus.removeListener('operation', handleOperation)
    mind.bus.removeListener('state:selectNodes', handleSelectNodes)
    mind.bus.removeListener('state:unselectNodes', handleSelectNodes)
    if (mind.resetHistoryBaseline === resetHistoryBaseline) {
      mind.resetHistoryBaseline = undefined
    }
  }
}
