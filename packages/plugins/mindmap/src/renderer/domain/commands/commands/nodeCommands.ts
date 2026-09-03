/**
 * MindMap 命令体系 — 节点操作命令
 *
 * 中文说明：
 * - node.removeSelected / node.removeByIds
 * - node.addChild / node.insertSiblingBefore / node.insertSiblingAfter / node.insertParent
 * - node.toggleExpand
 * - 内部调用现有实例方法，不推翻 operations 层
 * - Phase 3 WP3-2：记录语义 steps
 *
 * @module domain/commands/commands/nodeCommands
 */

import type { MindMapInstance } from '../../types'
import type { CommandDef, CommandContext, CommandResult } from '../types'
import {
  guardsForRemoveSelected,
  guardsForRemoveByIds,
  guardsForSingleNode,
  guardsForSingleNodeAllowRoot,
} from '../guards'
import {
  normalizeTopicsForRemove,
  normalizeNodeIdsForRemove,
  normalizeNodeIdsForMove,
  isTargetDescendantOfAnySource,
  isRootNodeId,
  findNodeObjById,
  computeAfterSelectNodeIdForRemove,
  getParentNodeId,
  getNodeIndexInSiblings,
} from '../normalize'
import {
  recordNodeRemoveStep,
  recordNodeAddStep,
  recordNodeToggleExpandStep,
  recordNodeMoveStep,
} from '../../transaction/stepRecorder'
import { flickerLog } from '../../../shared/utils/debug/flickerDebug'

// ============================================================================
// Payload 类型
// ============================================================================

export interface RemoveByIdsPayload {
  nodeIds: string[]
}

export interface AddChildPayload {
  nodeId: string
  /** 是否立即进入编辑（默认 true） */
  edit?: boolean
}

export interface InsertSiblingPayload {
  nodeId: string
  /** 是否立即进入编辑（默认 true） */
  edit?: boolean
}

export interface InsertParentPayload {
  nodeId: string
  /** 是否立即进入编辑（默认 true） */
  edit?: boolean
}

export interface ToggleExpandPayload {
  nodeId: string
  /** 强制展开/折叠（不传则切换） */
  expanded?: boolean
}

// ============================================================================
// node.removeSelected — 删除当前选中的节点
// ============================================================================

export const nodeRemoveSelectedCommand: CommandDef<Record<string, never>> = {
  name: 'node.removeSelected',

  can(mind: MindMapInstance, _payload: Record<string, never>): boolean {
    const guard = guardsForRemoveSelected(mind)
    if (!guard.ok) return false

    // 额外检查：归一化后是否有节点可删
    const topics = normalizeTopicsForRemove(mind.currentNodes)
    return topics.length > 0
  },

  run(ctx: CommandContext, mind: MindMapInstance, _payload: Record<string, never>): CommandResult {
    const guard = guardsForRemoveSelected(mind)
    if (!guard.ok) {
      return { ok: false, txId: ctx.txId, reason: guard.reason, message: guard.message }
    }

    // 归一化：去重 + root 过滤 + 祖先链收敛
    const topics = normalizeTopicsForRemove(mind.currentNodes)

    if (topics.length === 0) {
      // 全是 root 或空选区（after normalize），不算失败但无操作
      return { ok: true, txId: ctx.txId }
    }

    // Phase 3 WP3-2：记录语义 step（在执行前）
    const nodeIds = topics.map((t) => t.nodeObj.id)
    recordNodeRemoveStep(ctx, mind, nodeIds)

    // 删除后选中策略：由命令层统一决策（operations 只负责执行）
    const afterSelectNodeId = computeAfterSelectNodeIdForRemove(nodeIds, mind)

    // 调用现有方法
    // 注意：removeNodes 内部会再次调用 unionTopics，但我们已经做了更彻底的归一化
    // Phase 1 先保持调用现有方法，不改 operations 内部逻辑
    mind.removeNodes(topics, { afterSelectNodeId })

    return { ok: true, txId: ctx.txId }
  },
}

// ============================================================================
// node.removeByIds — 按 nodeIds 删除节点
// ============================================================================

export const nodeRemoveByIdsCommand: CommandDef<RemoveByIdsPayload> = {
  name: 'node.removeByIds',

  can(mind: MindMapInstance, payload: RemoveByIdsPayload): boolean {
    const guard = guardsForRemoveByIds(payload?.nodeIds ?? [], mind)
    if (!guard.ok) return false

    // 额外检查：归一化后是否有节点可删
    const normalizedIds = normalizeNodeIdsForRemove(payload.nodeIds, mind)
    return normalizedIds.length > 0
  },

  run(ctx: CommandContext, mind: MindMapInstance, payload: RemoveByIdsPayload): CommandResult {
    const guard = guardsForRemoveByIds(payload?.nodeIds ?? [], mind)
    if (!guard.ok) {
      return { ok: false, txId: ctx.txId, reason: guard.reason, message: guard.message }
    }

    // 归一化
    const normalizedIds = normalizeNodeIdsForRemove(payload.nodeIds, mind)

    if (normalizedIds.length === 0) {
      return { ok: true, txId: ctx.txId }
    }

    // 转为 Topic[]
    const topics = []
    for (const nodeId of normalizedIds) {
      try {
        const topic = mind.findEle(nodeId)
        topics.push(topic)
      } catch {
        // 节点可能折叠，跳过（不影响其他节点删除）
        continue
      }
    }

    if (topics.length === 0) {
      // 所有节点都折叠了
      return { ok: false, txId: ctx.txId, reason: 'notFound', message: 'All target nodes are collapsed' }
    }

    // Phase 3 WP3-2：记录语义 step（在执行前）
    const nodeIds = topics.map((t) => t.nodeObj.id)
    recordNodeRemoveStep(ctx, mind, nodeIds)

    // 删除后选中策略：由命令层统一决策（operations 只负责执行）
    const afterSelectNodeId = computeAfterSelectNodeIdForRemove(nodeIds, mind)
    mind.removeNodes(topics, { afterSelectNodeId })

    return { ok: true, txId: ctx.txId }
  },
}

// ============================================================================
// node.addChild — 添加子节点
// ============================================================================

export const nodeAddChildCommand: CommandDef<AddChildPayload> = {
  name: 'node.addChild',

  can(mind: MindMapInstance, payload: AddChildPayload): boolean {
    // addChild 允许在 root 上操作
    const guard = guardsForSingleNodeAllowRoot(payload?.nodeId, mind)
    return guard.ok
  },

  run(ctx: CommandContext, mind: MindMapInstance, payload: AddChildPayload): CommandResult {
    const guard = guardsForSingleNodeAllowRoot(payload?.nodeId, mind)
    if (!guard.ok) {
      return { ok: false, txId: ctx.txId, reason: guard.reason, message: guard.message }
    }

    // 查找 DOM 元素
    let topic
    try {
      topic = mind.findEle(payload.nodeId)
    } catch {
      return { ok: false, txId: ctx.txId, reason: 'notFound', message: `Node DOM not found: ${payload.nodeId}` }
    }

    const edit = payload.edit ?? true

    // Phase 3 WP3-2：记录语义 step（在执行前）
    recordNodeAddStep(ctx, mind, 'addChild', payload.nodeId, edit)

    // 调用现有方法
    mind.addChild(topic, undefined, { edit })

    return { ok: true, txId: ctx.txId }
  },
}

// ============================================================================
// node.insertSiblingBefore — 在节点前插入兄弟
// ============================================================================

export const nodeInsertSiblingBeforeCommand: CommandDef<InsertSiblingPayload> = {
  name: 'node.insertSiblingBefore',

  can(mind: MindMapInstance, payload: InsertSiblingPayload): boolean {
    const guard = guardsForSingleNode(payload?.nodeId, mind)
    if (!guard.ok) return false

    // 额外检查：root 的 insertSibling 会变成 addChild，这里先不禁止
    // 让 operations 内部处理这个逻辑
    return true
  },

  run(ctx: CommandContext, mind: MindMapInstance, payload: InsertSiblingPayload): CommandResult {
    // 对于 root 的情况，insertSibling 会内部转为 addChild
    // 所以这里用 guardsForSingleNodeAllowRoot
    const guard = guardsForSingleNodeAllowRoot(payload?.nodeId, mind)
    if (!guard.ok) {
      return { ok: false, txId: ctx.txId, reason: guard.reason, message: guard.message }
    }

    let topic
    try {
      topic = mind.findEle(payload.nodeId)
    } catch {
      return { ok: false, txId: ctx.txId, reason: 'notFound', message: `Node DOM not found: ${payload.nodeId}` }
    }

    const edit = payload.edit ?? true

    // Phase 3 WP3-2：记录语义 step（在执行前）
    recordNodeAddStep(ctx, mind, 'insertSiblingBefore', payload.nodeId, edit)

    flickerLog('command node.insertSiblingBefore', {
      t: performance.now(),
      txId: ctx.txId,
      nodeId: payload.nodeId,
      edit,
      structureRevision: mind.structureRevision,
      transition: mind.map?.style?.transition ?? null,
      transform: mind.map?.style?.transform ?? null,
    })

    mind.insertSibling('before', topic, undefined, { edit })

    flickerLog('command node.insertSiblingBefore done', {
      t: performance.now(),
      txId: ctx.txId,
      structureRevision: mind.structureRevision,
      transition: mind.map?.style?.transition ?? null,
      transform: mind.map?.style?.transform ?? null,
    })

    return { ok: true, txId: ctx.txId }
  },
}

// ============================================================================
// node.insertSiblingAfter — 在节点后插入兄弟
// ============================================================================

export const nodeInsertSiblingAfterCommand: CommandDef<InsertSiblingPayload> = {
  name: 'node.insertSiblingAfter',

  can(mind: MindMapInstance, payload: InsertSiblingPayload): boolean {
    const guard = guardsForSingleNode(payload?.nodeId, mind)
    if (!guard.ok) return false
    return true
  },

  run(ctx: CommandContext, mind: MindMapInstance, payload: InsertSiblingPayload): CommandResult {
    const guard = guardsForSingleNodeAllowRoot(payload?.nodeId, mind)
    if (!guard.ok) {
      return { ok: false, txId: ctx.txId, reason: guard.reason, message: guard.message }
    }

    let topic
    try {
      topic = mind.findEle(payload.nodeId)
    } catch {
      return { ok: false, txId: ctx.txId, reason: 'notFound', message: `Node DOM not found: ${payload.nodeId}` }
    }

    const edit = payload.edit ?? true

    // Phase 3 WP3-2：记录语义 step（在执行前）
    recordNodeAddStep(ctx, mind, 'insertSiblingAfter', payload.nodeId, edit)

    flickerLog('command node.insertSiblingAfter', {
      t: performance.now(),
      txId: ctx.txId,
      nodeId: payload.nodeId,
      edit,
      structureRevision: mind.structureRevision,
      transition: mind.map?.style?.transition ?? null,
      transform: mind.map?.style?.transform ?? null,
    })

    mind.insertSibling('after', topic, undefined, { edit })

    flickerLog('command node.insertSiblingAfter done', {
      t: performance.now(),
      txId: ctx.txId,
      structureRevision: mind.structureRevision,
      transition: mind.map?.style?.transition ?? null,
      transform: mind.map?.style?.transform ?? null,
    })

    return { ok: true, txId: ctx.txId }
  },
}

// ============================================================================
// node.insertParent — 插入父节点
// ============================================================================

export const nodeInsertParentCommand: CommandDef<InsertParentPayload> = {
  name: 'node.insertParent',

  can(mind: MindMapInstance, payload: InsertParentPayload): boolean {
    // insertParent 不允许在 root 上操作（root 没有父节点可插入）
    const guard = guardsForSingleNode(payload?.nodeId, mind)
    return guard.ok
  },

  run(ctx: CommandContext, mind: MindMapInstance, payload: InsertParentPayload): CommandResult {
    const guard = guardsForSingleNode(payload?.nodeId, mind)
    if (!guard.ok) {
      return { ok: false, txId: ctx.txId, reason: guard.reason, message: guard.message }
    }

    let topic
    try {
      topic = mind.findEle(payload.nodeId)
    } catch {
      return { ok: false, txId: ctx.txId, reason: 'notFound', message: `Node DOM not found: ${payload.nodeId}` }
    }

    const edit = payload.edit ?? true

    // Phase 3 WP3-2：记录语义 step（在执行前）
    recordNodeAddStep(ctx, mind, 'insertParent', payload.nodeId, edit)

    mind.insertParent(topic, undefined, { edit })

    return { ok: true, txId: ctx.txId }
  },
}

// ============================================================================
// node.toggleExpand — 切换节点展开/折叠
// ============================================================================

export const nodeToggleExpandCommand: CommandDef<ToggleExpandPayload> = {
  name: 'node.toggleExpand',

  can(mind: MindMapInstance, payload: ToggleExpandPayload): boolean {
    // toggleExpand 允许在 root 上操作
    const guard = guardsForSingleNodeAllowRoot(payload?.nodeId, mind)
    if (!guard.ok) return false

    // 额外检查：节点必须有子节点才能展开/折叠
    const nodeObj = findNodeObjById(payload.nodeId, mind.nodeData)
    if (!nodeObj) return false
    if (!nodeObj.children || nodeObj.children.length === 0) {
      return false // 没有子节点，不能展开/折叠
    }

    return true
  },

  run(ctx: CommandContext, mind: MindMapInstance, payload: ToggleExpandPayload): CommandResult {
    const guard = guardsForSingleNodeAllowRoot(payload?.nodeId, mind)
    if (!guard.ok) {
      return { ok: false, txId: ctx.txId, reason: guard.reason, message: guard.message }
    }

    const nodeObj = findNodeObjById(payload.nodeId, mind.nodeData)
    if (!nodeObj) {
      return { ok: false, txId: ctx.txId, reason: 'notFound', message: `Node not found: ${payload.nodeId}` }
    }

    if (!nodeObj.children || nodeObj.children.length === 0) {
      return { ok: false, txId: ctx.txId, reason: 'forbidden', message: 'Node has no children to expand/collapse' }
    }

    let topic
    try {
      topic = mind.findEle(payload.nodeId)
    } catch {
      return { ok: false, txId: ctx.txId, reason: 'notFound', message: `Node DOM not found: ${payload.nodeId}` }
    }

    // 获取当前展开状态（expanded 为 false 或 undefined 表示展开，true 表示折叠）
    const wasExpanded = !nodeObj.expanded
    // 计算操作后的展开状态
    const isExpanded = payload.expanded !== undefined ? payload.expanded : !wasExpanded

    // Phase 3 WP3-2：记录语义 step（在执行前）
    recordNodeToggleExpandStep(ctx, mind, payload.nodeId, wasExpanded, isExpanded)

    // 调用现有方法
    // expandNode(el, isExpand?) - 如果 payload.expanded 有值则强制设置，否则切换
    mind.expandNode(topic, payload.expanded)

    return { ok: true, txId: ctx.txId }
  },
}

// ============================================================================
// node.move — 移动节点（Phase 3 WP3-4：拖拽命令化）
// ============================================================================

/**
 * Move 操作的位置类型
 */
export type MovePosition = 'before' | 'after' | 'in'

/**
 * Move 命令的 payload
 *
 * 中文说明：
 * - fromNodeIds：被移动的节点 ID 列表
 * - toNodeId：目标节点 ID
 * - position：位置（before/after/in）
 */
export interface MoveNodePayload {
  fromNodeIds: string[]
  toNodeId: string
  position: MovePosition
}

/**
 * Move 的 guards 检查结果
 */
interface MoveGuardResult {
  ok: boolean
  reason?: 'invalidPayload' | 'forbidden' | 'notFound' | 'missingDocumentId'
  message?: string
}

/**
 * node.move 的 guards
 *
 * 中文说明（按 phase3.md 设计）：
 * - 禁止 root 参与 move（fromNodeIds 不允许包含 root）
 * - 禁止把父节点移动到自己的子树中（toNodeId 不能是 from 中任一节点的 descendant）
 * - 禁止 noop（toNodeId 不能在 fromNodeIds 内）
 * - 输入口径收敛（fromNodeIds 去重、祖先链收敛）
 */
function guardsForMove(payload: MoveNodePayload | undefined, mind: MindMapInstance): MoveGuardResult {
  // 文档必须就绪
  if (!mind.documentId) {
    return { ok: false, reason: 'missingDocumentId', message: 'Document not ready' }
  }

  // payload 校验
  if (!payload) {
    return { ok: false, reason: 'invalidPayload', message: 'Payload is required' }
  }
  if (!Array.isArray(payload.fromNodeIds) || payload.fromNodeIds.length === 0) {
    return { ok: false, reason: 'invalidPayload', message: 'fromNodeIds must be non-empty array' }
  }
  if (!payload.toNodeId || typeof payload.toNodeId !== 'string') {
    return { ok: false, reason: 'invalidPayload', message: 'toNodeId is required' }
  }
  if (!['before', 'after', 'in'].includes(payload.position)) {
    return { ok: false, reason: 'invalidPayload', message: 'position must be "before", "after", or "in"' }
  }

  // 归一化 fromNodeIds
  const normalizedFromIds = normalizeNodeIdsForMove(payload.fromNodeIds, mind)
  if (normalizedFromIds.length === 0) {
    return { ok: false, reason: 'forbidden', message: 'No valid nodes to move (all filtered out or root)' }
  }

  // 检查 toNodeId 是否存在
  const toNodeObj = findNodeObjById(payload.toNodeId, mind.nodeData)
  if (!toNodeObj) {
    return { ok: false, reason: 'notFound', message: `Target node not found: ${payload.toNodeId}` }
  }

  // 禁止 noop：toNodeId 不能在 fromNodeIds 内
  if (normalizedFromIds.includes(payload.toNodeId)) {
    return { ok: false, reason: 'forbidden', message: 'Cannot move node to itself' }
  }

  // 禁止把父节点移动到自己的子树中
  if (isTargetDescendantOfAnySource(normalizedFromIds, payload.toNodeId, mind)) {
    return { ok: false, reason: 'forbidden', message: 'Cannot move node into its own subtree' }
  }

  // 对于 position = 'before' 或 'after'，toNodeId 不能是 root
  // 因为 root 没有兄弟节点
  if (payload.position !== 'in' && isRootNodeId(payload.toNodeId, mind)) {
    return { ok: false, reason: 'forbidden', message: 'Cannot move before/after root node' }
  }

  return { ok: true }
}

export const nodeMoveCommand: CommandDef<MoveNodePayload> = {
  name: 'node.move',

  can(mind: MindMapInstance, payload: MoveNodePayload): boolean {
    const guard = guardsForMove(payload, mind)
    return guard.ok
  },

  run(ctx: CommandContext, mind: MindMapInstance, payload: MoveNodePayload): CommandResult {
    const guard = guardsForMove(payload, mind)
    if (!guard.ok) {
      return { ok: false, txId: ctx.txId, reason: guard.reason!, message: guard.message }
    }

    // 归一化 fromNodeIds
    const normalizedFromIds = normalizeNodeIdsForMove(payload.fromNodeIds, mind)

    // 获取 Topic 元素
    const fromTopics = []
    for (const nodeId of normalizedFromIds) {
      try {
        const topic = mind.findEle(nodeId)
        fromTopics.push(topic)
      } catch {
        // 节点可能折叠，跳过
        continue
      }
    }

    if (fromTopics.length === 0) {
      return { ok: false, txId: ctx.txId, reason: 'notFound', message: 'All source nodes are collapsed or not found' }
    }

    let toTopic
    try {
      toTopic = mind.findEle(payload.toNodeId)
    } catch {
      return { ok: false, txId: ctx.txId, reason: 'notFound', message: `Target node DOM not found: ${payload.toNodeId}` }
    }

    // Phase 3 WP3-2：记录语义 step（在执行前）
    // 构建 before 快照（用于 undo）
    const before: { nodeParentMap: Record<string, string>; nodeIndexMap: Record<string, number> } = {
      nodeParentMap: {},
      nodeIndexMap: {},
    }
    for (const nodeId of normalizedFromIds) {
      const parentId = getParentNodeId(nodeId, mind)
      const index = getNodeIndexInSiblings(nodeId, mind)
      if (parentId !== null) {
        before.nodeParentMap[nodeId] = parentId
      }
      if (index !== -1) {
        before.nodeIndexMap[nodeId] = index
      }
    }
    recordNodeMoveStep(ctx, mind, normalizedFromIds, payload.toNodeId, payload.position, before)

    // 调用现有方法
    if (payload.position === 'before') {
      mind.moveNodeBefore(fromTopics, toTopic)
    } else if (payload.position === 'after') {
      mind.moveNodeAfter(fromTopics, toTopic)
    } else if (payload.position === 'in') {
      mind.moveNodeIn(fromTopics, toTopic)
    }

    return { ok: true, txId: ctx.txId }
  },
}

// ============================================================================
// 导出所有命令
// ============================================================================

export const nodeCommands = [
  nodeRemoveSelectedCommand,
  nodeRemoveByIdsCommand,
  nodeAddChildCommand,
  nodeInsertSiblingBeforeCommand,
  nodeInsertSiblingAfterCommand,
  nodeInsertParentCommand,
  nodeToggleExpandCommand,
  nodeMoveCommand,
] as const
