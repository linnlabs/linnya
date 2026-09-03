# 15 · Host Migration File Manifest

> **状态**：🚧 持续同步中；Batch 0~4 主体已实装并验证，D-2 package-boundary 收尾已完成  
> **日期**：2026-04-21  
> **作用**：把宿主迁移批次细化到文件级，避免实施时“看着顺手就改”  
>
> **关联主文档**：
> - [`13-public-api-surface-and-host-migration-batches.md`](./13-public-api-surface-and-host-migration-batches.md)
> - [`14-stable-vs-compat-exports.md`](./14-stable-vs-compat-exports.md)

---

## 1. 排序原则

迁移顺序不是按“谁引用最多”排，而是按：

1. 先拿低风险文件逼出 exports 缺口
2. 先改边界清楚的小闭环
3. `flow` 先改外圈，再改 runner 核心
4. `chat` 历史兼容清理放在 runtime 主链之后
5. 最拧巴的 `context injection` 最后拆

一句大白话：先从边缘试压，再往主心骨上靠。

---

## 2. 文件级批次清单

> **2026-04-22 实施回填**：
>
> - Batch 0 / 1 / 2 / 3：已完成
> - Batch 4：主体已完成
> - 原 Batch 5 的主 knot（`defaultGraphExecutorContextBuilder` 及其直接依赖）已在 Batch 4 收口过程中一并解开
> - 因此本文档现在的作用更偏向“解释为什么顺序这样定”，而不是要求下一步机械继续跑完整个 0~5

### Batch 0：testkit / tests canary

**先动文件**

- [src/agent/testkit/index.ts](../../../../../src/agent/testkit)
- [src/agent/runtime-kernel/index.ts](../../../../../src/agent/runtime-kernel)
- [graphLoopHarness.ts](../../../../../src/app-hosts/linnya/testkit/agent-harness/graphLoopHarness.ts:1)
- [toolRegistryHarness.ts](../../../../../src/app-hosts/linnya/testkit/agent-harness/toolRegistryHarness.ts:1)
- [childRunHarness.ts](../../../../../src/app-hosts/linnya/testkit/agent-harness/childRunHarness.ts:1)

**同批改**

- [graphLoop.integration.test.ts](../../../../../src/app-hosts/linnya/testkit/agent-harness/__tests__/graphLoop.integration.test.ts:1)
- [graphLoop.stepPolicy.test.ts](../../../../../src/app-hosts/linnya/testkit/agent-harness/__tests__/graphLoop.stepPolicy.test.ts:1)

**不要拆开改**

- `graphLoopHarness.ts` 和它依赖的动态 import 入口不要分两轮改

原因：

- 一旦 `runtime-kernel/index.ts` 还没补齐，就会逼出新的 deep import

**主要风险**

- 低

### Batch 1：child-runs

**先动文件**

- [registeredSubagentInvoker.ts](../../../../../src/app-hosts/linnya/adapters/child-runs/registeredSubagentInvoker.ts:1)
- [internalAgentInvokerFactory.ts](../../../../../src/app-hosts/linnya/adapters/child-runs/internalAgentInvokerFactory.ts:1)
- [registeredAgentResolver.ts](../../../../../src/app-hosts/linnya/adapters/child-runs/registeredAgentResolver.ts:1)
- [childRunHarness.ts](../../../../../src/app-hosts/linnya/testkit/agent-harness/childRunHarness.ts:1)

**同批改**

- [internalAgentInvokerFactory.test.ts](../../../../../src/app-hosts/linnya/adapters/flow/agent-runner/__tests__/internalAgentInvokerFactory.test.ts:1)

**不要拆开改**

- `registeredSubagentInvoker.ts` / `internalAgentInvokerFactory.ts` / `registeredAgentResolver.ts`
- `childRunHarness.ts` 不要晚于上面三者太久

原因：

- 这是一个完整的默认装配闭环：`promptKey -> resolver -> internal invoker -> invoke`
- 任意拆开都会出现默认 resolver / invoker / harness 三边口径不一致

**主要风险**

- 中低

### Batch 2：flow event/session seam

**先动文件**

- [flow.runner-handoff.ts](../../../../../src/app-hosts/linnya/adapters/flow/flow.runner-handoff.ts:1)
- [flow.persistence.ts](../../../../../src/app-hosts/linnya/adapters/flow/flow.persistence.ts:1)
- [flow.host-session.service.ts](../../../../../src/app-hosts/linnya/adapters/flow/flow.host-session.service.ts:1)
- [flow.stream-handler.ts](../../../../../src/app-hosts/linnya/adapters/flow/flow.stream-handler.ts:1)
- [agentEventBridge.ts](../../../../../src/app-hosts/linnya/adapters/flow/agent-runner/agentEventBridge.ts:1)
- [runFinalizer.ts](../../../../../src/app-hosts/linnya/adapters/flow/agent-runner/runFinalizer.ts:1)
- [runFailureEmitter.ts](../../../../../src/app-hosts/linnya/adapters/flow/agent-runner/runFailureEmitter.ts:1)
- [summarizationEventEmitter.ts](../../../../../src/app-hosts/linnya/adapters/flow/agent-runner/summarizationEventEmitter.ts:1)
- [runLifecycleCoordinator.ts](../../../../../src/app-hosts/linnya/adapters/flow/agent-runner/runLifecycleCoordinator.ts:1)
- [sse.port.ts](../../../../../src/app-hosts/linnya/adapters/realtime/sse.port.ts:1)
- [sqlite.implementation.ts](../../../../../src/app-hosts/linnya/adapters/persistence/event-store/sqlite.implementation.ts:1)

**同批改**

- [runtimeEventLifecycle.contract.test.ts](../../../../../src/app-hosts/linnya/adapters/realtime/__tests__/runtimeEventLifecycle.contract.test.ts:1)
- [sse.port.test.ts](../../../../../src/app-hosts/linnya/adapters/realtime/__tests__/sse.port.test.ts:1)
- [agentEventBridge.test.ts](../../../../../src/app-hosts/linnya/adapters/flow/agent-runner/__tests__/agentEventBridge.test.ts:1)
- [summarizationEventEmitter.test.ts](../../../../../src/app-hosts/linnya/adapters/flow/agent-runner/__tests__/summarizationEventEmitter.test.ts:1)
- [runFinalizer.test.ts](../../../../../src/app-hosts/linnya/adapters/flow/agent-runner/__tests__/runFinalizer.test.ts:1)

**不要拆开改**

- `flow.host-session.service.ts` / `flow.runner-handoff.ts` / `flow.persistence.ts`
- `flow.stream-handler.ts` / `agentEventBridge.ts` / `runFinalizer.ts`
- `sse.port.ts` / `sqlite.implementation.ts` / realtime contract tests

原因：

- 这是 `EventBus / Sequencer / collector / persistence / SSE` 的外圈接缝
- 单拆会让 `stream_end`、`tool_output` feedback、error event 的收尾口径漂移

**主要风险**

- 中高

### Batch 3：flow runner core

**先动文件**

- [flow.run-preparation.service.ts](../../../../../src/app-hosts/linnya/adapters/flow/flow.run-preparation.service.ts:1)
- [flow.history-builder.service.ts](../../../../../src/app-hosts/linnya/adapters/flow/flow.history-builder.service.ts:1)
- [build-base-agent-invoke-request.ts](../../../../../src/app-hosts/linnya/adapters/flow/history-builder/build-base-agent-invoke-request.ts:1)
- [history-builder-options-extender.registry.ts](../../../../../src/app-hosts/linnya/adapters/flow/history-builder/history-builder-options-extender.registry.ts:1)
- [runBootstrapper.ts](../../../../../src/app-hosts/linnya/adapters/flow/agent-runner/runBootstrapper.ts:1)
- [executionPolicyAssembler.ts](../../../../../src/app-hosts/linnya/adapters/flow/agent-runner/executionPolicyAssembler.ts:1)
- [toolContextFactory.ts](../../../../../src/app-hosts/linnya/adapters/context-injection/toolContextFactory.ts:1)
- [flow.agent-runner.service.ts](../../../../../src/app-hosts/linnya/adapters/flow/flow.agent-runner.service.ts:1)

**同批改**

- [agentRunner.interrupted.integration.test.ts](../../../../../src/app-hosts/linnya/adapters/flow/__integration-tests__/agentRunner.interrupted.integration.test.ts:1)
- [flow.followup-tool-history.integration.test.ts](../../../../../src/app-hosts/linnya/adapters/flow/__integration-tests__/flow.followup-tool-history.integration.test.ts:1)
- [summarization.test.ts](../../../../../src/app-hosts/linnya/adapters/flow/__integration-tests__/summarization.test.ts:1)
- [runBootstrapper.test.ts](../../../../../src/app-hosts/linnya/adapters/flow/agent-runner/__tests__/runBootstrapper.test.ts:1)
- [toolContextFactory.test.ts](../../../../../src/app-hosts/linnya/adapters/flow/agent-runner/__tests__/toolContextFactory.test.ts:1)

**不要拆开改**

- `flow.run-preparation.service.ts` / `flow.history-builder.service.ts` / `build-base-agent-invoke-request.ts`
- `toolContextFactory.ts` / `runBootstrapper.ts` / `flow.agent-runner.service.ts`

原因：

- 这几组一起决定 `AgentInvokeRequest` 的构造口径、`runContext` / enrichment 合并方式、以及进入执行前的 `ToolContext`
- 单拆会让 runner 执行前准备和执行期契约断开

**主要风险**

- 高

### Batch 4：registry + context + context-policies compat cleanup

**先动文件**

- [agent-registry/types.ts](../../../../../src/app-hosts/linnya/agent-registry/types.ts:1)
- [GenericAgentTask.ts](../../../../../src/app-hosts/linnya/agent-registry/GenericAgentTask.ts:1)
- [agentTaskResolver.ts](../../../../../src/app-hosts/linnya/agent-registry/agentTaskResolver.ts:1)
- [chatTaskResolver.ts](../../../../../src/app-hosts/linnya/agent-registry/chatTaskResolver.ts:1)
- [context/agent/contracts.ts](../../../../../src/app-hosts/linnya/context/agent/contracts.ts:1)
- [context/agent/schemas.ts](../../../../../src/app-hosts/linnya/context/agent/schemas.ts:1)
- [context/chat/contracts.ts](../../../../../src/app-hosts/linnya/context/chat/contracts.ts:1)
- [context/chat/request-adapters.ts](../../../../../src/app-hosts/linnya/context/chat/request-adapters.ts:1)
- [context/chat/createMessageOrchestrator.ts](../../../../../src/app-hosts/linnya/context/chat/createMessageOrchestrator.ts:1)
- [context/chat/schemas.ts](../../../../../src/app-hosts/linnya/context/chat/schemas.ts:1)
- [defaultAgentProviderRegistry.ts](../../../../../src/app-hosts/linnya/context-policies/defaultAgentProviderRegistry.ts:1)
- [defaultChatProviderRegistry.ts](../../../../../src/app-hosts/linnya/context-policies/defaultChatProviderRegistry.ts:1)
- [defaultSummarizationOptions.ts](../../../../../src/app-hosts/linnya/context-policies/defaultSummarizationOptions.ts:1)
- [graphRuntimeFactory.ts](../../../../../src/app-hosts/linnya/adapters/runtime-assembly/graphRuntimeFactory.ts:1)
- [modelCatalog.ts](../../../../../src/app-hosts/linnya/adapters/runtime-assembly/modelCatalog.ts:1)
- [graphExtractionLlmCallerClient.ts](../../../../../src/features/knowledge-base/graph/application/graphExtractionLlmCallerClient.ts:1)

**同批改**

- 所有直接依赖 `IAgentTask` / `IChatTask` / `BaseAgentTask` / `BaseConversationalTask` 的注册项
  代表文件：
  - [review/task.ts](../../../../../src/app-hosts/linnya/agent-registry/agents/review/task.ts:1)
  - [default/task.ts](../../../../../src/app-hosts/linnya/agent-registry/chats/default/task.ts:1)
  - 以及 `src/app-hosts/linnya/agent-registry/chats/*/task.ts`

**不要拆开改**

- `agentTaskResolver.ts` / `GenericAgentTask.ts`
- `chatTaskResolver.ts` / `context/chat/createMessageOrchestrator.ts`
- `defaultAgentProviderRegistry.ts` / `defaultChatProviderRegistry.ts`
- `graphRuntimeFactory.ts` / `modelCatalog.ts`
- `graphExtractionLlmCallerClient.ts` 不要晚于 `llm` 兼容导出改动太久

原因：

- 这批既包含 `chat` 历史兼容清理，也包含 runtime assembly / llm concrete use 的 compat 收口
- 如果拆太散，很容易一边在收 `chatCompat`，另一边又继续把旧链路公开成长期正式 API

**主要风险**

- 中高

### Batch 5：context-injection final knot

> **2026-04-22 回填**：该结的主链路部分已在 Batch 4 收口时一起解开；D-2 package-boundary 收尾完成后，已无需再单独保留一个机械意义上的 Batch 5。

**先动文件**

- [defaultGraphExecutorContextBuilder.ts](../../../../../src/app-hosts/linnya/adapters/context-injection/defaultGraphExecutorContextBuilder.ts:1)

**不要拆开改**

- 它不要作为单文件孤立修改
- 必须和下面这些依赖一起看：
  - [graphRuntimeFactory.ts](../../../../../src/app-hosts/linnya/adapters/runtime-assembly/graphRuntimeFactory.ts:1)
  - [defaultToolManager.ts](../../../../../src/app-hosts/linnya/adapters/tools/defaultToolManager.ts:1)
  - [defaultAgentProviderRegistry.ts](../../../../../src/app-hosts/linnya/context-policies/defaultAgentProviderRegistry.ts:1)
  - [defaultChatProviderRegistry.ts](../../../../../src/app-hosts/linnya/context-policies/defaultChatProviderRegistry.ts:1)
  - [agentTaskResolver.ts](../../../../../src/app-hosts/linnya/agent-registry/agentTaskResolver.ts:1)
  - [chatTaskResolver.ts](../../../../../src/app-hosts/linnya/agent-registry/chatTaskResolver.ts:1)

原因：

- 它是当前最深的历史结
- 同时扯着 `agent/chat`、task resolver、provider registry、ToolManager、llmCaller
- 如果单文件硬改，最容易把历史兼容逻辑封进未来公共边界

**额外依赖**

- Batch 3 必须先稳定
- Batch 4 必须先稳定

**主要风险**

- 最高

---

## 3. 当前结论

本文的文件级顺序已经被实际实施验证到 Batch 4 主体。

这轮验证后的结论仍然成立：如果跳批次，最容易出问题的地方有两个：

1. 过早碰 `context injection`
2. 在 `child-runs` 和 `flow event/session seam` 之前就先大改 runner 核心

一句大白话：

- `child-runs` 先拿来试 runtime 装配
- `flow` 先改外圈，再改主血管
- `context injection` 是死结，但它的主 knot 已在 Batch 4 收口过程中一起解开；剩余是否单开一批，要看白名单收尾判定

---

## 4. 状态

- [x] 把迁移批次细化到文件级
- [x] 标出每批的同批改文件
- [x] 标出不该拆开的文件组合
- [x] 回填到 `engine/07`（已通过 `engine/07 §2.4 / §5.3` 引用本清单）
- [x] D-2 package-boundary 收尾完成（本清单顺序已实际验证到 Batch 4，且原 Batch 5 主 knot 已在 Batch 4 中解开）
