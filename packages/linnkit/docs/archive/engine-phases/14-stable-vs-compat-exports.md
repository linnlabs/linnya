# 14 · Stable vs Compat Exports

> **状态**：✅ 决策定稿（2026-04-21）；**§2 / §3 已在 D-1.a/b 落地（commits `1a93fe77` / `e1fb29ed`）**
> **作用**：把 `src/agent` 未来要公开的东西分成三层：
> 1. **稳定导出**：可以长期承诺给宿主/第二消费者用
> 2. **兼容导出**：只是为了这次迁移先放出来，后面要尽量收回
> 3. **宿主自持 / 不公开**：永远不该并进 `linnkit` 公共面
>
> **关联主文档**：
> - [`07-public-api-and-package-boundary.md`](./07-public-api-and-package-boundary.md)
> - [`13-public-api-surface-and-host-migration-batches.md`](./13-public-api-surface-and-host-migration-batches.md)
> - [`16-m4-m5-regression-test-plan.md`](./16-m4-m5-regression-test-plan.md) §4 G1 = D-1.a/b 完成判据
>
> **本文档是 D-1.a 起 sub `index.ts` 的真源**：每个 sub `index.ts` 应该只 re-export 本文档列为 stable / compat 的符号；列为 internal / 宿主自持 的一律不暴露。

---

## 1. 判定标准

### 1.1 稳定导出

只有同时满足下面几条，才进“稳定导出”：

1. 它描述的是**宿主真的需要依赖的长期能力**
2. 它不强绑定 Linnya 现在这套产品组织方式
3. 就算以后 `linnkit` 改名、`chat` 继续退场、`linnsec` 接入，也大概率还成立
4. 把它公开，不会把一整坨历史实现细节一起锁死

### 1.2 兼容导出

进入“兼容导出”的典型情况：

1. Linnya 现在确实在用，不放出来迁移很痛
2. 但它带着明显的历史包袱、宿主味道、或当前过渡实现
3. 长远看，大概率会被更干净的 port / factory / namespace 替代

一句大白话：

- **稳定导出** = 以后还敢认
- **兼容导出** = 这次迁移先借出来，用完尽量收回

### 1.3 宿主自持

这类东西不该进入 `linnkit` 公共面：

1. 它本质上是 Linnya 的产品层语义
2. 它是宿主默认策略、默认注册表、默认装配根节点
3. 它应该依赖 `linnkit` 公共面，而不是反向被并进去

### 1.4 绝不公开

这类东西也不该进入公开面：

1. 只是 node / tool / llm 内部的辅助实现
2. 只为当前某个宿主的实现细节服务
3. 公开后只会鼓励更多 deep import 伪装成“合法使用”

---

## 2. 研究结论

### 2.1 根入口 `src/agent`

#### 稳定导出

| 入口 | 说明 |
|------|------|
| `ports` (namespace) | 宿主调用 agent 的最小合同（详见 §2.2） |
| `runtimeKernel` (namespace) | runtime 装配 / tool runtime / event 生命周期 / flow session 长期依赖（详见 §2.3） |
| `testkit` (namespace) | 测试侧公共 harness 与断言（详见 §2.3 末尾 + §2.6） |
| `contracts` (namespace) | ✅ **D-4.c 已落地**（2026-04-22，详见 [`engine/20 §6`](./20-d3-d4-port-interfaces-plan.md)）：A 类协议物理 move 后的稳定出口（`AiMessage` / `RuntimeEvent` / `SubRunTraceEvent` / `AgentTodoSnapshot` 等）；已**取代**旧的 `from '@app/schemas'` 拿这些符号的路径；`packages/schemas` 旧真源已物理删除（无反向兜底） |
| `shared/ids` | `generateMessageId` / `generateRunId`（id 生成是 12+ 处宿主真实依赖的最小工具，长期成立）|

#### 兼容导出

| 入口 | 说明 |
|------|------|
| `contextManager` (namespace) | 现在还没干净到当彻底稳定公共层，`chat/*` 历史包袱明显，长远收敛后再升级 |
| `shared/llmTelemetryContext` | 当前宿主 run 审计 + 统计用的过渡实现，长远被 `engine/08` 正式 telemetry 契约替代 |
| `withLLMTelemetryContext` | Batch 3 `flow.agent-runner.service` 需要的 telemetry scope 入口；直接从根入口导出，避免宿主业务代码写入 codename compat namespace |
| `LlmCallTelemetry` | 当前 flow lifecycle hook 需要透传 run 内 LLM 调用统计；属于 `shared/llmTelemetryContext` 的兼容类型出口 |
| `shared/llmAuditRecorder` | `setLlmAuditRecorder` 单例注入接口，被 `src/domains/audit/features/llm-run-audit` 消费；长远收口到 telemetry port |

#### 不公开（internal）

| 文件 | 决议依据 |
|------|---------|
| `shared/TokenCalculator` | 0 处宿主 deep import；engine 内部 LLM 上下文 token 估算辅助 |
| `shared/errorClassifier` | 0 处宿主 deep import；runtime 内部错误分类，宿主走 `runtimeKernel.events.createRuntimeErrorEvent` |
| `shared/logger` | 0 处宿主 deep import；engine 内部统一日志，宿主有自己的 logger |

#### 当前证据

- [`src/agent/index.ts`](../../../../../src/agent/index.ts) —— 已有的 5 行最小版（D-1.a 会按本表扩展）
- [`flow.agent-runner.service.ts:44`](../../../../../src/app-hosts/linnya/adapters/flow/flow.agent-runner.service.ts) —— `withLLMTelemetryContext` 真实使用点
- §2.7 的 host import 实测快照 —— shared/ 6 文件分类的客观依据

### 2.2 `ports`

#### 稳定导出

- `AgentInvocationRequest`
- `AgentAiEngine`
- `AgentAiEngineStreamContent`

理由：

- 这层就是宿主调用 agent 的最小合同
- 不该带具体产品味道

#### 当前证据

- [agent-invocation.ts](../../../../../src/agent/ports/agent-invocation.ts:1)
- [ai-engine.ts](../../../../../src/agent/ports/ai-engine.ts:1)
- [agent-registry/types.ts](../../../../../src/app-hosts/linnya/agent-registry/types.ts:18)

### 2.3 `runtime-kernel`

#### 稳定导出

`graph`

- `GraphExecutor`
- `GraphAgentExecutor`
- `GraphAgentExecutorDependencies`
- `GraphExecutorContextBuilder`
- `GraphExecutorContextBuildInput`
- `GraphExecutorContextBuildOutput`
- `PendingContextRuntimeEvent`
- `GraphNode`
- `EngineState`
- `ExecutorLocalState`
- `Checkpointer`

`tools`

- `BaseTool`
- `OpenAIToolSchema`
- `ToolParameterSchema`
- `ToolExecutionContext`
- `ToolSchemaContext`
- `ToolContextPatch`
- `ToolRuntimeDefinition`
- `ToolCatalogPort`
- `ToolExecutionPort`
- `ToolRuntimePort`
- `ObservationPreviewPort`

`execution`

- `EventBus`
- `EventSequencer`
- `createRuntimeErrorEvent`

`events`

- `describeRuntimeEventLifecycle`
- `RuntimeEventLifecycleDecision`
- `eventMapper`
- `EventMappingContext`
- `ConversationMemoryPort`
- `AnyAgentEvent`
- `isToolCallDecisionEvent`

`runContext`

- `RunContext`
- `createDefaultRunContext`

理由：

- 这些都是宿主 runtime 装配、tool runtime、event 生命周期、flow session 长期需要依赖的最小合同
- 不是 Linnya 产品注册表和默认策略本身

当前证据：

- [graphRuntimeFactory.ts](../../../../../src/app-hosts/linnya/adapters/runtime-assembly/graphRuntimeFactory.ts:1)
- [toolRegistry.ts](../../../../../src/app-hosts/linnya/adapters/tools/toolRegistry.ts:1)
- [sse.port.ts](../../../../../src/app-hosts/linnya/adapters/realtime/sse.port.ts:12)
- [sqlite.implementation.ts](../../../../../src/app-hosts/linnya/adapters/persistence/event-store/sqlite.implementation.ts:8)
- [runBootstrapper.ts](../../../../../src/app-hosts/linnya/adapters/flow/agent-runner/runBootstrapper.ts:4)

`testkit`

- `createScriptedAiEngineHarness`
- `assertions` namespace（D-1.a 实际实现：把 `assertions.ts` 收成 namespace，比平铺函数稳）
- `createGraphLoopHarness`（D-2 Batch 0 新增：runtime-owned graph loop seam，宿主测试 wrapper 不再直接拼 `GraphExecutor / MemoryCheckpointer / *Node`）
- `createReplayHarness`
- `createToolContextFixture`

理由：

- 这些就是测试侧真正该依赖的公共试跑能力

当前证据：

- [graphLoopHarness.ts](../../../../../src/agent/runtime-kernel/testkit/graphLoopHarness.ts:1)
- [graphLoopHarness.ts](../../../../../src/app-hosts/linnya/testkit/agent-harness/graphLoopHarness.ts:1)

#### 兼容导出

`llm`

- `LlmCaller`
- `LlmCallOptions`
- `ModelCatalogLike`
- `ModelCatalogEntry`
- `ModelResolver`

理由：

- Linnya 当前 runtime assembly 和知识库图谱抽取都直接吃这层
- 但这更像“当前默认实现公开”，不是长期最理想的宿主边界
- 长远更可能被 `LlmProviderPort` / host-facing factory 收口

当前证据：

- [graphRuntimeFactory.ts](../../../../../src/app-hosts/linnya/adapters/runtime-assembly/graphRuntimeFactory.ts:8)
- [graphExtractionLlmCallerClient.ts](../../../../../src/features/knowledge-base/graph/application/graphExtractionLlmCallerClient.ts:19)

`childRuns`

- `InternalAgentInvoker`
- `InternalAgentConfig`
- `InternalAgentInvokeConfig`
- `InternalAgentInvokeResult`
- `ChildRunRequest`
- `ChildRunResult`
- `ChildRunInvokerPort`
- `pickChildRunSeedHistory`

理由：

- 宿主现在确实直接搭这套
- 但长期更应该收敛到 child-run 的 port 和 host adapter，而不是把 `InternalAgentInvoker` 当成长期宿主 API

当前证据：

- [internalAgentInvokerFactory.ts](../../../../../src/app-hosts/linnya/adapters/child-runs/internalAgentInvokerFactory.ts:1)
- [registeredSubagentInvoker.ts](../../../../../src/app-hosts/linnya/adapters/child-runs/registeredSubagentInvoker.ts:1)

`enrichment`

- `RequestEnricher`
- `EnrichmentContext`
- `EnrichmentResult`
- `RegistryEnrichmentResult`
- `requestEnricherRegistry`

理由：

- `RequestEnricher` 这些类型本身可以长期存在
- 但 `requestEnricherRegistry` 这个单例，是当前 Linnya 注册 builtins 的过渡做法，偏兼容

当前证据：

- [runBootstrapper.ts](../../../../../src/app-hosts/linnya/adapters/flow/agent-runner/runBootstrapper.ts:3)
- [builtin/index.ts](../../../../../src/app-hosts/linnya/agent-registry/builtin/index.ts:13)

`subrun`

- `EventBusSubRunTracePublisher`
- `SubRunTracePublisher`

理由：

- 宿主 toolContextFactory 现在直接 new 这个默认实现
- 长远更像 host adapter convenience，而不是每个消费者都必须知道的核心 API

当前证据：

- [toolContextFactory.ts](../../../../../src/app-hosts/linnya/adapters/context-injection/toolContextFactory.ts:6)

`graph concrete defaults`

- `MemoryCheckpointer`
- `LlmNode`
- `ToolNode`
- `UserNode`
- `AnswerNode`
- `WaitUserNode`

理由：

- 它们现在对 testkit 和 runtime assembly 很有用
- 但从“长期公共面”看，它们更像默认实现，不是纯合同

当前证据：

- [graphLoopHarness.ts](../../../../../src/app-hosts/linnya/testkit/agent-harness/graphLoopHarness.ts:114)

`tools implementation helpers`

- `normalizeToolArgs`
- `computeToolIdempotencyKey`
- `findCachedToolOutputByIdempotencyKey`
- `ensureToolContextRuntimeCapability`
- `stripRuntimeReservedToolContextPatch`
- `readToolContextUserQuery`
- `readToolContextModelId`
- `readToolContextRunContext`
- `readToolContextWorkingHistory`
- `readToolContextPersistedHistory`

理由：

- 这是当前 Linnya 默认 `ToolRegistry` 的实现 helper
- `ensureToolContextRuntimeCapability` / `stripRuntimeReservedToolContextPatch` 是 Batch 3 `toolContextFactory` 的 runtime-owned capability seam，宿主只调用，不重新解释 reserved key 规则
- `readToolContextModelId` / `readToolContextWorkingHistory` 也是 child-run 继承父 run 模型与上下文历史的过渡 helper
- 不是 tool runtime 最小合同

当前证据：

- [toolRegistry.ts](../../../../../src/app-hosts/linnya/adapters/tools/toolRegistry.ts:1)
- [toolContextFactory.ts](../../../../../src/app-hosts/linnya/adapters/context-injection/toolContextFactory.ts:1)

`event governance shortcuts`

- `shouldEmitRuntimeEventToSse`
- `shouldPersistRuntimeEvent`
- `shouldReplayRuntimeEventToUi`
- `shouldEnterAgentContext`

理由：

- 它们其实都是 `describeRuntimeEventLifecycle(...)` 的快捷壳
- 迁移期可以保留，长期更推荐宿主依赖统一生命周期决策对象

当前证据：

- [sse.port.ts](../../../../../src/app-hosts/linnya/adapters/realtime/sse.port.ts:30)
- [sqlite.implementation.ts](../../../../../src/app-hosts/linnya/adapters/persistence/event-store/sqlite.implementation.ts:8)

### 2.4 `context-manager`

#### 暴露风格：namespace（保持现 `index.ts` 三阶段模型）

`context-manager/index.ts` 当前已经按 profile namespace 暴露：

- `agentContracts / agentConfig / agentContext / agentOrchestration / agentPreprocessors / agentTasks / agentTools / agentUtils`
- `chatContracts / chatContext / chatOrchestration / chatPreprocessors / chatRequestAdapters / chatTasks / chatUtils`
- `shared`

**风格定稿**：保持 namespace 暴露，**不平铺具体类符号到顶层**。理由：

1. 与现有 `index.ts` 一致，D-1.a 不做破坏性改动
2. 未来加新 profile（如 `secretary` profile）天然兼容，不破坏现有 import
3. 三阶段模型（`shared` / `profiles/agent` / `profiles/chat`）有真实的产品分层语义，不该被打散

下面"稳定导出"列出的具体符号是**每个 namespace 内部的最小公开承诺**——即：`agentContracts.IAgentTask` 可用，但 `agentContracts.SomeInternalType` 不公开。

#### 稳定导出（namespace 内最小符号）

只建议保留 `agent` 这边的最小合同和可组装能力（位于 `agentContracts / agentContext / agentOrchestration / agentPreprocessors / agentTasks / agentUtils` 命名空间）：

- `AgentProfileRequest`
- `IAgentTask`
- `AgentTaskResolver`
- `AgentMessageOrchestrator`
- `ContextProviderRegistry`
- `AgentCoreContextProvider`
- `AgentWorkingMemoryProvider`
- `CheckpointSummarizationProvider`
- `shared/providers`
- `shared/summarization`

理由：

- 这些是宿主接入 agent core 的最小合同
- 不直接绑定 Linnya 的产品注册表
- 即使以后 `chat` 继续退场，它们仍然成立

#### 兼容导出

- `agentTasks.BaseAgentTask`
- `agentTools.ToolManager`
- `messageFormatter`
- `chatTasks.IChatTask`
- `chatTasks.BaseConversationalTask`
- `chatOrchestration.MessageOrchestrator`
- `chatContracts.*`
- `chatRequestAdapters.*`
- `chatUtils.messageAdapters`
- `AGENT_CONSTANTS` / `DEFAULT_AGENT_CONFIG`

理由：

- 宿主现在确实在用
- 尤其是 `chat/*`，明显带着“单独 chat 模式”的历史世界观
- 应该以后统一挂到 `contextManager.chatCompat`

#### 宿主自持，不进 `linnkit` 公共面

- `src/app-hosts/linnya/context/agent/*`
- `src/app-hosts/linnya/context/chat/*` wrapper
- `src/app-hosts/linnya/agent-registry/*`
- `src/app-hosts/linnya/context-policies/*`
- `defaultGraphExecutorContextBuilder`

理由：

- 这些不是 `context-manager` 的公共合同，而是 Linnya 自己的产品组织方式、默认策略和装配根节点

当前证据：

- [defaultGraphExecutorContextBuilder.ts](../../../../../src/app-hosts/linnya/adapters/context-injection/defaultGraphExecutorContextBuilder.ts:3)
- [createMessageOrchestrator.ts](../../../../../src/app-hosts/linnya/context/chat/createMessageOrchestrator.ts:1)
- [defaultAgentProviderRegistry.ts](../../../../../src/app-hosts/linnya/context-policies/defaultAgentProviderRegistry.ts:1)
- [GenericAgentTask.ts](../../../../../src/app-hosts/linnya/agent-registry/GenericAgentTask.ts:11)

> **2026-04-22 D-2 回填**：
>
> - `defaultGraphExecutorContextBuilder` / `defaultToolManager` / `toolRegistry` / host task 实现层已经实际迁到上述 compat namespace
> - 因此这里列出的 compat symbol 不是“研究建议”，而是当前真实迁移面

### 2.5 宿主自持的产品层，不该误判成公开导出

- `AgentInvokeRequest` 与相关 API schemas  
  证据：[context/agent/contracts.ts](../../../../../src/app-hosts/linnya/context/agent/contracts.ts:1)、[context/agent/schemas.ts](../../../../../src/app-hosts/linnya/context/agent/schemas.ts:1)
- `AgentDefinition` / `agentRegistry` / `ChatDefinition` / `chatTaskResolver`  
  证据：[agent-registry/types.ts](../../../../../src/app-hosts/linnya/agent-registry/types.ts:1)、[registry.ts](../../../../../src/app-hosts/linnya/agent-registry/registry.ts:1)、[chatTaskResolver.ts](../../../../../src/app-hosts/linnya/agent-registry/chatTaskResolver.ts:1)
- `defaultAgentProviderRegistry` / `defaultChatProviderRegistry` / `defaultSummarizationOptions`  
  证据：[defaultAgentProviderRegistry.ts](../../../../../src/app-hosts/linnya/context-policies/defaultAgentProviderRegistry.ts:1)、[defaultChatProviderRegistry.ts](../../../../../src/app-hosts/linnya/context-policies/defaultChatProviderRegistry.ts:1)
- `defaultGraphExecutorContextBuilder`  
  证据：[defaultGraphExecutorContextBuilder.ts](../../../../../src/app-hosts/linnya/adapters/context-injection/defaultGraphExecutorContextBuilder.ts:112)

### 2.6 明确不该公开

- `tick-pipeline/*`
- `llmNode.state.ts`
- `llmNode.eventBridge.ts`
- `toolNode` 内部辅助实现
- `toolIdempotency/*`
- `shared/TokenCalculator` / `shared/errorClassifier` / `shared/logger`（见 §2.1）
- 任何只服务某个默认宿主实现的 helper

理由：

- 宿主并不需要长期知道这些
- 一旦公开，只会鼓励新的伪装 deep import

---

### 2.7 决议依据：宿主真实 deep import 面快照

> **采集时间**：2026-04-21（HEAD = `69a708de`）
> **采集命令**：`Grep "from ['\"](src/agent|@/agent)/[^'\"]+" --glob '!src/agent/**'`
> **采集范围**：`src/app-hosts/` + `apps/renderer/` + `src/features/` + `src/tools/` + `src/integrations/` + `src/electron-main/` + `src/infra/` + `src/shared/`

#### `shared/*` 文件级使用面（§2.1 决议依据）

| 文件 | 宿主 deep import 处数 | 主要消费者 | 决议 |
|------|----------------------|----------|------|
| `shared/ids` | 12+ | flow.* / agent-runner / persistence / context-injection / child-runs / agent-registry | stable |
| `shared/llmTelemetryContext` | 2 | flow.agent-runner.service / runLifecycleHook.types | compat |
| `shared/llmAuditRecorder` | 1 | src/domains/audit/features/llm-run-audit | compat |
| `shared/TokenCalculator` | 0 | — | internal |
| `shared/errorClassifier` | 0 | — | internal |
| `shared/logger` | 0 | — | internal |

#### 决议方法（与 §1 判定标准对齐）

- **0 宿主 deep import → internal**：没有外部消费者，公开只会鼓励新的伪装 deep import（§1.4）
- **1-2 宿主 deep import → compat**：有真实使用，但偏宿主特定的过渡实现（§1.2）
- **3+ 跨多个目录的 deep import → stable**：宿主真的需要依赖的长期能力（§1.1）

#### 后续刷新机制

- 每次 D-2 batch 收口完成（engine/15 Batch 0~5），重跑此快照
- Batch 5 完成后，理论 deep import 数 ≈ 0（宿主全走入口 import）；届时 stable/compat 不再以"使用数"判，而以"宿主明确需要哪些公开能力"判
- 快照变化记录在本节（保留历史），不另起文档

---

## 3. 当前建议

### 3.1 第一阶段应该先做什么

1. 先把“稳定导出”和“兼容导出”按 namespace 写进 `index.ts`
2. 根入口不要平铺兼容导出
3. `context-manager` 兼容导出必须带上兼容语义命名
4. `runtime-kernel` 先按组导出，不一次性把所有 concrete class 拉成永恒公共面
5. `宿主自持` 这类文件一律不进入 `linnkit` 公共面，只改它们消费公开入口的方式

### 3.2 当前不该做什么

1. 不要为了这次迁移把 `context-manager` 整体升级成正式长期 API
2. 不要把 concrete default implementations 全部误判成“稳定导出”
3. 不要把当前单例注册中心做法直接永久公开

---

## 4. 状态

- [x] 补出"稳定导出 vs 兼容导出 vs 宿主自持"判定标准
- [x] 给出 root / ports / runtime-kernel / context-manager / testkit 分类
- [x] 标出不该公开的内部面
- [x] **shared/ 6 文件完整决议（§2.1 + §2.7 实测证据）** —— 2026-04-21 PR1
- [x] **context-manager 暴露风格定稿（namespace + 三阶段模型，§2.4）** —— 2026-04-21 PR1
- [x] **宿主真实 import 面快照入档（§2.7）** —— 2026-04-21 PR1，作为决议时间戳
- [x] 回填到 `engine/07` 与 `engine/13`（已通过 `engine/07 §2.4 / §5.3 / §7` 与 `engine/13 §3 / §4` 体现）
- [x] **`index.ts` 实施完成（D-1.a，commit `1a93fe77`）**：`runtime-kernel/index.ts` / `ports/index.ts` / `testkit/index.ts` 三个新文件 + 扩 `src/agent/index.ts`（稳定面 + `linnkitCompat` namespace）+ 4 个 snapshot 测试 + manifest 测试均已落地
- [x] **`package.json` 草案落地（D-1.b，commit `e1fb29ed`）**
