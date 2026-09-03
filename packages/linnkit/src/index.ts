export * as ports from './ports';
export * as runtimeKernel from './runtime-kernel';
export * as contracts from './contracts';
export { defineAgent, defineConfig, resolveConfiguredInference, runAgent } from './quickstart';
export type {
  DefinedAgent,
  DefineAgentInput,
  LinnkitQuickstartConfig,
  RunAgentOptions,
  RunAgentResult,
} from './quickstart';

// 注意（关键边界规约）：
// `testkit` 子树**禁止**从根入口 re-export。
// 原因：`testkit/agent-harness/scriptedInferenceHarness.ts` / `assertions.ts`
// 在源码顶层直接 `import { vi, expect } from 'vitest'`；这是测试专用依赖。
// tsup/esbuild 处理 `export * as testkit from './testkit'` 时会把 testkit 整棵
// 子树静态加入图，**即便消费侧从未使用 `testkit` namespace**，结果会把 vitest
// runtime 拖入 backend production bundle，导致 electron main 启动时抛
// "Vitest failed to access its internal state."。
// 必须通过显式子入口 `import * as testkit from 'linnkit/testkit'` 使用，且
// 该子入口只能在 testkit/test 文件里被引用（由 `npm run lint:codename` 守护）。
export {
  generateAuditEnvelopeId,
  generateRunId,
  generateRuntimeEventId,
} from './contracts';
export { withLLMTelemetryContext } from './shared/llmTelemetryContext';
export type { LlmCallTelemetry } from './shared/llmTelemetryContext';
export {
  LlmAuditProjectionError,
  projectDurableLlmAuditValue,
} from './shared/llmAuditProjection';
export { setLlmAuditRecorder } from './shared/llmAuditRecorder';
export type {
  ContextManagerAuditRecordInput,
  LlmAuditRecorder,
  RunTranscriptAuditInput,
  ToolProtocolErrorAuditInput,
} from './shared/llmAuditRecorder';
