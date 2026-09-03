# Telemetry · 接 TelemetryPort（可选）

> **What** · `TelemetryPort` 接入 —— LLM 调用、context build / compaction、tool、graph node 与 run lifecycle 上报（含 `runId` / `parentRunId` 用于成本聚合）。
> **When to read** · 接 Datadog / OpenTelemetry / Prometheus；做成本预警；监控 P99 时延；做多租户用量统计。
> **Prerequisites** · [`02-quickstart.md`](./02-quickstart.md)。
> **Key exports** · `TelemetryPort` / `telemetry` namespace from `@linnlabs/linnkit/runtime-kernel` · `withLLMTelemetryContext` from `@linnlabs/linnkit`（兼容旧 benchmark / hook）。
> **Related** · [`token-management.md`](./token-management.md) · [`audit.md`](./audit.md) · [`run-supervisor.md`](./run-supervisor.md) · [`testing.md`](./testing.md)（`createMockTelemetryPort`）

## 1. linnkit 给你的合同

- `TelemetryPort`（来自 `@linnlabs/linnkit/runtime-kernel`，在 `telemetry` namespace 下）：`emit(event)` + 可选 `flush()`。
- `TelemetryEvent` / `TelemetryEventKind` / `TelemetryScope`（同上）：6 类 kind（`llm_call` / `tool_call` / `context_build` / `context_compaction` / `graph_node` / `run_lifecycle`）的事实 schema。
- `withLLMTelemetryContext`（来自 `@linnlabs/linnkit` 根入口）：兼容旧 benchmark / hook 的 AsyncLocalStorage 聚合工具；runtime-kernel 生产路径不再直接写它。

中文备注：Q-M13 后，kernel 内部只写显式 `TelemetryPort.emit(...)`。如果 host 仍需要 ALS 聚合，应在自己的 `TelemetryPort` adapter 外层实现，而不是让 stage / middleware 直接调用 `recordLlmCallTelemetry`。

## 2. linnkit 自带的 mock primitive

- `noopTelemetry`（从 `runtimeKernel.telemetry` namespace 取）：默认无副作用实现，写测试时直接当 placeholder。
- `createMockTelemetryPort()`（来自 `@linnlabs/linnkit/testkit`）：按 `scope.runId ?? scope.turnId` 收集 telemetry，并提供可被 `RunHandle.cost()` 读取的 `RunCostCollector`。

## 3. 当前自动发出的事件

| kind | 发出位置 | 用途 |
|---|---|---|
| `llm_call` | `llmTelemetryMiddleware`；context compaction 内部 LLM 调用 | LLM latency、usage、成本聚合；内部调用使用 `phase=context-internal / purpose=context_compaction` |
| `context_build` | `buildContextStage` | context token estimate、component ledger、校准 |
| `context_compaction` | `compact_context` / `commit_context_compaction` stage | 每次抑制、尝试、失败或成功的水位、释放量、耗时、usage 与 run 归属 |
| `tool_call` | `ToolNode` | tool latency、成功/失败、错误码 |
| `graph_node` | `runGraphNodeWithTelemetry` | 每个 graph node 执行耗时 |
| `run_lifecycle` | `runWithLifecycleTelemetry` | spawned；终态还带 `stepsUsed / maxSteps / terminalReason` |

`llm_call.canonicalUsage` 是 provider 响应 usage 的标准口径，适合接成本聚合和 actual usage 统计；`context_build.tokenEstimate` 是上下文构建期估算，适合做裁剪解释和 calibration 配对。两者不是同一个数字，完整说明见 [`token-management.md`](./token-management.md)。

`context_compaction` 只记录安全指标，不记录 checkpoint 正文。`generationAttempted` 明确区分“已发出 Provider 请求”和“发送前被容量或护栏阻断”；只有前者消耗 attempt 护栏。`beforeTokens / afterTokens / compactionInputTokens` 分别回答触发时占用、重建后占用和压缩请求自身成本；`compressionRatio` 保留原始压缩比并允许大于等于 1，便于审计无效结果；`canonicalUsage` 保留 Provider actual cache read/write。`outcome=completed` 只在摘要已经通过 admission 并完成 durable commit 后出现。

`run_lifecycle` 的 terminal reason 区分普通完成、等待用户、步数上限强制收尾、步数真正耗尽、容量失败、其它失败和取消。它是执行观测，不替代 Host RunRegistry 的权威 run 状态；同一逻辑 run 经 `wait_user` 恢复时可能出现多个 execution 终态，消费者应读取最新终态并保留观测次数。

## 4. 你必须做的

1. 决定 telemetry 落到哪：日志、指标、tracing 管道、host 自家 telemetry sink。
2. 把 `TelemetryPort` 作为可选能力接入 runtime-assembly。
3. 确保 adapter 按 `scope.runId` / `scope.parentRunId` 聚合成本；同步 child-run 必须保留父子关系。

## 5. 你不要做的

- 不要把 telemetry 直接和 UI 事件流绑死（UI 走实时通道，telemetry 走 sink）。
- 不要把 tracing id / run id 透传到模型供应商请求体里。
- 不要把"先埋点再说"的 ad-hoc 日志散在业务文件里——所有可观测点收敛进 telemetry port。
- 不要在新 kernel 代码里直接调用 `recordLlmCallTelemetry`；它只是旧 ALS 聚合兼容层。

## 6. Scope 字段与父子 run

| 字段 | 何时填 |
|---|---|
| `scope.runId` | 当前 run 自己的 id（同步 child-run 应填 child run id 自己） |
| `scope.parentRunId` | 父 run 的 id（同步 child-run 必填，detached run 视场景填） |
| `scope.turnId` | host 的 turn 概念 id（推荐与 `runId` 对齐） |
| `scope.conversationId` | host 的会话/对话 id |

正确填写后，`RunCostCollector.snapshot(parentRunId)` 可以返回 `childrenTotal`，把同步子 agent 的 LLM cost 聚合到父 run。

## 7. 最小验证

- 单测：注入一个 `Array.push`-style sink，断言一次 run 里关键 kind 发出且 scope 含 `runId`。
- 集成测：并发两个 run 时 `scope.runId` 不串；child-run 的 `parentRunId` 不丢。
- 集成测：父 agent 工具内 `invokeChildRun` → 父 run 的 `cost().childrenTotal.llmCost > 0`，且子 run 自身 cost 不重复计入父 run 的直接 cost。
- 集成测：真实触发一次 compaction，断言只出现一条最终 outcome，且安全 sink 中没有摘要正文。
- 集成测：正常完成、容量失败、取消与步数耗尽分别产生准确的 `stepsUsed / maxSteps / terminalReason`。
