import type { MindMapInstance, NodeObj } from '../types/index'
import type { Topic } from '../types/dom'
import type { OperationType } from '../../shared/utils/events/eventBus'

/**
 * Selection 恢复（语义化 + 可观测）
 *
 * 中文说明：
 * - 用于 undo/redo 的 selection 恢复
 * - 以命令语义为主，避免 try/catch 静默吞掉
 * - 当目标节点不可见时，回退到最近可见祖先
 */

export type SelectionRestoreAction = 'undo' | 'redo'

export interface HistorySelectionSnapshot {
  operation: OperationType
  currentTarget: {
    type: 'summary' | 'arrow' | 'nodes'
    value: string | string[]
  }
  currentSelected: string[]
  commandMeta?: {
    txId?: string
    commandName?: string
    source?: string
    traceId?: string
  }
}

export interface SelectionRestoreResult {
  selectedNodeIds: string[]
  missingNodeIds: string[]
  fallbackNodeIds: string[]
  action: SelectionRestoreAction
  reason: string
}

type MissingReason = 'notFoundInData' | 'notInDom'

interface ResolveTopicResult {
  topic: Topic | null
  resolvedNodeId?: string
  missingReason?: MissingReason
}

function safeFindTopic(mind: MindMapInstance, nodeId: string): Topic | null {
  try {
    return mind.findEle(nodeId) as Topic
  } catch {
    return null
  }
}

function findNodeObjById(nodeId: string, root: NodeObj): NodeObj | null {
  if (root.id === nodeId) {
    return root
  }
  if (root.children) {
    for (const child of root.children) {
      const found = findNodeObjById(nodeId, child)
      if (found) {
        return found
      }
    }
  }
  return null
}

function resolveTopicByNodeId(mind: MindMapInstance, nodeId: string): ResolveTopicResult {
  const direct = safeFindTopic(mind, nodeId)
  if (direct) {
    return { topic: direct, resolvedNodeId: nodeId }
  }

  const nodeObj = findNodeObjById(nodeId, mind.nodeData)
  if (!nodeObj) {
    return { topic: null, missingReason: 'notFoundInData' }
  }

  let current = nodeObj.parent
  while (current) {
    const ancestorTopic = safeFindTopic(mind, current.id)
    if (ancestorTopic) {
      return { topic: ancestorTopic, resolvedNodeId: current.id }
    }
    current = current.parent
  }

  return { topic: null, missingReason: 'notInDom' }
}

function resolveDesiredNodeIds(
  snapshot: HistorySelectionSnapshot,
  action: SelectionRestoreAction
): { nodeIds: string[]; reason: string } {
  if (snapshot.currentTarget.type !== 'nodes') {
    return { nodeIds: [], reason: 'non-node-target' }
  }

  if (snapshot.operation === 'removeNodes') {
    if (action === 'undo') {
      return { nodeIds: snapshot.currentTarget.value as string[], reason: 'undo-removeNodes' }
    }
    return { nodeIds: snapshot.currentSelected, reason: 'redo-removeNodes' }
  }

  if (action === 'undo') {
    return { nodeIds: snapshot.currentSelected, reason: 'undo-default' }
  }

  return { nodeIds: snapshot.currentTarget.value as string[], reason: 'redo-default' }
}

function logSelectionRestore(
  snapshot: HistorySelectionSnapshot,
  result: SelectionRestoreResult
): void {
  if (import.meta.env.MODE === 'production') return
  if (result.missingNodeIds.length === 0 && result.fallbackNodeIds.length === 0) return

  console.warn('[SelectionRestore] selection fallback', {
    action: result.action,
    reason: result.reason,
    commandName: snapshot.commandMeta?.commandName,
    txId: snapshot.commandMeta?.txId,
    desiredNodeIds: snapshot.currentTarget.type === 'nodes' ? snapshot.currentTarget.value : [],
    selectedNodeIds: result.selectedNodeIds,
    missingNodeIds: result.missingNodeIds,
    fallbackNodeIds: result.fallbackNodeIds,
  })
}

/**
 * 恢复 selection（用于 undo/redo）
 */
export function restoreSelectionFromSnapshot(
  mind: MindMapInstance,
  snapshot: HistorySelectionSnapshot,
  action: SelectionRestoreAction
): SelectionRestoreResult {
  const { nodeIds, reason } = resolveDesiredNodeIds(snapshot, action)

  if (nodeIds.length === 0) {
    return {
      selectedNodeIds: [],
      missingNodeIds: [],
      fallbackNodeIds: [],
      action,
      reason,
    }
  }

  const selectedById = new Map<string, Topic>()
  const missingNodeIds: string[] = []
  const fallbackNodeIds: string[] = []

  for (const nodeId of nodeIds) {
    const resolved = resolveTopicByNodeId(mind, nodeId)
    if (resolved.topic && resolved.resolvedNodeId) {
      if (resolved.resolvedNodeId !== nodeId) {
        fallbackNodeIds.push(nodeId)
      }
      selectedById.set(resolved.resolvedNodeId, resolved.topic)
      continue
    }

    if (resolved.missingReason) {
      missingNodeIds.push(nodeId)
    }
  }

  const topics = Array.from(selectedById.values())
  if (topics.length > 0) {
    mind.selectNodes(topics)
  } else {
    mind.clearSelection()
  }

  const result: SelectionRestoreResult = {
    selectedNodeIds: Array.from(selectedById.keys()),
    missingNodeIds,
    fallbackNodeIds,
    action,
    reason,
  }

  logSelectionRestore(snapshot, result)

  return result
}
