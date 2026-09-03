# Child Runs · 同步嵌入 vs 异步后台子 agent

> **What** · 两种子 agent 调用形态 —— `invokeChildRun`（同步嵌入，父 agent 等结果）vs `spawnDetached`（异步后台，立刻返回 `RunHandle`）。
> **When to read** · 多 agent 协作；要在一个 agent 里调另一个 agent；想做后台调度 / 长任务 / 通知触发。
> **Prerequisites** · [`run-supervisor.md`](./run-supervisor.md)。
> **Key exports** · `invokeChildRun` / `spawnDetached` from `@linnlabs/linnkit/runtime-kernel`。
> **Related** · [`run-supervisor.md`](./run-supervisor.md) · [`agent-registration-guide.md` §6](./agent-registration-guide.md) ⭐

linnkit 提供**两条 API**承载"子 agent"概念。它们不是配置开关，是两种本质不同的调用形态——按需选用。

## 1. 概念对照

| API | 场景 | 语义 |
|---|---|---|
| `toolContext.invokeChildRun(...)` | 父 agent 工具内**同步调用**子 agent | 父等待子完成；用于 deep search / task subagent 这类嵌入式执行 |
| `runSupervisor.spawnDetached(...)` | 顶层后台任务、定时任务、wake hook、在线秘书 | 立刻返回 handle；调用方后续 `peek / waitForTerminal / cancel / drain` |

## 2. 何时用同步 `invokeChildRun`

适合场景：

- 子 agent 是**父 agent 工具的实现细节**（"调用搜索 agent → 取结果作为本工具的 observation"）
- 调用方需要立刻拿到子 agent 的结构化输出来决定下一步
- 子 agent 的成本/取消语义跟父 agent 绑死（取消父则子必停）

调用形态：在父 agent 的某个工具实现里调 `toolContext.invokeChildRun(spec)`。返回值是 child run 的最终输出，且 child run 内的 LLM cost / tool cost 会自动归到父 run 的 `childrenTotal`。

## 3. 何时用异步 `spawnDetached`

适合场景：

- 任务由**外部触发器**（HTTP / cron / wake hook / 用户在前端点了"启动一个后台代办"）触发
- 调用方**不阻塞**等待结果——立刻拿 handle 用于 cancel / observe / cost
- 子 agent 与父 agent 的生命周期解耦（子 agent 失败不直接导致父 agent 失败）

骨架：

```ts
const supervisor = new runtimeKernel.runSupervisor.DefaultRunSupervisor({
  registryStore,
  executor: {
    async execute(ctx) {
      // 这里接你自己的 GraphExecutor / daemon runner。
      // ctx.signal、ctx.eventBus、ctx.eventStore、ctx.costCollector 都来自 register spec。
      await runYourAgent(ctx);
      return {
        runId: ctx.runId,
        status: 'completed',
        completedAt: Date.now(),
      };
    },
  },
});

const handle = await supervisor.spawnDetached({
  conversationId,
  agentSpec,
  request,
  eventBus,
  eventStore,
  costCollector,
  wakeSource: 'cron',
  iterationBudget: { max: 20, refundable: true },
});

const outcome = await supervisor.waitForTerminal(handle.runId);
```

`spawnDetached` 与 `registerRun + 自己跑` 等价，但显式告诉 supervisor"这不是同步等结果的 run"——`RunRegistrationSpec.wakeSource` / `iterationBudget` / `ephemeral` 等字段都在这里生效。

## 4. 命名注意

- 公开 namespace：`runtimeKernel.childRunTrace`（含 `subrun_trace` 观测协议 publisher 与合同）。
- 事件 type 仍叫 `subrun_trace`（前端可继续按这个名字处理）。
- 内部目录是 `child-run-trace/`；外部消费者一律走公开 namespace。

## 5. 关键边界

- **不要**把 `invokeChildRun` 当成"小一号的 run"——它本质上是父 run 内部的一个嵌入式调用，与父 run 共享 abort signal、cost 聚合、enrichment registry。
- **不要**把 `spawnDetached` 用于工具调用流（HTTP 端到端响应里不应该等 spawnDetached 完成）——那是 invokeChildRun 的场景。
- 父子 run 的 cost 通过 `scope.parentRunId` 关联；如果你的 telemetry adapter 没把 `parentRunId` 透传到 sink，那 `childrenTotal` 字段就是 0。
- 同步 child-run 的 `conversationId` 是宿主审计/事件归属，不是内部 checkpoint key。host 如果先用 `RunSupervisor.registerRun({ runId: childRunId, conversationId })` 注册 child run，随后调用 `ChildRunInvoker` / `invokeChildRun` 时也必须传入同一个 `conversationId`。框架内部会继续使用独立 checkpoint key 隔离子图状态，但 RuntimeEvent / Audit / Telemetry 会落在这个 host conversation 下。
- 同步 child-run 在图启动前必须把任务文本接纳为唯一一条正式 `user_input`：先经 child `RuntimeEventSink` 获得 `lane=child / visibility=parent-trace` 的 routed identity，再把同一个事件放入初始 history，并将其 ID 写入 request `currentUserEventId`。后续每个 LLM tick 都按该身份定位当前用户输入，禁止根据 `request.query` 重建新 ID、新 timestamp 的临时用户消息。
- child `user_input` 是 incoming fact，不是 graph 生成结果，因此进入 child EventBus / EventStore 和初始 history，但不重复加入 `ChildRunInvokeResult.events` 或 transcript 的 graph event 段。深度门禁与 pre-abort 检查都必须先于任务 admission：调用前已经取消时直接返回 cancelled result，不创建图节点，也不发布 `user_input`；只有真正开始执行的 child 才接纳任务事实。执行开始后的取消继续保留已经接纳的事实与 checkpoint 恢复结果。
- child 与 parent 共用 `conversationId` 不代表共用正文。child 原始事实持久化用于审计和上下文恢复，Conversation 主时间线只恢复 foreground/conversation；父工具卡只从 parent `subrun_trace` 展示 child 过程。
- 父会话历史继承与 Host 环境注入是两份独立合同。Host 可以在 root admission 时把项目、当前文件或当前视图等通用 `fences[]` 冻结到 `ToolExecutionContext.childRunContextInjections`；ChildRunInvoker 只透传这些开放 kind，不解释产品语义。selection、附件或其它临时授权是否进入 child 仍由 Host 显式决定，不能由 `inheritTurns` 顺带扩大。
- parent `subrun_trace` 始终是 ephemeral live presentation。重启后的卡片历史由 Host 对已 admission trace 建立的紧凑 read model 提供；Linnkit 不依赖宿主数据库，也不提供持久化开关。
- Linnkit 的实时答案协议始终是 chunk 创建正文、完整答案负责 durable 封口。Host 的紧凑历史可以只保存完整答案快照，但必须在自己的历史读取边界把它规范化为一次性 chunk 与原封口，再进入 Host 的正式 presentation admission；不得为历史重载而放宽 Linnkit 实时合同，也不得让完整答案直接创建第二条正文链。
- child 工具 decision 投影为一条携带 canonical `tool_calls[]` 的 trace，保持一个 child fact 对应一个 `source_event_id`。decision 只是 durable replay 输入，不表示工具开始；真实开始的 `tool_process` 必须携带 owner admission 后的 args，terminal `tool_output` 必须携带结构化 output。已退役的 decision 标量字段不属于当前合同。
- EventStore 的默认 `readEvents()` 必须保持无损事实读取，供审计与 child 恢复使用；foreground Agent 构建历史时必须显式请求 `lane=foreground / visibility=conversation` 的 routing scope。缺少 routing identity 的 payload 不属于当前 Runtime 合同，读取主链必须拒绝，不能根据存储关系恢复或猜测身份。
- 同步 child-run 的失败统一走 Result：普通失败返回 `{ success:false, error }`，取消返回 `{ success:false, cancelled:true, error }`。执行开始后，传给 Graph/provider 的受控 `AbortSignal.aborted` 是取消判定权威；provider 即使把取消包装成普通 Error，也不得把 child lifecycle 写成 failed。错误名称只作为标准 AbortError 的补充识别。
- 同步 child-run 不支持 `wait_user`。一旦路由到交互节点或产生 `requires_user_interaction`，必须返回明确失败并保留该事实事件，交互应上提给 foreground run；禁止把 child run 伪装为 completed，或让多个 child 共用正文 interaction。
- 同步 child-run 默认最多嵌套 4 层。父上下文 `childRunDepth` 已到上限时，`invokeChildRun` 直接返回 `{ success:false, error }`，不会继续启动子图，避免工具递归耗尽资源。
- 异步 `spawnDetached` 不创建同步 child-run 的内部 checkpoint key；它注册的就是一个真实 run，`RunExecutionContext.conversationId/runId/parentRunId` 必须与 `RunRecord` 对齐。executor 读取的是注册时的 `AgentSpec` / request / metadata 快照，不应依赖调用方之后继续修改对象。
- child lifecycle 汇总的唯一 owner 是 `RunRegistryStore`。按父级读取必须使用 `supervisor.list({ parentRunId })`；EventStore、parent trace、Telemetry、CostCollector 与 LLM Audit 只承担各自的事实或观测职责。
- cancelled child 返回 Result 后，Host lifecycle 必须把 `stepCount` 作为取消 patch 写入 run registry，并把 `currentNode` 收口为 cancelled。不能因为外部取消请求已经先写终态，就永久保留旧的 `llm` 节点和初始迭代数。
- child provider 在取消或失败前已经产生 thought 时，streaming adapter 必须发布同 `thought_message_id` 的完成事实；parent trace 原样投影该封口。UI 只能消费 trace，不能根据父工具结束或页面重载自行结束 thought timer。
- terminal waiter 不缓存 child lifecycle 快照。同步 child 调用方先等待 invoker settlement，再使用 `list / peek / waitForTerminal` 从 RunRegistryStore 读取最终进度；detached child 则由 Supervisor 等 executor settlement 后唤醒 waiter。
- 所有会启动可见 child 的工具结果都必须用 `data.subrun_ids: string[]` 声明权威 child 清单。单 child 也使用单元素数组，不另设 `subrun_id` 结果别名。
- Renderer 必须把 live 首条 `subrun_trace` 形成的 summary 身份与父工具 presentation 原子提交；terminal result 与 summary 同时存在时必须逐项一致。卡片不得从 raw result、数组下标或“父调用下只有一个 bucket”猜 child 身份。
- 历史 detail 读取必须同时携带消息所属 `conversation_id`、`parent_tool_call_id` 与 `subrun_id`。消息所属会话由 render host 在挂载边界固定，不能由叶子卡片在展开时读取全局 active conversation。

### 5.1 Host runtime scope

Linnkit 只定义 child-run 原语和端口，不替 Host 选择全局实例。Host 必须在 composition root 完成一次 execution runtime 装配，并保证 root 与 child 使用同一批 Supervisor、EventStore、cursor factory、CostCollector、AuditPort、TelemetryPort 和模型输入能力。

同步 child invoker 应作为 ToolContext capability 显式注入。root ToolContext 接纳该实例，派生 child ToolContext 继续继承，因此递归 child 不需要第二套 registry 或异步全局上下文。缺少 capability 表示 Host 装配不完整，必须在 child admission 前失败。

以下做法违反生命周期合同：

- 模块级 lazy child invoker；
- lifecycle 或 factory 在执行时分别读取 global getter；
- runtime 重建后继续复用旧 invoker；
- root 使用显式 Store、child 却回退 Memory 或进程默认 Store；
- 测试显式注入正确端口，而生产 ToolContext 依赖 fallback。

进程级 singleton 可以是 composition root 的一种实现，但只能在装配时读取一次并形成不可拆分的 scope，不能成为执行链中随处可查的 service locator。

## 6. 最小验证

- 单测：父 agent 工具内 `invokeChildRun` → 父 run 的 `cost().childrenTotal.llmCost > 0`
- 集成测：child run 内部调用工具时，`model.select` / `tool.allow` audit envelope 的 `scope.conversationId` 与注册 child run 的 conversationId 一致，`scope.runId` 是 child runId。
- 单测：child run 的 `abortSignal` 在调用前或执行中触发时，即使 provider 抛普通 Error，`invokeChildRun` 仍 resolve 出 `cancelled:true`，而不是 reject 或写成 failed。
- 单测：父上下文 `childRunDepth` 已达 4 时，`invokeChildRun` 返回失败结果且不会创建 LLM node / GraphExecutor 子图。
- 图路由业务测：child 连续经历 LLM → tool → LLM 时只发布一条 `user_input`，两轮 request 的 `currentUserEventId` 相同，工具结果之后 current user 仍位于原始事实位置而不是末尾重新出现。
- 图路由业务测：同步 child run 进入 `wait_user` 时返回 `success:false`，错误明确要求 foreground run 承担交互，且事件中仍保留 `requires_user_interaction`。
- 单测：`spawnDetached` 立刻返回；executor 收到注册时的 `conversationId/runId/parentRunId` 与 request 快照；`waitForTerminal` 在执行结束后 resolve 出 store 中的最终 status
- 单测：`spawnDetached` 中的 run 被 `cancel()` 后，executor 收到的 `ctx.signal.aborted === true`
- 生命周期集成测：外部先取消执行中的 child，child 返回后 `runs.status=cancelled`、`currentNode=cancelled` 且 `iterationsUsed` 等于真实 stepCount；取消审计和资源释放只发生一次。
- detached 集成测：外部取消后 executor settlement 前 waiter 不返回、资源不释放；settlement 后 outcome 与 RunRegistryStore 的最终进度一致。
- Host 集成测：同时创建两套 runtime scope 并并发执行 child，分别从两套 EventStore、RunSupervisor 与 Audit 读取结果；任何一侧都不得出现另一侧的 run 或事实。
- 递归集成测：root 注入的 child invoker 在派生 child ToolContext 中保持同一实例，内层工具继续使用同一 runtime scope。
- Renderer 集成测：真实父工具投影在首条 child trace 后原子获得 `subrunId`；父 virtual row 只渲染轻量进度，完整 child messages 经独立正式 admission 后在 Host detail 表面展示。测试必须锁定 decision batch 无可见 queued 步骤、process 后 loading、output terminal、reload 缺 process 时仍从 decision 恢复 args、紧凑历史缺 answer chunk 时从 durable 完整答案恢复正文、live 完整答案缺 chunk 时继续拒绝，以及 detail 请求总是携带 `conversation_id + parent_tool_call_id + subrun_id`。
