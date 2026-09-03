import type { MindMapInstance, NodeObj } from '../../../domain/types'

/**
 * Lifecycle Signals（生命周期信号）工具函数
 *
 * 中文说明：
 * - 这是“基础设施层”工具：统一发出 document/structure/geometry 等信号
 * - 目的：把信号语义固定下来，避免各处重复实现、时序不一致与参数漂移
 */

function countNodes(node: NodeObj | undefined): number {
  if (!node) return 0
  let total = 1
  const children = node.children
  if (Array.isArray(children)) {
    for (const child of children) {
      total += countNodes(child)
    }
  }
  return total
}

/**
 * 结构就绪：在结构重建完成后触发（init/refresh 完成）
 *
 * 约束：
 * - 仅当 mind.documentId 存在时才触发（文档上下文缺失时，不应让 feature 误以为 ready）
 * - 统一在这里自增 structureRevision
 */
export function fireStructureReady(mind: MindMapInstance): void {
  const docId = mind.documentId
  if (!docId) return

  mind.structureRevision = (mind.structureRevision ?? 0) + 1

  const nodeCount = countNodes(mind.nodeData)
  mind.bus.fire('lifecycle:structureReady', {
    documentId: docId,
    nodeCount,
    structureRevision: mind.structureRevision,
    timestamp: Date.now(),
  })
}

