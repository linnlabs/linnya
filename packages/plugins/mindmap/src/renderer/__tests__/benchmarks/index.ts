/**
 * MindMap History 压测工具入口
 *
 * Phase 3 WP3-3：History 演进评审的工具集
 *
 * @module __tests__/benchmarks
 */

// 数据集生成器
export {
  generateDataset,
  getDatasetStats,
  SCALE_NODE_COUNTS,
  DEPTH_LIMITS,
  RELATION_RATIOS,
  BENCHMARK_CONFIGS,
  type DatasetScale,
  type TreeDepthMode,
  type RelationDensity,
  type DatasetConfig,
  type DatasetStats,
} from './datasetGenerator'

// 压测工具类
export {
  HistoryBenchmark,
  calculatePercentileStats,
  formatBytes,
  formatMs,
  type TimingRecord,
  type PercentileStats,
  type MemorySnapshot,
  type GeometryFlushRecord,
  type BenchmarkResult,
} from './historyBenchmark'

// 压测场景
export {
  collectAllNodeIds,
  collectLeafNodeIds,
  collectNonRootNodeIds,
  selectRandomNodes,
  deepCloneMindMapData,
  calculateSerializedSize,
  MockHistoryManager,
  runBatchDeleteScenario,
  runContinuousUndoRedoScenario,
  runDragMoveScenario,
  runAllScenarios,
  formatResultsAsMarkdownTable,
  type ScenarioConfig,
  type ScenarioRunner,
  type BatchDeleteParams,
  type ContinuousUndoRedoParams,
  type DragMoveParams,
} from './benchmarkScenarios'
