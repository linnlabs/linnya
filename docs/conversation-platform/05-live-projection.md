# 05 · Live 投影

> **What** · SSE 事件如何经纯函数 `reduceEvent` 变成 live message，在途状态如何按执行身份分区，何时释放。
> **When to read** · 改投影器、加事件类型、排查答案拼接错乱 / 工具卡不更新 / 切会话丢状态之前。
> **不变量** · [INV-02](./00-invariants.md#inv-02--messageprojection-是唯一投影体系)、[INV-06](./00-invariants.md#inv-06--释放语义分层)、[INV-10](./00-invariants.md#inv-10--局部-id-必须带-scope)、[INV-19](./00-invariants.md#inv-19--实时与历史答案职责分离)、[INV-20](./00-invariants.md#inv-20--空白答案不落地)、[INV-29](./00-invariants.md#inv-29--projection-runtime-属于-conversation不属于当前页面)、[INV-56](./00-invariants.md#inv-56--工具展示派生只有三个-admission-入口)、[INV-60](./00-invariants.md#inv-60--上下文占用的实时快照与结算事实分层)
> **Related** · [02 事件管线](./02-event-pipeline.md) · [06 read model](./06-read-model.md) · [08 生命周期](./08-lifecycle.md)

---

## 1. 唯一入口

`apps/renderer/domains/conversation/services/messageProjection/index.ts` 是唯一投影入口。纯函数设计，支持事件重放与状态恢复。旧 `ConversationMessageManager` 已彻底移除。

投影器按事件类型分文件（`services/messageProjection/projectors/`）：

| 投影器 | 处理 |
|---|---|
| `userInput.ts` | durable 用户消息 |
| `thought.ts` | 思考段增量合并 |
| `finalAnswer.ts` | chunk 物化与 seal 封口 |
| `finalAnswerReset.ts` | 答案段重置 |
| `tool.ts` | 工具 decision / process / output |
| `subrunTrace.ts` | parent trace → 父工具 trace bucket/version（不直接创建 child 消息） |
| `summary.ts` | 摘要事实与进度 presentation 的唯一编排入口 |
| `requiresUserInteraction.ts` | HITL 等待态 |
| `contextUsageSnapshot.ts` | 运行中最近成功 Prompt 的上下文占用 |
| `runExecutionMetrics.ts` | 工作统计与最终上下文占用收敛 |
| `transportEnd.ts` | execution 级释放 |
| `error.ts` | 错误事实 |

---

## 2. 状态结构：为什么这样分层

真源 `services/messageProjection/state.ts`。层次**精确对应** [INV-10](./00-invariants.md#inv-10--局部-id-必须带-scope) 的 scope 要求：

```text
MessageProjectionState              （按 conversation_id 持有）
├─ conversation: Conversation
├─ messageIndex: Map<message_id, 下标>
├─ processedEvents: Set<event_id>          去重
├─ executionRunOwners: Map<execution_id, run_id>
└─ runStates: Map<run_id, RunProjectionState>
   ├─ toolState: Map<tool_call_id, ToolState>      ← 属于 run
   └─ executionStates: Map<execution_id, ExecutionProjectionState>
      ├─ turnState:      Map<turn_id, TurnState>   ← 属于 execution
      ├─ answerState:    Map<answer_id, AnswerState>
      └─ thoughtBuffers: Map<turn_id, Map<thought_message_id, content>>
```

### 2.1 工具在 run 层、答案在 execution 层

这不是随意的：

- **工具属于 run**：同一逻辑 run 的 `wait-user → resume` 会开启新 execution，但要继续更新**原来那张**工具卡。按 execution 分区会让 resume 后找不到原卡。
- **答案 / thought / turn 属于 execution**：它们不跨 resume 复用。

`executionRunOwners` 让投影器能从 `execution_id` 反查 owner run。同一 `execution_id` 不得改绑另一个 run。

### 2.2 Thought buffer 是分段状态

Thought 的完整归并 scope 是 `run_id + execution_id + turn_id + thought_message_id`。同一 turn 中
Thought A complete 后，Thought B 的 delta/complete 必须创建和更新另一条消息；complete 只删除 B
自己的 buffer，不得按 turn 清空或复用 A。事件 `id` 只参与 `processedEvents` 幂等，不参与选择消息。

这条结构与协议语义一致：`thought_message_id` 是段身份，不是可被“最后一条思考”替代的可选标记。
禁止维护 current thought、扫描最近一条 thought 或在 identity 改变后继续追加旧段。

---

## 3. 工作区不是响应式状态

`messageProjectionStates` 是 reducer 的**唯一运行时工作区**，使用普通 `Map`，**不是**组件可订阅状态。

```text
messageProjectionStates（普通 Map，就地修改纯 JS 对象）
        │  commitPipeline
        ▼
conversationState.conversations（Vue 响应式）  ← UI 唯一订阅面
```

组件禁止读取工作区，也禁止直接修改 `conversation.messages`：

```javascript
// ❌ 错误：直接修改 Vue 状态
conversation.messages.splice(index + 1);

// ✅ 正确：通过投影系统处理
assistantStore.truncateProjectionStateAfterMessage(conversationId, messageId);
```

### 3.1 提交管线

`services/orchestration/projectionCommitPipeline.ts`：

- `schedule()` 用 50 ms `setTimeout` 合并高频事件。
- `flush()` 立即提交（用于需要同步可见的场景）。
- `discard()` / `discardAll()` 取消 pending commit。

**为什么必须替换 messages 数组引用**：投影器就地修改纯 JS 对象，Vue 无法感知深层 `content` 变化。替换数组引用后，`activeMessages → turns → renderableItems → visibleItems` 的 computed 链路才能稳定传播。

**为什么只合并部分字段**：MessageProjection 只拥有消息、消息派生 metadata 与消息活动时间。标题、标签、创建信息由各自 feature 持有：

```ts
// mergeProjectedConversation：只覆盖三个字段
{ ...current, messages: [...projected.messages], metadata: projected.metadata,
  updatedAt: Math.max(current.updatedAt, projected.updatedAt) }
```

整对象覆盖会让延迟投影快照擦掉 `features/conversation-title/` 刚写入的标题。

`context_usage_snapshot` 不是 token 流，频率最多为每次成功 LLM Prompt 一条，因此直接 `flush()`；它不加入
chunk/thought/subrun 的 50 ms 高频合并名单。投影器只按 Host 提供的 `user_message_id` 修订既有 user message，缺失目标时
不创建消息、不扫描“最近一条用户消息”。随后到达的 `run_execution_metrics` 使用同一产品转换函数覆盖最终值。

### 3.2 历史加载守卫只在一处

历史加载期间的 live 事件拒绝统一留在 `projectionStore.handleSseEvent` 入口，**不下沉到 commit pipeline**。同一不变量不散落两处。

### 3.3 工具展示采用 project-then-apply

`helpers/toolPatch.ts` 把旧消息与本次 patch 交给共享 admission owner `prepareToolCallMessageCandidate.ts`，由后者构造完整候选 metadata/content 并调用 `toolPresentationProjectionPort`。只有 schema 与 projector 全部成功后，`toolPatch.ts` 才创建或替换 tool message，并更新 run 级 `toolState`；Subrun 完整消息复用同一候选 owner，但保留自己的 bucket 与原子快照 commit。

这是 mutable reducer 的事务边界。`reduceEvent` 捕获异常不会回滚已发生的就地变异；若先更新 metadata 再运行 projector，一次非法 success payload 会留下“工具已完成但 presentation 仍是旧 loading”的半状态，并随 conversation-scoped runtime 跨导航常驻。

当前 `ToolUiConfig.presentation` 是可选迁移能力；未迁工具不产生 `toolPresentation`，仍走原卡片路径。已迁工具必须保证 live 与 reload 对相同正式 payload 产生同一展示模型。

### 3.4 Runtime error 是会话表面状态

`error` 是 durable 运行事实，但不是时间线消息。持有当前 execution realtime reader 的 Renderer 收到它后，必须由唯一消息投影入口归一化用户文案，再写入对应 conversation 的 interactive-run snapshot，驱动 ErrorBanner；控制状态层不得重新解释错误码或保留另一套文案映射。

ErrorBanner 属于会话表面层，必须锚定 `ConversationHost`，不能挂在可滚动的历史内容中。无论当前历史有多长、用户位于哪个滚动位置，当前会话的新错误都应保持可见；横幅关闭仍只修改对应 conversation snapshot。

历史 window 只重放消息 read model，不模拟 realtime reader。CLI 等外部进程发起的 execution 即使写入同一数据库，也不会让已打开的 Renderer 主动收到实时事件，因此不会仅凭数据库投影弹出 ErrorBanner。若未来需要跨进程即时提示，应新增正式的 Host 事件订阅能力，不能轮询历史或把 `error` 伪造成时间线消息。

---

## 4. 跨会话续跑（[INV-29](./00-invariants.md#inv-29--projection-runtime-属于-conversation不属于当前页面)）

`messageProjectionStates` 按 `conversation_id` 持有，**不跟随 `activeConversationId` 释放**。

```text
切走 → 后台 SSE 继续投影到原 conversation
切回 → HistoryLoader 只重载 window，必须保留已有 live slot 和 reducer
```

否则：ephemeral chunk 已到、durable seal 后到时，会丢失同一 answer 的聚合状态——表现为"只剩 seal、没有 chunk 前缀"的**假协议错误**。

> 教训 8：可见页面不是运行态 owner。修复方向是保留 owner 状态，**不是**放宽 seal 校验。

破坏性 cleanup 只允许发生在：

1. 已确认不会再收到事件的 conversation 生命周期终点
2. 全局 reset

且必须**同时取消 pending commit**（否则 50 ms 后的定时器会把已废弃快照写回）。仅删除历史事实不自动证明后台 run 已终止。

---

## 5. 答案投影

### 5.1 正文只来自 chunk（[INV-19](./00-invariants.md#inv-19--实时与历史答案职责分离)）

```text
final_answer_chunk(seq=0)  → 用 answer_id 创建 UI message
final_answer_chunk(seq=1..n) → 追加正文
final_answer               → 封口，校验并修订原消息
```

非流式 LLM 与工具终答**也**由 Graph 先发布 one-shot chunk。完整 `final_answer` 必须满足 `id === answer_id`。

seal 只校验并修订原消息，**不得改 message id**（[INV-09](./00-invariants.md#inv-09--答案消息身份从首块起固定)）。

禁止：

- 根据未来工具事件回溯把已发布正文改写为 thought
- 从完整事件或 `tool_output` 补造缺失正文
- 维护"当前答案下标"
- 按文本去重

### 5.2 completion_reason 决定展示语义

| reason | 投影为 |
|---|---|
| `terminal` | 最终回答 |
| `tool_call` | 工具前播报 |
| `interrupted` | 未完成回答 |

展示语义**直接读** seal 的 `completion_reason`，不做推断。

同一 `answer_id` 只属于一次 provider stream attempt。retry、wait-user resume 或任何新的
provider stream 都必须生成新的 `answer_id`；`partial_answer(interrupted)` 不会在后续用同一身份
变成 `final_answer(terminal)`。window/live 两侧若把同一身份封成不同 reason 或不同正文，属于
admission 协议错误，不是需要合并的进度状态。

### 5.3 答案段归并是共享 feature

主时间线与 Subrun 完整消息 admission 都复用 `features/answer-segment/`，只按 `answer_id + seq` 增量构建正文。父卡的轻量进度 projector 不构建正文。

### 5.4 Subrun 是独立的消息 admission，不是第二个主时间线

parent `subrun_trace` 只修订对应父工具消息的 trace bucket/version。`features/subrun-card/functions/admitSubrunMessageProjection.ts` 在独立、非响应式的快照上消费该 bucket，并与主链 `toolPatch.ts` 共用 `prepareToolCallMessageCandidate.ts`。

```text
parent trace bucket
  → detached child snapshot
  → answer/tool admission + presentation projection
  → 全批次成功后原子发布
```

这条链只服务 Host 就地详情和插件公开 `SubrunCard`，不写入 `conversation.messages`，也不进入父 visual row。任一 child 事实接纳失败时，整个新快照拒绝，保留上一个已接纳快照；不得在 Vue `watch/computed` 中 parse/project 或发布半快照。

### 5.5 空白答案不落地（[INV-20](./00-invariants.md#inv-20--空白答案不落地)）

部分模型吐出只含不可见字符的答案（零宽空格等，`String.trim()` 无法移除）。判定收口两处：

- 内容级：`functions/answerContent.ts` 的 `isBlankAnswerContent()`
- 消息级：`functions/renderableConversationMessage.ts`

投影器据此阻止落地；UI 列表构建、`Message.vue`、selectors 复用同一口径。禁止各自散落判空逻辑。

---

## 6. 摘要投影（[INV-21](./00-invariants.md#inv-21--摘要事实与压缩进度是两个不同实体)）

`projectors/summary.ts` 是唯一编排入口，`features/summary-presentation/` 持有纯函数。

```text
summarization_start/end/error（实时）
   → 维护当前 summarization_progress（Renderer-only presentation）
   → 按 summarization_id + run_id + execution_id + turn_id 全量校验归属
   → end.summary_id 记录本次已提交 history_summary.id
history_summary（durable fact 到达）
   → 只删除 historySummaryId 精确命中的 completed progress → 以事实 ID 创建唯一摘要消息
```

reload **不依赖**任何实时进度事件。禁止：共用 type/ID/状态字段、按"最近一条摘要"猜关联、随机生成 progress ID、恢复顶层 `summaryStatus/summaryInfo`。

Producer 端同样只能有一条事实链：Context Manager 为 Graph 的自动压缩阶段创建 pending `history_summary` draft；重建 Prompt 通过容量接纳后，`commit_context_compaction` 先请求 Host durable commit，确认落盘后才发送 `summarization_end(summary_id=history_summary.id)`，再经既有 publisher fan-out 同一摘要事实。persistence consumer 按 fact ID 去重。正常 realtime 顺序保持 `start → end → history_summary`；commit 失败只能是 `start → error`，不得提前出现 end / summary，主模型也不能执行。commit 成功后摘要不可回滚，progress transport 失败只记日志；后续 fan-out 失败也不能让 Renderer 收到伪造的 summarization error。Renderer 不为 progress 持久化，不因到达时序创建第二条摘要消息，也不新增 checkpoint 工具卡或其它 UI 分支；live 与 reload 合并只使用 end 提供的精确 fact ID。

---

## 7. 消息修订（[INV-38](./00-invariants.md#inv-38--visual-row-支持任意消息-revision)）

MessageProjection **以替换消息对象**表达 metadata、工具状态和 subrun version 等结构化修订。

```text
同引用原地增长  → 只用于尾部正文 streaming
替换对象引用    → 表达任意位置的结构化修订
```

下游 append-only row builder 据此按 message id 重投受影响的 row（详见 [07 渲染](./07-render.md)）。禁止深度 watch 整棵消息树。

---

## 8. 释放语义（[INV-06](./00-invariants.md#inv-06--释放语义分层)）

| 触发 | 释放 |
|---|---|
| `transport_end` | 对应 **execution** 的 thought / turn / answer 在途状态 |
| terminal `run_status` | 整个 **run** 及其 tool 索引 |
| 侧栏切换 | **什么都不释放**（不是 Runtime 生命周期事件） |
| pre-admission transport 结束 | 只结束网络请求（没有 `run_id`） |

一个 execution 结束不得删除同 conversation 的其它 run。

---

## 9. 禁止清单

| # | 禁止 | 正确做法 |
|---|---|---|
| 1 | 组件读 `messageProjectionStates` | 只订阅 `conversationState`（§3） |
| 2 | 直接改 `conversation.messages` | `truncateProjectionStateAfterMessage()`（§3） |
| 3 | commit 时整对象覆盖 conversation | 只合并三个字段（§3.1） |
| 4 | 侧栏切换时 cleanup reducer | 按 conversation 持有，续跑（§4） |
| 5 | cleanup 时忘记取消 pending commit | 两者必须同时（§4） |
| 6 | 工具状态按 execution 分区 | 按 run 分区（§2.1） |
| 7 | 从 `tool_output` 或完整 `final_answer` 补造正文 | 正文只来自 chunk（§5.1） |
| 8 | 按后续工具事件把正文改写为 thought | 读 `completion_reason`（§5.2） |
| 9 | 各处自己写答案判空 | 复用两个共享函数（§5.4） |
| 10 | 按"最近一条摘要"关联进度 | 四元身份全量校验（§6） |
| 11 | 深度 watch 消息树 | 靠对象引用替换定位传播（§7） |
| 12 | Thought 只按 turn 缓冲或更新最近一条 | 按完整 scope + thought identity 分段（§2.2） |
