# Linnya Backend Child Runs

Layer: `host-adapter/child-runs`

这里承接 Linnya 宿主对 child-run 的默认装配与注册解析。  
如果要回答“工具触发已注册 agent 时，默认是怎么解析 agent、怎么装配 invoker、怎么走 child-run 主链的”，应该看这里。

---

## 1. 模块定位

本目录负责：

- 已注册 agent 的默认解析
- 默认 `ChildRunInvoker` 宿主装配
- registered child-run 的默认调用入口

本目录不负责：

- child-run runtime 协议本体
- graph-engine 主循环
- 工具如何决定是否触发 child-run

---

## 2. 核心职责

1. 把 registry 里的 agent definition 转成 child-run 可执行配置
2. 提供 Linnya 默认的 `ChildRunInvoker` 装配
3. 提供默认的 registered child-run 调用入口
4. 把 agent registry、tool runtime、observation preview 和 child-run 原语接起来
5. 装配 child fact 到 parent `subrun_trace` 的宿主发布端口

---

## 3. 关键边界 / 不变量

1. 这里只做 host default assembly，不定义 child-run runtime 协议
2. child-run 原语、history policy、最小上下文仍属于 独立 Linnkit 仓的 `src/runtime-kernel/child-runs/*`
3. 只有“已注册 agent”才能走这条默认调用链
4. registered child invoker 必须由 composition root 创建并经 ToolContext 显式注入，不存在模块级默认实例
5. parent trace 是 child fact 的展示投影；关键关联字段使用 Linnkit 共享 schema，不在 metadata 中另造别名
6. root 与所有递归 child 必须持有同一个 `LinnyaAgentRuntimeScope`；缺少 invoker 是 admission error，不允许回退全局 getter

---

## 4. 详细目录树

```text
src/app-hosts/linnya/adapters/child-runs/
├── README.md
├── childRunLifecycle.ts        # 显式 scope 下的 registered child-run 生命周期注册/收尾
├── childRunInvokerFactory.ts   # Linnya ChildRunInvoker 依赖装配
├── registeredAgentResolver.ts       # 已注册 agent 默认解析器
├── registeredSubagentInvoker.ts     # registered child-run 默认调用入口
└── __tests__/
    └── registeredSubagentInvoker.test.ts
```

---

## 5. 真实数据流

### 5.1 已注册 agent 的默认解析链

`registeredAgentResolver.ts` 的链路很简单，但边界很重要：

1. 从 runtime-gated `AgentDefinitionResolver` 读取当前 enabled agent
2. 根据 `promptKey` 找到对应 definition
3. 通过 `toChildRunAgentConfig(...)` 转成 child-run 可执行配置

这里的关键点是：

- registry 仍是产品定义真源
- 但执行前要先被压成 runtime 可消费的最小配置

### 5.2 ChildRunInvoker 装配链

`childRunInvokerFactory.ts` 负责：

1. 构造默认 `ModelResolver`
2. 构造默认 `LlmNode`
3. 注入默认：
   - `toolRuntime`
   - `observationPreview`
   - `eventToMessageConverter`
4. 产出可执行的 `ChildRunInvoker`

这说明一件事：

- `ChildRunInvoker` 真正的执行原语已经是 runtime-kernel
- 但默认如何接上 Linnya 的 model resolver / tool runtime / preview，是这里的职责

### 5.2.1 child-run 生命周期

`childRunLifecycle.ts` 负责把 registered child-run 接入 Linnya 宿主的 run lifecycle：

1. 执行 child-run 前先调用 `RunSupervisor.registerRun({ runId: subrunId, parentRunId })`
2. 注册时复用宿主 `RunEventStore / RunCostCollector / AgentSpec`
3. child-run 开始、成功、失败、取消时同步更新 run registry 状态
4. 创建 child `RuntimeEventPublisher`，把 `lane=child / visibility=parent-trace` 的唯一 sink 注入 Graph
5. 让共用 `EventBusEventPersistence` 与 parent trace projector 订阅同一个 child EventBus
6. terminal 前依次 drain child persistence 与 parent projection；失败时把 child 标记为 `failed`，禁止虚假 `completed`
7. 关闭本次 child-run lifecycle 的 EventBus；cost bucket 保留到父 run 结束，保证父 run 的 `childrenTotal` 仍可观测

中文备注：
- `ChildRunInvoker` 内部的 LLM tick 会通过 EventStore-backed `AuditPort` 写 `audit_envelope`；
- `LinnyaEventStoreAdapter.append()` 只允许向已存在的 run append，因此 child-run 必须先注册 run；
- 禁止在 `SQLiteEventStore.openRunSession()` 或 adapter 里自动补 run，否则会掩盖上游生命周期错误。
- 不在 child-run 完成时单独 `release(childRunId)`：否则父 run 结束前查询 cost 时会丢失 `childrenTotal`。
- root 与并发 child 共用当前 runtime scope 的 `nextEventStoreId` owner；每个 run 各建 cursor factory 会破坏 EventStore 全局分页顺序。

### 5.2.2 Runtime scope 所有权

应用 composition root 在数据库、Supervisor、Audit、Telemetry 与模型输入端口完成装配后，只创建一个 registered child invoker。该实例经 `AgentRunnerService` 和 `createToolContext()` 进入 root ToolContext；递归 child 通过 ToolContext 派生继承同一实例。

生命周期依赖必须一次性来自同一个 `LinnyaAgentRuntimeScope`：Supervisor、EventStore、cursor factory、CostCollector 与 AuditPort 不得分别查询进程全局状态。否则 runtime 重建、双 workspace、benchmark 或并发 host 会出现 child 事实、审计和 run registry 分属不同作用域的问题。

`registeredChildRunInvoker` 是执行能力，不是可选增强。需要启动 child 的工具在 admission 前发现该端口缺失时必须明确失败；禁止静默创建默认 invoker、MemoryEventStore 或无审计 child。

### 5.2.3 Lifecycle 汇总 owner

SQLite `runs` 表（经 `RunSupervisor / RunHandle` 读写）是 subrun lifecycle 汇总的唯一
owner。按父级展示或诊断时统一使用 `supervisor.list({ parentRunId })`；child EventStore 是
运行事实，parent trace / `subrun_summary` 是 UI read model，Telemetry 和 LLM Run Audit 是
短期观测面，均不得复制 status 统计。

外部取消会先触发 abort 并写 `cancelled`，child Result 稍后才带回真实 `stepCount`。因此
`markCancelled()` 必须在 drain 后用 lifecycle patch 把 `currentNode=cancelled` 和
`iterationsUsed=stepCount` 写回同一终态。该补全不得再次触发取消审计、callback 或资源释放。
同步 invoker 返回后，`list / peek / waitForTerminal` 必须从 SQLite `runs` 读取这份补全结果；
禁止在 Supervisor waiter 或 host adapter 缓存取消瞬间的旧 outcome。

工具输出只通过 `data.subrun_ids` 暴露权威 child 清单。即使一次只启动一个 child，也使用
单元素数组；trace 负责追加事件计数，不能成为“child 是否存在”的唯一证据。

### 5.3 Registered child-run 调用主链

`registeredSubagentInvoker.ts` 的真实链路是：

1. 接收 `RegisteredChildRunRequest`
2. 从 parent tool context 中读取：
   - working history
   - modelId
   - abort signal
   - trace publisher
3. 根据 `historyPolicy` 选 seed history
4. 通过 `registeredAgentResolver` 找到 agent config
5. 默认路径必须从父上下文拿到 `conversationId` 与父 `runId`，再通过 `childRunLifecycle` 注册 child run
6. lifecycle 把正式 child `runtimeEventSink` 注入默认 `ChildRunInvoker`
7. child EventBus 将同一事实 fan-out 到持久化、RunHandle observation 和 parent trace projector
8. terminal drain 成功后，根据执行结果标记 child run completed / failed / cancelled
9. 把结果投影回 `RegisteredChildRunResult`

也就是说：

- 工具侧只需要知道“调用 registered child-run”
- 真正的 agent 解析、history seed、default invoker 装配，都在这里统一收口
- Linnkit 已把同步 child-run 的取消归一化为 `{ success: false, cancelled: true }`；本适配器必须原样透传并把 run lifecycle 记为 `cancelled`，不得再抛成普通执行异常或写成 `failed`
- child 执行链自己的 `AbortSignal.aborted` 是取消判定权威；provider 抛出的 Error 名称和文案不是 lifecycle 协议。child 已产生的 thought 必须由 Linnkit streaming adapter 在任意 provider 退出路径封口，再通过标准 trace projector 到父级。
- 默认 lifecycle 下，child Graph 必须消费 `RunHandle.signal`；它同时承接父 signal 和 `RunSupervisor.cancel(childRunId)`，禁止绕回只读原始父 signal
- 工具层可见 child 必须统一经 `src/tools/agent_control/subrun/shared/` 公开入口调用；该入口拥有父工具绑定，subagent、batch 与产品工具不得各自拼 `tracePolicy`
- 缺少 `parentToolCallId` 或 `createSubRunTracePublisher` 时，可见 child 必须在启动前失败；禁止静默退化为“child 已执行但父工具卡没有 trace”

### 5.4 Parent trace 协议

Linnkit 的纯函数 `projectChildRuntimeEventToSubRunTrace()` 统一决定 child fact 到 parent trace 的选择和字段映射。Linnya 只负责把父工具绑定与父 runtime publisher 注入，不得在 subagent、batch 或具体产品工具里复制映射 switch。

`ChildRunParentTraceProjection` 只能作为 child EventBus consumer 使用。禁止把 trace publisher 重新传给 `ChildRunInvoker`，也禁止在 Graph sink 内同时 route child identity 和发布父 trace；这会绕过 child persistence，并让父 trace 取代 child truth。

每条 parent trace 必须保留 child `source_event_id`；答案 trace 还必须保留 `answer_id / seq / is_last`。这些字段参与历史归并和答案拼接，不能塞入 `meta`。已 durable commit 的 child `history_summary` 只投影统计与替换来源 ID，供完整详情复用现有 Summary 行；不得复制摘要正文，也不得把 compaction 临时进度投影成已完成事实。工具可以把 child final answer 写入父 Agent observation，但 Renderer 不得从工具结果补造 SubrunCard 正文。

成功 child `tool_output` 可以额外投影顶层、有序的 `RuntimeResourceRef`，供完整 Subrun 详情复用正式工具卡和受管图片预览。失败 output 与其他 trace kind 不允许携带附件；Linnya publisher、紧凑历史和查询重建必须保持 refs 顺序，不得把它们塞进 output/meta，也不得携带图片字节或 host 物理路径。该字段只服务 UI read model，不会进入父 Agent 的消息或模型输入。

parent `subrun_trace` 始终是 `ephemeral` 实时展示协议，不进入通用 `events`。Host projector 只把完整 thought、工具 decision/terminal、已提交 `history_summary` 和完整 answer 写入 `subrun_trace_runs / subrun_trace_items`；历史 API 按 `parent_tool_call_id + subrun_id` 读取并重建同一公开 DTO，不保存逐 chunk 动画帧。

`metadata/meta` 只能承载删除后不影响正确性的展示或诊断信息。若产品 workflow 需要把 subrun 绑定到写入目标，app-level orchestration 应从已校验的请求 DTO 预先建立 `subrun_id → 业务目标` 映射；收到 trace 后只用顶层正式 `subrun_id` 查表。具体工具不得把业务目标塞进 trace metadata，再让 Renderer 以它决定副作用。

---

## 6. 最容易放错层的改动

1. child-run history policy 本体
   - 不属于这里，属于 runtime-kernel/child-runs
2. agent definition 本体
   - 不属于这里，属于 agent-registry
3. 工具侧触发时的产品结果整形
   - 不属于这里，属于 concrete tool / product 层
4. graph loop 或 node 语义
   - 不属于这里，属于 runtime-kernel/graph-engine

---

## 7. 开发注意事项

1. 如果改的是“默认 registered child-run 怎么接上”，优先改这里
2. 如果改的是 child-run 协议最小字段，去 `runtime-kernel/child-runs/*`
3. 如果改的是 agent 可注册定义，去 `src/app-hosts/linnya/agent-registry/*`
4. 不要再恢复旧 `core/graph-engine/internal/index.ts` 那种 compatibility facade
5. 不要在 lifecycle、factory、工具入口或测试中增加 module singleton / global getter fallback
6. 新 host 必须在 composition root 构造 runtime scope 和 registered child invoker，再把窄端口注入 ToolContext
7. runtime 重新装配后不得复用旧 invoker；实例生命周期必须与其 scope 完全一致
8. lifecycle 汇总只能读取 RunSupervisor；禁止从 trace、Audit 或 Telemetry 反推 child status
9. 新增可见 child 工具时，结构化结果必须返回 `subrun_ids`，不新增单数结果字段

---

## 8. 最小回归集合

改默认 child-run 装配时，至少补或复跑：

- `src/app-hosts/linnya/adapters/child-runs/__tests__/registeredSubagentInvoker.test.ts`
- `src/app-hosts/linnya/adapters/child-runs/__tests__/childRuntimeScopeIsolation.integration.test.ts`
- `src/app-hosts/linnya/adapters/child-runs/__tests__/childRunCancellation.sqlite.integration.test.ts`
- 其中必须包含 SQLite-backed `RunSupervisor + LinnyaEventStoreAdapter + EventStoreAuditPort` 路径，避免测试只走 MemoryEventStore 而漏掉真实 run lifecycle 问题
- SQLite 路径必须验证 child durable fact 与紧凑 parent trace history 的 `source_event_id` 关联，以及 projector / persistence 失败不会留下 completed run
- `src/app-hosts/linnya/adapters/flow/agent-runner/__tests__/childRunInvokerFactory.test.ts`
- 独立 Linnkit 仓的 `src/runtime-kernel/child-runs/__tests__/childRunInvoker.test.ts`

如果改的是工具侧 child-run 主链，再加：

- `src/tools/agent_control/subrun/shared/__tests__/subagentRunner.parallel.test.ts`
- `src/tools/agent_control/subrun/shared/__tests__/subagentRunner.integration.test.ts`
- `src/tools/agent_control/subrun/subagent/__tests__/subagentTool.failure-recovery.integration.test.ts`
- `src/tools/deep_research/__tests__/researchSubagentWorkspace.integration.test.ts`

Host 端到端测试必须按事实 owner 取数：run 注册前提交的 `user_input` 从会话输入事务读取；EventBus 接纳的工具、答案与 `subrun_trace` 从 Linnkit EventStore 读取。不得再从旧 collector 或 Graph 返回数组断言运行事实，否则测试会绕开生产持久化主链。

涉及装配生命周期时，还必须并发创建两套独立 runtime scope，证明 child 事实、Audit、Supervisor 状态和 cursor 不进入对方。只在同一个全局 runtime 内跑两个 child，无法发现跨 workspace 或 runtime 重建后的实例泄漏。

涉及取消时，还必须覆盖 supervisor 先取消、child 后返回 Result 的真实时序，并从 run registry
断言迭代数和终态节点已补全；只断言 AbortSignal 或返回值 `cancelled=true` 不足以证明持久状态正确。

涉及父级同一 decision 的多个串行 child 工具调用时，还必须覆盖首个执行中取消、后续调用未启动的场景，并关闭重开 SQLite 后通过正式 history reader 断言所有 tool call 已配对且不存在 loading 行。

---

## 9. 相关文档

- 独立 Linnkit 仓的 `src/runtime-kernel/README.md`
- 独立 Linnkit 仓的 `src/runtime-kernel/graph-engine/README.md`
- `src/app-hosts/linnya/adapters/flow/README.md`
- `src/app-hosts/linnya/agent-registry/README.md`
