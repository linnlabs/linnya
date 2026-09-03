# 02 · 事件管线

> **What** · 一条事实从 Graph 内部产生，到 admission、发布、fan-out，再到 Renderer 消费的完整链路与门禁。
> **When to read** · 新增或修改 RuntimeEvent / SSEEvent、改 realtime adapter、排查事件丢失或串线之前。
> **不变量** · [INV-01](./00-invariants.md#inv-01--runtimeevent-是唯一事实源)、[INV-04](./00-invariants.md#inv-04--身份只有一个提交者)、[INV-05](./00-invariants.md#inv-05--序号命名空间隔离)、[INV-06](./00-invariants.md#inv-06--释放语义分层)、[INV-31](./00-invariants.md#inv-31--请求--流实例作用域并发模型)、[INV-44](./00-invariants.md#inv-44--durable-ui-与-foreground-context-按-routing-identity-隔离)
> **Related** · [01 身份](./01-identity.md) · [03 持久化](./03-persistence.md) · [05 live 投影](./05-live-projection.md)

---

## 1. 转换链路

```text
Graph 内部 AnyAgentEvent
  │  eventMapper.agentToRuntime()
  ▼
RuntimeEvent（草稿：允许暂时没有 run routing identity）
  │  RuntimeEventSink → RuntimeEventPublisher.route()
  ▼
RoutedRuntimeEvent（正式事实：run_id / parent_run_id / lane / visibility 已附着）
  │  EventBus
  ├──────────────┬──────────────┐
  ▼              ▼              ▼
events 表    SSEEvent      observers
（持久化）   （实时 wire）  （audit）

每个 child lifecycle 另建独立 child EventBus
  ├─ child EventStore persistence
  └─ ChildRunParentTraceProjection
       └─ 映射为 subrun_trace → parent RuntimeEventPublisher → parent EventBus
```

child EventBus 不是 parent EventBus 的 fan-out 下游。父子之间只通过 `ChildRunParentTraceProjection` 发布新的 parent `subrun_trace` 投影事实；原始 child fact 不进入 parent bus 或 Conversation 正文。

### 1.1 两个类型不可混用

| 类型 | 含义 | 谁可以接收 |
|---|---|---|
| `RuntimeEvent` | admission 前的草稿 | mapper、sink 入口 |
| `RoutedRuntimeEvent` | 已完成 run admission 的正式事实 | EventBus、EventStore、replay、Renderer wire 投影 |

Provider / Agent mapper **永远只创建草稿**，不接收 routing identity。可执行 Graph 必须由装配层注入 `RuntimeEventSink`，并且**只把 sink 返回的** `RoutedRuntimeEvent` 放入 journal。

root、child、detached、quickstart 与 testkit 遵守同一规则（[INV-04](./00-invariants.md#inv-04--身份只有一个提交者)）。禁止通过 `TickOutput.newEvents`、collector 或执行结束遍历 Graph result 维护第二事件通道。

> 教训：测试装配不能拥有另一套协议。旁路通过只说明旁路可用，不能证明生产主链正确。

### 1.2 唯一出口原则

所有实时事件必须经由 publisher → EventBus → realtime adapter 单一路径。**禁止**在 graph node / tool / bridge 中直接构造 SSE DTO 或调用 transport sink。

暂停协议不构成例外：`requires_user_interaction` 也必须先成为一份标准 RuntimeEvent。

transport acknowledgement / progress / completion 必须明确标为**非事实信号**，不能伪装成另一份 RuntimeEvent。

---

## 2. 共享合同是唯一协议定义

Host 与客户端可以独立实现投影、传输和持久化，但不能各自定义事件 DTO。统一从 `@linnlabs/linnkit/contracts` 导入：

| 合同 / 函数 | 位置 | 用途 |
|---|---|---|
| `RuntimeEvent` / `RoutedRuntimeEvent` / `EventEnvelope` / `SSEEvent` | 独立 Linnkit 仓的 `src/contracts/events.ts`、`sse.ts` | wire 与事实定义 |
| `routeRuntimeEvent()` | `contracts/events.ts` | 草稿 → 正式事实的唯一 admission 操作 |
| `parseRoutedRuntimeEvent()` | `contracts/events.ts` | 不可信边界校验 |
| `parseRuntimeEventRoutingIdentity()` | `contracts/events.ts` | 读取正式身份的唯一方式 |
| `runtimeEventToSSEEvent()` | `contracts/sse.ts` | 标准 RuntimeEvent → SSEEvent 映射 |
| `validateSSEEvent()` | `contracts/sse.ts` | SSE 入口校验 |

`parseRuntimeEventRoutingIdentity()` **只接受顶层** `run_id / parent_run_id / lane / visibility`。禁止从 `metadata.run_id`、`metadata.run_context` 或 `turn_id` 猜身份。缺少正式身份代表 publisher / admission 边界被绕过，应直接失败。

EventBus 缺少正式 `run_id / lane / visibility` 时必须**拒绝 fan-out**，不能只记日志后继续分发。

### 2.1 TypeScript 类型不是校验

类型只在编译期有效。Provider JSON、HTTP SSE、IPC、数据库 payload 和插件输入进入可信代码前必须执行共享 Zod schema 校验。`value as SSEEvent` 不能替代 `parse`（[INV-17](./00-invariants.md#inv-17--strict-schema-必须在真实边界执行)）。

### 2.2 浏览器边界

| 入口 | 环境 | 前端可用 |
|---|---|---|
| `@linnlabs/linnkit/contracts` | Browser-safe | ✅ Zod 合同与 schema |
| `@linnlabs/linnkit/runtime-kernel/events` | Browser-safe | ✅ 事件治理纯函数 |
| `@linnlabs/linnkit/runtime-kernel` | **Node-only** | ❌ 会把 `node:async_hooks` / `crypto` 拖进前端 bundle |

需要生命周期判断时优先用更窄的 `/runtime-kernel/events`。不要为省 bundle 体积复制 interface 或退回类型断言。

---

## 3. 序号命名空间（[INV-05](./00-invariants.md#inv-05--序号命名空间隔离)）

两类 `seq` 属于**不同命名空间**，混用会导致答案正文乱序或丢块：

| 序号 | 含义 | 映射到 SSE |
|---|---|---|
| `EventEnvelope.seq` | 单次 execution 内**所有**事件的全局顺序 | `execution_seq` |
| `final_answer_chunk.seq` | 单个答案**内部**从 `0` 开始的连续分块序号 | `seq` |

realtime adapter 不得用前者覆盖后者。MessageProjection 只按答案内部 `seq` 拼接正文。

---

## 4. 事件语义（哪些事件表示什么）

| 事件 | 表示 | 不表示 |
|---|---|---|
| `tool_call_decision` | 模型提交了调用清单 | 调用已开始 |
| `tool_process(start)` | 单个调用实际启动 | durable 结果（只服务实时过程） |
| `tool_output` | 每个调用的 durable 终态结果 | — |
| `requires_user_interaction` | 后端已正式进入等待态 | — |
| `final_answer_chunk` | 答案正文增量 | 封口 |
| `final_answer` | 答案封口事实 | 正文的唯一来源（正文必须先有 chunk） |
| `run_status` | RunRegistry 权威业务状态 | transport 状态 |
| `context_usage_snapshot` | 每次成功 LLM Prompt 的 ephemeral 上下文占用快照 | 工具完成、计费用量或 durable reload 事实 |
| `run_execution_metrics` | 本次 execution 的 durable 结算统计；可携带最近成功 Prompt 的 `context_usage` | 工具生命周期、累计成本、控制态 |
| `transport_end` | 当前网络连接关闭 | run 结束 |

`context_usage_snapshot` 的频率由成功的 **LLM Prompt** 决定，不由工具事件决定。一次 Prompt 即使返回多个
tool calls 也只产生一条快照；工具执行结束后，下一次 Prompt 成功才产生下一条。它与最终 metrics 共用同一份
`ContextUsageSnapshot` 合同，但生命周期不同：前者只服务 live，后者负责持久化与 reload 收敛（[INV-60](./00-invariants.md#inv-60--上下文占用的实时快照与结算事实分层)）。

Graph 在测量后、调 Provider 前执行 `admit_prompt_capacity`。`used_tokens > input_budget_tokens` 时该 attempt 以 `llm.prompt.input_budget_exceeded` 结束，候选测量不发布为 `context_usage_snapshot`。

### 4.1 run 与 transport 是两种生命周期

同一逻辑 run 可以经历多个 execution 与多次 HTTP/SSE transport。

- `run_status` 更新权威业务状态。
- `transport_end` 只释放同 `executionId` 的 controller。
- `awaiting_user` 仍为 busy，输入区保持"终止"，切换会话也不取消它。
- resume 沿用 `run_id` 并分配新 `execution_id`。

释放级别不可混用（[INV-06](./00-invariants.md#inv-06--释放语义分层)）：`transport_end` 清 execution，terminal `run_status` 清 run。一个 execution 结束不得删除同 conversation 的其它 run。

HTTP、reader 和缺少 `transport_end` 的 EOF 只是 **transport failure**，禁止在前端伪造 RuntimeEvent `error` 或 run 终态。

### 4.2 transport outcome 与投影回调边界

Renderer transport owner 对 reader 的唯一正式收口是判别联合 `ConversationTransportOutcome`：

| outcome | 含义 |
|---|---|
| `ended` | 收到正式 `transport_end`，本次连接正常结束 |
| `failed` | client 的 `http/network/protocol/projection` failure，或 server `transport_error` |
| `interrupted` | 本地明确中止本次连接 |

顺序固定为：停止读取 → `reader.cancel/releaseLock` → 再调用业务回调并交付 outcome。SSE 解析、协议校验、
消息投影和上层回调属于不同失败边界；projector/callback 抛错不能被 reader 循环重新包装成网络或协议错误，
回调也不能在 reader 尚未释放时反向等待 run 结算。

`failed` outcome 只说明 transport 无法证明 run 最终状态。Conversation 编排必须按本次请求已捕获的
`conversation_id + run_id` 查询 Host 结算快照，不能读取切换后的 active conversation，也不能合成
`run_status/error` 事件。精确结算协议见 [08 §3.5](./08-lifecycle.md)。

---

## 5. lane 与 visibility（[INV-44](./00-invariants.md#inv-44--durable-ui-与-foreground-context-按-routing-identity-隔离)）

并发 Agent 必须显式声明投影边界。**lane 决定控制权，visibility 决定消息是否可见**，二者都不能靠 promptKey 或事件内容猜测。

| 用途 | lane | visibility | 进正文？ | 进 foreground context？ |
|---|---|---|---|---|
| 对话正文 run | `foreground` | `conversation` | ✅ | ✅ |
| 自动标题 / 摘要等辅助 run | `auxiliary` | `none` | ❌ | ❌ |
| child run 事实 | `child` | `parent-trace` | ❌（只经 parent `subrun_trace` 展示） | ❌ |

Conversation 主 read model、foreground Agent history、用户消息计数和预览**只**消费 `lane=foreground / visibility=conversation`。

child fact 先进入独立 child EventBus/EventStore；父级 `subrun_trace` 只是通过 `source_event_id` 关联的展示 read model（[INV-26](./00-invariants.md#inv-26--subrun-是投影不是第二事实源)）。

---

## 6. Host incoming fact：durable-first

用户输入、HITL interaction response 等由 Host 接纳的事实，走**与 Agent 生成事实相反**的顺序：

```text
客户端 command（不是事实）
  │
  ▼
run admission → publisher.route() 得到正式事实
  │
  ▼
admission transaction 内 durable commit    ← 先落盘
  │
  ▼
publishRouted() fan-out                     ← 后广播
  │
  ▼
向 persistence consumer 登记"已提交"（避免重复写）
```

对比：

| | Agent 生成事实 | Host incoming fact |
|---|---|---|
| 顺序 | publish → 持久化与实时平级消费 | 先 durable commit → 再 fan-out |
| 入口 | `publisher.publish()` | `publisher.route()` + `publishRouted()` |

客户端只发送 command，不创建"已提交"的 RuntimeEvent（[INV-03](./00-invariants.md#inv-03--事实身份只在-durable-commit-后成立)）。

HITL 的 `tool_output` 由 `src/app-hosts/linnya/adapters/flow/interactive-run/functions/buildInteractionResponseIncomingEvent.ts` 唯一转换。`FlowOrchestrator` 只编排 claim、persist、activate 与 runner dispatch，不手写 tool output 或 interaction payload。

**成功 transport 必须已有用户输入 ack**：持久化 run 如果执行结束仍未收到 ack，属于协议破坏并显式失败。不得把 transport end 当成 commit，不得静默补造 header。重复 ack 同样显式失败。

---

## 7. Renderer 侧：请求级路由（[INV-31](./00-invariants.md#inv-31--请求--流实例作用域并发模型)）

`features/realtime-event-routing/` 为每次 `invokeAssistant` 创建**独立 router**，持有本请求的：

- `AbortSignal`
- conversation 一致性校验
- event id 去重
- turn 陈旧判定
- lane / visibility 门禁
- 用户交互等待门禁

编排层把 `assistantStore.handleSseEvent` 作为 `ConversationEventDispatcher` **显式注入**。纯编辑器请求不注入端口，继续消费专用 callback。

禁止：模块全局 handler、setter、初始化开关、"启用但未注册"的半状态、active conversation fallback。

### 7.1 会话 ID 一次性捕获

聊天编排在用户动作发起时捕获 `conversationId`，任何 `await`（上下文 / 保存 / 配额）之后**只能按该 ID 解析目标会话**，禁止重读 `activeConversation`。

否则切换侧栏会把用户消息与 SSE 投影拆到不同会话。

### 7.2 编辑重发的固定顺序

```text
取消旧流 → 截断旧尾部 → 启动新请求
```

旧请求必须在任何本地截断前失去事件写入资格。请求提交后不得由前端猜测后端状态并恢复旧尾部；失败通过标准错误事件呈现并允许用户重试。

### 7.3 五类输入严格区分

| 输入 | 职责 |
|---|---|
| RuntimeEvent | 消息事实 |
| `context_usage_snapshot` | 运行中最近成功 Prompt 占用投影；ephemeral，不提供 reload |
| `run_execution_metrics` | 工作统计与最终最近成功 Prompt 占用投影；durable，负责 reload 收敛 |
| `run_status` | 控制态驱动 |
| `transport_end` / `transport_error` | 网络请求收敛 |

任一类都不能代替另一类。

---

## 8. 变更门禁

新增或修改事件时必须**同时**完成，缺一即合同回退：

1. 使用共享 schema 校验 wire，不在 Conversation definitions 复制 RuntimeEvent / SSEEvent DTO。
2. 在请求级 router 明确 conversation、turn、lane、visibility 与 awaiting-user admission；不得把校验塞进 Vue 组件或 store fallback。
3. 在 messageProjection 纯函数中按完整 scope 投影；控制信号留在 interactive-run，不伪装成正文消息。
4. 后端 read model 与前端 live projection 使用同一组**业务 fixtures** 做 parity，但保留两套独立实现（[INV-02](./00-invariants.md#inv-02--messageprojection-是唯一投影体系)）。
5. 覆盖实时增量、历史重载、同会话并发 run、wait-user resume、切换会话和失败传播；只测字段或组件快照不构成门禁。
6. 涉及 Host、虚拟列表、Teleport、OverlayScrollbars 或导航时序时运行真机导航门禁（见 [11 测试](./11-testing-gates.md)）。
7. 同步更新本目录文档；禁止用临时审计、日志说明或代码注释代替长期合同。
8. 凡是 Renderer 必须读取才能路由、归并、判断生命周期或选择副作用目标的值，必须来自共享 schema 的正式字段（[INV-16](./00-invariants.md#inv-16--metadata-不是控制面)）。
9. 修改跨端字段前先写清 owner 与生命周期：Runtime 路由身份属于 Linnkit 顶层字段；HTTP command 身份属于 API DTO；Conversation message 字段属于 `@app/schemas` read model。禁止为了少传一次参数把字段复制进 metadata、payload、store 或另一条事件。
10. 业务门禁必须穿过生产实现：涉及 durable UI read model 的改动至少使用真实 `SQLiteEventStore`，同时断言 committed Runtime fact、SQLite UI row、live SSE 与 reload DTO。只使用 MemoryEventStore、mock persistence port 或字段快照不能证明主链正确。

---

## 9. Host 的自由度与边界

Host 特有的**非控制展示信息**可以在官方投影之后追加到 `SSEEvent.meta`，但：

- 不得回流到 Linnkit kernel。
- 不得把 routing、identity 或生命周期字段藏入开放 meta。

如果 host 选择使用 `SSEEvent` wire DTO，`RuntimeEvent → SSEEvent` 的字段翻译必须复用 `runtimeEventToSSEEvent()`，不要手写第二套 mapper。

Linnkit **不规定** SSE / WebSocket / MQTT 的传输形态——不同部署形态天差地别。它只规定字段语义与发布链路。
