# Linnya Flow Adapters

Layer: `app-host`

本目录是 Conversation 后端请求的应用层编排边界，拥有 run admission、RuntimeEvent publisher、EventBus 消费、SSE 传输和 EventStore 持久化。

## 1. 模块边界

Flow 负责：

- 接收 start / resume / cancel；
- 为每次 transport 创建 EventSequencer、EventBus 与 SsePort；
- 通过 RunSupervisor 建立逻辑 run 的唯一控制权；
- 持久化 incoming facts；
- 为 Graph 注入 RuntimeEventSink 与 `RuntimeEventCommitPort`；后者复用同一有序 persistence 队列，在 fan-out 前提交需要强一致的 durable fact；
- 从同一 EventBus 分发 realtime 与 durable persistence；
- 在 durable 事实写完后更新 run 终态；
- 发送 transport completion。

Flow 不负责：

- Graph 节点业务规则；
- RuntimeEvent 公共 schema 与治理规则；
- 在 Host 重新映射、聚合或补造 Graph 已创建的事实；
- Renderer 的消息投影和 active conversation 选择。

## 2. 执行链

一次 foreground 或 auxiliary 执行遵循固定顺序：

1. Router 建立当前 HTTP/SSE transport；
2. FlowOrchestrator 准备 incoming events 与 history；
3. RunSupervisor 原子注册 start，或 claim 原 wait-user run 的 resume；
4. Host 打开与 Linnkit runId 相同的 root RunSession；
5. incoming user input / interaction tool output 先 durable commit；
6. resume claim 在 incoming commit 后 activate；
7. Host 绑定正式 `run_id / lane / visibility` 并创建 RuntimeEventPublisher；
8. AgentRunner 只在 publisher 前补充 execution-scoped 非路由 metadata，并将该 runtimeEventSink 与基于同一 persistence 队列的 durable commit port 注入 Graph；
9. Graph 发布的每个 RuntimeEvent 进入 EventBus；
10. SsePort 与 RunEventPersistence 独立消费同一 envelope；
11. RunEventPersistence drain 成功后，completed 分支先清 checkpoint，再写不可逆 completed；awaiting_user 保留 checkpoint 后写暂停态；
12. Host 发布权威 `run_status`；
13. Host 发布 `transport_end`，结束当前 transport 并关闭 EventBus。

Foreground cancel command 有额外完成屏障：`RunSupervisor.cancel()` 只表示 abort 已触发且 cancelled 控制态已写入，不表示正在执行的 ToolNode、execution settlement 与 Host persistence 已收口。`FlowOrchestrator` 按精确 runId 读取持久身份并等待原 Flow execution 完成 drain 与 Host finalize 后，取消 HTTP 才能返回成功；Renderer 只可在成功响应后读取 durable window / subrun trace。自然完成可能先于取消，成功响应因此明确区分 `cancelled` 与 `already_terminal`，并携带真实 `terminal_status`。纯 `awaiting_user` 没有在途 execution，可以直接取消；但 resume 从 claim 前就必须登记新的 completion，即使 RunRecord 在 incoming fact 持久化期间仍显示 `awaiting_user`，cancel 也必须等待该 resume transport 完整收尾。RunRecord 状态不能替代 Host execution registry，active-run 列表也不能作为 cancel admission。

incoming facts 与 generated facts 的写入入口不同是有意设计：incoming facts 在执行前已经存在并需要先提交；generated facts 必须从 RuntimeEventPublisher 进入 EventBus。自动 compaction 的 `history_summary` 仍是 generated fact，但为保证 durable-before-fanout，会先由 `RuntimeEventCommitPort` 在同一队列完成提交，再由唯一 publisher fan-out；EventBus persistence consumer 按 fact ID 去重。两者不能互相 fallback，也不能写出第二份摘要事实。

应用装配层必须通过 `FlowRuntimePersistencePort` 把同一个 Linnkit EventStore 与同一游标生成器显式交给 Flow。FlowOrchestrator 不读取进程全局 EventStore，也不自行创建 MemoryEventStore。RunSupervisor registration 与 EventBus persistence 必须消费这一个注入实例；incoming facts 虽经 ConversationPersistencePort 写入，但它与 Linnkit adapter 必须连接同一个底层事实库。

## 3. 唯一生成事实链

生成事实只允许走：

`Graph / Host fact creator → RuntimeEventPublisher → EventBus → consumers`

RuntimeEventPublisher：

- 使用 Host admission 决定的正式路由身份；
- 校验 EventBus 与 EventSequencer 属于同一 execution；
- 创建唯一 EventEnvelope；
- 返回附着身份后的 `RoutedRuntimeEvent`；
- 维护当前 execution 的 published journal，供 FlowExecutionResult 与 transcript 使用。

已删除的旧实现不能恢复：

- AgentEventBridge；
- StreamCollector；
- collector-only / persistence-only queue；
- run 结束时 append missing events；
- Host 对 wait-user 的 type cherry-pick；
- AnswerNode 的 Host 侧完整答案重组。

## 4. Realtime 与 Persistence

SsePort 和 RunEventPersistence 是 EventBus 的平级消费者。

| 消费者 | 输入 | 职责 |
|---|---|---|
| SsePort | EventEnvelope<RuntimeEvent> | 按 governance 过滤，使用共享 mapper 投影 SSE，添加 Host render hint |
| RunEventPersistence | EventEnvelope<RuntimeEvent> | 按 governance 过滤，按发布顺序串行写入 root run |
| Run result journal | RuntimeEventPublisher 返回事件 | transcript、结果检查、run 状态所需的当前 execution 事实视图 |

消费者只能读取 payload，不能修改、重新编号或重建事实。

`SSESink` 是 transport DTO 的单向出口，签名固定为 `ConversationRealtimeEvent → void`。它不能返回 RuntimeEvent、不能被 Graph 注入，也不能被 benchmark / testkit 当作事实收集器；观察、评分和持久化必须读取 publisher journal 或 EventBus 中的 routed fact。

Graph mapper、bridge 与 local state 不持有 routing identity。它们只创建事实草稿并调用必需的 runtimeEventSink；Graph journal 只保存 sink 返回的 routed fact。缺 sink、sink 发布失败或 journal 收到未路由事件都必须中止 execution，Host 不得从返回结果补发。

RunEventPersistence 的首个写入错误会阻止后续写入；drain 将错误传播给 AgentRunner。run 必须先标 failed，不能留下 completed 假象。

## 5. 答案、工具和 WaitUser

- chunk 与完整 final answer 都由 Linnkit LlmNode 主链发布；
- 完整 final answer 与实时 chunk 使用同一个 answer_id；
- final answer 通过 EventBus 同时进入实时与持久化，不存在 collector-only 版本；
- tool process 通常只实时，tool output 作为 durable fact；
- WaitUserNode 发布唯一 interaction RuntimeEvent；Host 只从 publisher journal 读取该事实更新 RunSupervisor；
- resume 使用原逻辑 run_id，但当前 transport 拥有新的 execution_id；
- response command 的 `runId / interactionId / toolCallId / checkpointRevision / resumeToken` 只交给 RunSupervisor claim；Host 通过 `interactive-run/functions/buildInteractionResponseIncomingEvent.ts` 创建 terminal `tool_output`，其中 interaction 只含 `status / submittedAt / response`；
- `approved` 不得只把裸 `{ "action": "approve" }` 当作模型 observation。Host 在上述 committed fact 边界明确投影“用户已经批准、等待条件已经满足、不得重复请求同一确认”；结构化 `data` 和 `metadata.interaction` 仍保存原始事实。`submitted / modified / skipped` 继续保留工具 owner 组织的领域 observation，避免 Host 覆盖问卷答案或修改内容；
- auxiliary 标题 run 使用独立 runId、`lane=auxiliary`、`visibility=none`，不能进入正文。

## 6. 身份与并发

| 身份 | owner | 用途 |
|---|---|---|
| conversation_id | 请求与 conversation domain | 数据归属 |
| turn_id | 当前用户轮次 | 消息聚合 |
| run_id | RunSupervisor admission | checkpoint、控制态、事实归属 |
| execution_id | EventSequencer | 当前 transport / resume 尝试 |
| lane | Host admission | foreground、auxiliary、child |
| visibility | Host admission | conversation、parent-trace、none |
| answer_id | LLM answer creator | chunk 聚合 |
| chunk seq | streaming adapter | 单答案内顺序 |
| execution_seq | EventSequencer / SSE mapper | 整个 execution 到达顺序 |

核心身份必须是正式字段，不得藏在 metadata，也不得从当前 active controller 猜测。

## 7. Transport-only 信号

`user_input_committed` 是 incoming fact durable commit 后的确认，不是新的 RuntimeEvent；它不会再次进入 EventBus 或持久化。

上下文压缩的 start / end / error 是 SSE-only UI 进度信号，callback 只能发这些 presentation。Context Manager 只创建纯压缩计划与 pending `history_summary` draft；Graph 的 `commit_context_compaction` 在重建 Prompt 通过容量接纳后，先调用 AgentRunner 注入的 `RuntimeEventCommitPort` 完成 routing admission、落盘与 ack，但不 fan-out。成功后 Graph 才发送 `end(summary_id=history_summary.id)`，并通过既有 RuntimeEventPublisher 发布同一摘要事实；persistence consumer 按 fact ID 去重，随后主 Provider 才能执行。Renderer 用该精确 ID 归并 progress 与 durable summary，不按 run 或“最近一条”猜测。提交失败必须形成 `start → error`，不得出现 end、summary 或主调用。durable commit 成功后不可回滚：生产 progress callback 必须 no-throw，SSE transport 失败只记录日志；后续 publisher 异常可以让 execution 失败，但不能再发 summarization error 或删除已提交摘要。

压缩生成、校验或重建失败使用 `llm.context.compaction_failed` / `llm.context.compaction_insufficient` 进入标准 execution settlement，最多结算一份 durable error fact。软阈值失败且原 Prompt 合法时可以继续；严格超限、无可替换区段或提交失败必须阻止主 Provider。Renderer 仍只看到原有摘要进度与 `history_summary`，没有新的工具卡、设置项或交互入口。

execution 收尾固定分为三层：

| 对象 | 属性 | 唯一 owner | 用途 |
|---|---|---|---|
| `context_usage_snapshot` | ephemeral RuntimeEvent | LlmNode + execution-scoped Host enrichment | 每次成功 Prompt 后实时刷新；不持久化、不按工具补发 |
| `run_execution_metrics` | durable RuntimeEvent | execution-settlement feature | 记录 outcome、duration 与最终 context usage，参与实时投影和历史重建 |
| `run_status` | SSE-only | RunSupervisor / Host session | 在 durable drain 后投影权威 run 状态 |
| `transport_end` | SSE-only | Host session | 关闭当前 execution 连接，不推断 run 终态 |

run admission 前失败使用 `transport_error`；run admission 后失败使用 durable RuntimeEvent `error`。Graph 内部的 `admit_prompt_capacity` 属于已接纳 execution 的 Provider 前容量门禁，超限以 `llm.prompt.input_budget_exceeded` 走后者，不调 Provider、不发成功 `context_usage_snapshot`。Host 和 Renderer 都不得在另一条分支补造业务终态。

## 8. 关键模块

| 模块 | 职责 |
|---|---|
| `flow.orchestrator.ts` | start / resume / 异常 / finally 的应用层顺序 |
| `flow.host-session.service.ts` | per-execution EventBus、publisher、SsePort、root RunSession、transport 收尾 |
| `flow.agent-runner.service.ts` | Graph bootstrap 与 execution 用例编排 |
| `execution-settlement/` | metrics 发布、persistence drain、RunSupervisor 状态落定 |
| `flow.runner-handoff.ts` | Host 到 runner 的窄契约 |
| `flow.runtime.ts` | 应用装配层到 Flow 的 Supervisor、CostCollector、Runtime EventStore 与 cursor 窄端口 |
| `agent-runner/runEventPersistence.ts` | EventBus durable consumer 与 drain |
| `agent-runner/summarizationEventEmitter.ts` | 自动压缩的 SSE-only 进度 callback；不发布 `history_summary` |
| `flow.persistence.ts` | incoming / generated event 的 EventStore 事务端口 |
| `incoming-events/` | wire incoming event 校验、资源提交与 RuntimeEvent 物化 |
| `interactive-run/` | foreground run 查询、resume / cancel contract |
| `interactive-run/orchestration/stopConversationFlowActivity.ts` | 对话删除前停止全部 Flow root、等待 Host completion 并复查 child |

`interactive-run/orchestration/flowExecutionCompletionRegistry.ts` 是 cancel command、对话 cleanup 与原 Flow execution 之间唯一的进程内完成屏障。它不替代 RunSupervisor、不保存持久业务状态，也不允许用 timeout 猜测 settlement。start 在 RunSupervisor admission 后立即登记 `runId + conversationId`；resume 在 claim 前登记，使 claim、incoming commit、activate、runner settlement 与 Host finalize 属于同一屏障。Supervisor 的精确 run 查询是异步的，必须保留查询前后捕获到的 completion；active running/pending run 缺少注册记录必须在取消前直接失败。自然完成从 active 列表消失不是失败，按持久 run 终态返回 `already_terminal`；run 不存在或 conversation/parent 身份不匹配仍必须失败。

对话 cleanup 必须在持久 cleanup job 阻止新 admission 后调用 `stopConversationActivityAndWait()`。它处理同一 conversation 的全部 foreground/auxiliary root；Supervisor 已先写取消终态时仍等待按 conversation 捕获的 completion，纯 `awaiting_user` 才允许没有 completion。cleanup job 的失败重放不能依赖内存 registry：每轮通过 RunSupervisor 按 conversation/status 读取持久 `runs`，重新发现带 `originalSource=flow` 的 failed/cancelled root，并从 checkpoint clear 到 cost release 幂等重试。completed 只有在 checkpoint clear 成功后才能写入，因此不扫描成功历史；仍在 Host finalize 的 completed execution 由 pending completion 的 runId 精确补查。只有 typed `RunNotFoundError` 与成功 completion 共同出现时才忽略取消竞态，其他取消错误不得吞掉。全部 root 完成后还要复查 registered child；child 仍活跃说明父链没有按合同收口，必须失败。该能力只证明 Flow/Host 收尾，不证明任意 CLI 进程树为空，也不能替代未来 Commands activity owner。

Flow 主体与 Host settlement 是显式的两个阶段：无论主体成功或失败，都先完成 Host finalize 并结算 completion，再统一返回结果或抛错。两阶段同时失败时必须保留两份错误上下文；禁止在 `finally` 中抛错覆盖原始 execution failure。

## 9. 开发规范

新增 RuntimeEvent 或修改数据流时：

1. 先在 Linnkit contracts 和 governance 确定合同；
2. 明确事实创建者与字段 owner；
3. 只把 runtimeEventSink 注入事实创建边界；
4. realtime 与 persistence 只能增加消费者，不能增加事实源；
5. run 终态必须等待 persistence drain；completed 还必须等待 checkpoint 清理；
6. metrics → drain → terminal cleanup / run status → transport end 的时序不得改写；
7. cancel success 必须等待原 execution 完成事实 drain 与 Host finalize；resume completion 必须覆盖 claim 前到 finalize 的完整区间，RunSupervisor 的 `awaiting_user/cancelled` 记录都不能冒充该完成屏障；cancel 与自然终态竞争时必须返回真实 terminal status，禁止用 active 列表缺失制造 409；
8. 对话 cleanup 必须枚举全部 foreground/auxiliary root，并在 root completion 后复查 child；不能只复用 foreground UI 投影或逐 child 等 Supervisor terminal；
9. start、resume、auxiliary、child 都要验证 identity 与 visibility；
10. 更新 Graph README、Linnkit realtime 接入文档、Conversation architecture；
11. 增加真实业务链测试，验证 live / durable parity、wait-user、自动压缩 durable commit port、并发隔离与失败传播；修改 incoming fact 或 Conversation UI payload 时必须经过真实 SQLite 事实写入、UI row、SSE 与 reload 读取，不能用 mock persistence 代替生产投影。
12. Flow 集成测试必须让 incoming 与 generated facts 进入同一个底层测试 Store，并从 history/replay 结果断言业务事实；禁止依靠未装配的进程 fallback Store 让测试偶然通过。
13. composition root 必须把同一个 runtime scope 同时交给 FlowOrchestrator、AgentRunner 和 registered child invoker；执行过程中不得再次查询全局 Store、Supervisor、CostCollector 或 AuditPort。
14. `registeredChildRunInvoker` 由 AgentRunner 注入 root ToolContext，递归 child 继承同一实例；缺端口必须在 child admission 前失败。

## 10. 禁止项

- 禁止 AgentRunner 或 Graph 直接调用 transport sink。
- 禁止 Host 手写第二套 RuntimeEvent → SSE mapper。
- 禁止从 realtime sink 回收 RuntimeEvent，或让 sink 返回额外事实。
- 禁止正常业务事实绕开 RuntimeEventPublisher。
- 禁止 mapper、Graph local、bridge 或 execution-scoped metadata wrapper 附着 routing identity。
- 禁止 `TickOutput.newEvents`、collector 或 Graph result 维护平行事件集合。
- 禁止结束时批量补写 Graph returned events。
- 禁止以 event.id 去重掩盖双事实源。
- 禁止 publisher 后修改 payload。
- 禁止吞掉 schema、publisher、persistence 或 lifecycle 错误。
- 禁止以 conversation active state 替代 run / execution identity。
- 禁止辅助 Agent 与正文 Agent 共享 runId、checkpoint 或 visibility。
- 禁止用 mapping metadata 在 hook、runner 和 settlement 之间偷渡关键返回值。
- 禁止将 EOF 或 transport close 当作 run completed / failed。
- 禁止 cancel HTTP 在原 execution 的 durable drain / Host finalize 之前返回成功。
- 禁止用 active-run 列表判断精确 cancel 目标是否存在，或把自然终态竞争返回成 409。
- 禁止在 EventStore adapter 临时补建缺失 run；缺 run 是生命周期错误。
- 禁止 FlowOrchestrator、runner 实现或测试执行逻辑从进程全局读取另一套 EventStore；全局 getter 只允许出现在应用 composition root 或测试 fixture 装配层。
- 禁止 root 与 child 分别捕获不同批次的 Supervisor、EventStore、Audit、Telemetry、CostCollector 或模型输入端口。
- 禁止模块级 child invoker、运行时懒初始化和缺端口时创建 Memory runtime。

## 11. 回归门禁

修改 Flow 数据流至少验证：

- Provider chunk 到 live final answer，再到 durable final answer；
- 工具前答案段、工具事件、工具后答案段的顺序；
- wait-user 立即可见、切会话重载、提交 resume；
- AbortError 保留 partial final answer，不生成普通 runtime error；
- persistence drain 失败时 run 为 failed；
- foreground 与 auxiliary 同时运行不串消息；
- wait-user resume 在 claim / incoming commit 期间并发取消时，cancel 不得先于该 Host execution finalize 返回；
- 多 child trace 归属正确；
- 两套 runtime scope 并发运行时，root/child 事实、生命周期与审计完全隔离；
- root 与 child 的 compaction 都必须先 durable commit `history_summary` 再调用主 Provider；commit 失败、硬超限无候选和 wait-user resume 后再次压缩均不能产生双事实；commit 后 publisher 失败仍保留已提交摘要；
- SSE 答案 seq 与 execution_seq 独立；
- Host Flow 与 Renderer projection 的端到端流程。

不要用组件样式、README snapshot 或旧内部类调用次数代替业务测试。
