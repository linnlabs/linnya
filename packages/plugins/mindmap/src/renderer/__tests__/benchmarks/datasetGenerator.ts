/**
 * MindMap 基准数据集生成器
 *
 * Phase 3 WP3-3：History 演进评审的数据集生成工具
 *
 * 中文说明：
 * - 支持 S/M/L 三档规模：1k/5k/20k nodes
 * - 支持树深度差异（浅/深）
 * - 支持 arrows/summaries 的数量级差异
 * - 数据集可重复生成，便于 CI/本地对比
 *
 * @module __tests__/benchmarks/datasetGenerator
 */

import type { MindMapData, NodeObj } from '../../domain/types'

// ============================================================================
// 配置类型
// ============================================================================

/**
 * 数据集规模档位
 */
export type DatasetScale = 'S' | 'M' | 'L'

/**
 * 树深度模式
 */
export type TreeDepthMode = 'shallow' | 'deep'

/**
 * 关系密度（arrows/summaries）
 */
export type RelationDensity = 'none' | 'low' | 'high'

/**
 * 数据集配置
 */
export interface DatasetConfig {
  /** 规模档位 */
  scale: DatasetScale
  /** 树深度模式 */
  depthMode: TreeDepthMode
  /** 关系密度 */
  relationDensity: RelationDensity
  /** 随机种子（可选，用于可重复生成） */
  seed?: number
}

/**
 * 规模档位对应的节点数
 */
export const SCALE_NODE_COUNTS: Record<DatasetScale, number> = {
  S: 1000,
  M: 5000,
  L: 20000,
}

/**
 * 深度模式对应的最大深度
 */
export const DEPTH_LIMITS: Record<TreeDepthMode, number> = {
  shallow: 4, // 最大 4 层
  deep: 12, // 最大 12 层
}

/**
 * 关系密度对应的比例（相对于节点数）
 */
export const RELATION_RATIOS: Record<RelationDensity, { arrows: number; summaries: number }> = {
  none: { arrows: 0, summaries: 0 },
  low: { arrows: 0.02, summaries: 0.01 }, // 2% arrows, 1% summaries
  high: { arrows: 0.1, summaries: 0.05 }, // 10% arrows, 5% summaries
}

// ============================================================================
// 简单的伪随机数生成器（可复现）
// ============================================================================

/**
 * 简单的线性同余生成器（LCG）
 * 用于生成可重复的伪随机数序列
 */
class SeededRandom {
  private seed: number

  constructor(seed: number) {
    this.seed = seed
  }

  /**
   * 生成 [0, 1) 范围的伪随机数
   */
  next(): number {
    // LCG 参数（来自 MINSTD）
    this.seed = (this.seed * 48271) % 2147483647
    return this.seed / 2147483647
  }

  /**
   * 生成 [min, max) 范围的整数
   */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min)) + min
  }

  /**
   * 从数组中随机选择一个元素
   */
  pick<T>(arr: T[]): T {
    return arr[this.nextInt(0, arr.length)]
  }

  /**
   * 从数组中随机选择 n 个元素（不重复）
   */
  sample<T>(arr: T[], n: number): T[] {
    const copy = [...arr]
    const result: T[] = []
    for (let i = 0; i < Math.min(n, copy.length); i++) {
      const idx = this.nextInt(0, copy.length)
      result.push(copy[idx])
      copy.splice(idx, 1)
    }
    return result
  }
}

// ============================================================================
// 数据集生成器
// ============================================================================

let globalNodeIdCounter = 0

/**
 * 生成唯一的节点 ID
 */
function generateNodeId(): string {
  return `node_${++globalNodeIdCounter}`
}

/**
 * 重置 ID 计数器（每次生成新数据集时调用）
 */
function resetNodeIdCounter(): void {
  globalNodeIdCounter = 0
}

/**
 * 生成单个节点
 */
function createNode(id: string, topic: string, parent?: NodeObj): NodeObj {
  return {
    id,
    topic,
    parent,
    children: [],
  }
}

/**
 * 递归生成子树
 *
 * @param parent 父节点
 * @param currentDepth 当前深度
 * @param maxDepth 最大深度
 * @param targetCount 目标节点数
 * @param createdCount 已创建节点数（引用计数）
 * @param rng 随机数生成器
 * @param allNodes 所有节点的收集数组
 */
function generateSubtree(
  parent: NodeObj,
  currentDepth: number,
  maxDepth: number,
  targetCount: number,
  createdCount: { value: number },
  rng: SeededRandom,
  allNodes: NodeObj[]
): void {
  if (createdCount.value >= targetCount || currentDepth >= maxDepth) {
    return
  }

  // 计算剩余需要创建的节点数
  const remaining = targetCount - createdCount.value

  // 根据深度和剩余数量决定子节点数
  // 深度越深，子节点数越少；剩余越多，子节点数越多
  const depthFactor = 1 - currentDepth / maxDepth
  const baseChildCount = Math.max(1, Math.floor(depthFactor * 5))
  const childCount = rng.nextInt(1, Math.min(baseChildCount + 3, remaining + 1))

  for (let i = 0; i < childCount && createdCount.value < targetCount; i++) {
    const id = generateNodeId()
    const topic = `Topic ${id.split('_')[1]} (D${currentDepth})`
    const child = createNode(id, topic, parent)

    parent.children!.push(child)
    allNodes.push(child)
    createdCount.value++

    // 递归生成子节点
    generateSubtree(child, currentDepth + 1, maxDepth, targetCount, createdCount, rng, allNodes)
  }
}

/**
 * 生成 arrows（节点间的连接关系）
 */
function generateArrows(
  allNodes: NodeObj[],
  count: number,
  rng: SeededRandom
): MindMapData['arrows'] {
  const arrows: MindMapData['arrows'] = []
  const usedPairs = new Set<string>()

  for (let i = 0; i < count && allNodes.length >= 2; i++) {
    // 随机选择两个不同的节点
    let from: NodeObj
    let to: NodeObj
    let pairKey: string
    let attempts = 0

    do {
      const [a, b] = rng.sample(allNodes, 2)
      from = a
      to = b
      pairKey = `${from.id}->${to.id}`
      attempts++
    } while (usedPairs.has(pairKey) && attempts < 100)

    if (!usedPairs.has(pairKey)) {
      usedPairs.add(pairKey)
      arrows.push({
        id: `arrow_${i + 1}`,
        from: from.id,
        to: to.id,
        label: `Arrow ${i + 1}`,
      })
    }
  }

  return arrows
}

/**
 * 生成 summaries（节点范围的摘要）
 */
function generateSummaries(
  root: NodeObj,
  count: number,
  rng: SeededRandom
): MindMapData['summaries'] {
  const summaries: MindMapData['summaries'] = []

  // 收集所有有多个子节点的父节点
  const eligibleParents: NodeObj[] = []
  const collectEligible = (node: NodeObj) => {
    if (node.children && node.children.length >= 2) {
      eligibleParents.push(node)
    }
    node.children?.forEach(collectEligible)
  }
  collectEligible(root)

  for (let i = 0; i < count && eligibleParents.length > 0; i++) {
    const parent = rng.pick(eligibleParents)
    const children = parent.children!

    // 随机选择连续的子节点范围
    const startIdx = rng.nextInt(0, children.length - 1)
    const endIdx = rng.nextInt(startIdx + 1, children.length)

    const ids = children.slice(startIdx, endIdx + 1).map((c) => c.id)

    summaries.push({
      id: `summary_${i + 1}`,
      ids,
      text: `Summary ${i + 1}`,
    })
  }

  return summaries
}

/**
 * 生成完整的 MindMapData
 *
 * @param config 数据集配置
 * @returns 生成的 MindMapData
 */
export function generateDataset(config: DatasetConfig): MindMapData {
  // 重置 ID 计数器
  resetNodeIdCounter()

  const seed = config.seed ?? Date.now()
  const rng = new SeededRandom(seed)

  const nodeCount = SCALE_NODE_COUNTS[config.scale]
  const maxDepth = DEPTH_LIMITS[config.depthMode]
  const relationRatios = RELATION_RATIOS[config.relationDensity]

  // 创建根节点
  const rootId = generateNodeId()
  const root: NodeObj = createNode(rootId, 'Root', undefined)

  // 收集所有节点（用于生成 arrows）
  const allNodes: NodeObj[] = [root]
  const createdCount = { value: 1 } // root 已计入

  // 生成子树
  generateSubtree(root, 1, maxDepth, nodeCount, createdCount, rng, allNodes)

  // 计算 arrows 和 summaries 数量
  const arrowCount = Math.floor(allNodes.length * relationRatios.arrows)
  const summaryCount = Math.floor(allNodes.length * relationRatios.summaries)

  // 生成 arrows 和 summaries
  const arrows = generateArrows(allNodes, arrowCount, rng)
  const summaries = generateSummaries(root, summaryCount, rng)

  return {
    nodeData: root,
    arrows,
    summaries,
    direction: 1, // 默认方向
    theme: { name: 'default' },
  }
}

/**
 * 获取数据集统计信息
 */
export interface DatasetStats {
  nodeCount: number
  maxDepth: number
  arrowCount: number
  summaryCount: number
  avgBranchingFactor: number
}

/**
 * 计算数据集统计信息
 */
export function getDatasetStats(data: MindMapData): DatasetStats {
  let nodeCount = 0
  let maxDepth = 0
  let totalChildren = 0
  let parentCount = 0

  const traverse = (node: NodeObj, depth: number) => {
    nodeCount++
    maxDepth = Math.max(maxDepth, depth)
    if (node.children && node.children.length > 0) {
      totalChildren += node.children.length
      parentCount++
      node.children.forEach((child) => traverse(child, depth + 1))
    }
  }

  traverse(data.nodeData, 0)

  return {
    nodeCount,
    maxDepth,
    arrowCount: data.arrows?.length ?? 0,
    summaryCount: data.summaries?.length ?? 0,
    avgBranchingFactor: parentCount > 0 ? totalChildren / parentCount : 0,
  }
}

/**
 * 预定义的基准数据集配置
 */
export const BENCHMARK_CONFIGS: Record<string, DatasetConfig> = {
  // S 档（1k nodes）
  'S-shallow-none': { scale: 'S', depthMode: 'shallow', relationDensity: 'none', seed: 42 },
  'S-shallow-low': { scale: 'S', depthMode: 'shallow', relationDensity: 'low', seed: 42 },
  'S-deep-none': { scale: 'S', depthMode: 'deep', relationDensity: 'none', seed: 42 },
  'S-deep-low': { scale: 'S', depthMode: 'deep', relationDensity: 'low', seed: 42 },

  // M 档（5k nodes）
  'M-shallow-none': { scale: 'M', depthMode: 'shallow', relationDensity: 'none', seed: 42 },
  'M-shallow-low': { scale: 'M', depthMode: 'shallow', relationDensity: 'low', seed: 42 },
  'M-shallow-high': { scale: 'M', depthMode: 'shallow', relationDensity: 'high', seed: 42 },
  'M-deep-none': { scale: 'M', depthMode: 'deep', relationDensity: 'none', seed: 42 },
  'M-deep-low': { scale: 'M', depthMode: 'deep', relationDensity: 'low', seed: 42 },
  'M-deep-high': { scale: 'M', depthMode: 'deep', relationDensity: 'high', seed: 42 },

  // L 档（20k nodes）
  'L-shallow-none': { scale: 'L', depthMode: 'shallow', relationDensity: 'none', seed: 42 },
  'L-shallow-low': { scale: 'L', depthMode: 'shallow', relationDensity: 'low', seed: 42 },
  'L-deep-none': { scale: 'L', depthMode: 'deep', relationDensity: 'none', seed: 42 },
  'L-deep-low': { scale: 'L', depthMode: 'deep', relationDensity: 'low', seed: 42 },
}
