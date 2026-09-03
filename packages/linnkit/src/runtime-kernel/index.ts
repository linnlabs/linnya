// === 命名空间导出（保留强分层信号，便于 deep navigation） ===
export * as graph from './graph-engine';
export * as tools from './tools';
export * as execution from './execution';
export * as events from './events';
export * as runContext from './run-context';

export * as llm from './llm';
export * as childRuns from './child-runs';
export * as childRunTrace from './child-run-trace';
export * as enrichment from './enrichment';
export * as runSupervisor from './run-supervisor';
export * as telemetry from './telemetry';
export * as audit from './audit';
export * as systemReminder from './system-reminder';
export * as tokenAccounting from './token-accounting';

// === 扁平 re-export（业界 namespace + flat 双重暴露惯例） ===
// 与上方 namespace 共存：namespace 暴露分层结构，扁平暴露 P1 收口的消费符号。
// 说明：消费侧 `linnkit/runtime-kernel` 子入口直接 import `BaseTool` /
// `ToolExecutionContext` 等大量符号，依赖此扁平入口；
// 子 entry index.ts 控制公开面粒度，本入口仅 1:1 透出。
export * from './tools';
export * from './llm';
export * from './graph-engine';
export * from './child-run-trace';
export * from './enrichment';
export * from './audit';
export * from './system-reminder';
export * from './token-accounting';

// === 顶层符号 ===
export { ENGINE_ERROR_CODES } from '../shared/errorClassifier';
export type { ErrorClassification } from '../shared/errorClassifier';

export { createGraphLoopHarness } from './testkit/graphLoopHarness';
export { createDefaultGraphExecutor } from './testkit/defaultGraphExecutor';

export type {
  DefaultGraphExecutorOptions,
} from './testkit/defaultGraphExecutor';
export type {
  GraphLoopHarness,
  GraphLoopHarnessOptions,
  GraphLoopHarnessRunResult,
  GraphLoopLlmNodeFactoryParams,
} from './testkit/graphLoopHarness';
