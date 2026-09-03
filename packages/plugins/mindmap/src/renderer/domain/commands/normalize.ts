/**
 * MindMap 命令体系 — 输入归一化（Normalize）
 *
 * 中文说明：
 * - 这是"口径统一"的单点实现，所有命令/feature 必须复用这里的归一化函数
 * - 消灭"同一意图多口径"导致的隐性耦合 bug
 * - 对齐 nodeOperations.removeNodes 的最终顶层节点集合逻辑
 *
 * @module domain/commands/normalize
 */

import type { Topic } from '../types/dom'
import type { MindMapInstance, NodeObj } from '../types'

// ============================================================================
// Topic[] 归一化（UI 入口常用）
// ============================================================================

/**
 * 基础 Topic 去重
 *
 * 中文说明：
 * - 去除重复的 Topic 引用
 * - 保持输入顺序
 */
export function dedupeTopics(topics: Topic[]): Topic[] {
  const seen = new Set<Topic>()
  const result: Topic[] = []
  for (const topic of topics) {
    if (!seen.has(topic)) {
      seen.add(topic)
      result.push(topic)
    }
  }
  return result
}

/**
 * 过滤 root 节点
 *
 * 中文说明：
 * - root 节点的 nodeObj.parent 为空
 * - root 不能进入"节点级命令"（删除/移动等）
 */
export function filterRootTopics(topics: Topic[]): Topic[] {
  return topics.filter((topic) => topic.nodeObj.parent != null)
}

/**
 * 直接父子收敛
 *
 * 中文说明：
 * - 如果某节点的直接父节点也在列表中，则移除该子节点
 * - 这是 unionTopics 的原有逻辑
 */
export function collapseDirectParentChild(topics: Topic[]): Topic[] {
  return topics.filter((topic, _, list) => {
    const parent = topic.nodeObj.parent
    return !list.some((other) => other !== topic && other.nodeObj === parent)
  })
}

/**
 * 祖先链收敛（用于删除/批量操作）
 *
 * 中文说明：
 * - 遍历每个节点的完整祖先链
 * - 如果任何祖先也在待处理列表中，则移除该节点（只保留顶层）
 * - 这是 removeNodes 的额外逻辑，比直接父子收敛更彻底
 */
export function collapseAncestorChain(topics: Topic[]): Topic[] {
  const idsInList = new Set(topics.map((t) => t.nodeObj.id))
  return topics.filter((topic) => {
    let current = topic.nodeObj.parent
    while (current) {
      if (idsInList.has(current.id)) {
        return false // 祖先也在列表中，跳过当前节点
      }
      current = current.parent
    }
    return true
  })
}

/**
 * 完整的删除归一化（Topic[]）
 *
 * 中文说明：
 * - 去重 + root 过滤 + 祖先链收敛
 * - 对齐 removeNodes 的最终顶层节点集合
 * - 这是删除相关命令必须使用的标准口径
 *
 * @param topics 原始 Topic 数组
 * @returns 归一化后的 Topic 数组（仅包含顶层节点）
 */
export function normalizeTopicsForRemove(topics: Topic[]): Topic[] {
  // Step 1: 去重
  const deduped = dedupeTopics(topics)
  // Step 2: 过滤 root
  const withoutRoot = filterRootTopics(deduped)
  // Step 3: 祖先链收敛（只保留顶层）
  const collapsed = collapseAncestorChain(withoutRoot)
  return collapsed
}

/**
 * 基础的 Topic 归一化（不含祖先链收敛）
 *
 * 中文说明：
 * - 去重 + root 过滤 + 直接父子收敛
 * - 对齐 unionTopics 的行为
 * - 用于非删除场景（如复制、选择等）
 */
export function normalizeTopicsBasic(topics: Topic[]): Topic[] {
  const deduped = dedupeTopics(topics)
  const withoutRoot = filterRootTopics(deduped)
  const collapsed = collapseDirectParentChild(withoutRoot)
  return collapsed
}

// ============================================================================
// nodeId[] 归一化（跨层/IPC/脚本 常用）
// ============================================================================

/**
 * 基础 nodeId 去重
 */
export function dedupeNodeIds(nodeIds: string[]): string[] {
  return [...new Set(nodeIds)]
}

/**
 * 过滤空字符串 nodeId
 */
export function filterEmptyNodeIds(nodeIds: string[]): string[] {
  return nodeIds.filter((id) => id && id.length > 0)
}

/**
 * 检查是否为 root 节点
 *
 * 中文说明：
 * - root 节点的 nodeObj.parent 为空
 * - 需要通过 mind.nodeData 查找
 */
export function isRootNodeId(nodeId: string, mind: MindMapInstance): boolean {
  return mind.nodeData.id === nodeId
}

/**
 * 根据 nodeId 获取 NodeObj
 *
 * 中文说明：
 * - 递归遍历 nodeData 树查找
 * - 找不到返回 null
 */
export function findNodeObjById(nodeId: string, root: NodeObj): NodeObj | null {
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

/**
 * 完整的删除归一化（nodeId[]）
 *
 * 中文说明：
 * - 去重 + 过滤空 + root 过滤 + 祖先链收敛
 * - 对齐 normalizeTopicsForRemove 的行为
 *
 * @param nodeIds 原始 nodeId 数组
 * @param mind MindMap 实例（用于查找 nodeObj）
 * @returns 归一化后的 nodeId 数组
 */
export function normalizeNodeIdsForRemove(nodeIds: string[], mind: MindMapInstance): string[] {
  // Step 1: 去重 + 过滤空
  const deduped = filterEmptyNodeIds(dedupeNodeIds(nodeIds))

  // Step 2: 转为 NodeObj 并过滤 root
  const nodeObjs: NodeObj[] = []
  for (const id of deduped) {
    if (isRootNodeId(id, mind)) {
      continue // 跳过 root
    }
    const nodeObj = findNodeObjById(id, mind.nodeData)
    if (nodeObj) {
      nodeObjs.push(nodeObj)
    }
  }

  // Step 3: 祖先链收敛
  const idsInList = new Set(nodeObjs.map((n) => n.id))
  const collapsed = nodeObjs.filter((nodeObj) => {
    let current = nodeObj.parent
    while (current) {
      if (idsInList.has(current.id)) {
        return false
      }
      current = current.parent
    }
    return true
  })

  return collapsed.map((n) => n.id)
}

/**
 * 基础的 nodeId 归一化（不含祖先链收敛）
 *
 * 中文说明：
 * - 去重 + 过滤空 + root 过滤
 * - 用于非删除场景
 */
export function normalizeNodeIdsBasic(nodeIds: string[], mind: MindMapInstance): string[] {
  const deduped = filterEmptyNodeIds(dedupeNodeIds(nodeIds))
  return deduped.filter((id) => !isRootNodeId(id, mind))
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 检查 Topic 数组是否包含 root
 *
 * 中文说明：
 * - 用于 guard 判断
 */
export function hasRootInTopics(topics: Topic[]): boolean {
  return topics.some((topic) => topic.nodeObj.parent == null)
}

/**
 * 检查 nodeId 数组是否包含 root
 */
export function hasRootInNodeIds(nodeIds: string[], mind: MindMapInstance): boolean {
  return nodeIds.some((id) => isRootNodeId(id, mind))
}

/**
 * 获取 Topic 数组中的所有 nodeId
 */
export function topicsToNodeIds(topics: Topic[]): string[] {
  return topics.map((topic) => topic.nodeObj.id)
}

// ============================================================================
// Move 相关工具函数（Phase 3 WP3-4）
// ============================================================================

/**
 * 检查是否为指定节点的后代
 *
 * 中文说明：
 * - 用于 move guard：禁止把父节点移动到自己的子树中
 * - 递归检查 ancestorId 是否在 nodeId 的祖先链中
 */
export function isDescendantOf(nodeId: string, ancestorId: string, mind: MindMapInstance): boolean {
  const nodeObj = findNodeObjById(nodeId, mind.nodeData)
  if (!nodeObj) return false

  let current = nodeObj.parent
  while (current) {
    if (current.id === ancestorId) {
      return true
    }
    current = current.parent
  }
  return false
}

/**
 * 检查是否为指定节点的祖先
 *
 * 中文说明：
 * - 用于 move guard：禁止把父节点移动到自己的子树中
 */
export function isAncestorOf(ancestorId: string, nodeId: string, mind: MindMapInstance): boolean {
  return isDescendantOf(nodeId, ancestorId, mind)
}

/**
 * 检查 toNodeId 是否是 fromNodeIds 中任一节点的后代
 *
 * 中文说明：
 * - 用于 move guard
 * - 如果 toNodeId 是 from 中任一节点的后代，则禁止移动
 */
export function isTargetDescendantOfAnySource(
  fromNodeIds: string[],
  toNodeId: string,
  mind: MindMapInstance
): boolean {
  for (const fromId of fromNodeIds) {
    if (isAncestorOf(fromId, toNodeId, mind)) {
      return true
    }
  }
  return false
}

/**
 * 完整的 Move 归一化（nodeId[]）
 *
 * 中文说明：
 * - 去重 + 过滤空 + root 过滤 + 祖先链收敛
 * - 对齐 normalizeNodeIdsForRemove 的行为
 * - move 和 remove 的 fromNodeIds 归一化逻辑一致
 */
export function normalizeNodeIdsForMove(nodeIds: string[], mind: MindMapInstance): string[] {
  return normalizeNodeIdsForRemove(nodeIds, mind)
}

/**
 * 获取节点的父节点 ID
 */
export function getParentNodeId(nodeId: string, mind: MindMapInstance): string | null {
  const nodeObj = findNodeObjById(nodeId, mind.nodeData)
  if (!nodeObj || !nodeObj.parent) return null
  return nodeObj.parent.id
}

/**
 * 获取节点在兄弟中的索引
 */
export function getNodeIndexInSiblings(nodeId: string, mind: MindMapInstance): number {
  const nodeObj = findNodeObjById(nodeId, mind.nodeData)
  if (!nodeObj || !nodeObj.parent) return -1
  const siblings = nodeObj.parent.children || []
  return siblings.findIndex((child) => child.id === nodeId)
}

// ============================================================================
// 删除后的选中策略（Command 层语义）
// ============================================================================

/**
 * 计算“删除后应选中的节点 ID”
 *
 * 中文说明：
 * - 这是删除命令语义的一部分，应由命令层统一决策（而非散落在 operations）
 * - 该函数不做 DOM 命中，只依赖 nodeData 的树结构（可测试、可复现）
 *
 * 策略：
 * - 以“最后一个被删除的节点”为参考（保持与旧行为一致：multi-delete 以最后一个为准）
 * - 优先选择同级的下一个未被删除节点
 * - 否则选择同级的上一个未被删除节点
 * - 若同级都被删除，则回退到父节点
 * - 若父节点也在删除集合中（非规范输入场景），向上收敛到最近一个“父节点不被删除”的层级再计算
 */
export function computeAfterSelectNodeIdForRemove(
  removedNodeIds: string[],
  mind: MindMapInstance
): string | null {
  if (!Array.isArray(removedNodeIds) || removedNodeIds.length === 0) return null

  const deleteIds = new Set(removedNodeIds)
  const referenceId = removedNodeIds[removedNodeIds.length - 1]!
  let removedObj = findNodeObjById(referenceId, mind.nodeData)
  if (!removedObj) return null

  // 非规范输入保护：如果删除集合包含“父节点”，则提升到最近一层保证 parent 不被删除
  while (removedObj.parent && deleteIds.has(removedObj.parent.id)) {
    removedObj = removedObj.parent
  }

  const parent = removedObj.parent
  if (!parent) return null

  const siblings = parent.children ?? []
  const index = siblings.findIndex((child) => child.id === removedObj.id)
  if (index === -1) {
    // 理论上不应发生（nodeData 的 parent/children 关系应一致）
    // 这里返回父节点，避免出现“删除后无选中”
    return parent.id
  }

  // 先向后找 next sibling（跳过同批删除的节点）
  for (let i = index + 1; i < siblings.length; i++) {
    const candidate = siblings[i]
    if (candidate && !deleteIds.has(candidate.id)) {
      return candidate.id
    }
  }

  // 再向前找 prev sibling
  for (let i = index - 1; i >= 0; i--) {
    const candidate = siblings[i]
    if (candidate && !deleteIds.has(candidate.id)) {
      return candidate.id
    }
  }

  // 同级都没了，回退父节点
  return parent.id
}
