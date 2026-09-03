# Realtime · 实时通道（Host 完全自有）

> **What** · 实时通道（SSE / WebSocket / IPC）接入 —— `RuntimeEvent` 经官方 mapper 投影为 `SSEEvent`，Host 可在其后追加自己的 wire/meta enrichment；客户端用 browser-safe events seam 做事件治理决策。
> **When to read** · 要把 agent 进度推到前端；做 daemon ↔ renderer IPC；做 Web SSE；想知道"哪些事件该回放给 UI / 哪些只该写 EventStore"。
> **Prerequisites** · [`02-quickstart.md`](./02-quickstart.md)；浏览器使用规则见 [`README §5`](./README.md)。
> **Key exports** · `RuntimeEvent` / `RoutedRuntimeEvent` / `EventEnvelope` / `SSEEvent` / `runtimeEventToSSEEvent` from browser-safe `@linnlabs/linnkit/contracts` · `shouldReplayRuntimeEventToUi` / `shouldEmitRuntimeEventToSse` / `getRuntimeEventUiProjectionKind` from browser-safe `@linnlabs/linnkit/runtime-kernel/events`。
> **Related** · [`runtime-identity.md`](./runtime-identity.md) · [`audit.md`](./audit.md) · [`persistence.md`](./persistence.md) · [`constraints-and-pitfalls.md`](./constraints-and-pitfalls.md)

`@linnlabs/linnkit` **不规定** SSE / WebSocket / MQTT 的传输形态——不同部署形态（HTTP server / Electron IPC / 内嵌 RPC）天差地别。但如果 host 选择使用 `SSEEvent` wire DTO，`RuntimeEvent → SSEEvent` 的字段翻译必须复用 `runtimeEventToSSEEvent()`，不要在 host 里手写第二套 mapper。

但有两条**铁规**：

1. **唯一出口原则**：所有实时事件必须经由你自己的 RuntimeEvent publisher → EventBus → realtime adapter 单一路径推给前端。**禁止**在 graph node / tool / bridge 中直接构造 SSE DTO 或调用 transport sink。暂停协议不构成例外；`requires_user_interaction` 也必须先成为一份标准 RuntimeEvent。
2. **生成事实不要绕过 EventBus**：会导致 seq 断裂、实时与持久化分叉。transport acknowledgement / progress / completion 必须明确标为非事实信号，不能伪装成另一份 RuntimeEvent。

同一逻辑 run 可以经历多个 execution 与 HTTP/SSE transport。`run_execution_metrics` 记录本次 execution 的 durable 结算事实，`run_status` 投影 RunRegistry 权威状态，`transport_end` 只关闭当前连接。`awaiting_user` 等非终态 run 必须保留，resume 沿用 `run_id` 并分配新 `execution_id`。

Prompt 上下文占用有意拆成两层：Graph 每次成功 Provider attempt 通过既有 RuntimeEventSink 发布 ephemeral
`context_usage_snapshot`，供实时 UI 提高刷新频率；execution settlement 最多发布一条 durable
`run_execution_metrics.context_usage`，供 EventStore/reload 最终收敛。失败、取消或被 `admit_prompt_capacity` 拒绝的 attempt 不发布候选快照。频率按成功
Prompt 计算，不按工具事件计算：一次 Prompt 返回多个 tool calls 仍是一条快照，工具完成后的下一次 Prompt 成功才再次更新。
自动 compaction 的内部模型调用只进入 token ledger 与 `context_compaction` / `llm_call` telemetry，不生成 `context_usage_snapshot`；该快照始终只代表成功提交给主 Provider 的 Agent Prompt。

Host 的 cancel command 必须按精确 `run_id` 读取持久身份，并等待该 execution 的事实 drain 与
Host finalize。cancel 与自然 `completed/failed` 同时发生属于合法终态竞争；Host 应返回竞争后的
真实 terminal status，不能因为 run 已从 active 列表消失就返回冲突。不存在的 run、错误的
conversation 归属或 child/root 身份错误仍必须拒绝，不能把幂等扩大成无条件成功。

并发 Agent 还必须显式声明投影边界：foreground 正文用 `lane=foreground / visibility=conversation`；标题等不应进入正文的辅助 run 用 `lane=auxiliary / visibility=none`。自动 compaction 不是辅助 run，它继承当前 root 或 child execution 的 routing identity，仅把内部 LLM 调用标记为 `phase=context-internal / purpose=context_compaction`。lane 决定控制权，visibility 决定消息是否可见，二者都不能靠 promptKey 或事件内容猜测。

## 1. 事件转换链路

```text
Graph 内部 AnyAgentEvent
  │  eventMapper.agentToRuntime()
  ▼
RuntimeEvent
  │  RuntimeEventSink → RuntimeEventPublisher（run admission）
  ▼
RoutedRuntimeEvent
  │  EventBus
  │  shouldEmitRuntimeEventToSse(event)
  │  runtimeEventToSSEEvent(event)
  ▼
SSEEvent / WS message / IPC payload
```

Host 特有的非控制展示信息可以在官方投影之后追加到 `SSEEvent.meta`，但不得回流到 Linnkit kernel，也不得把 routing、identity 或生命周期字段藏入开放 meta。

### 1.1 共享合同是唯一协议定义

Host 与客户端可以独立实现投影、传输和持久化，但不能各自定义一份事件 DTO。以下合同统一从 `@linnlabs/linnkit/contracts` 导入：

- `RuntimeEvent`：事实草稿；允许在 publisher 前暂时没有 run routing identity；
- `RoutedRuntimeEvent`：已完成 run admission 的正式事实；EventBus、EventStore 和 replay 只能接收该类型；
- `EventEnvelope`：单次 execution 内的发布顺序与 trace；
- `SSEEvent`：实时 wire DTO，与底层使用 SSE、WebSocket 或 IPC 无关；
- `runtimeEventToSSEEvent()`：标准 RuntimeEvent 到 SSEEvent 映射；
- `validateRuntimeEvent()` / `validateSSEEvent()`：不可信边界的运行时校验。

TypeScript 类型只在编译期有效。Provider JSON、HTTP SSE、IPC、数据库 payload 和插件输入进入可信代码前必须执行共享 Zod schema 校验；`value as SSEEvent` 不能替代 parse。

`routeRuntimeEvent()` / `RuntimeEventPublisher.route()` 是从草稿到正式事实的唯一 admission 操作，`parseRoutedRuntimeEvent()` 用于不可信边界校验。EventBus 缺少正式 `run_id / lane / visibility` 时必须拒绝 fan-out，不能只记录日志后继续分发。

`@linnlabs/linnkit/contracts` 是 browser-safe 合同入口。浏览器客户端不得 import Node-only 的 `@linnlabs/linnkit/runtime-kernel`；生命周期纯函数从 browser-safe 的 `@linnlabs/linnkit/runtime-kernel/events` 导入。

### 1.2 两类序号禁止混用

`EventEnvelope.seq` 与具体事件携带的 `seq` 属于不同命名空间：

- `EventEnvelope.seq` 是单次 execution 内所有事件的全局顺序；映射到标准 SSE DTO 时使用 `execution_seq`。
- `final_answer_chunk.seq`、`markdown_chunk.seq` 是各自流内部的业务序号；必须原样保留，不能被 realtime adapter 重写。

realtime adapter 在官方 mapper 之后只能写 `execution_id / execution_seq / run_id / lane / visibility` 等宿主归属字段。禁止把 `EventEnvelope.seq` 写回 `SSEEvent.seq`：答案投影依赖 chunk 从 `0` 连续递增，覆盖后会让实时答案永远等待不存在的首块，而持久化的完整 `final_answer` 只能在重新加载历史时出现。

### 1.3 身份字段与 owner

身份的唯一性作用域、等值关系与禁止替代以 [`runtime-identity.md`](./runtime-identity.md) 为唯一完整规范；本节只保留实时链路速查。

| 字段 | 唯一语义 | owner | 约束 |
|---|---|---|---|
| `id` | 单个 RuntimeEvent 的稳定 ID | 事实创建者 | 实时、持久化和重放不变 |
| `conversation_id` | 产品会话聚合根 | host conversation orchestration | 禁止用 active conversation fallback |
| `run_id` | 一次逻辑 run | RunSupervisor | start / wait / resume 全程稳定 |
| `parent_run_id` | 父子 run 关系 | RunSupervisor / child-run orchestration | 不得藏出多个 metadata 变体 |
| `execution_id` | 一次实际执行或 transport 尝试 | EventSequencer / host session | resume 必须产生新值 |
| `turn_id` | 对话轮次事实分组 | host conversation orchestration | 不得用 step count 推断 |
| `user_message_id` | Host 产品 read model 中触发 execution 的用户事实 | host conversation orchestration | 可选正式绑定；客户端不得按 turn 或 active message 猜测 |
| `answer_id` | 一个答案 segment；也是该段 final fact 与 UI message 的稳定身份 | streaming adapter；非流式终答创建边界 | 新 `final_answer.id === answer_id`；mapper、node、host 只透传 |
| `summarization_id` | 一次 SSE-only 压缩进度 presentation；引用 start event ID | Host compaction progress adapter | start 满足 `id === summarization_id`；end/error 原样透传并保持同一 run/execution |
| `final_answer_chunk.seq` | 单答案 segment 内顺序 | streaming adapter；非流式终答创建边界 | 从 0 连续；下游只验证，不改写 |
| `final_answer.completion_reason` | segment 封口原因 | LLM / Tool node 的事实创建边界 | `terminal`、`tool_call`、`interrupted`；下游只读 |
| `tool_call_id` | 工具 decision/process/output 关联键 | provider 或 host tool bootstrap | 全链稳定 |
| `interaction_id` | 一次 wait-user 请求 | wait-user fact creator | resume 原样回传 |
| `subrun_id` | child run 的父级展示身份 | child lifecycle orchestration | parent trace 全程稳定 |
| `source_event_id` | parent trace 对应的 child RuntimeEvent ID | child→parent trace projector | 一个 trace 项只对应一个 source fact |

核心身份必须进入共享 schema 的正式字段，不能长期依赖开放 `metadata` 承载。目标合同中，`execution_id` 属于 EventEnvelope 并投影到实时 DTO，`run_id / parent_run_id` 属于逻辑事实归属。host 特有展示信息才放 `metadata` 或 `meta`。

这条规则不只约束“身份”这个名字。任何消费者为了正确路由、归并、判断生命周期或选择副作用目标而必须读取的值，都属于关键操作语义：通用协议字段应进入共享 contracts；产品 workflow 的业务绑定应在启动前从已校验 DTO 建立显式映射，并通过正式事件 ID 查找。开放 `metadata/meta` 只能承载删除后不影响业务正确性的展示、诊断或附加材料，不能成为隐式控制面。

事实创建边界的 TypeScript 契约也必须与该表一致。Linnkit 的 `FinalAnswerEvent.answer_id`、`StreamChunkEvent.answer_id` 和 `StreamChunkEvent.seq` 是必填字段；mapper 只验证和透传，缺失时立即失败，不生成临时身份或默认序号。

所有用户可见 assistant 文本共用一条实时协议：`final_answer_chunk` 负责 live 正文，完整 `final_answer` 负责 durable 事实和 live 封口。封口事实必须携带 `completion_reason`：`terminal` 才是 run 的终态交付，`tool_call` 是工具调用前的可见播报，`interrupted` 是异常或取消时封存的未完成段。非流式 LLM 或工具终答必须由 Graph 事实创建边界先发布 `seq=0,is_last=true` 的 one-shot chunk；Host 与客户端禁止从完整答案或 `tool_output` 补造缺失的 live 正文。客户端从首个 chunk 起就必须以稳定 `answer_id` 归并该 segment；seal 验证 `final_answer.id === answer_id` 及正文一致性，只修订同一实体。

压缩进度与摘要事实也必须分开。`summarization_start/end/error` 是 SSE-only Host signal，三者共享正式 `summarization_id + run_id + execution_id + turn_id`；end 还必须携带 `summary_id`，且它严格等于本次已提交的 `history_summary.id`。end 的统计字段固定为 `original_message_count / compressed_message_count / compression_ratio`，比例是 `0..1` 数值。`history_summary` 才是 durable fact，其 `original_message_count` 是事实创建时必填的数据，SSE、存储或客户端不得根据 replaced IDs 或默认值猜测。

Context Manager 只做压缩计划、固定格式校验和 pending summary draft。重建 Prompt 通过容量接纳后，Graph 的 `commit_context_compaction` 必须先调用 Host `RuntimeEventCommitPort` 完成 routing admission、durable persistence 与 ack，且不 fan-out；成功后才允许 callback 发送 `summarization_end`，再由既有 RuntimeEvent sink / publisher 发布同一 `history_summary`。EventBus persistence consumer 按 fact ID 去重，不能重复写库。Host callback 不得发布 RuntimeEvent 或持久化。Context Manager、Graph Engine 与 Host 间的 presentation 回调只允许导入 `packages/linnkit/src/contracts/summarization.ts` 的 `SummarizationCallbacks`，不得复制成 `unknown` 或开放对象。commit 失败必须形成 `start → error`，不得出现 end、摘要 fact 或主模型调用；commit 成功后摘要不可回滚，也不得再上报 `summarization_error` 或 `llm.context.compaction_failed`。生产 Host callback 必须 no-throw，progress transport 失败只记录日志；非标准 RuntimeEvent sink 若在后续 fan-out 抛错，execution 可以失败，但已提交摘要必须保留。标准 execution settlement 只为 commit 前的压缩失败根据 `llm.context.compaction_failed` / `llm.context.compaction_insufficient` 最多结算一份 error fact。客户端不得把 progress 伪装成 history summary，也不得按最新消息猜 end/error 归属。

### 1.4 一个事实、一个 publisher

标准发布链是：事实创建者构造一次 RuntimeEvent，经唯一 publisher 生成 EventEnvelope，再由 EventBus fan-out 给 realtime、persistence、run feedback 和 observability。

需要 durable history 的 execution 使用 `EventBusEventPersistence` 订阅同一个 EventBus：它按发布顺序串行写入注入的 EventStore，跳过 ephemeral 事件，并由 `drain()` 在 lifecycle 进入终态前传播首个写入失败。root 与 child 不得各自复制 persistence queue；EventStore cursor 由宿主注入的单一 `nextEventStoreId` owner 生成。

自动 compaction 的 `history_summary` 是唯一例外的时序要求，不是第二条事实链：Graph 在 publisher fan-out 前调用 `RuntimeEventCommitPort(event, source)`，Host 复用同一有序 persistence 队列完成 routing admission 与 durable commit，但不发送 EventEnvelope；随后 publisher fan-out 同一 fact，persistence consumer 按 fact ID 识别已提交记录并跳过重复写入。这样 realtime 永远不会先于数据库看到摘要，同时仍只有一个事实 ID 和一个 publisher。

Linnkit 已提供 `RuntimeEventPublisher`：构造时绑定同一次 execution 的 `EventBus`、`EventSequencer` 与 `RuntimeEventRoutingIdentity`；`publish()` 会返回附着正式身份后的 RuntimeEvent，并把同一对象放入 envelope。Graph execution journal 和 Host 消费方必须使用这个返回值，不能再自行映射一份平行对象。

Provider / Agent mapper 的输出必须停留在 `RuntimeEvent` 草稿。mapper context 只能补充普通 metadata，不得携带 `routingIdentity`；Graph local 也不得保存 routing identity。`RuntimeEventSink` 是 Graph 的必需 admission port，返回值必须是 `RoutedRuntimeEvent`，Graph journal 只能记录这个返回值。缺少 sink 时应在执行边界失败，不能给 standalone、child 或测试环境发明默认节点级 fallback。

root Host 通常以 `RuntimeEventPublisher` 实现 sink；child orchestration 以显式 child admission sink 附着 child identity，再把 routed fact 可选投影为 parent trace。quickstart 与 testkit 也必须在装配层建立 sink：callback、MemoryEventStore 和 observer 都是 EventBus 的平级消费者，禁止执行结束后遍历 Graph result 补发或补写。

`RuntimeEvent` 基础 schema 允许 host 绑定前的草稿事实暂时没有 routing identity；进入 execution publisher 后，`run_id / lane / visibility` 是强制字段。自动 compaction 的 Context Manager 会创建 pending `history_summary` draft，但只有 Graph 的 commit stage 能把它交给当前 execution publisher；这不代表实时或持久化主链可以缺少身份。

Host 如果需要给 Graph、工具上下文、自动 compaction 和 execution settlement 统一补充 `activity`、`runtime_trace` 等扩展材料，应在 publisher 前注入一个 execution-scoped sink。该 sink 只能合并不参与路由的 metadata；正式 routing identity 仍只由 `RuntimeEventPublisher` 附着，禁止在 wrapper 与 publisher 各实现一遍身份提升或 schema 路由。

禁止：

- 一个 collector 直接写 persistence，另一个 mapper 单独发 realtime；
- graph node 直接构造 SSE DTO；
- host 从 Graph 返回值中按 event type cherry-pick 后补发；
- mapper 或 bridge 在 publisher 前预先附着 routing identity；
- `TickOutput.newEvents`、collector 或 Graph result 形成第二事件集合；
- realtime adapter 改写 RuntimeEvent payload；
- transport finalizer 分别构造“实时版本”和“持久化版本”的同一事实；
- 以“避免重复 SSE”为由让 durable terminal fact 绕过统一 publisher。

允许存在多个消费者和多个投影，不允许存在多个事实生产源。

### 1.4.1 Child fact 与 parent trace

child RuntimeEvent 是运行事实，`subrun_trace` 是挂载到父工具卡的 read model。二者不是两套可以互相替代的事实：child fact 先完成 child admission，parent trace 再由纯投影选择可展示事件并通过父 publisher 发布。

child fact 即使与 parent 共用 `conversation_id`，也只属于 `lane=child / visibility=parent-trace`。面向会话正文的 read model 只接纳 `lane=foreground / visibility=conversation`；增量投影与全量 rebuild 必须复用 `shouldReplayRuntimeEventToUi()` 的同一 routing-aware 决策。重载时 child thought、tool、answer 不得成为 parent 正文，唯一标准展示输入仍是 parent run 发布的 `subrun_trace`。

child thought 的完成性也属于 child fact：provider 正常完成、失败或取消都会由 streaming adapter 封口当前 thought，再经 parent trace 投影。前端不得用父工具 status、run status 或 lazy-load 状态合成 `thought_complete`。

共享合同对 parent trace 的关键字段有以下硬性要求：

- `SubRunTraceKind` 是 trace `kind` 的唯一 schema；RuntimeEvent、SSE、Host 查询和任何 UI/插件公开类型都必须派生，不能重列字符串联合；
- 每条 trace 都必须在顶层携带 `source_event_id`，指向唯一 child RuntimeEvent；
- `tool_call_decision` 必须携带本次 child fact 的 canonical `tool_calls[]` 完整批次，不得拆成多条 trace，也不得使用标量 `tool_name/tool_call_id/args` 代替；
- `tool_process` 必须携带 owner admission 后的 `tool_name + tool_call_id + args + phase + status`；decision 不表示已开始，不定义 queued/pending 展示状态；
- `tool_output` 必须携带单个工具身份、terminal success/error 状态与结构化 output；只有 success 可以在顶层携带有序 durable `attachments` refs，failure 与其他 trace kind 必须拒绝该字段；Host 紧凑历史保存 decision 是为了在 ephemeral process 不存在时可确定恢复 args；
- `final_answer_chunk` 必须在顶层携带 `answer_id / seq / delta`，可选 `is_last`；
- `final_answer` 必须在顶层携带 `answer_id / content / completion_reason`；
- `answer_id / seq / is_last / source_event_id` 禁止放进开放 `meta`；
- Runtime→SSE 官方 mapper 必须原样保留这些字段，包括成功工具结果的 attachment refs 顺序。

parent trace 中的 attachment refs 只是展示所需的资源身份，不包含图片字节或 host 物理路径，也不会成为父 Agent 的模型输入。Host 如果持久化紧凑 trace，必须原样保存并在公开合同校验后恢复；客户端只能把 refs 交给正式 attachment/tool-card admission，不能根据 output、observation 或 locator 补造附件。

`projectChildRuntimeEventToSubRunTrace()` 只负责“哪些 child 事件可展示、字段如何映射”，不负责 child admission、生成 parent trace id、持久化或 transport。Host 必须把发布与生命周期装配放在该纯投影之外。

父工具结果中的 child final answer 可以服务父 Agent observation，但不能成为 UI client 的第二正文来源。客户端只能从 trace 投影 child 过程；实时与回放 trace 通过 `source_event_id` 归并，不能按文本内容或“是否已有任意 final answer”猜测去重。

`subrun_trace` 是 live presentation，必须保持 `ephemeral=true`，不能进入通用 RuntimeEvent 事实表。需要重启后展示时，Host 可以从已 admission 的 trace 投影独立紧凑 read model；该 read model 只保存产品确认需要的语义项，读取后必须用公开 `RuntimeEvent` schema 重建并校验完整 DTO。历史投影是 live presentation 的物化视图，不是第二个 child RuntimeEvent 事实源。

### 1.5 run、execution 与 transport

`run_id` 表示逻辑 Agent run；`execution_id` 表示一次实际执行或 transport。wait-user 会结束当前 transport，但逻辑 run 仍为 `awaiting_user`；resume 沿用 run_id，分配新的 execution_id。

生命周期边界不允许交叉推断：

- `run_execution_metrics` 是 RuntimeEvent，先经 publisher 实时发布并 durable commit；
- Host 只能在 persistence drain 成功后更新 RunRegistry，然后发 `run_status`；
- Host 最后发 `transport_end` 并关闭当前 EventBus；
- admission 前失败发 `transport_error`，不得伪造没有 run 的 RuntimeEvent `error`；
- 客户端遇到 transport、reader 或意外 EOF 只上报本地 transport failure，不得补造 `error`、`run_status` 或 durable metrics。

### 1.6 lane 与 visibility

| lane | 典型用途 | 默认可见性 |
|---|---|---|
| `foreground` | 会话正文 Agent | `conversation` |
| `auxiliary` | 自动标题、内部评估 | `none` |
| `child` | 父工具内部子 Agent | `parent-trace` |

`lane` 表示执行位置，`visibility` 表示展示范围。客户端必须同时校验 conversation、run、execution 和 visibility；不能仅凭 `conversation_id` 把事件写进当前正文。

`shouldReplayRuntimeEventToUi()` 不是单纯的事件类型白名单：事件还必须同时满足 `lane=foreground / visibility=conversation`。`shouldPersistRuntimeEvent()` 与它相互独立，因此 child / auxiliary 的 durable fact 可以保留在 EventStore，却不会进入 Conversation 主时间线。会话预览与用户消息计数同样只能消费这个 foreground/conversation 集合，`total_events` 才统计全部 durable facts。

正式 EventBus、EventStore 与 replay 输入都必须是 `RoutedRuntimeEvent`。缺少 routing identity 的事实不属于当前合同，Host 必须在启用新协议前完成显式数据清理或离线重建；运行时读取主链不得恢复、猜测或补齐身份。

## 2. eventGovernance 决策函数（前端可用）

事件**生命周期治理**统一走 `eventGovernance` 纯函数：

| 函数 | 用途 |
|---|---|
| `shouldPersistRuntimeEvent` | 是否写入 host EventStore（`ephemeral=true` 或 `tool_process` 不持久化） |
| `shouldReplayRuntimeEventToUi` | 页面 reload 时是否从 EventStore 回放给前端 |
| `shouldEnterAgentContext` | 是否进入 LLM 上下文窗口 |
| `shouldEmitRuntimeEventToSse` | 是否走实时通道 |
| `getRuntimeEventUiProjectionKind` | UI 投影类别（不同 kind 走不同前端组件） |

这些函数都在 `@linnlabs/linnkit/runtime-kernel/events` slim seam，**浏览器安全**。任意 browser bundle 都从该入口导入，不复制判断。

## 3. 三种事件模型

| 模型 | 所在层 | 用途 |
|------|--------|------|
| `AnyAgentEvent` | runtime-kernel（领域事件）| graph node 内部产出的原始事件 |
| `RuntimeEvent` | runtime-kernel → host（持久化事件）| 持久化、上下文重建、history 回放的事实来源 |
| 实时通道事件（如 SSE）| contracts + host realtime adapter（表现层事件）| `runtimeEventToSSEEvent` 负责标准 SSE 字段；host 负责自己的 meta enrichment 与传输 |

`RuntimeEvent` 持久化由你的 `EventStore` adapter 落地；实时推送由你自己的 realtime adapter 决定。linnkit 只规定标准 `SSEEvent` DTO 的投影，不规定 HTTP/SSE/WebSocket/IPC 怎么传。

## 4. 几个常见事件的处置 cheatsheet

| RuntimeEvent | persist | replayToUi | enterAgentContext | realtime |
|---|---|---|---|---|
| `final_answer_chunk` | ✗（ephemeral）| ✗ | ✗ | ✓ |
| `final_answer` | ✓ | ✓ | ✓ | ✓ |
| `tool_process` | ✗ | ✗ | ✗ | ✓ |
| `tool_output` | ✓ | ✓ | ✓ | ✓ |
| `thought`（增量）| ✗ | ✗ | ✗ | ✓ |
| `thought`（完成）| ✓ | ✓ | ✓ | ✓ |
| `tool_call_decision` | ✓ | ✓ | ✓ | ✓ |
| `requires_user_interaction` | ✓ | ✓ | ✗ | ✓ |
| `history_summary` | ✓ | ✓ | ✓ | ✓ |
| `context_usage_snapshot` | ✗（ephemeral）| ✗ | ✗ | ✓ |
| `run_execution_metrics` | ✓ | ✓ | ✗ | ✓ |
| `audit_envelope` | ✓ | ✗ | ✗ | ✗ |

`final_answer` 仍进入 realtime channel，但它不是第二条正文输入，只用于验证 chunk 聚合结果与规范身份、记录封口原因并结束该 answer segment。它不得替换 live message id。只有 `completion_reason=terminal` 可以被 settlement、复制与操作栏视为最终交付；`tool_call` 和 `interrupted` 仍可展示，但不得冒充终答。缺少 chunk 的非空完整答案是协议错误，不能静默渲染。

`tool_call_decision` 表示模型提交了调用清单，不等于所有调用正在执行。普通 ToolNode 串行消费清单，实际开始由 ephemeral `tool_process(start)` 表达。客户端不应为 decision 创建 queued/pending 可见行；未来 ToolNode 并行化时只是多个 process 同时开始，协议不变。无论成功、失败还是 run 取消，decision 中每个 `tool_call_id` 都必须有 durable `tool_output` 配对；未启动就取消的调用使用 error output 明确结算，不能让 Host 或 Renderer 把永久 loading 当成可恢复状态。

`context_usage_snapshot` 必须通过 Graph 已注入的 RuntimeEventSink 发布，不能为 token 面板建立 node→transport 旁路。它不进入
Graph history/checkpoint event list、EventStore、UI replay 或 Agent context；Host 可以在 publisher 前的 execution-scoped
enrichment 中绑定 `user_message_id`。客户端收到后只修订该正式用户实体；最终 metrics 使用相同产品投影覆盖最终值。
这个事件代表“Provider 已接纳并成功完成的 Prompt attempt”，不是单纯测量结果。主 Prompt 超过输入预算时必须在 Provider 前以 `llm.prompt.input_budget_exceeded` 失败，候选快照只用于该次错误诊断，不进入实时、checkpoint 或结算快照。

实际决策一律以 `shouldXxxRuntimeEvent()` 函数返回值为准；这张表只是速查。

表中的 `replayToUi=✓` 还隐含 routing 前提：仅对 `lane=foreground / visibility=conversation` 成立。相同类型若属于 child 或 auxiliary run，仍可持久化，但 `replayToUi=false`。

`run_status / transport_end / transport_error` 是 SSE-only 宿主信号，不是 RuntimeEvent，不进 EventStore 或 Agent context。它们必须引用正式 `run_id / execution_id`，不得从 metadata、active conversation 或连接是否关闭反推所有权。

`summarization_start / summarization_end / summarization_error` 同样是 SSE-only 宿主信号。start 创建 presentation identity，end/error 引用该 identity；end 的 `summary_id` 另外精确引用本次已提交的 `history_summary.id`。完成后的摘要由 Graph 的 `commit_context_compaction` 先 durable commit，再按 `end → RuntimeEvent publisher fan-out` 进入主链，之后才允许主 Provider 调用。Renderer 只能用这个 ID 将 completed progress 与 durable summary 归并，不能按 run、execution 或“最近一条摘要”猜测。Host 不得把 callback 的开放对象直接展开成 wire DTO，也不得在 callback 内调 RuntimeEventSink。只有 commit 前或 commit 本身失败才走 `start → error`；commit 成功后 progress transport 失败只能记录日志，不能再发 error 或撤销摘要。

测试 realtime adapter 时，必须在同一个 EventBus 上先发布至少一条其它事件，再发布 `final_answer_chunk(seq=0, 1)`，同时断言业务 `seq` 保持 `0, 1`、`execution_seq` 按整个 execution 单调递增。只测试单事件 mapper 无法发现字段覆盖。

## 5. 修改事件协议时的开发清单

新增事件、字段或消费者不是单文件修改。提交前必须依次完成：

1. 在 browser-safe contracts 中定义 schema、类型与不可信边界 parser，前后端不得复制近似 DTO。
2. 明确它是 durable fact、ephemeral progress、run control、transport signal、app acknowledgement 还是 read model row；不同类别不能互相代替。
3. 为每个身份和业务字段指定唯一 owner；routing identity 只由 admission 提交，execution 顺序只由 EventSequencer 提交。
4. 事实创建者只创建一次 draft；生成事实经 RuntimeEventSink 和 RuntimeEventPublisher 发布，incoming fact 经同一 publisher route 后 durable commit，再 publishRouted fan-out。
5. 在 eventGovernance 同时决定 persistence、realtime、UI replay 与 Agent context，adapter 不另写一份事件类型表。
6. realtime adapter 复用 runtimeEventToSSEEvent，只补 Host 的 execution 与展示 enrichment；不得改写 payload 或业务序号。
7. EventStore 只接收 RoutedRuntimeEvent；read model 只从正式字段读身份，不读取 metadata 别名。
8. 客户端先 `validateSSEEvent`，再按 conversation、run、execution、turn 和实体 ID 投影；不得回退 active conversation 或全局裸 ID。
9. root、resume、auxiliary、child、detached、quickstart、benchmark 和 testkit 使用同一 admission/publisher 模型，不能为测试建立简化旁路。
10. 同一变更同步更新 framework 与接入方的永久文档；阶段性审计和 proposal 不能成为长期规范来源。

业务门禁至少覆盖：

- 同一事实的 realtime 与 durable/read-model 最终语义一致；
- 非答案事件先出现时，答案业务 seq 仍从 0 正常拼接；
- wait-user 的创建、切换会话、提交、resume 与取消保持同一 run 所有权；
- 同会话并发 run、父子 run 与 auxiliary run 不串正文、控制态或 trace；
- publisher、schema、sequence 或 persistence 失败会阻止虚假 completed；
- Provider 坏 JSON、异常 EOF 与 transport 断开显式失败，不补造业务终态。

只验证字段常量、内部方法调用或单事件快照不足以证明协议正确。优先使用跨 EventBus、持久化、read model 和客户端投影的业务测试。
