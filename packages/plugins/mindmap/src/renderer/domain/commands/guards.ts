/**
 * MindMap 命令体系 — 守卫（Guards）
 *
 * 中文说明：
 * - 把"到处 if/else"收敛为标准库
 * - 所有守卫返回 GuardResult，便于统一处理
 * - 失败时必须返回可观测的 reason，禁止 silent fallback
 *
 * @module domain/commands/guards
 */

import type { Topic } from '../types/dom'
import type { MindMapInstance } from '../types'
import type { CommandFailReason } from './types'
import { isRootNodeId, findNodeObjById, hasRootInTopics, hasRootInNodeIds } from './normalize'

// ============================================================================
// GuardResult — 守卫结果类型
// ============================================================================

/**
 * 守卫通过
 */
export interface GuardPass {
  ok: true
}

/**
 * 守卫失败
 */
export interface GuardFail {
  ok: false
  reason: CommandFailReason
  message?: string
}

/**
 * 守卫结果
 */
export type GuardResult = GuardPass | GuardFail

/**
 * 创建通过结果
 */
export function pass(): GuardPass {
  return { ok: true }
}

/**
 * 创建失败结果
 */
export function fail(reason: CommandFailReason, message?: string): GuardFail {
  return { ok: false, reason, message }
}

// ============================================================================
// 文档上下文守卫
// ============================================================================

/**
 * 要求文档上下文就绪
 *
 * 中文说明：
 * - 检查 mind.documentId 是否存在
 * - 依赖 documentId 的命令必须调用此守卫
 */
export function requireDocumentReady(mind: MindMapInstance): GuardResult {
  if (!mind.documentId) {
    return fail('missingDocumentId', 'Document context not ready (documentId is null)')
  }
  return pass()
}

// ============================================================================
// 选区守卫
// ============================================================================

/**
 * 要求选区非空
 *
 * 中文说明：
 * - 检查 mind.currentNodes 是否有选中节点
 * - 删除/复制等依赖选区的命令必须调用此守卫
 */
export function requireSelectionNonEmpty(mind: MindMapInstance): GuardResult {
  if (!mind.currentNodes || mind.currentNodes.length === 0) {
    return fail('noSelection', 'No nodes selected')
  }
  return pass()
}

/**
 * 要求当前节点存在
 *
 * 中文说明：
 * - 检查 mind.currentNode 是否存在
 * - 单节点操作使用
 */
export function requireCurrentNode(mind: MindMapInstance): GuardResult {
  if (!mind.currentNode) {
    return fail('noSelection', 'No current node')
  }
  return pass()
}

// ============================================================================
// Root 守卫
// ============================================================================

/**
 * 禁止 root 节点（Topic）
 *
 * 中文说明：
 * - root 节点不能进入"节点级命令"（删除/移动等）
 * - 检查单个 Topic
 */
export function forbidRootTopic(topic: Topic): GuardResult {
  if (!topic.nodeObj.parent) {
    return fail('forbidden', 'Root node cannot be operated')
  }
  return pass()
}

/**
 * 禁止 root 节点（nodeId）
 */
export function forbidRootNodeId(nodeId: string, mind: MindMapInstance): GuardResult {
  if (isRootNodeId(nodeId, mind)) {
    return fail('forbidden', 'Root node cannot be operated')
  }
  return pass()
}

/**
 * 禁止选区中包含 root
 *
 * 中文说明：
 * - 检查 mind.currentNodes 是否包含 root
 * - 与 normalizeTopicsForRemove 配合使用
 */
export function forbidRootInSelection(mind: MindMapInstance): GuardResult {
  if (hasRootInTopics(mind.currentNodes)) {
    return fail('forbidden', 'Selection contains root node')
  }
  return pass()
}

/**
 * 禁止 nodeIds 中包含 root
 */
export function forbidRootInNodeIds(nodeIds: string[], mind: MindMapInstance): GuardResult {
  if (hasRootInNodeIds(nodeIds, mind)) {
    return fail('forbidden', 'Node list contains root node')
  }
  return pass()
}

// ============================================================================
// 节点存在性守卫
// ============================================================================

/**
 * 要求节点存在（通过 nodeId）
 *
 * 中文说明：
 * - 检查指定 nodeId 对应的节点是否存在于 nodeData 中
 * - 不做 DOM 查询（纯数据层检查）
 */
export function requireNodeExists(nodeId: string, mind: MindMapInstance): GuardResult {
  const nodeObj = findNodeObjById(nodeId, mind.nodeData)
  if (!nodeObj) {
    return fail('notFound', `Node not found: ${nodeId}`)
  }
  return pass()
}

/**
 * 要求所有节点都存在
 */
export function requireAllNodesExist(nodeIds: string[], mind: MindMapInstance): GuardResult {
  for (const nodeId of nodeIds) {
    const result = requireNodeExists(nodeId, mind)
    if (!result.ok) {
      return result
    }
  }
  return pass()
}

// ============================================================================
// Payload 守卫
// ============================================================================

/**
 * 要求 payload 非空
 */
export function requirePayload<T>(payload: T | undefined | null, field: string): GuardResult {
  if (payload === undefined || payload === null) {
    return fail('invalidPayload', `Missing required field: ${field}`)
  }
  return pass()
}

/**
 * 要求 nodeId 字段有效
 */
export function requireValidNodeId(nodeId: string | undefined | null): GuardResult {
  if (!nodeId || typeof nodeId !== 'string' || nodeId.length === 0) {
    return fail('invalidPayload', 'Invalid nodeId')
  }
  return pass()
}

/**
 * 要求 nodeIds 数组有效
 */
export function requireValidNodeIds(nodeIds: string[] | undefined | null): GuardResult {
  if (!nodeIds || !Array.isArray(nodeIds)) {
    return fail('invalidPayload', 'Invalid nodeIds (expected array)')
  }
  if (nodeIds.length === 0) {
    return fail('invalidPayload', 'Empty nodeIds array')
  }
  for (const id of nodeIds) {
    if (typeof id !== 'string' || id.length === 0) {
      return fail('invalidPayload', 'Invalid nodeId in array')
    }
  }
  return pass()
}

// ============================================================================
// 组合守卫
// ============================================================================

/**
 * 组合多个守卫（全部通过才通过）
 *
 * 中文说明：
 * - 按顺序执行守卫
 * - 第一个失败的守卫决定最终结果
 */
export function all(...guards: GuardResult[]): GuardResult {
  for (const guard of guards) {
    if (!guard.ok) {
      return guard
    }
  }
  return pass()
}

/**
 * 延迟执行的组合守卫
 *
 * 中文说明：
 * - 接受返回 GuardResult 的函数数组
 * - 按顺序执行，遇到失败立即返回（短路求值）
 */
export function allLazy(...guardFns: Array<() => GuardResult>): GuardResult {
  for (const fn of guardFns) {
    const result = fn()
    if (!result.ok) {
      return result
    }
  }
  return pass()
}

// ============================================================================
// 常用预设组合
// ============================================================================

/**
 * 删除命令的标准守卫组合
 *
 * 中文说明：
 * - 文档就绪 + 选区非空
 * - 不检查 root（因为 normalize 会过滤 root）
 */
export function guardsForRemoveSelected(mind: MindMapInstance): GuardResult {
  return all(requireDocumentReady(mind), requireSelectionNonEmpty(mind))
}

/**
 * 基于 nodeIds 删除的标准守卫组合
 */
export function guardsForRemoveByIds(
  nodeIds: string[],
  mind: MindMapInstance
): GuardResult {
  return allLazy(
    () => requireDocumentReady(mind),
    () => requireValidNodeIds(nodeIds),
    () => requireAllNodesExist(nodeIds, mind)
  )
}

/**
 * 单节点操作的标准守卫组合
 */
export function guardsForSingleNode(
  nodeId: string,
  mind: MindMapInstance
): GuardResult {
  return allLazy(
    () => requireDocumentReady(mind),
    () => requireValidNodeId(nodeId),
    () => requireNodeExists(nodeId, mind),
    () => forbidRootNodeId(nodeId, mind)
  )
}

/**
 * 单节点操作（允许 root）的标准守卫组合
 *
 * 中文说明：
 * - 用于 toggleExpand 等允许在 root 上操作的命令
 */
export function guardsForSingleNodeAllowRoot(
  nodeId: string,
  mind: MindMapInstance
): GuardResult {
  return allLazy(
    () => requireDocumentReady(mind),
    () => requireValidNodeId(nodeId),
    () => requireNodeExists(nodeId, mind)
  )
}
