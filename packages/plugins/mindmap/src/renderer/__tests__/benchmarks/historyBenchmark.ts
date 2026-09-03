/**
 * MindMap History 压测工具类
 *
 * Phase 3 WP3-3：History 演进评审的性能指标采集工具
 *
 * 中文说明：
 * - 采集操作耗时、undo/redo 耗时、内存占用等指标
 * - 输出结构化结果（JSON），便于横向对比
 * - 支持多种测试场景（批量删除/拖拽/连续 undo-redo）
 *
 * @module __tests__/benchmarks/historyBenchmark
 */

// ============================================================================
// 性能指标类型
// ============================================================================

/**
 * 单次操作的耗时记录
 */
export interface TimingRecord {
  /** 操作名称 */
  operation: string
  /** 耗时（毫秒） */
  durationMs: number
  /** 时间戳 */
  timestamp: number
}

/**
 * 百分位统计
 */
export interface PercentileStats {
  min: number
  p50: number
  p75: number
  p90: number
  p95: number
  p99: number
  max: number
  avg: number
  count: number
}

/**
 * 内存快照
 */
export interface MemorySnapshot {
  /** 已使用的堆内存（字节） */
  heapUsed: number
  /** 堆内存总量（字节） */
  heapTotal: number
  /** 外部内存（字节） */
  external: number
  /** 时间戳 */
  timestamp: number
  /** 标签（用于标识快照时机） */
  label: string
}

/**
 * geometryFlushed 事件记录
 */
export interface GeometryFlushRecord {
  /** 触发原因 */
  reasons: string[]
  /** 关联的 txId（如果有） */
  txId?: string
  /** 耗时（毫秒） */
  durationMs?: number
  /** 时间戳 */
  timestamp: number
}

/**
 * 完整的基准测试结果
 */
export interface BenchmarkResult {
  /** 测试名称 */
  name: string
  /** 数据集配置名 */
  datasetConfig: string
  /** 开始时间 */
  startTime: number
  /** 结束时间 */
  endTime: number
  /** 总耗时（毫秒） */
  totalDurationMs: number
  /** 操作耗时统计 */
  operationStats: {
    [operationType: string]: PercentileStats
  }
  /** undo 耗时统计 */
  undoStats?: PercentileStats
  /** redo 耗时统计 */
  redoStats?: PercentileStats
  /** 内存快照 */
  memorySnapshots: MemorySnapshot[]
  /** geometryFlushed 事件统计 */
  geometryFlushStats: {
    totalCount: number
    reasons: { [reason: string]: number }
  }
  /** 额外元数据 */
  metadata: Record<string, unknown>
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 计算百分位数
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.ceil(sorted.length * (p / 100)) - 1
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))]
}

/**
 * 计算百分位统计
 */
export function calculatePercentileStats(values: number[]): PercentileStats {
  if (values.length === 0) {
    return {
      min: 0,
      p50: 0,
      p75: 0,
      p90: 0,
      p95: 0,
      p99: 0,
      max: 0,
      avg: 0,
      count: 0,
    }
  }

  const sorted = [...values].sort((a, b) => a - b)
  const sum = values.reduce((acc, v) => acc + v, 0)

  return {
    min: sorted[0],
    p50: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1],
    avg: sum / values.length,
    count: values.length,
  }
}

/**
 * 格式化字节数为人类可读的字符串
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/**
 * 格式化毫秒为人类可读的字符串
 */
export function formatMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(2)} μs`
  if (ms < 1000) return `${ms.toFixed(2)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

// ============================================================================
// HistoryBenchmark 类
// ============================================================================

/**
 * History 压测工具类
 *
 * 中文说明：
 * - 用于采集操作耗时、内存占用等性能指标
 * - 支持多种测试场景
 * - 输出结构化 JSON 结果
 */
export class HistoryBenchmark {
  private name: string
  private datasetConfig: string
  private startTime: number = 0
  private endTime: number = 0

  /** 操作耗时记录 */
  private operationTimings: Map<string, number[]> = new Map()

  /** undo 耗时记录 */
  private undoTimings: number[] = []

  /** redo 耗时记录 */
  private redoTimings: number[] = []

  /** 内存快照 */
  private memorySnapshots: MemorySnapshot[] = []

  /** geometryFlushed 记录 */
  private geometryFlushRecords: GeometryFlushRecord[] = []

  /** 额外元数据 */
  private metadata: Record<string, unknown> = {}

  constructor(name: string, datasetConfig: string) {
    this.name = name
    this.datasetConfig = datasetConfig
  }

  /**
   * 开始计时
   */
  start(): void {
    this.startTime = performance.now()
    this.takeMemorySnapshot('start')
  }

  /**
   * 结束计时
   */
  end(): void {
    this.endTime = performance.now()
    this.takeMemorySnapshot('end')
  }

  /**
   * 记录操作耗时
   */
  recordOperation(operationType: string, durationMs: number): void {
    if (!this.operationTimings.has(operationType)) {
      this.operationTimings.set(operationType, [])
    }
    this.operationTimings.get(operationType)!.push(durationMs)
  }

  /**
   * 计时执行一个操作
   */
  timeOperation<T>(operationType: string, fn: () => T): T {
    const start = performance.now()
    const result = fn()
    const end = performance.now()
    this.recordOperation(operationType, end - start)
    return result
  }

  /**
   * 计时执行一个异步操作
   */
  async timeOperationAsync<T>(operationType: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now()
    const result = await fn()
    const end = performance.now()
    this.recordOperation(operationType, end - start)
    return result
  }

  /**
   * 记录 undo 耗时
   */
  recordUndo(durationMs: number): void {
    this.undoTimings.push(durationMs)
  }

  /**
   * 计时执行 undo
   */
  timeUndo(fn: () => void): void {
    const start = performance.now()
    fn()
    const end = performance.now()
    this.recordUndo(end - start)
  }

  /**
   * 记录 redo 耗时
   */
  recordRedo(durationMs: number): void {
    this.redoTimings.push(durationMs)
  }

  /**
   * 计时执行 redo
   */
  timeRedo(fn: () => void): void {
    const start = performance.now()
    fn()
    const end = performance.now()
    this.recordRedo(end - start)
  }

  /**
   * 采集内存快照
   *
   * 中文说明：
   * - 在浏览器环境中，performance.memory 可能不可用
   * - 在 Node.js 环境中，使用 process.memoryUsage()
   */
  takeMemorySnapshot(label: string): void {
    let snapshot: MemorySnapshot

    // 检查 Node.js 环境
    if (typeof process !== 'undefined' && process.memoryUsage) {
      const mem = process.memoryUsage()
      snapshot = {
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        external: mem.external,
        timestamp: Date.now(),
        label,
      }
    }
    // 检查浏览器环境（Chrome 特有）
    else if (
      typeof performance !== 'undefined' &&
      (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } })
        .memory
    ) {
      const mem = (
        performance as unknown as { memory: { usedJSHeapSize: number; totalJSHeapSize: number } }
      ).memory
      snapshot = {
        heapUsed: mem.usedJSHeapSize,
        heapTotal: mem.totalJSHeapSize,
        external: 0,
        timestamp: Date.now(),
        label,
      }
    } else {
      // 无法获取内存信息
      snapshot = {
        heapUsed: 0,
        heapTotal: 0,
        external: 0,
        timestamp: Date.now(),
        label,
      }
    }

    this.memorySnapshots.push(snapshot)
  }

  /**
   * 记录 geometryFlushed 事件
   */
  recordGeometryFlush(reasons: string[], txId?: string, durationMs?: number): void {
    this.geometryFlushRecords.push({
      reasons,
      txId,
      durationMs,
      timestamp: Date.now(),
    })
  }

  /**
   * 设置元数据
   */
  setMetadata(key: string, value: unknown): void {
    this.metadata[key] = value
  }

  /**
   * 获取测试结果
   */
  getResult(): BenchmarkResult {
    // 计算操作耗时统计
    const operationStats: { [operationType: string]: PercentileStats } = {}
    for (const [type, timings] of this.operationTimings) {
      operationStats[type] = calculatePercentileStats(timings)
    }

    // 计算 geometryFlushed 统计
    const reasonCounts: { [reason: string]: number } = {}
    for (const record of this.geometryFlushRecords) {
      for (const reason of record.reasons) {
        reasonCounts[reason] = (reasonCounts[reason] || 0) + 1
      }
    }

    return {
      name: this.name,
      datasetConfig: this.datasetConfig,
      startTime: this.startTime,
      endTime: this.endTime,
      totalDurationMs: this.endTime - this.startTime,
      operationStats,
      undoStats: this.undoTimings.length > 0 ? calculatePercentileStats(this.undoTimings) : undefined,
      redoStats: this.redoTimings.length > 0 ? calculatePercentileStats(this.redoTimings) : undefined,
      memorySnapshots: this.memorySnapshots,
      geometryFlushStats: {
        totalCount: this.geometryFlushRecords.length,
        reasons: reasonCounts,
      },
      metadata: this.metadata,
    }
  }

  /**
   * 输出结果到 JSON 字符串
   */
  toJSON(): string {
    return JSON.stringify(this.getResult(), null, 2)
  }

  /**
   * 打印结果摘要
   */
  printSummary(): void {
    const result = this.getResult()

    console.log('\n=== Benchmark Summary ===')
    console.log(`Name: ${result.name}`)
    console.log(`Dataset: ${result.datasetConfig}`)
    console.log(`Total Duration: ${formatMs(result.totalDurationMs)}`)

    console.log('\n--- Operation Stats ---')
    for (const [type, stats] of Object.entries(result.operationStats)) {
      console.log(`  ${type}:`)
      console.log(`    Count: ${stats.count}`)
      console.log(`    P50: ${formatMs(stats.p50)}, P95: ${formatMs(stats.p95)}, Max: ${formatMs(stats.max)}`)
    }

    if (result.undoStats) {
      console.log('\n--- Undo Stats ---')
      console.log(`  Count: ${result.undoStats.count}`)
      console.log(
        `  P50: ${formatMs(result.undoStats.p50)}, P95: ${formatMs(result.undoStats.p95)}, Max: ${formatMs(result.undoStats.max)}`
      )
    }

    if (result.redoStats) {
      console.log('\n--- Redo Stats ---')
      console.log(`  Count: ${result.redoStats.count}`)
      console.log(
        `  P50: ${formatMs(result.redoStats.p50)}, P95: ${formatMs(result.redoStats.p95)}, Max: ${formatMs(result.redoStats.max)}`
      )
    }

    console.log('\n--- Memory ---')
    if (result.memorySnapshots.length >= 2) {
      const start = result.memorySnapshots.find((s) => s.label === 'start')
      const end = result.memorySnapshots.find((s) => s.label === 'end')
      if (start && end) {
        console.log(`  Start: ${formatBytes(start.heapUsed)}`)
        console.log(`  End: ${formatBytes(end.heapUsed)}`)
        console.log(`  Delta: ${formatBytes(end.heapUsed - start.heapUsed)}`)
      }
    }

    console.log('\n--- GeometryFlush ---')
    console.log(`  Total: ${result.geometryFlushStats.totalCount}`)
    for (const [reason, count] of Object.entries(result.geometryFlushStats.reasons)) {
      console.log(`    ${reason}: ${count}`)
    }

    console.log('\n========================\n')
  }
}

// ============================================================================
// 导出
// ============================================================================

export default HistoryBenchmark
