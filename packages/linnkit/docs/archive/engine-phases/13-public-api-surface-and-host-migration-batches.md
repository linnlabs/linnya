# 13 · Public API Surface and Host Migration Batches

> **状态**：🚧 持续同步中；**§3 / §4 公开入口建议已在 D-1.a/b 落地，§5 迁移批次已完成 D-2 package-boundary 收口**（小细节按真实代码继续回填）  
> **日期**：2026-04-21（首版）/ 2026-04-22（D-1.a/b 落地后小幅更新）  
> **作用**：把“真抽包前的下一步研究”压缩成两个问题：  
> 1. `src/agent` 该先开哪些公开入口  
> 2. Linnya 宿主该按什么顺序脱离 deep import  
>
> **关联主文档**：
> - [`07-public-api-and-package-boundary.md`](./07-public-api-and-package-boundary.md)
> - [`11-phase-e-hard-blockers.md`](./11-phase-e-hard-blockers.md)
> - [`12-agent-contracts-audit.md`](./12-agent-contracts-audit.md)

---

## 1. 目标先说死

**当前主目标仍然是 `agent` 真抽包研究，不是 `linnsec` 开发。**

前面写 `secretary/*`，只是为了反推：

- 哪些能力以后必须留在 `linnkit`
- 哪些能力不能继续绑死 Linnya 宿主

但当前要继续研究和落计划的主线，还是：

1. 补 `src/agent` 的公开入口
2. 把宿主对 `src/agent` 内部目录的直接依赖，按批次迁到公开入口
3. 在这两件事完成前，不进入 Phase E 真抽包

一句大白话：现在先研究“怎么把发动机单独拎出来”，不是开始造“秘书整车”。

---

## 2. 本轮核心结论

### 2.1 deep import 热点集中，不该平均用力

只看宿主代码文件（不含文档）统计，热点主要集中在：

- `runtime-kernel/execution`：38
- `context-manager/profiles`：37
- `runtime-kernel/graph-engine`：33
- `runtime-kernel/tools`：21
- `shared/ids`：12
- `runtime-kernel/enrichment`：11
- `runtime-kernel/events`：10
- `runtime-kernel/llm`：9

这说明下一步不该平均撒网，而应优先把下面几块的公开面收出来：

1. `runtime-kernel`
2. `context-manager` 的过渡兼容导出
3. `testkit`

### 2.2 当前最卡的不是“没 exports”，而是“宿主装配点吃得太深”

最典型的两个文件：

- [defaultGraphExecutorContextBuilder.ts](../../../../../src/app-hosts/linnya/adapters/context-injection/defaultGraphExecutorContextBuilder.ts:1)
- [graphRuntimeFactory.ts](../../../../../src/app-hosts/linnya/adapters/runtime-assembly/graphRuntimeFactory.ts:1)

它们的问题不是 import 多，而是：

- 一边直接吃 `context-manager/profiles/*`
- 一边直接吃 `runtime-kernel/*`
- 还顺手把 Linnya 默认实现和历史兼容逻辑一起拧进去

所以当前最重要的不是继续谈“大方向”，而是给宿主一个**足够窄但够用的公开入口层**。

---

## 3. 公开入口该先开什么

### 3.1 结论

第一阶段不要追求“一步到位的完美 exports 体系”。  
应该先补四层入口：

1. ✅ `src/agent/index.ts`（D-1.a 已落地）
2. ✅ `src/agent/ports/index.ts`（D-1.a 已落地）
3. ✅ `src/agent/runtime-kernel/index.ts`（D-1.a 已落地，namespace 形态：`graph / tools / events / llm / resilience / instructions / execution`）
4. ✅ `src/agent/testkit/index.ts`（D-1.a 已落地，含 `assertions` namespace）
5. ✅ `src/agent/contracts/index.ts`（**D-4.c 已落地**，2026-04-22；详见 [`engine/20 §6`](./20-d3-d4-port-interfaces-plan.md)）：A 类协议物理 move 后的公开入口（`AiMessage` / `RuntimeEvent` / `SubRunTraceEvent` / `AgentTodoSnapshot` 等）；已**取代** `from '@app/schemas'` 拿这些符号的旧路径，旧真源（`packages/schemas/src/{domain-models,runtime-events,runtime-models,view-models}.ts`，共 -2155 行）已物理删除（无反向兜底）

`context-manager/index.ts` 已经存在，但它现在更像过渡导出层，不该继续无限扩张——D-1.a 已经把它收进 `linnkitCompat namespace`（详见 §4.1 修订）。

### 3.2 各层职责

#### A. `src/agent/index.ts`

只放最上层、最稳定的东西：

- `ports`
- `runtimeKernel`
- `contextManager`
- `testkit`
- `shared/ids`
- `shared/llmTelemetryContext`

这里不建议一开始就把大量 runtime 类平铺到根入口。  
原因很简单：根入口铺太宽，后面要收口或改名会更痛。

#### B. `src/agent/ports/index.ts`

第一阶段建议暴露：

- `AgentInvocationRequest`  
  来源：[agent-invocation.ts](../../../../../src/agent/ports/agent-invocation.ts:1)
- `AgentAiEngine` 及流式相关类型  
  来源：[ai-engine.ts](../../../../../src/agent/ports/ai-engine.ts:1)

这层是宿主“怎么调用 agent”的最小合同面，应尽量稳定。

#### C. `src/agent/runtime-kernel/index.ts`

第一阶段建议按“宿主真实在吃什么”来开，不按目录漂亮程度来开。

建议先暴露 8 组：

1. `graph`
2. `tools`
3. `execution`
4. `events`
5. `llm`
6. `enrichment`
7. `childRuns`
8. `runContext`

它们分别对应当前最真实的宿主依赖：

- [graphRuntimeFactory.ts](../../../../../src/app-hosts/linnya/adapters/runtime-assembly/graphRuntimeFactory.ts:1)
- [toolRegistry.ts](../../../../../src/app-hosts/linnya/adapters/tools/toolRegistry.ts:1)
- [internalAgentInvokerFactory.ts](../../../../../src/app-hosts/linnya/adapters/child-runs/internalAgentInvokerFactory.ts:1)
- [agentEventBridge.ts](../../../../../src/app-hosts/linnya/adapters/flow/agent-runner/agentEventBridge.ts:1)

#### D. `src/agent/testkit/index.ts`

第一阶段建议暴露：

- `agent-harness`
- `context-harness`
- `tool-fixtures`

来源：

- [src/agent/testkit/agent-harness](../../../../../src/agent/testkit/agent-harness)
- [src/agent/testkit/context-harness](../../../../../src/agent/testkit/context-harness)
- [src/agent/testkit/tool-fixtures](../../../../../src/agent/testkit/tool-fixtures)

不先补它，dry-run 和测试会继续偷吃内部路径。

---

## 4. 第一阶段导出草案

> 这里是研究稿，不是最终代码模板。  
> 目的是先把公开面想清楚，再进入 D-1 实施。

### 4.1 `src/agent/index.ts`

> **D-1.a 实际落地形态（commit `1a93fe77`）**：分成"稳定导出"和"兼容导出（`linnkitCompat`）"两层：
>
> ```ts
> // 稳定导出
> export * as ports from './ports';
> export * as runtimeKernel from './runtime-kernel';
> export * as testkit from './testkit';
> export { generateMessageId, generateRunId } from './shared/ids';
>
> // 兼容导出（隔离进 linnkitCompat namespace，长远收回）
> export const linnkitCompat = {
>   contextManager,
>   llmTelemetryContext,
>   llmAuditRecorder,
> } as const;
> ```
>
> 与原稿的差异：
> - `contextManager` 与 `llmTelemetryContext` / `llmAuditRecorder` 一起进 `linnkitCompat` 而非根入口（详见 [`engine/14 §2.1`](./14-stable-vs-compat-exports.md)）
> - `ports` 改为 `* as ports` namespace 形态（与 `runtimeKernel` / `testkit` 一致），而非平铺
> - 没有补 `shared/llmTelemetryContext` 到稳定面（它现在在 `linnkitCompat` 里）

原稿建议（保留作历史参考）：

- `export * from './ports'`
- `export * as runtimeKernel from './runtime-kernel'`
- `export * as contextManager from './context-manager'`
- `export * as testkit from './testkit'`
- 保留 `shared/ids`
- 补 `shared/llmTelemetryContext`

### 4.2 `src/agent/ports/index.ts`

建议职责：

- `export type { AgentInvocationRequest } from './agent-invocation'`
- `export type { AgentAiEngine, AgentAiEngineStreamContent } from './ai-engine'`

### 4.3 `src/agent/runtime-kernel/index.ts`

建议不要一开始就把每个类全部平铺导出。  
第一阶段更稳的做法是：**按组 namespace 化**，内部再逐步细化。

建议分组：

- `graph`
- `tools`
- `execution`
- `events`
- `llm`
- `enrichment`
- `childRuns`
- `runContext`
- `subrun`

其中宿主最真实需要的代表项包括：

- `GraphExecutor` / `GraphAgentExecutor` / `GraphExecutorContextBuilder`
- `MemoryCheckpointer`
- `LlmNode` / `ToolNode` / `UserNode` / `AnswerNode` / `WaitUserNode`
- `EventBus` / `EventSequencer` / `createRuntimeErrorEvent`
- `describeRuntimeEventLifecycle` / `shouldPersistRuntimeEvent`
- `BaseTool` / `ToolRuntimePort` / `ObservationPreviewPort`
- `LlmCaller` / `ModelResolver`
- `RequestEnricher` / `requestEnricherRegistry`
- `InternalAgentInvoker`

这些结论分别来自：

- [executor.ts](../../../../../src/agent/runtime-kernel/graph-engine/executor.ts:1)
- [engine.ts](../../../../../src/agent/runtime-kernel/graph-engine/engine.ts:1)
- [ports.ts](../../../../../src/agent/runtime-kernel/tools/ports.ts:1)
- [eventGovernance.ts](../../../../../src/agent/runtime-kernel/events/eventGovernance.ts:1)
- [llm/index.ts](../../../../../src/agent/runtime-kernel/llm/index.ts:1)
- [internalAgentInvoker.ts](../../../../../src/agent/runtime-kernel/child-runs/internalAgentInvoker.ts:1)

### 4.4 `context-manager` 的公开定位

这层现在不能当成“已经彻底稳定的通用公共层”。

当前建议是：

- `agent/*` 继续作为可复用层，但不要无限公开细枝末节
- `chat/*` 明确当成 `chatCompat`

也就是说，后面如果继续整理 `context-manager/index.ts`，应更像：

- `contextManager.agent`
- `contextManager.chatCompat`
- `contextManager.shared`

而不是继续把 `agent/chat` 当两个并列的一等长期模式。

### 4.5 `src/agent/testkit/index.ts`

D-1.a 落地职责：

- `createScriptedAiEngineHarness`
- `assertions` namespace（**实际实现**：把 `assertions.ts` 的所有断言函数收进 `assertions` namespace，比平铺函数更稳，避免根入口 surface 漂移）
- `createReplayHarness`
- `createToolContextFixture`

来源：

- [scriptedAiEngineHarness.ts](../../../../../src/agent/testkit/agent-harness/scriptedAiEngineHarness.ts:1)
- [assertions.ts](../../../../../src/agent/testkit/agent-harness/assertions.ts:1)
- [replayHarness.ts](../../../../../src/agent/testkit/context-harness/replayHarness.ts:1)
- [toolContext.ts](../../../../../src/agent/testkit/tool-fixtures/toolContext.ts:1)

---

## 5. 宿主迁移批次建议

> **2026-04-22 实施回填**：
>
> - Batch 0 / 1 / 2 / 3 已完成
> - Batch 4 主体已完成，并把原来最深的 `defaultGraphExecutorContextBuilder` / `defaultToolManager` / `toolRegistry` knot 一并收进公开面
> - 因此这份分批顺序仍是**正确的研究顺序**，但“下一步”不再是机械继续开一个独立 Batch 5；D-2 package-boundary 收尾已经完成

> 这里不按“引用数最多”排，而按“先低风险试压，再碰主链路，最深的结最后拆”排。

### Batch 0：testkit / tests canary

代表文件：

- [graphLoopHarness.ts](../../../../../src/app-hosts/linnya/testkit/agent-harness/graphLoopHarness.ts:1)

为什么先做：

- 不碰生产路径
- 最适合先暴露 exports 缺口

风险：

- 低

依赖：

- `runtime-kernel`
- `testkit`
- `tools`

### Batch 1：tools + realtime + persistence

代表文件：

- [toolRegistry.ts](../../../../../src/app-hosts/linnya/adapters/tools/toolRegistry.ts:1)
- [sse.port.ts](../../../../../src/app-hosts/linnya/adapters/realtime/sse.port.ts:1)
- [sqlite.implementation.ts](../../../../../src/app-hosts/linnya/adapters/persistence/event-store/sqlite.implementation.ts:1)

为什么先做：

- 这批边界最清楚
- 收口收益高
- 改动范围相对小

风险：

- 中低

依赖：

- `runtime-kernel/tools`
- `runtime-kernel/events`
- `runtime-kernel/execution`

### Batch 2：agent-registry + context + context-policies

代表文件：

- [agent-registry/types.ts](../../../../../src/app-hosts/linnya/agent-registry/types.ts:1)
- [GenericAgentTask.ts](../../../../../src/app-hosts/linnya/agent-registry/GenericAgentTask.ts:1)
- [createMessageOrchestrator.ts](../../../../../src/app-hosts/linnya/context/chat/createMessageOrchestrator.ts:1)
- [defaultAgentProviderRegistry.ts](../../../../../src/app-hosts/linnya/context-policies/defaultAgentProviderRegistry.ts:1)

为什么排这里：

- 这批文件多，但多数是浅依赖
- 很适合倒逼 `context-manager` 的公开面先成形

风险：

- 中

依赖：

- `context-manager`
- `ports`

注意：

- 这里会直接碰到 `chat profile` 的历史尾巴
- 要避免把兼容层误公开成长期正式 API

### Batch 3：child-runs + runtime assembly

代表文件：

- [internalAgentInvokerFactory.ts](../../../../../src/app-hosts/linnya/adapters/child-runs/internalAgentInvokerFactory.ts:1)
- [registeredSubagentInvoker.ts](../../../../../src/app-hosts/linnya/adapters/child-runs/registeredSubagentInvoker.ts:1)
- [graphRuntimeFactory.ts](../../../../../src/app-hosts/linnya/adapters/runtime-assembly/graphRuntimeFactory.ts:1)

为什么排中后段：

- 这里是真正的 runtime 构造区
- exports 设计如果不稳，会反复改装配工厂

风险：

- 中高

依赖：

- `tools`
- `llm`
- `graph`
- `childRuns`

### Batch 4：flow

代表文件：

- [flow.host-session.service.ts](../../../../../src/app-hosts/linnya/adapters/flow/flow.host-session.service.ts:1)
- [agentEventBridge.ts](../../../../../src/app-hosts/linnya/adapters/flow/agent-runner/agentEventBridge.ts:1)

为什么后做：

- 这是运行主链
- 前面边界不稳，最后都会在这里集中爆

风险：

- 高

依赖：

- 前几批基本都先稳定

### Batch 5：context injection

代表文件：

- [defaultGraphExecutorContextBuilder.ts](../../../../../src/app-hosts/linnya/adapters/context-injection/defaultGraphExecutorContextBuilder.ts:1)
- [toolContextFactory.ts](../../../../../src/app-hosts/linnya/adapters/context-injection/toolContextFactory.ts:1)

为什么最后拆：

- 这不是最大批，但它是最深的结
- 同时扯着 `chat/agent`、task、tool、llm、builder、provider registry

风险：

- 最高

依赖：

- 几乎依赖前面所有批次

一句大白话：先改边缘和浅层，逼出公开入口；主链路后改；最拧巴的结最后拆。

---

## 6. 当前不该顺手做大的事

### 6.1 不要现在就把 `context-manager` 吹成彻底通用公共层

现实是：

- `agent/*` 里还带任务和产品组织味道
- `chat/*` 还是历史兼容层

所以当前抽包研究里，它更适合被定义为：

- `linnkit` 的内部可复用子系统
- 不是马上承诺给外部任意消费者自由拼装的成熟公共平台

### 6.2 不要把 `@app/schemas` 清理绑到这一拍

这块已经在 [`12-agent-contracts-audit.md`](./12-agent-contracts-audit.md) 里分好类。

优先顺序应该是：

1. 先收口 imports
2. 再决定哪些 agent 合同并回 `linnkit`

不然主线会从“真抽包准备”滑成“顺手做一轮协议大迁移”。

---

## 7. 建议写回实施排序的下一步

现在写回 `engine/07` 的下一步，不该再是旧的“D-1 / D-2 之间怎么启动”，而应是：

1. 承认本文的四层公开入口和分批顺序已经被实际代码验证到 Batch 4 主体
2. 不再机械推进“再开一个独立 Batch 5”
3. 承认过渡期收尾已经走完，PR-J 最终 enforce 已上线
4. 下一步直接进入 D-3 / D-4，并把本文当作 Phase E 前的顺序说明

---

## 8. 当前结论

当前最该继续研究和推进计划的，不是 `linnsec` 功能，而是两件硬事：

1. **公开入口怎么开**
2. **宿主怎么分批脱离 deep import**

如果这两件事不先写清楚，Phase E 还是一句口号。

---

## 9. 状态

- [x] 明确当前主目标仍然是 `agent` 真抽包研究
- [x] 给出四层公开入口建议
- [x] 给出宿主迁移批次建议
- [x] 回填到 `engine/07` 的 D-1 / D-2 实施顺序（已通过 `engine/07 §2.4 / §5.3` 体现）
- [x] **D-1.a/b 已实施**（公开入口 4 层 + `package.json` 草案；commits `1a93fe77` / `e1fb29ed`）
- [x] D-2 package-boundary 收尾完成（本清单顺序已实际验证到 Batch 4，且 PR-J 最终 enforce 已上线）
