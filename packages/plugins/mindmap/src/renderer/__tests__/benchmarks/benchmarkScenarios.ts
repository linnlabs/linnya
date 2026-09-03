/**
 * MindMap History 压测场景
 *
 * Phase 3 WP3-3：History 演进评审的压测场景定义
 *
 * 中文说明：
 * - 定义批量删除、多次拖拽、连续 undo/redo 等场景
 * - 每个场景都可独立运行，输出结构化结果
 * - 用于评估 snapshot vs diff/patch vs step-invert 策略
 *
 * @module __tests__/benchmarks/benchmarkScenarios
 */

import type { MindMapData, NodeObj } from '../../domain/types'
import { generateDataset, getDatasetStats, type DatasetConfig } from './datasetGenerator'
import { HistoryBenchmark, type BenchmarkResult } from './historyBenchmark'

// ============================================================================
// 场景类型定义
// ============================================================================

/**
 * 测试场景配置
 */
export interface ScenarioConfig {
  /** 场景名称 */
  name: string
  /** 场景描述 */
  description: string
  /** 数据集配置 */
  datasetConfig: DatasetConfig
}

/**
 * 测试场景执行器接口
 *
 * 中文说明：
 * - 由于我们无法在纯 Node 环境模拟完整的 MindMap DOM 渲染
 * - 这里定义的是"场景模拟"——模拟操作序列和 history 状态变化
 * - 真实的 DOM 压测需要在浏览器环境（Playwright/Cypress）中执行
 */
export interface ScenarioRunner {
  /** 运行场景并返回结果 */
  run(config: ScenarioConfig): BenchmarkResult
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 收集数据集中的所有节点 ID
 */
export function collectAllNodeIds(data: MindMapData): string[] {
  const ids: string[] = []
  const traverse = (node: NodeObj) => {
    ids.push(node.id)
    node.children?.forEach(traverse)
  }
  traverse(data.nodeData)
  return ids
}

/**
 * 收集叶子节点 ID（无子节点）
 */
export function collectLeafNodeIds(data: MindMapData): string[] {
  const ids: string[] = []
  const traverse = (node: NodeObj) => {
    if (!node.children || node.children.length === 0) {
      ids.push(node.id)
    } else {
      node.children.forEach(traverse)
    }
  }
  traverse(data.nodeData)
  return ids
}

/**
 * 收集非根节点 ID
 */
export function collectNonRootNodeIds(data: MindMapData): string[] {
  const ids: string[] = []
  const traverse = (node: NodeObj) => {
    if (node.parent) {
      ids.push(node.id)
    }
    node.children?.forEach(traverse)
  }
  traverse(data.nodeData)
  return ids
}

/**
 * 随机选择 n 个节点（使用固定种子保证可重复）
 */
export function selectRandomNodes(nodeIds: string[], n: number, seed: number = 42): string[] {
  // 简单的 LCG 伪随机
  let s = seed
  const random = () => {
    s = (s * 48271) % 2147483647
    return s / 2147483647
  }

  const copy = [...nodeIds]
  const result: string[] = []
  for (let i = 0; i < Math.min(n, copy.length); i++) {
    const idx = Math.floor(random() * copy.length)
    result.push(copy[idx])
    copy.splice(idx, 1)
  }
  return result
}

/**
 * 深拷贝 MindMapData（模拟快照）
 */
export function deepCloneMindMapData(data: MindMapData): MindMapData {
  // 使用 JSON 序列化/反序列化（简单但有效）
  // 注意：这会丢失 parent 引用，需要重建
  // 中文说明（根因修复）：
  // - NodeObj 存在 `parent` 指针，形成循环引用（parent -> children -> parent）
  // - benchmark 必须能处理真实结构，否则“必须压测”无法执行
  // - 因此这里序列化时显式忽略 parent 字段，再在反序列化后重建 parent 指针
  const replacer = (key: string, value: unknown) => {
    if (key === 'parent') return undefined
    return value
  }
  const clone = JSON.parse(JSON.stringify(data, replacer)) as MindMapData

  // 重建 parent 引用
  const rebuildParent = (node: NodeObj, parent?: NodeObj) => {
    node.parent = parent
    node.children?.forEach((child) => rebuildParent(child, node))
  }
  rebuildParent(clone.nodeData)

  return clone
}

/**
 * 计算 MindMapData 的序列化大小（字节）
 */
export function calculateSerializedSize(data: MindMapData): number {
  // 序列化时需要处理循环引用（parent）
  const replacer = (key: string, value: unknown) => {
    if (key === 'parent') return undefined
    return value
  }
  return JSON.stringify(data, replacer).length
}

// ============================================================================
// 模拟 History 管理器（用于纯 JS 压测）
// ============================================================================

/**
 * 模拟的 History Entry
 */
interface MockHistoryEntry {
  prev: MindMapData
  next: MindMapData
  operationType: string
  timestamp: number
}

/**
 * 模拟的 History 管理器
 *
 * 中文说明：
 * - 模拟现有的 snapshot-based history 策略
 * - 用于在纯 JS 环境中压测 undo/redo 性能
 */
export class MockHistoryManager {
  private history: MockHistoryEntry[] = []
  private currentIndex = -1
  private current: MindMapData

  constructor(initialData: MindMapData) {
    this.current = deepCloneMindMapData(initialData)
  }

  /**
   * 记录一次操作
   */
  recordOperation(operationType: string, newData: MindMapData): void {
    // 截断 redo 历史
    this.history = this.history.slice(0, this.currentIndex + 1)

    const entry: MockHistoryEntry = {
      prev: deepCloneMindMapData(this.current),
      next: deepCloneMindMapData(newData),
      operationType,
      timestamp: Date.now(),
    }

    this.history.push(entry)
    this.current = deepCloneMindMapData(newData)
    this.currentIndex = this.history.length - 1
  }

  /**
   * 执行 undo
   */
  undo(): MindMapData | null {
    if (this.currentIndex < 0) return null

    const entry = this.history[this.currentIndex]
    this.current = deepCloneMindMapData(entry.prev)
    this.currentIndex--
    return this.current
  }

  /**
   * 执行 redo
   */
  redo(): MindMapData | null {
    if (this.currentIndex >= this.history.length - 1) return null

    this.currentIndex++
    const entry = this.history[this.currentIndex]
    this.current = deepCloneMindMapData(entry.next)
    return this.current
  }

  /**
   * 获取当前数据
   */
  getCurrent(): MindMapData {
    return this.current
  }

  /**
   * 获取历史记录数量
   */
  getHistoryLength(): number {
    return this.history.length
  }

  /**
   * 获取内存占用估算（字节）
   */
  estimateMemoryUsage(): number {
    let total = 0
    for (const entry of this.history) {
      total += calculateSerializedSize(entry.prev)
      total += calculateSerializedSize(entry.next)
    }
    return total
  }
}

// ============================================================================
// 场景 1：批量删除
// ============================================================================

/**
 * 批量删除场景参数
 */
export interface BatchDeleteParams {
  /** 删除批次数 */
  batchCount: number
  /** 每批删除的节点数 */
  nodesPerBatch: number
}

/**
 * 运行批量删除场景
 *
 * 中文说明：
 * - 模拟多次批量删除操作
 * - 测量每次删除的耗时和 history 记录开销
 */
export function runBatchDeleteScenario(
  datasetConfig: DatasetConfig,
  params: BatchDeleteParams = { batchCount: 10, nodesPerBatch: 50 }
): BenchmarkResult {
  const benchmark = new HistoryBenchmark('batch-delete', JSON.stringify(datasetConfig))
  benchmark.setMetadata('params', params)

  // 生成数据集
  const data = generateDataset(datasetConfig)
  const stats = getDatasetStats(data)
  benchmark.setMetadata('datasetStats', stats)

  // 创建 history 管理器
  const history = new MockHistoryManager(data)

  benchmark.start()

  // 收集可删除的节点（非根节点）
  let availableNodes = collectNonRootNodeIds(history.getCurrent())

  for (let batch = 0; batch < params.batchCount && availableNodes.length > 0; batch++) {
    // 选择要删除的节点
    const toDelete = selectRandomNodes(
      availableNodes,
      Math.min(params.nodesPerBatch, availableNodes.length),
      42 + batch
    )

    // 模拟删除操作
    benchmark.timeOperation('delete', () => {
      const current = history.getCurrent()
      const newData = simulateNodeDeletion(current, toDelete)
      history.recordOperation('removeNodes', newData)
    })

    // 更新可用节点列表
    availableNodes = collectNonRootNodeIds(history.getCurrent())
  }

  // 记录 history 状态
  benchmark.setMetadata('historyLength', history.getHistoryLength())
  benchmark.setMetadata('historyMemoryEstimate', history.estimateMemoryUsage())

  benchmark.end()

  return benchmark.getResult()
}

/**
 * 模拟节点删除
 */
function simulateNodeDeletion(data: MindMapData, nodeIds: string[]): MindMapData {
  const clone = deepCloneMindMapData(data)
  const idsToDelete = new Set(nodeIds)

  const filterChildren = (node: NodeObj) => {
    if (node.children) {
      node.children = node.children.filter((child) => {
        if (idsToDelete.has(child.id)) {
          return false
        }
        filterChildren(child)
        return true
      })
    }
  }

  filterChildren(clone.nodeData)
  return clone
}

// ============================================================================
// 场景 2：连续 undo/redo
// ============================================================================

/**
 * 连续 undo/redo 场景参数
 */
export interface ContinuousUndoRedoParams {
  /** 先执行的操作数（生成历史） */
  operationCount: number
  /** undo 次数 */
  undoCount: number
  /** redo 次数 */
  redoCount: number
}

/**
 * 运行连续 undo/redo 场景
 *
 * 中文说明：
 * - 先执行一系列操作生成历史
 * - 然后连续执行 undo/redo
 * - 观察性能衰减和状态漂移
 */
export function runContinuousUndoRedoScenario(
  datasetConfig: DatasetConfig,
  params: ContinuousUndoRedoParams = { operationCount: 100, undoCount: 200, redoCount: 200 }
): BenchmarkResult {
  const benchmark = new HistoryBenchmark('continuous-undo-redo', JSON.stringify(datasetConfig))
  benchmark.setMetadata('params', params)

  // 生成数据集
  const data = generateDataset(datasetConfig)
  const stats = getDatasetStats(data)
  benchmark.setMetadata('datasetStats', stats)

  // 创建 history 管理器
  const history = new MockHistoryManager(data)

  benchmark.start()

  // 阶段 1：执行一系列操作生成历史
  let availableNodes = collectNonRootNodeIds(history.getCurrent())
  for (let i = 0; i < params.operationCount && availableNodes.length > 10; i++) {
    const toDelete = selectRandomNodes(availableNodes, 5, 100 + i)

    benchmark.timeOperation('delete', () => {
      const current = history.getCurrent()
      const newData = simulateNodeDeletion(current, toDelete)
      history.recordOperation('removeNodes', newData)
    })

    availableNodes = collectNonRootNodeIds(history.getCurrent())
  }

  benchmark.takeMemorySnapshot('after-operations')

  // 阶段 2：连续 undo
  for (let i = 0; i < params.undoCount; i++) {
    benchmark.timeUndo(() => {
      history.undo()
    })
  }

  benchmark.takeMemorySnapshot('after-undo')

  // 阶段 3：连续 redo
  for (let i = 0; i < params.redoCount; i++) {
    benchmark.timeRedo(() => {
      history.redo()
    })
  }

  benchmark.takeMemorySnapshot('after-redo')

  // 记录最终状态
  benchmark.setMetadata('historyLength', history.getHistoryLength())
  benchmark.setMetadata('historyMemoryEstimate', history.estimateMemoryUsage())

  benchmark.end()

  return benchmark.getResult()
}

// ============================================================================
// 场景 3：模拟拖拽移动
// ============================================================================

/**
 * 拖拽移动场景参数
 */
export interface DragMoveParams {
  /** 拖拽次数 */
  dragCount: number
  /** 每次拖拽的节点数 */
  nodesPerDrag: number
}

/**
 * 运行拖拽移动场景
 *
 * 中文说明：
 * - 模拟多次拖拽移动操作
 * - 测量每次移动的耗时和 history 记录开销
 */
export function runDragMoveScenario(
  datasetConfig: DatasetConfig,
  params: DragMoveParams = { dragCount: 50, nodesPerDrag: 3 }
): BenchmarkResult {
  const benchmark = new HistoryBenchmark('drag-move', JSON.stringify(datasetConfig))
  benchmark.setMetadata('params', params)

  // 生成数据集
  const data = generateDataset(datasetConfig)
  const stats = getDatasetStats(data)
  benchmark.setMetadata('datasetStats', stats)

  // 创建 history 管理器
  const history = new MockHistoryManager(data)

  benchmark.start()

  for (let i = 0; i < params.dragCount; i++) {
    const current = history.getCurrent()
    const availableNodes = collectNonRootNodeIds(current)

    if (availableNodes.length < params.nodesPerDrag + 1) break

    // 选择要移动的节点和目标节点
    const selected = selectRandomNodes(availableNodes, params.nodesPerDrag + 1, 200 + i)
    const toMove = selected.slice(0, params.nodesPerDrag)
    const target = selected[params.nodesPerDrag]

    // 模拟移动操作
    benchmark.timeOperation('move', () => {
      const newData = simulateNodeMove(current, toMove, target)
      history.recordOperation('moveNodeIn', newData)
    })
  }

  benchmark.setMetadata('historyLength', history.getHistoryLength())
  benchmark.setMetadata('historyMemoryEstimate', history.estimateMemoryUsage())

  benchmark.end()

  return benchmark.getResult()
}

/**
 * 模拟节点移动（简化版：移动到目标节点下）
 */
function simulateNodeMove(data: MindMapData, nodeIds: string[], targetId: string): MindMapData {
  const clone = deepCloneMindMapData(data)
  const idsToMove = new Set(nodeIds)
  const movedNodes: NodeObj[] = []

  // 先从原位置移除
  const removeFromParent = (node: NodeObj) => {
    if (node.children) {
      const removed = node.children.filter((child) => {
        if (idsToMove.has(child.id)) {
          movedNodes.push(child)
          return false
        }
        removeFromParent(child)
        return true
      })
      node.children = removed
    }
  }

  removeFromParent(clone.nodeData)

  // 找到目标节点并添加
  const findAndAdd = (node: NodeObj): boolean => {
    if (node.id === targetId) {
      if (!node.children) node.children = []
      for (const moved of movedNodes) {
        moved.parent = node
        node.children.push(moved)
      }
      return true
    }
    if (node.children) {
      for (const child of node.children) {
        if (findAndAdd(child)) return true
      }
    }
    return false
  }

  findAndAdd(clone.nodeData)

  return clone
}

// ============================================================================
// 综合测试运行器
// ============================================================================

/**
 * 运行所有基准测试场景
 */
export function runAllScenarios(
  datasetConfigs: DatasetConfig[] = [
    { scale: 'S', depthMode: 'shallow', relationDensity: 'none', seed: 42 },
    { scale: 'M', depthMode: 'shallow', relationDensity: 'low', seed: 42 },
    { scale: 'L', depthMode: 'deep', relationDensity: 'low', seed: 42 },
  ]
): BenchmarkResult[] {
  const results: BenchmarkResult[] = []

  for (const config of datasetConfigs) {
    console.log(`\n--- Running scenarios for ${config.scale}-${config.depthMode} ---`)

    // 场景 1：批量删除
    console.log('  Running batch-delete...')
    results.push(runBatchDeleteScenario(config))

    // 场景 2：连续 undo/redo
    console.log('  Running continuous-undo-redo...')
    results.push(runContinuousUndoRedoScenario(config))

    // 场景 3：拖拽移动
    console.log('  Running drag-move...')
    results.push(runDragMoveScenario(config))
  }

  return results
}

/**
 * 格式化结果为表格（Markdown）
 */
export function formatResultsAsMarkdownTable(results: BenchmarkResult[]): string {
  const lines: string[] = []

  lines.push('| Scenario | Dataset | Total (ms) | Op P50 (ms) | Op P95 (ms) | Undo P95 (ms) | Memory Est. |')
  lines.push('|----------|---------|------------|-------------|-------------|---------------|-------------|')

  for (const result of results) {
    const opStats = Object.values(result.operationStats)[0]
    const memEst = result.metadata.historyMemoryEstimate as number | undefined

    lines.push(
      `| ${result.name} | ${result.datasetConfig} | ${result.totalDurationMs.toFixed(2)} | ${opStats?.p50.toFixed(2) ?? 'N/A'} | ${opStats?.p95.toFixed(2) ?? 'N/A'} | ${result.undoStats?.p95.toFixed(2) ?? 'N/A'} | ${memEst ? `${(memEst / 1024 / 1024).toFixed(2)} MB` : 'N/A'} |`
    )
  }

  return lines.join('\n')
}
