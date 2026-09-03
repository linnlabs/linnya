# Glossary · 术语对照

> **What** · 术语对照表 —— `Checkpoint` / `Event` / `Fence` / `Run` / `Trace` / `Tokenizer` 等同名异义概念在 linnkit 各处的精确含义。
> **When to read** · 看文档时被术语搞混；review 接入实现时需要对齐措辞；多人协作 / PR review 前对齐术语。
> **Prerequisites** · 无。
> **Key exports** · 无（本文是术语表）。
> **Related** · [`constraints-and-pitfalls.md`](./constraints-and-pitfalls.md) · 所有 §7.2 单点接入文档

agent 生态有几个名字相同语义不同的概念，第一次踩坑后才会意识到。先记住这几条。

## 1. `Checkpoint` 只表示执行状态快照

上下文压缩曾经也使用 Checkpoint 这个名字，容易与 Graph 状态恢复混淆。当前术语已经收口：

| 维度 | **Engine-state Checkpoint** | **Automatic Context Compaction** |
|---|---|---|
| 接口 | `Checkpointer` port（`@linnlabs/linnkit/runtime-kernel`） | `AgentSpec.contextPolicy.compaction` + Context Manager / Graph 内部合同；不是 LLM tool |
| 存什么 | `EngineState`：`nodeId / pendingToolCalls / local` | 唯一 durable `history_summary` 事实及其 `replacedMessageIds` |
| 谁触发 | `GraphExecutor` 在循环内自动 save / load | Graph 根据最终 Prompt 占用自动触发，使用本 run 已锁定的当前模型 |
| 解决什么 | 执行控制：中断恢复、为长 run / 异步 run 铺路 | 上下文工程：替换旧的模型可见历史，同时保留 durable 原始事件 |
| 落到哪 | 你提供的 `Checkpointer` 适配器（SQLite/Redis/文件……） | Host 的 RuntimeEvent 持久化链；成功提交后进入后续 context build |
| 是否影响步数预算 | 否 | 否；压缩不重置 Graph step |

接入时**绝对不要**把这两件事混到一起：

- 实现 `Checkpointer` adapter 时，**只**要能 save/load `EngineState` 就够了。不要试图在里面塞"摘要 / 对话压缩"语义。
- 想调整"对话太长时如何压缩"，配置 `contextPolicy.compaction`，并遵守 Context Manager 纯计划 / Graph 执行与提交的单一主链；不要定义上下文 checkpoint 工具、marker、专用摘要 Agent 或第二套设置。
- 旧 `context_checkpoint` 工具、step reset 与相关字段已直接删除，不提供兼容读取。当前完整合同见 [`context-engineering.md`](./context-engineering.md)。

## 2. "Event" 的三层

| 名字 | 所在层 | 用途 |
|---|---|---|
| `AnyAgentEvent` | runtime-kernel 内部领域事件 | graph node 内部产出的原始事件 |
| `RuntimeEvent` | runtime-kernel → host 持久化事件 | 持久化、上下文重建、history 回放的事实来源 |
| 实时通道事件（如 SSE）| host realtime adapter | 前端实时渲染（**接入方自己负责**）|

`RuntimeEvent` 持久化由你的 `EventStore` adapter 落地；实时推送由你自己的 realtime adapter 决定。linnkit 不规定这一层。

## 3. "Fence"

| 维度 | 说明 |
|---|---|
| 什么是 fence | host 自定义的"上下文围栏家族"，把不同来源的上下文（项目元数据 / 长记忆 / 系统事件 / 子 agent 摘要 / 用户引用 / ……）按 placement + lifetime + role 组织，注入到 LLM 不同位置 |
| 谁拥有 fence kind 的命名 | host（kebab-case，如 `memory-context` / `system-event`）|
| linnkit 提供什么 | `FenceDescriptor` 声明 schema、`FenceRegistry` 容器、`FenceLifetimePreprocessor` 生命周期清理、`MustKeepPolicy` 必保留判定、`context_injection` 这类 `AiMessage.type` 稳定载体 |
| host 提供什么 | descriptors（fence 家族定义）+ injections adapter（请求字段 → `FenceInjection[]`）+ 起码一个 `FenceRegistry` 实例供 orchestrator/formatter 共用 |
| 为什么这么设计 | 同一套 host 适配能支持任意"项目上下文 / 文档片段 / 长记忆 / 子 agent 摘要 / 系统事件"的混搭，框架不需要任何改动 |

## 4. "Run" / "Turn" / "Conversation" / "Trace"

| ID | 语义 | 谁拥有 |
|---|---|---|
| `runId` | 一次 agent 执行的唯一 id；从注册到终态（completed/failed/cancelled/awaiting_user/paused）有完整生命周期 | linnkit RunSupervisor（host 可在 register 时显式传入对齐自己的 `turnId`）|
| `turnId` | host 概念：一次用户输入 → 一次 agent 回答 的轮次 id | host |
| `conversationId` | host 概念：一段连续对话 id（一个 conversation 含多个 turn / run）| host |
| `traceId` | 可选：跨服务/跨进程追踪 id（如 OpenTelemetry trace id）| host |
| `parentRunId` | 当前 run 的父 run id（同步 child-run / detached spawned run 都会用）| linnkit RunSupervisor |
| `checkpointKey` | Graph EngineState 的物理索引；独立 run 必须使用稳定 runId，不能使用 conversationId | host graph orchestration |
| `executionId` | 一次 transport/EventBus 的序列作用域；同一 run 在 HITL 恢复前后可以有不同 executionId | host realtime layer |

**推荐做法**：由 Host admission 显式确定 `runId`，需要与 `turnId` 相同可以直接传入，但不能依赖两者相等。正式归属只写 `RuntimeEvent.run_id`；EventStore 和 `RunHandle.observe({ includePersisted: true })` 都按该顶层字段 replay，禁止读取 `metadata.run_context` 或用 `turn_id` fallback。

`awaiting_user` 是 run 非终态，不是“本次 SSE 已结束”的同义词。一次 HITL 的稳定身份是 `runId + interactionId + toolCallId + checkpointRevision + resumeToken`；恢复继续原 run，transport 可以更换 executionId。

## 5. "Subrun" / "Child-run" / "Internal Agent"

linnkit 0.5.0 起统一术语：

| 概念 | 用什么 |
|---|---|
| 父 agent 调用子 agent 这件事 | **child run**（公开 namespace：`runtimeKernel.childRunTrace`）|
| 子调用的观测协议（前端 trace UI 用）| 事件 type 仍叫 `subrun_trace`（向后兼容）|
| 子调用的"调用器"组件 | `ChildRunInvoker`（内部代码命名）|

**不要**在新代码里用 `subrun` 或 `internalAgent` 作为新命名——它们是历史遗留。
