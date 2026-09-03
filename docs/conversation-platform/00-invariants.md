# 全链路不变量总表

> **What** · Conversation 平台的全部跨链路长期约束，编号为 `INV-01`…`INV-60`。这是不变量的**唯一编号与规范摘要**。
>
> 条目按**主题分组**排列，组内不保证编号连续——新增约束取表尾新号后放进它所属的组（如 `INV-54` 在 C 组校验、`INV-55` 在 J 组治理）。查编号用目录跳转，不要按顺序扫。
> **When to read** · 任何改动前。违反其一即架构回退，评审应直接拒绝。
> **怎么用** · 专题文档可以解释机制、事故、派生约束与操作清单，但不得改变或重新定义不变量。新增跨链路约束加到表尾并取新号。
>
> **编号纪律**：`INV-xx` 一经发布**不复用、不重排**。删除的条目保留空号并注明废止原因。早期规范曾因手工编号产生重复编号，正是缺少这条纪律。

---

## A. 事实与投影体系

### INV-01 · RuntimeEvent 是唯一事实源

events 分页 API、审计 / 恢复 / deterministic replay 契约不变。UI read model 只是派生缓存。window / reload 数据、Vue 组件与业务编排不得绕过 MessageProjection 写入 `conversation.messages`；`services/messageProjection/**` 只维护隔离 reducer 工作区，`services/orchestration/projectionCommitPipeline.ts` 是将 live 投影提交到 Vue live slot 的唯一入口。

### INV-02 · messageProjection 是唯一投影体系

纯函数 `reduceEvent` 按 `conversation_id → run_id → execution_id → turn_id → answer_id` 定位答案状态，工具状态按 `run_id → tool_call_id` 定位。后端投影器与前端 `reduceEvent` 用 parity fixture 锁一致（**不抽共享实现**，避免共享 bug）；新增事件类型必须前端 + 后端 + fixture 同 PR 改。

### INV-03 · 事实身份只在 durable commit 后成立

Renderer 可预分配请求的 `messageId` command identity，但不得提前创建同 ID 的消息。Host 在 durable transaction 成功后返回 `user_input_committed`，该 ID 才能进入 UI projection。禁止 local-to-durable replacement、缺 ack 补造或按文本合并。

### INV-04 · 身份只有一个提交者

Provider / Agent mapper 只创建 draft；root 与 child 都由各自 lifecycle 装配的 `RuntimeEventPublisher` admission。Graph journal 只保存 sink 返回的 routed fact。禁止 mapper 预路由、`TickOutput.newEvents`、collector、Graph result 补发和测试夹具原样返回 draft。

### INV-05 · 序号命名空间隔离

`execution_seq` 表示一次 transport/execution 内所有 SSE 事件的全局顺序；`final_answer_chunk.seq` 表示单个答案内部从 `0` 开始的连续分块序号。realtime adapter 不得用前者覆盖后者。MessageProjection 只按答案内部 `seq` 拼接正文。

### INV-06 · 释放语义分层

`transport_end` 只释放对应 execution 的 thought / turn / answer 在途状态；terminal `run_status` 才释放整个 run 及其 tool 索引。侧栏切换不是 Runtime 生命周期事件，不触发任何一层释放。pre-admission transport 没有 `run_id`，只结束网络请求。HTTP、network、protocol 或 projection failure 必须先完成 reader teardown，再按精确 `conversation_id + run_id` 越过 Host execution completion 屏障并读取 durable run；不得由 transport 结果伪造 RuntimeEvent 或 run 终态。

### INV-07 · SDK 无感知

前端不感知底层是 OpenAI-compatible 还是 Anthropic SDK，不感知 provider 时序差异，只消费统一的 `SSEEvent` / `RuntimeEvent` / `messageProjection` 协议。禁止因某个 SDK 的特殊行为追加专用渲染分支或单独改按钮 / 问卷 / 消息显隐。

### INV-08 · 无历史兼容主链

旧字段、旧 payload、缺身份事实和非法 read-model row 必须**显式失败**。合同升级通过清理或 rebuild 完成，不在 live/reload 链路保留 shape guessing、别名或 fallback。

---

## B. 身份

### INV-09 · 答案消息身份从首块起固定

新 `final_answer.id`、`answer_id` 与答案 UI `message_id` 必须相等。seal 只修订同一消息，禁止把 chunk event ID 或另一 seal event ID 提交为新身份。不存在旧身份例外。

### INV-10 · 局部 ID 必须带 scope

两个并发 run 可以出现相同 `turn_id / tool_call_id`，但 `answer_id` 全局唯一。答案状态仍使用 `run_id + execution_id + turn_id + answer_id` 校验归属与生命周期；工具状态使用 `run_id + tool_call_id`。禁止把局部 ID 提升为裸 conversation 级索引，也禁止因为 ID 全局唯一就省略答案的运行归属校验。

### INV-11 · Tool UI 身份不属于单个事件

`tool_call_id` 只在 run 内唯一，`conversation_ui_messages.message_id` 是全局主键。Host durable projector 与 Renderer live projector 必须共同使用 `conversationMessageIdFromToolIdentity(run_id, tool_call_id)`，且 Tool `message_id === merge_key`。禁止从首个 event id、工具名、batch 下标或到达顺序派生。

### INV-12 · Runtime 与视觉轮次身份隔离

Runtime `turn_id` 只用于执行、上下文和引用关联；`ConversationVisualTurnId` 只用于 UI 分组、timeline 与虚拟化导航。完整 visual turn 由可见 user message ID 派生，partial visual turn 只服务当前历史窗口布局。两者禁止比较、复制或互相 fallback，也不得用 `string` 抹掉类型边界。

### INV-13 · command 身份不能泄漏到 read model

HITL response command 的 `runId / interactionId / toolCallId / checkpointRevision / resumeToken` 属于控制面与 RunSupervisor admission。工具消息顶层 `tool_call_id` 标识工具实体；`interaction.active` 只携带 `runId / interactionId / checkpointRevision / resumeToken`，不得重复 `toolCallId`。terminal interaction 只能携带 `status / submittedAt / response`。

### INV-58 · Runtime 身份在 admission 后必须保持名义类型

外部协议、Provider、SQLite row、HTTP path/body 与插件公共合同可以使用原始字符串；进入 Linnkit Runtime、RunSupervisor、Host 内部编排或 Renderer 运行态前，必须由身份 owner 的公开 schema 完成 strict admission。admission 后的 `RunId`、`ToolCallId` 等身份必须保持各自 brand，禁止重新扩大为普通 `string` 后跨身份传递。

同值复用也是正式派生，不是类型逃生口：host-only run 复用 `turn_id`、child run 复用 `subrun_id` 时必须调用命名明确的派生函数。Provider 流式 tool-call 草稿可以暂存未完成的原始 ID，但只有完成 `ToolCallIdSchema` admission 的调用才能进入 Graph、AgentEvent、RuntimeEvent、RunSupervisor 或 Renderer 投影。禁止 `as RunId`、`as ToolCallId`，也禁止通过 `as RuntimeEvent / SSEEvent / RunRecord` 等载体断言绕过身份校验。

brand 化按事故风险而非身份数量推进。当前强制范围是 `RunId + ToolCallId`；下一候选只包括直接参与答案拼接与并发归属的 `TurnId + AnswerSegmentId`，必须在独立影响分析后立项。`TraceId / AuditEnvelopeId / ContextLedgerEntryId` 等仅服务可观察性的身份默认保持 strict string schema，除非出现真实混用故障或进入控制面。禁止以“18 个身份尚未全部 brand”为理由机械扩张。

---

## C. 合同与校验

### INV-14 · 产品 UI schema 是唯一真源

`@app/schemas` 的 `ConversationUiMessageSchema`、`message-metadata.ts` 与 `tool-message.ts` 统一 Host row、HTTP DTO、Renderer window input 和每种消息的 metadata。各层不得重新声明 role/type/presentation/status 或开放 metadata 索引。

### INV-15 · 消息状态只能表达一次

工具状态只在 tool metadata；answer 的 `is_complete + completion_reason` 必须属于正式状态联合；插件扩展只允许 `messageExtension: { namespace, data: JsonRecord }`。禁止顶层 status、`messageMetadata/userInputMetadata`、非 JSON 插件值和根据缺字段推断 variant。

### INV-16 · metadata 不是控制面

metadata 只承载共享 strict schema 明确定义的展示附加信息。删除它不得改变事件归属、消息身份、run/execution 状态、恢复目标或写入目标。禁止开放扩展袋、任意 spread 和消费方 shape probing。需要新增语义时先扩展 owner schema。

会话级 agent 选择是正式控制面：read model 使用 `selectedAgentId`，跨端与持久化合同使用 `selected_agent_id`，其值必须是 `AgentDefinition.id`。禁止把 `promptKey` 或其它路由实现键写入 Conversation metadata；已知回流路径由 `guard:conversation-agent-control-plane` 机械拦截。

### INV-17 · strict schema 必须在真实边界执行

不只用于 TypeScript 推导。Host durable transaction、Host 业务适配器对通用 RuntimeEvent 中产品 metadata 的接纳、HTTP DTO admission、Renderer live projection 与 reload mapper 都必须 `parse`。任一边界失败应终止当前操作并保留原事实；禁止 catch 后删除字段、补默认值或降级为空对象。

可选字段只允许“缺失”，不允许“存在但非法”。例如 `user_quote` 不存在是合法普通消息；一旦存在，就必须通过 `UserQuoteSchema`，不得在历史构建、edit-resend 或 UI 中静默删除引用。

### INV-54 · parse 与 throw 只允许在 admission 边界

strict parse 与业务 `throw` 的合法位置是 admission 边界：Host durable transaction、Host 业务适配器（如 HistoryBuilder 接纳 Host 专属的 `user_quote` metadata）、HTTP DTO admission、Renderer DTO 映射（`mapUiMessageDto` / `uiMessagesDtoGuards`）、live projection 入口，以及 registry 在挂载展示组件前的 presentation projector。

**禁止出现在 Vue reactive effect 内**——`computed`、`watch` 回调、render 函数、以及被它们同步调用的纯函数。原因是机制性的而非风格性的：reactive effect 抛出会中断当前 patch/flush，且该 computed 会被反复标记 dirty 反复抛，把一次协议错误放大成整棵渲染树失效。真实案例：`selectors.activeMessages` 内的身份冲突 `throw` 曾导致会话切换永久失败。

失败必须"失败一次"：在边界终止该次操作并保留原事实。禁止为了满足本条而改用 `safeParse` + 默认值、空对象或静默隐藏——那违反 [INV-17](#inv-17--strict-schema-必须在真实边界执行)。正确做法是把解析上移到边界，让下游只消费判别联合。

### INV-18 · 工具 wrapper 与底层工具是两个正式合同

工具别名可以复用展示卡片，但不能把 wrapper payload 交给底层工具的 strict schema。底层 producer、wrapper adapter 与 Renderer consumer 各自从 `@app/schemas` 导入自己的合同；adapter 显式转换并再次 parse。禁止在组件内改字段名、猜来源或用 catch/fallback 吞协议错误。

### INV-56 · 工具展示派生只有三个 admission 入口

工具卡 presentation 只允许在三处生成：live `MessageProjection` 写 tool message **之前**、reload `mapUiMessageDto` 写入 window store **之前**，以及 Subrun 完整 child message 写入其独立快照 **之前**。三处共同调用 Conversation 的窄 projection port，并共用无状态的 tool message candidate builder；app-level 插件 registry 唯一拥有 alias 解析与工具 projector 分派。

每个正式暴露给 Agent 的业务工具都必须拥有 Renderer UI 注册；同一业务语义的 alias 可以共享卡片。工具当前未被某个 Agent 注册、当前采用 header-only 或配置 `hideContent`，都不代表卡片不可达或可以删除，也不能作为跳过 presentation 合同的理由。未命中 registry 的通用内容视图只用于未知工具、插件未加载或注册异常的诊断展示。

一次 projector 调用必须同时完成 alias 最终 key 固定、wrapper adapter 转换、strict schema parse 与展示模型构造。结果写在 `ToolCallMessage.toolPresentation`，属于 Renderer-only 派生字段：不进 metadata、不进 wire/SQLite、不复制到 visual row。标题只能保存延迟本地化描述符，禁止缓存当前语言字符串。

live 顺序必须是“构造完整候选 metadata/content → projector → 一次性写 message/toolState”。Subrun 必须先在非响应式 admission scheduler 中对脱离快照完成同样的全量接纳，成功后才原子替换可见快照。projector 失败时原工具实体或原 Subrun 快照保持原样。禁止在 `computed`、`watch`、render、visual-row builder 或卡片组件中再次运行 projector、解析原始 `args/result`，也禁止 apply 后再 project。

已迁移卡片进入 `guard:conversation-tool-presentation` 的单调增长清单。清单内卡片必须声明 presentation，且 AST 门禁禁止 raw `args/result`、组件内 schema parse 与业务 throw；禁止为返工移出清单。

紧凑步骤是独立的 Renderer read model，不计入上述完整卡片三个入口，也不得调用完整 projector。
每个 live executable 的最终非 alias `ToolUiConfig` 必须声明 `compactStep`。它只允许在非响应式 scheduler
的 detached 批次中运行，整批成功后原子提交；Vue `watch/computed/render` 不得同步 parse 或 project。
步骤只保存延迟本地化 descriptor。Conversation 通过窄 port 使用同一 enabled plugin registry 和 alias
规则，不维护具体工具名映射；只有 registry 未命中才允许通用诊断 fallback。

### INV-57 · 工具执行合同只承载业务事实

工具定义、Linnkit runtime、Host event 与 durable tool row 只传经过 owner schema 校验的业务事实。公共 `data` 及其中的 `metadata` 必须是封闭合同；插件和 provider 的内部详情不会自动穿透公共工具结果。

Renderer registry/projector 独立拥有工具卡的标题、图标、布局与 presentation。工具业务 `data` 先经共享 strict schema 校验，再由 projector 生成 Renderer-only `ToolCallMessage.toolPresentation`；该派生结果不进入 wire、SQLite 或工具业务合同。

紧凑步骤 `compactStep` 同样只属于 Renderer registry。其标题、参数模板和本地化 key 禁止进入
`BaseTool`、Linnkit runtime、RuntimeEvent 或 durable row；官方插件在自己的 Renderer contribution 中拥有
该配置，Host 不从 backend class 自动生成 UI。

`guard:conversation-contract` 扫描 Linnkit、插件后端、Host 与工具目录，防止执行合同混入展示配置或 durable row 持久化派生 presentation。

---

## D. 消息语义

### INV-19 · 实时与历史答案职责分离

当前会话只通过 `final_answer_chunk(seq=0..n)` 物化正文；首块直接用 `answer_id` 创建 UI message。非流式 LLM 与工具终答也由 Graph 先发布 one-shot chunk。完整 `final_answer` 是封口事实，`completion_reason` 由创建边界写入：`terminal` → 最终回答，`tool_call` → 工具前播报，`interrupted` → 未完成回答。禁止根据未来工具事件回溯改写为 thought，禁止从完整事件或 `tool_output` 补造正文。

### INV-20 · 空白答案不落地

部分模型会吐出只含不可见字符的 `final_answer`（零宽空格等，`String.trim()` 无法移除）。判定收口于 `functions/answerContent.ts` 的 `isBlankAnswerContent`（内容级）与 `functions/renderableConversationMessage.ts`（消息级）。投影器、UI 列表构建、`Message.vue` 与 selectors 复用同一口径。

### INV-21 · 摘要事实与压缩进度是两个不同实体

`history_summary` 是可持久化、可分页的事实消息；`summarization_progress` 是 Renderer-only presentation，start/end/error 按 `summarization_id + run_id + execution_id + turn_id` 关联同一次进度。`summarization_end.summary_id` 必须等于本次已提交的 `history_summary.id`，completed progress 只通过该事实 ID 与 durable 摘要关联。两者不得共用 type、ID 或 metadata 状态字段，也不得按 run 或“最近一条摘要”猜关联。

自动上下文压缩中，Context Manager 只负责纯计划、固定格式校验和 pending `history_summary` draft。重建后的主 Prompt 通过容量接纳后，Graph 的 `commit_context_compaction` 必须先调用 Host `RuntimeEventCommitPort`，在同一有序 persistence 队列完成 routing admission、落盘与 ack，但不 fan-out；成功后才发送带精确 fact ID 的 `summarization_end(summary_id=history_summary.id)`，再经唯一 RuntimeEvent publisher 发布同一摘要事实，persistence consumer 按 fact ID 去重。durable commit 是不可回滚分界：提交失败只能出现 `summarization_start → summarization_error`，不得出现 end、摘要事实或主模型调用；提交成功后不得再把 progress transport 或 fan-out 失败伪装成压缩回滚，已提交摘要必须保留。生产 Host callback 必须 no-throw，只发送既有 SSE-only progress，transport 失败只记录日志，不发布 RuntimeEvent 或 error fact；durable 摘要到达后必须按 `summary_id` 删除对应 progress。不得恢复 Context build 副作用、`summaryEvents` sidecar、专用 Summary Agent 或手动 checkpoint 工具作为第二条生产链。

### INV-22 · Markdown 只有一个解析入口

所有需要 Markdown 的 Conversation 内容统一使用 `MarkstreamRenderer` 与 `packages/stream-markdown-parser`。合同声明为原样 text 的内容（Workspace `presentation.kind='text'`、`tool_output_read.window_text`）使用保留空白的文本渲染。这由结构化合同判别，不由组件猜内容。

### INV-23 · 用户输入接纳只有一个入口

`features/user-input-admission/` 校验 ack 的 conversation、message、operation 与 replace identity，成功后才调用 store action。普通聊天、编辑重发、Annotation、插件 isolated run、subrun 和 table-fill 必须共用。

> **作用域说明**：本条禁止 Conversation projection store 定义或调用 `addUserMessage()`。它**不涉及** 独立 Linnkit 仓的 `src/context-manager/profiles/agent/context/ConversationSession.ts` 的同名方法——那是 linnkit 上下文装配的合法 API，与 Conversation UI 接纳无关。

### INV-60 · 上下文占用的实时快照与结算事实分层

每次成功提交给 Provider 的 LLM Prompt 只发布一条 ephemeral `context_usage_snapshot`，经既有
`RuntimeEventSink → RuntimeEventPublisher → EventBus → SSE` 主链实时修订触发 execution 的正式用户消息；失败、取消或被 Provider 前 Prompt 容量门禁拒绝的
attempt 不发布。主 Prompt 必须先满足 `used_tokens <= input_budget_tokens`，超限以 `llm.prompt.input_budget_exceeded` 失败且 Provider 不得被调用。工具调用只是上一条 Prompt 的决策结果，不额外补造快照；工具完成后的下一次 LLM Prompt 成功时再更新。

`context_usage_snapshot` 不进 EventStore、UI replay、Agent context 或 Graph history。Host 在 execution 边界绑定
`user_message_id`，Renderer 不按 turn、当前消息或 active conversation 猜目标。execution settlement 仍最多发布一条 durable
`run_execution_metrics.context_usage`，reload 与断线恢复以该最终快照收敛；两类事件必须通过同一个产品投影函数写入同一
`user_input.metadata.context_usage`，不得新建 token store 或平行 transport。

自动上下文压缩的内部 LLM 调用属于 `phase=context-internal / purpose=context_compaction`，只进入统一 token ledger 与 telemetry，不生成 `context_usage_snapshot`。压缩成功时，必须先完成“重建 → 重新注入 reminder → 重新计量 → 容量接纳 → Host durable commit → progress end → publisher fan-out”，之后才允许主 Provider 调用；提交前的生成、校验或重建失败且原 Prompt 仍在预算内时可以继续，原 Prompt 已严格超限时必须以 `llm.context.compaction_failed` 或 `llm.context.compaction_insufficient` 结算。summary durable commit 失败时一律阻止 end、摘要 fan-out 与主 Provider 调用，不能退回 publish-then-drain。

---

## E. 工具与 subrun

### INV-24 · 具体工具没有 Runtime 特权

Linnkit 只管理通用工具执行生命周期和上下文策略，不识别具体工具名，也不为工具建立专属 RuntimeEvent、SSE、ToolContext 或 Conversation 状态。工具的结构化结果属于产品/工具合同；工具卡只消费正式 `tool_output.payload.result`。

### INV-25 · 工具 batch 必须完整结算

`tool_call_decision` 只表示模型提交调用清单，`tool_process(start)` 才表示单个调用实际开始。普通 ToolNode 串行消费，工具专属 batch 可在自身合同内并发；两者都必须保证每个 assistant tool call 最终有一条 durable `tool_output`。执行中取消与尚未启动取消都由 ToolNode 在抛出 `AbortError` 前结算。Host、投影器和 Renderer 禁止扫描 loading 行补终态。

### INV-26 · Subrun 是投影，不是第二事实源

child fact 以 child/parent-trace 身份进入 child EventBus/EventStore，不进入 Conversation 正文；绑定父工具的 parent `subrun_trace` 是唯一展示来源。父工具 `tool_output.data` 与 `observation` 服务父 Agent 的结构化结果，不能在 trace 缺失时补造卡片正文。

### INV-27 · Subrun lifecycle 汇总只属于 RunSupervisor

SQLite `runs` / RunRegistryStore 保存 `parentRunId + status + currentNode + iterationsUsed + errorIfAny`，是按父级查询 child 生命周期的唯一 owner。Telemetry / CostCollector / LLM Audit 只做观测。禁止从 trace 数量、请求次数或 audit bucket 重建第二套 lifecycle。

### INV-28 · Subrun lazy 状态不是运行状态

`idle` 只表示历史 trace 尚未按需读取，不能展示为"正在加载"或"后台仍运行"。只有真实请求进入 `loading/preparing`，或父工具事实仍为 loading，才显示加载态。child thought 是否完成只看 trace 中同身份的完成事实。

<a id="inv-55-workflow-product"></a>

### INV-55 · `workflow` 命名保留给显式工作流产品

`workflow` 一词专指可注册、可配置、可执行的显式步骤编排产品（类似 Dify）。节点可以调用工具、Agent/subrun 或其它公开能力；具体节点实现不是 `workflow` 的定义本身。

**agent 选择不是 workflow。** PPT、Deep Research 等是注册的 `AgentDefinition`，通过系统提示词与 skill 约束行为、保留自主权；机制上只是 agent registry 按 key 查找，没有步骤、没有 subrun 生命周期。两者不得共用类型名、字段名或 UI 概念名。

持久化的是产品身份（选中的 agent），不是路由实现细节（`promptKey`）。plugin contribution 只通过 `agentId` 引用正式 `AgentDefinition.id`；Conversation read model 与请求分别使用 `selectedAgentId` / `selected_agent_id`。Host 完成 request admission 后才按 agent id 精确解析内部 `promptKey`，未知或停用的 agent 必须明确失败，不得 fallback（[INV-16](#inv-16--metadata-不是控制面)）。

`ConversationWorkflow*`、`conversationWorkflows`、`applyConversationWorkflowSelection` 与 Renderer `metadata.promptKey` 旁路已物理删除。`guard:conversation-agent-choice-naming` 以零基线防旧命名复活，`guard:conversation-agent-control-plane` 防 metadata 与 contribution 恢复隐藏控制面。one-shot 调用和 subrun worker 内部的 `promptKey` 仍是合法执行键，但不得借此进入会话 read model。

> 这与 `task` 命名治理是同类问题：泛化词被先到的概念占用，等真正需要它的机制出现时无名可用。

---

## F. 运行态与生命周期

### INV-29 · Projection runtime 属于 conversation，不属于当前页面

`messageProjectionStates` 中的 run / execution / turn / answer / tool 在途状态必须跨侧栏切换连续存在。导航只切换当前历史 window 和展示选择，不得 cleanup previous conversation，也不得为了 loading 壳丢弃 target conversation 的 runtime。破坏性 cleanup 只允许发生在已确认不会再收到事件的生命周期终点或全局 reset，并必须同时取消 pending commit。

### INV-30 · 运行态常驻不等于 DOM 常驻

`ConversationChatSurface` 必须用同一内容相位**原子互斥**空态与 `ConversationHost`（`v-if/v-else`）。进入 `draft / ready-empty` 时卸载 Host，返回非空或历史 loading 时重新挂载。工作区中的主区与右侧必须经过同一 app-level `WorkspaceConversationSurface` 再进入该 Surface，禁止任何 placement 直接挂载 Host 或复制相位规则。禁止用 `v-show` 保留 Host 再在同一更新周期递归拆除 virtualizer、Teleport、footer 与 OverlayScrollbars。后台投影连续性由 conversation-scoped store 保证（INV-29），不得把组件实例当作 runtime owner。

### INV-31 · 请求 / 流实例作用域并发模型

取消隔离、turn gate、交互等待、事件去重与 `ConversationEventDispatcher` 都由**每次请求独享的路由闭包**持有，不依赖全局 handler、`activeTurnId` 或全局去重集合。历史回放不经过 live 请求 gate。会话 ID 在用户动作发起时一次性捕获、全程透传，任何 `await` 之后都不得重读 `activeConversation`。

### INV-32 · 取消完成是三层屏障，不是 transport 状态

ToolNode 在抛出 `AbortError` 前为执行中和未启动调用写入配对 `tool_output`；Host cancel 只有在 execution facts、child parent-trace 与 finalize 全部完成后才能返回（wait-user resume 从 claim 前即属于该屏障）；Conversation 再按「当前 window → 已请求 subrun trace」顺序重读 durable truth。Renderer 禁止扫描 `loading`、伪造 `error/cancelled` 或依赖已中止 SSE 恰好送达终态。

### INV-33 · 跨 domain 执行态隔离

聊天、Annotation、外部 Input Extension 各自持有 controller 与同步状态；Conversation 宿主只通过窄 contract 聚合展示与取消能力。任何 feature 编排不得直接改写另一个 feature 的 store 内部状态。

### INV-34 · 后端一次装配只能有一个 execution runtime scope

composition root 显式把同一个 `LinnyaAgentRuntimeScope` 交给 Flow、AgentRunner 和 registered child invoker，并在同一装配点注入 TelemetryPort。incoming facts 的 Host 写入口与 generated facts 的 Linnkit adapter 必须落到同一底层 EventStore。禁止执行期查询全局 fallback。共享 scope 只共享基础设施端口，root / child / recursive child 仍各自拥有独立 routing identity。

### INV-35 · 标题资格来自创建动作

自动标题只属于本次运行期 materialize 的默认新会话。禁止根据消息数量、历史窗口内容、默认标题文案或 `titleOrigin` 推断；历史恢复和显式标题会话永远不补生成。

标题业务规则只属于 Renderer `features/conversation-title/`。Host `ensureConversation()` 只创建聚合根，不得从首问复制 fallback、空白归一化或截断规则。标题流程只能由 durable `user_input_committed` 接纳，并只消费其中必填的 `raw_content`；引用、附件、Agent 选择与 Host 注入的执行上下文均不得影响标题输入。

---

## G. 产品视觉与渲染

### INV-36 · 产品视觉契约（永不更改）

滚动条贯穿对话面板全高（含输入框区域）；对话内容滚入输入框背后渐隐（sticky footer + footer mask）。任何虚拟化方案都要**适配**该设计而不是清除它。

### INV-37 · 稳定实体 key

virtual row、timeline marker、动画账本与列表项必须使用正式 message/entity ID。禁止数组 index、内容文本、工具名+序号或随机 fallback。seal、`loading→complete` 与 reload 不得换 key。

### INV-38 · Visual row 支持任意消息 revision

MessageProjection 以替换消息对象表达结构化修订。append-only row builder 保存已处理消息的浅引用，任意位置引用变化时按 message id 重投对应 row；只有 id、role、type、turn identity 或可见性发生结构变化才全量 rebuild。同引用原地增长只保留给尾部正文 streaming，禁止深度 watch 整棵消息树。

### INV-39 · 测量单一执行者

尺寸测量统一交给 TanStack 的 `measureElement`。禁止每 item ResizeObserver + rAF 测高链、手写 spacer、第二套测量缓存，或测量后的第二次 `scrollTop` 修正。

### INV-40 · 滚动意图显式声明

virtualizer 是滚动执行的唯一写者；`useConversationScrollController` 只维护产品意图（`follow-bottom` / `anchored` / `free`）。落底、锚定由发送 / 编辑 / 重新生成编排显式声明。**禁止**用「列表形态变化」或「末条消息 role」反推用户意图。

### INV-41 · 消息可见性与入场动画解耦

`Message.vue` 只按 type 渲染，不决定消息是否可见；消息默认可见，入场动画只是增强。哪些消息播放一次性入场动画由 `ConversationView.vue` 统一决定并向下传递。禁止在 `Message.vue` 内用 `IntersectionObserver` / 视口可见性决定显隐。

### INV-59 · 完整消息共享同一个 visual-row 展示 owner

主时间线与 Subrun 就地详情都通过 `ui/messageCanvas` 渲染完整消息，共享 row DOM、视觉轮次边界、语义间距、streaming 归属、回答 footer 与 `Message.vue` leaf。最后一个 turn-end row 是 duration、answer actions 与 waiting indicator 的唯一 tail geometry owner；tail 作为 row 实测高度只参与一次 scroll geometry，宿主不得再创建独立 waiting reserve。主时间线的 TanStack adapter 只提供可见行、绝对位置与测量；Subrun 详情使用普通文档流，不创建第二个 virtualizer。禁止详情直接循环 `Message.vue`、自定义统一消息 `gap`，也禁止共享画布反向读取 foreground store、历史分页、timeline 或滚动状态。

---

## H. 数据层

### INV-42 · window ∪ live 双层物理隔离

window 行（已落盘）留在 `messageWindowStore`，**不回写** `conversation.messages`。渲染消费合成视图，只按规范 `message_id` 去重。唯一 lifecycle dominance 是 durable Tool 已为 `success/error` 而 live 仍为 `loading` 时 durable 压过陈旧 live，同时保留 live-only subrun trace。禁止按 merge key、tool name/call id 或文本猜同一实体。

### INV-43 · 局部消息为空不代表新会话

历史窗口与 live 投影物理分槽。任何"第一条 live 消息"判断都不能承担会话生命周期语义。

### INV-44 · durable UI 与 foreground context 按 routing identity 隔离

Conversation 主 read model、foreground Agent history、用户消息计数和预览只消费 `lane=foreground / visibility=conversation`。`lane=child / visibility=parent-trace` 的原始事实可供 child 恢复与审计，但不进父级正文。缺 routing 的事实必须拒绝。

### INV-45 · 加载期 SSE 无损缓冲

打开仍在生成、tail 快照尚未 ready 的会话时，原始 SSE 事件进入由 `{ conversationId, requestToken }` 唯一拥有的无损 FIFO。固定顺序：保留 projection runtime 与 live slot → 开启本世代缓冲 → 加载窗口 → 在同一 runtime 按序回放。禁止清空已有 chunk 前缀、数量上限、语义合并或跨世代回放。

### INV-46 · conversationContentPhase 是内容生命周期唯一口径

UI 空态 / 加载态判断禁止各自拼 messages 信号；`historyLoadingConversationId` 由 loader 独占写入。

---

## I. Subrun 展示链

### INV-47 · Subrun 完整消息只有一条正文输入链

`child fact → child EventBus → parent subrun_trace live / Host 紧凑历史 → Renderer 正式 Subrun message admission → child 消息`。trace 必须透传 answer segment 的 `completion_reason`。实时正文只能由 chunk 创建，完整答案只封口；紧凑历史不保存实时 chunk，因此 Renderer 必须在历史加载边界把 durable 完整答案快照确定性投影为一次性 chunk 与原封口，再进入同一 admission。不得据此放宽实时协议，也不得让完整答案直接创建正文。父工具 `tool_output.data` 与 `observation` 服务父 Agent 的结构化结果与上下文，**不能**在 trace 缺失时补造 child 正文——缺失必须作为 trace 历史投影 / 窗口 / 查询问题暴露。父卡只投影轻量进度；完整 child 消息只在 Host 就地详情或插件公开 `SubrunCard` 中渲染。工具专用卡片同样不得把 child events 压进 `tool_output.data` 后优先渲染。

### INV-48 · Subrun trace 使用稳定 accumulator

按 `subrun_id` 分桶、按 `source_event_id` 接纳。历史完整答案可以从一个真实 source 投影出内部 chunk 与封口；该投影身份只存在于 Renderer 内存，不能成为 wire 字段。历史确定前缀位置，重叠事实使用 live DTO；live 出现同一真实 source 时整体取代对应历史投影，live 新事实只追加尾部。source epoch 由 `conversation_id + parent_tool_call_id` 确定（单卡再加 `subrun_id`），变化时显式 reset。前缀重排只替换一次 bucket identity，之后稳定复用并仅扫描 live 新尾部。禁止在 computed 中反复创建合并数组、整 bucket 覆盖、按文本去重或按 `answer_id` 猜来源。

### INV-49 · Subrun leaf 使用正式身份

父工具用 `parent_tool_call_id`，bucket 用 `subrun_id / source_event_id`，步骤用 `tool_call_id`。父进度步骤的 Vue key 直接使用 `SubrunTraceDisplayStep.toolCallId`；child 工具消息 ID 统一由 `conversationSubrunMessageIdFromToolIdentity(subrun_id, tool_call_id)` 派生。详情定位必须携带不可变的 `conversationId + parentMessageId + parentToolCallId + subrunId`。禁止退回工具名 + 下标，也禁止在详情加载期重读全局 active conversation 猜作用域。

---

## J. 测试与门禁

### INV-50 · 业务门禁必须穿过生产实现

涉及 durable UI read model 的改动至少使用真实 `SQLiteEventStore`，并同时断言 committed Runtime fact、SQLite UI row、live SSE 与 reload DTO。只使用 `MemoryEventStore`、mock persistence port 或字段快照不能证明主链正确。

### INV-51 · 导航时序回归必须真机

涉及 Host、虚拟列表、Teleport、OverlayScrollbars 或导航时序的回归，必须运行 `pnpm run test:conversation-navigation:electron`。mock 滚动库或 stub `ConversationView` 的组件测试不能替代它。

### INV-52 · Parity fixture 同 PR 锁一致

后端 durable projector 与前端 `reduceEvent` 是两套独立实现，用同一组业务 fixtures 锁一致。新增或修改事件类型必须前端 + 后端 + fixture 同 PR 改，并覆盖实时增量、历史重载、同会话并发 run、wait-user resume、切换会话与失败传播。

### INV-53 · 测试装配不能拥有另一套协议

quickstart、testkit、benchmark 和 scripted node 也必须显式经过 admission sink，不得原样返回未路由的 draft，也不得通过 `TickOutput.newEvents`、collector 或遍历 Graph result 维护第二事件通道。生产代码禁止 import testkit。

---

## 教训档案（为什么会有上面这些条）

这些是真实故障留下的判断依据，不是抽象原则。

1. **逐层补时序的修补形状（修一层显一层）本身就是"应换成熟方案"的信号**，应更早识别。
2. **合成 gate 全绿 ≠ 生产可用**：正式放行必须真实 Electron 宿主 + 三类真实会话（5000 条无图 / 16 图 / 任务型）。
3. **只换引擎不换 UI**：headless 库负责滚动数学，宿主几何归集成方。
4. **空 `catch {}` 静默吞异常是掩盖 bug 的元凶**：捕获处必须打真实错误上下文。历史案例：`await import('sharp')` 失败被静默吞掉，导致所有生成图长期缺尺寸。
5. **库的扩展点语义要读源码核实**：TanStack 的 `shouldAdjustScrollPositionOnItemSizeChange` 是实例属性，options 传入静默忽略。
6. **死代码不能"继续调参"**：退役即成组删除。
7. **移动代码 ≠ 解耦**：以 import 边界 + 单一状态源为准，不以文件位置为准。
8. **抛错的位置和抛不抛一样重要**：同一个 strict parse 放在 admission 边界只失败一次，放在 `computed` 里会中断 Vue flush 并反复重算反复抛，把单条协议错误放大成整棵渲染树失效（[INV-54](#inv-54--parse-与-throw-只允许在-admission-边界)）。严格校验必须配"抛在哪里"的纪律，而不是靠放宽校验来止血。
9. **通用词被先到者占用，真正需要它的机制就无名可用**：`task` 已经付过一次学费，`workflow` 不能再被普通应用编排或 agent 选择提前占用；该名称保留给未来可注册、可配置的显式工作流产品（[INV-55](#inv-55-workflow-product)）。命名冲突要在概念出现前就分开，不是等碰撞了再改。
10. **可见页面不是运行态 owner**：用侧栏切换 cleanup reducer，会把正确身份变成"只剩 seal、没有 chunk 前缀"的假协议错误。修复应保留 owner 状态，不能放宽 seal 校验。
11. **store 常驻不能推导出组件常驻**：用 `v-show` 把空态和完整消息子树塞进同一 patch，会让第三方滚动 DOM、Teleport anchor 与虚拟列表卸载同时竞争 vnode 所有权。正确边界是 Surface 原子换树、store 独立续跑（INV-29 + INV-30）。
12. **committed fact 不能由客户端补造**：客户端只提交 command。
13. **测试装配不能拥有另一套协议**：quickstart、testkit、benchmark 也必须显式经过 admission sink。
14. **`metadata` 不是控制面**：发现消费者依赖它做路由时，应提升为共享正式字段。
15. **优先用类型排除非法状态，其次才在边界拦截**：Thought 完成态改成判别联合后，组件里的业务 `throw` 自然消失；把错误搬进 projector 只会保留同一个非法状态。
