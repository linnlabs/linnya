# 08 · 生命周期与执行态

> **What** · 组件挂载边界、run / transport / 导航三种生命周期的区分、HITL 控制面、取消三层屏障。
> **When to read** · 改 Surface / Host 结构、改取消或恢复流程、排查"切换不过去 / 半屏残留 / 取消后卡 loading"之前。
> **不变量** · [INV-30](./00-invariants.md#inv-30--运行态常驻不等于-dom-常驻)、[INV-29](./00-invariants.md#inv-29--projection-runtime-属于-conversation不属于当前页面)、[INV-06](./00-invariants.md#inv-06--释放语义分层)、[INV-31](./00-invariants.md#inv-31--请求--流实例作用域并发模型)、[INV-03](./00-invariants.md#inv-03--事实身份只在-durable-commit-后成立)、[INV-13](./00-invariants.md#inv-13--command-身份不能泄漏到-read-model)、[INV-32](./00-invariants.md#inv-32--取消完成是三层屏障不是-transport-状态)、[INV-33](./00-invariants.md#inv-33--跨-domain-执行态隔离)
> **Related** · [05 live 投影](./05-live-projection.md) · [06 read model](./06-read-model.md) · [07 渲染](./07-render.md)

---

## 1. 三种生命周期不可混用

这是本域最容易出错的地方。三者**互相独立**：

| 生命周期 | 由什么驱动 | 终点信号 | 释放什么 |
|---|---|---|---|
| **run** | 业务执行 | terminal `run_status` | 整个 run 及其 tool 索引 |
| **transport** | 网络请求 | `transport_end` / `transport_error` | 该 execution 的 controller 与在途答案状态 |
| **导航 / DOM** | 用户切页 | 组件卸载 | 只有 DOM 与展示选择 |

**导航不是 Runtime 生命周期事件。** 侧栏切换既不取消 run，也不释放投影（[INV-29](./00-invariants.md#inv-29--projection-runtime-属于-conversation不属于当前页面)）。

> 教训 8：可见页面不是运行态 owner。
> 教训 9：store 常驻不能推导出组件常驻。

---

## 2. 组件挂载边界（[INV-30](./00-invariants.md#inv-30--运行态常驻不等于-dom-常驻)）

**Surface 是内容结构的唯一 owner。** 空态与 `ConversationHost` 用 `v-if` / `v-else` **原子互斥**：

```html
<!-- ConversationChatSurface.vue -->
<div v-if="!shouldMountHost" class="empty-state-layout"> ... </div>
<ConversationHost v-else ... />
```

`shouldMountHost` 由 `shouldMountConversationHost(contentPhase)` 统一决定（[06 §5](./06-read-model.md)）：

```text
draft / ready-empty     -> false
history-loading / ready -> true
```

进入 `draft / ready-empty` → 卸载 Host。返回非空或历史 loading → 重新挂载。

这里统一的是**内容 owner、相位判断、消息列和输入框规格**，不是强迫所有 placement 使用相同排版：主区把 regular 输入框放在居中空态中；右侧复用 `ConversationEmptyState`，将同一个 regular 输入框放在底部 footer。位置与视觉密度必须独立，`side-pane` 不得映射成 `compact`。两种空态都只能拥有一个 composer，也都不能为了复用 footer 而重新常驻 Host。

### 2.1 为什么不能用 v-show 保留 Host

这条不变量是**真实事故**换来的，不是理论洁癖。

曾经为"保住后台投影连续性"把互斥分支改成 `v-show`，让 Host 常驻。后果：

```text
Host 常驻 → ConversationView（虚拟列表）、TimelineNav（内含 Teleport to="body"）、
            panel-footer、OverlayScrollbars 实例
         → 全部在 Surface 正在 patch 的【同一个 block】内递归拆除
         → 第三方滚动 DOM、Teleport anchor、虚拟列表同时争抢 vnode 所有权
```

Vue 内部表现为 `getNextHostNode` 读到 `el === null`、`unmountComponent` 读到 `component === null`。因为 `componentUpdateFn` 在 `patch` **之前**就把 `instance.subTree = nextTree` 赋值了，一次 patch 抛出会留下半挂载树作为下次更新的"旧树"，错误自我延续。又因为整个 flush 跑在 promise 微任务里，**一次抛出会中止该 flush 中其余所有组件更新**。

用户可见症状正是：

- 会话切换永远走不完（"切换不过去"）
- 新建对话时空态插到页面上半部，下半部仍是旧会话（`display:none` 与旧 View 的卸载都没执行）

**正确边界**：Surface 原子换树，store 独立续跑。后台投影连续性由 conversation-scoped store 保证（[05 §4](./05-live-projection.md)），**不得把组件实例当作 runtime owner**。

### 2.2 Host 内部资源跟随真实挂载周期

Host 内的 OverlayScrollbars、virtualizer、Teleport、observers 只跟随**真实组件挂载周期**创建和销毁。

禁止：

- 为保留后台投影而常驻隐藏 DOM
- 让延迟 projection commit 参与 DOM 生命周期决策

工作区主区和右侧都先进入 app-level `WorkspaceConversationSurface`，再进入同一个 `ConversationChatSurface` 状态机。`ConversationSidePane` 只是布局壳，不能成为第二个内容 owner；它只把 `side-pane` presentation 和可见活动态向下传递。项目初始化页属于预先 materialize 正式会话的专用嵌入场景，不得反向成为工作区 Surface 的实现模板。

### 2.3 消息树必须绑定不可变 render scope

`ConversationHost` 是导航身份 owner。它用 `conversationId` 给 `ConversationView` 建立挂载 key，
`ConversationView` 再向整棵消息树提供本次挂载不可变的 render scope：

```text
ConversationHost(conversationId owner)
  -> keyed ConversationView
  -> Message / ToolCallsMessage
  -> 需要读取历史资源的工具卡
```

叶子卡片不得直接读取 `assistantStore.activeConversationId`。active identity 会随导航变化，而
旧消息、异步组件和在途读取仍可能属于上一个 conversation；把两者组合会形成一个从未存在过的
资源地址。切换 conversation 必须重建 View，异步 continuation 只消费其所属 render scope，不能
在继续执行时重读全局 active state。

### 2.4 Host Subrun 详情不嵌套在 virtual row

Host 的 `subagent/subrun_batch` 父卡只渲染轻量进度，点击详情后由 `ConversationHost` 在同一滚动视口内用 `v-if/v-else` 结构性切换：

```text
ConversationView（父时间线）
          ↕ 结构性互斥，无 Transition
SubrunDetailSurface（完整 child 消息）
```

详情 scope 在打开时固定 `conversationId + parentMessageId + parentToolCallId + subrunId`，异步历史加载不得重读 active conversation。Host 保留 footer 与命令审批，但详情内不显示输入框。返回时按父 message identity 恢复进入前的精确 offset；不按数组下标、工具名或当前 active row 猜定位。

插件公开 `SubrunCard` 仍可使用 bounded 容器。该分支的正文必须直接条件挂载，**不得实例化 `Transition/BaseTransition`**；否则 async component、动态测高和 Transition 会共享 DOM anchor 生命周期，一次 patch 失败就可能留下 `subTree.el=null` 并持续报 `parentNode(null)`。Host 端到端测试必须覆盖父进度卡、详情切换、真实工具 presentation 和返回锚点；插件测试则单独覆盖 bounded 合同。

---

## 3. Foreground run 控制面

`features/interactive-run/` 是 conversation 正文 Agent run 的**唯一**控制状态源。状态按 `conversationId` 分区，保存：

```text
runId / turnId / executionId / status / pendingInteraction / 当前 transport controller
```

### 3.1 单 foreground run（[INV-31](./00-invariants.md#inv-31--请求--流实例作用域并发模型)）

同一 conversation 同时最多一个 active foreground run。

auxiliary run（自动标题等）拥有独立 `runId`，使用 `lane=auxiliary + visibility=none`，**不进入**正文控制状态和消息投影。

### 3.2 run 与 transport 分离（[INV-06](./00-invariants.md#inv-06--释放语义分层)）

```text
run_status      → 更新权威业务状态
transport_end   → 只释放同 executionId 的 controller
```

`awaiting_user` **仍为 busy**：输入区保持"终止"，切换会话也不取消它。

### 3.3 resume 的判定窗口

resume 从 claim 前就已经是一轮 Host execution，但 RunRecord 要到 incoming fact durable commit 后 `activate` 才转为 `running`。

这段窗口内**只能**由 Host completion registry 判断是否在途，**不能**从 `awaiting_user` 反推"没有 transport"。反推会让取消提前返回成功（见 §5）。

### 3.4 五类输入严格区分

| 输入 | 职责 |
|---|---|
| RuntimeEvent | 消息事实 |
| `context_usage_snapshot` | 每次成功 Prompt 的临时上下文占用投影 |
| `run_execution_metrics` | 工作统计投影 |
| `run_status` | 控制态 |
| `transport_end` / `transport_error` | 只收敛网络请求 |

任一类不能代替另一类。SSE 入口必须用共享 `validateSSEEvent`，并校验 wire `event:` 与 payload `type` 一致。HTTP 错误、reader 错误和缺 `transport_end` 的 EOF 只是 **transport failure**，禁止在前端伪造 RuntimeEvent `error` 或 run 终态。

### 3.5 transport failure 后的精确 run 结算

transport failure 发生时，transport owner 必须先 cancel/release reader 并释放本次 controller，随后
Interactive Run 编排才可请求：

```text
GET /conversations/:conversationId/runs/:runId/settlement
  → 等待 FlowExecutionCompletionRegistry 中该 run 的 pending completion
  → RunSupervisor.findByConversation(conversationId) 读取 durable registry
  → 校验 exact run、root、foreground 归属
  → 返回 active snapshot / terminal snapshot / null
```

这是一次精确 barrier read，不是轮询，也不允许用任意延时猜 Host 已完成取消。Host 必须先跨过同一
execution completion promise，再读取 durable run，避免在 client disconnect 与 Host finalize 之间返回
过期 active 快照。

Renderer 只同步 Interactive Run control read model：原 run 仍为 `awaiting_user` 时恢复正式 pending
interaction；同一 run 已换到新 execution 时替换旧 `submitting` snapshot；terminal 时同步真实终态；
返回 `null` 或结算查询失败时进入 `failed` 并保留 transport/projection error，不能继续无限 busy。
响应的 conversation、requested run 与 payload run 身份必须逐项相等。全过程不补造 RuntimeEvent、
`run_status` 或工具终态。

---

## 4. HITL

### 4.1 事实由 Host 创建（[INV-03](./00-invariants.md#inv-03--事实身份只在-durable-commit-后成立)）

```text
Renderer 提交 command（runId + interactionId + toolCallId
                       + checkpointRevision + resumeToken）
   ▼
RunSupervisor.claimResume() 校验
   ▼
buildInteractionResponseIncomingEvent.ts  ← 唯一转换边界
   ▼
Host admission 附着正式 run identity → 同批次 durable commit
   ▼
RuntimeEventPublisher.publishRouted() → EventBus → 实时投影
```

Renderer **不得**在命令成功前乐观写入 submitted `tool_output`，也不得在 transport 完成 / EOF 后合成或补投 committed 事件。

请求失败后查询 active-run 并以**服务端快照**收敛（`orchestration/reconcileInteractiveRunCommandFailure.ts`）。

`FlowOrchestrator` 只负责编排 claim、persist、activate、runner dispatch，不得在编排层手写 tool output 或 interaction payload。

### 4.2 命令身份不进 read model（[INV-13](./00-invariants.md#inv-13--command-身份不能泄漏到-read-model)）

`ConversationToolInteractionSchema` 是严格判别联合：

| variant | 保存 |
|---|---|
| `active` | 当前恢复凭证（`runId` / `interactionId` / `checkpointRevision` / `resumeToken`） |
| `submitted` / `skipped` / `approved` / `modified` | **只**保存展示结果（`status` / `submittedAt` / `response`） |

`toolCallId` 属于 response command，并对应工具消息 payload 顶层的 `tool_call_id`；它不是 `interaction` variant 的字段。response command 的身份在 `claimResume()` 校验后即完成职责，**不能**继续写入 terminal message metadata。

> 教训 6：committed fact 不能由客户端补造。

---

## 5. 取消：三层屏障（[INV-32](./00-invariants.md#inv-32--取消完成是三层屏障不是-transport-状态)）

取消**不是** transport 状态。foreground cancel API 只有在**全部四项**完成后才可返回成功：

```text
1. ToolNode 取消事实写入      （执行中 + 未启动的调用都要配对 tool_output）
2. execution persistence drain
3. child parent-trace drain
4. Host finalize
```

RunSupervisor 的 `awaiting_user` / `cancelled` 控制态**本身都不满足**该条件。Host 以 execution completion promise 作为屏障：

| 时机 | 登记点 |
|---|---|
| start | admission 后立即登记 |
| resume | **claim 前**登记 |

这样 interaction incoming commit、activate 与 finalize 都落在同一屏障内。cancel 必须按精确
`runId` 读取持久 run 身份，并保留该异步查询**前后**捕获到的 completion（否则查询窗口内
新建的 completion 会漏掉）。禁止用 active-run 列表做 cancel admission：自然完成会先从
active 列表消失，这只是合法终态竞争，不是 409 冲突。

cancel response 明确区分两种结果：

| outcome | 含义 |
|---|---|
| `cancelled` | 本次命令使 run 进入 `cancelled` |
| `already_terminal` | 自然 `completed/failed` 已先发生，或 run 已经 `cancelled` |

两种成功都必须已经越过同一 Host completion 屏障。run 不存在、conversation 归属错误、
目标是 child run 或收尾失败才是命令错误；不得把这些真实错误也做成幂等成功。

真源：`src/app-hosts/linnya/adapters/flow/interactive-run/orchestration/flowExecutionCompletionRegistry.ts`。

### 5.1 Renderer 侧收尾顺序

```text
1. 按 response.terminal_status 固定真实终态，中止旧 reader
2. reconcileTerminalConversationView.ts
   ├─ 当前 conversation window 重读（reconcileTerminalConversationWindow.ts）
   └─ subrun trace invalidation
```

顺序固定，不可调换。规则：

- **只有曾经请求过的 trace** 自动重读；从未展开的继续 lazy。
- revision 刷新期间**保留旧快照**，成功后原子接纳新 durable bucket。
- 用户已切走时**不得抢占**单活跃窗口；回切走正常 history loader。
- window reconciliation 失败必须**向上报告**，且不得发布虚假 trace invalidation。
- 后台 trace 重读失败保留明确日志和可重试状态，**不得**把已终态 run 恢复为 active。

### 5.2 Renderer 禁止的三件事

1. 扫描 `loading` 工具行伪造 `cancelled` / `error` tool fact
2. 依赖已中止的 SSE 恰好送达终态
3. 用 transport 状态代替 durable truth

工具终态由 ToolNode 在抛出 `AbortError` **之前**结算（[INV-25](./00-invariants.md#inv-25--工具-batch-必须完整结算)）。陈旧 live loading 由 window dominance 压过（[06 §3.3](./06-read-model.md)）。

---

## 6. 跨 domain 执行态隔离（[INV-33](./00-invariants.md#inv-33--跨-domain-执行态隔离)）

聊天、Annotation、外部 Input Extension **各自持有** controller 与同步状态：

| 域 | 执行态 owner |
|---|---|
| 正文聊天 | `features/interactive-run/` |
| 编辑器批注 | `features/annotation-run/store/annotationRunExecutionStore.ts` |
| application contributed use case | `store/executionState.ts`（**正文禁止写入**） |

Conversation 宿主只通过**窄 contract** 聚合展示与取消能力。任何 feature 编排不得直接改写另一个 feature 的 store 内部状态。

`store/executionState.ts` 只为尚未迁移的 application use case 保留，**不拥有** conversation foreground run，也不保存 HITL 状态。

Annotation 的 `persistToConversation=false` 必须显式发送 `persist=false`：不物化会话、不注入消息投影端口、不等待 ack（[02 §7.2](./02-event-pipeline.md)）。

---

## 7. 会话入口与 agent 选择

> **命名更正（[INV-55](./00-invariants.md#inv-55-workflow-product)）**：本节描述的机制是 **agent 选择**，不是 workflow。PPT / 深度研究是两个注册的 `AgentDefinition`（靠系统提示词与 skill 约束行为、保留自主权），`promptKey` 只是 agent registry 的查找键——没有步骤、没有 subrun。`workflow` 一词保留给未来可注册、可配置的显式工作流产品。

正式链路只有一条：

```text
plugin contribution agentId
  → applyConversationAgentChoice
  → Host selected-agent mutation
  → SQLite conversations.selected_agent_id
  → history list / metadata reload
  → Conversation.selectedAgentId
  → request selected_agent_id
  → Host admitConversationAgentChoice
  → 按 AgentDefinition.id 精确查找
  → 内部 promptKey
```

- **产品身份单一**：插件、Renderer、跨端 DTO 与 SQLite 共同使用 `AgentDefinition.id`；`promptKey` 只在 Host admission 之后成为单次执行的内部路由键，不进 read model、metadata 或 agent-choice contribution。
- **原子正式化**：空白草稿选择 agent 时，Host 在同一事务内正式化 conversation 并写入 `selected_agent_id`；清空空白草稿不凭空创建会话。
- **先持久化后提交 read model**：Renderer 只有在 Host mutation 成功后才更新目标 conversation；失败保留原选择，不做乐观写入或 fallback。
- **会话 ID 一次性捕获**：编排在用户动作发起时捕获 `conversationId` 与 `projectId`，任何 `await` 之后只能按该身份提交结果，禁止重读 `activeConversation`（[INV-31](./00-invariants.md#inv-31--请求--流实例作用域并发模型)）。
- **失败显式**：未知或停用的 agent 返回协议错误，不退回默认 agent。只有会话本来没有选择时，Host 才按默认 agent 规则执行。
- **合法例外**：one-shot 调用和 subrun worker 可以使用内部 `promptKey`；它们不是会话级 agent 选择，不得写回 `selected_agent_id` 或 Conversation metadata。

---

## 8. 禁止清单

| # | 禁止 | 正确做法 |
|---|---|---|
| 1 | 用 `v-show` 保留 Host | `v-if`/`v-else` 原子互斥（§2） |
| 2 | 把组件实例当 runtime owner | store 按 conversation 续跑（§2.1） |
| 3 | 常驻隐藏 DOM 保投影 | 资源跟随真实挂载周期（§2.2） |
| 4 | 让 pending commit 参与 DOM 决策 | 两者解耦（§2.2） |
| 5 | 侧栏切换取消 run / 清投影 | 导航不是 Runtime 事件（§1） |
| 6 | `awaiting_user` 当成空闲 | 仍为 busy（§3.2） |
| 7 | 从 `awaiting_user` 反推无 transport | 查 completion registry（§3.3） |
| 8 | 前端伪造 RuntimeEvent error / run 终态 | transport failure 只是 transport（§3.4） |
| 9 | 乐观写入 submitted `tool_output` | 等 Host committed fact（§4.1） |
| 10 | terminal variant 保留 resumeToken | 只保存展示结果（§4.2） |
| 11 | cancel 在控制态变更后就返回成功 | 四项屏障全完成（§5） |
| 12 | 扫描 loading 行伪造 cancelled | ToolNode 结算 + window dominance（§5.2） |
| 13 | 取消收尾抢占已切走的窗口 | 让位给 history loader（§5.1） |
| 14 | 跨 feature 直改对方 store | 窄 contract（§6） |
| 15 | `await` 后重读 `activeConversation` | 一次性捕获 ID（§7） |
| 16 | 在 Conversation metadata 或 contribution 中保存 `promptKey` | `selected_agent_id` + Host admission（§7） |
| 17 | reader 未释放就查询 active run，或用延时轮询终态 | teardown 后按 exact run 读取 settlement barrier（§3.5） |
