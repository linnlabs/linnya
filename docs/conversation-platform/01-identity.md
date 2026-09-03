# 01 · 身份矩阵

> **What** · Conversation 平台的全部身份：谁创建、在什么范围唯一、稳定多久、如何派生、禁止如何 fallback。
> **When to read** · 新增任何 ID、排查消息重复/丢失/串线、写 merge 逻辑、写 Vue key 之前。
> **不变量** · [INV-09](./00-invariants.md#inv-09--答案消息身份从首块起固定)、[INV-10](./00-invariants.md#inv-10--局部-id-必须带-scope)、[INV-11](./00-invariants.md#inv-11--tool-ui-身份不属于单个事件)、[INV-12](./00-invariants.md#inv-12--runtime-与视觉轮次身份隔离)、[INV-13](./00-invariants.md#inv-13--command-身份不能泄漏到-read-model)、[INV-58](./00-invariants.md#inv-58--runtime-身份在-admission-后必须保持名义类型)
> **Related** · [02 事件管线](./02-event-pipeline.md) · [06 read model](./06-read-model.md) · [09 工具](./09-tools.md)

---

## 1. 三个身份世界

最常见的事故来源是把这三层混成一层。它们**永不互相 fallback**。

| 世界 | 属于谁 | 代码 owner | 服务什么 |
|---|---|---|---|
| **Runtime 身份** | Linnkit 框架事实链 | `packages/linnkit/src/contracts/identity/` | Agent 执行、上下文关联、审计回放 |
| **产品 read model 身份** | Linnya 产品边界 | `packages/schemas/src/conversation/message-identity.ts` | UI message 主键、跨端 DTO、持久化行 |
| **视觉身份** | Linnya UI 布局 | `packages/schemas/src/conversation/visual-turn-identity.ts` | 分组、timeline、虚拟化导航 |

判断归属的问题只有一个：**这个 ID 是在描述"Agent 执行时发生了什么"，还是"产品要交换/展示什么"？**

---

## 2. Runtime 身份矩阵

真源 `packages/linnkit/src/contracts/identity/`：`definitions.ts`（schema 与语义）、`generators.ts`（生成器）、`invariants.ts`（跨字段关系）、`index.ts`（唯一出口，禁止 deep import）。

Runtime 身份遵循统一类型边界：Provider、HTTP、SQLite row 与插件公共合同可以携带 raw string；进入 Runtime、Host 内部编排或 Renderer 运行态时必须由真源 schema parse，并保持各自 brand。禁止用 `as RunId` 或把对象整体断言成 RuntimeEvent 来跳过 admission。

当前 brand 停止点是 `RunId + ToolCallId`。它们直接控制父子 run、取消/恢复、Tool 归属和 UI 合并，收益已经由真实 `rootRunId = conversationId` 故障证明。`TurnId + AnswerSegmentId` 是下一候选但未立项；纯可观察性身份没有事故证据时不迁移。strict schema 覆盖全部身份，不等于全部身份都必须成为 TypeScript brand。

| 身份 | 标识对象 | owner | 唯一性作用域 | 稳定期 |
|---|---|---|---|---|
| `RuntimeEvent.id` | 一份不可变 fact | 事实 creator | 全局 | 创建后永久不变 |
| `conversation_id` | 会话聚合根 | Host orchestration | 全局 | 聚合根生命周期 |
| `turn_id` | 一次用户请求及其后续工作 | Host orchestration | **conversation 内** | 该轮生命周期 |
| `run_id` | 一次逻辑 Agent run | RunSupervisor/Host | 全局 | start、wait、resume 全程不变 |
| `execution_id` | 一次实际执行 | execution owner | 全局 | 单次 start 或 resume |
| `trace_id` | 一条可观察性关联链 | EventSequencer | 全局 | execution 生命周期 |
| `answer_id` | 一个可流式聚合的答案段 | answer segment creator | 全局 | 首 chunk 到 seal 及回放 |
| `summarization_id` | 一次 SSE-only 摘要进度 | Host summarization adapter | **execution 内** | start 到 end/error；等于 start event ID |
| `thought_message_id` | 一个可增量合并的思考段 | thought creator | **run 内** | 思考段生命周期 |
| `tool_call_id` | 一次工具调用 | provider 或 tool bootstrap | **run 内** | decision、process、output 全链 |
| `interaction_id` | 一次等待用户输入的交互 | interaction creator | **run 内** | wait 到 resume |
| `subrun_id` | 一个 child run | child orchestration | 全局 | child 生命周期 |
| `source_event_id` | 对已有 child fact 的引用 | trace projector | 不创建命名空间 | 与被引用事实一致 |
| `resume_token` | 一次恢复凭据 | interaction owner | 全局 | 一次性使用 |
| `control.target_id` | event/message/branch anchor | control creator | 不创建命名空间 | 与目标一致 |

### 2.1 局部唯一 ≠ 可以裸用

标粗的四个（`turn_id` / `thought_message_id` / `tool_call_id` / `interaction_id`）只在局部唯一。两个并发 run 完全可以出现相同的 `tool_call_id`。`answer_id` 不在此列，它由 `AnswerSegmentIdSchema` 定义为全局唯一。

按 [INV-10](./00-invariants.md#inv-10--局部-id-必须带-scope)，在途状态索引必须带完整 scope：

```text
答案状态   run_id + execution_id + turn_id + answer_id
工具状态   run_id + tool_call_id          ← 注意不含 execution
thought   run_id + execution_id + turn_id + thought_message_id
```

**工具为什么按 run 而不按 execution 分区**：同一逻辑 run 的 `wait-user → resume` 会开启**新的 execution**，但要继续更新原来那张工具卡。按 execution 分区会让 resume 后的更新找不到原卡。

### 2.2 层级关系

```text
conversation
├─ turn                     （一次用户请求及其后续工作，wait/resume 期间不变）
└─ run                      （wait/resume 期间不变）
   ├─ execution(start)      （首次执行）
   └─ execution(resume)     （恢复时创建新 execution）

event  同时携带 run / execution / turn 归属
answer 属于单次 execution，并绑定稳定 turn
tool   属于 run，可跨 execution 延续
thought 属于单次 execution 下的稳定 turn；每个 thought_message_id 独立成段
```

`turn_id` 不是 `execution_id` 的子身份。wait-user resume 会复用原 `turn_id` 与 `run_id`，只更换 `execution_id`。同一 `execution_id` 不得改绑另一个 run；同一 execution 的 answer 不得改绑 turn；同一 run 的 tool call 不得改绑 turn。

### 2.3 Thought 段身份

`thought_message_id` 标识一个可增量更新、随后封口的独立思考段，不表示“当前思考槽位”。同一
execution/turn 内，已完成的 Thought A 与新身份 Thought B 必须成为两条不同消息；B 的 delta 或
complete 不得重新打开、覆盖或拼接到 A。`RuntimeEvent.id` 只负责事实幂等，不能替代段身份。

因此 live buffer 必须按 `run_id + execution_id + turn_id + thought_message_id` 精确定位；complete
只封口并释放同一 thought identity。禁止按“最近一条 thought”、数组尾项或仅 `turn_id` 合并。

---

## 3. 强制等值关系

### 3.1 Final answer（[INV-09](./00-invariants.md#inv-09--答案消息身份从首块起固定)）

`final_answer` 与 answer segment 一一对应，因此：

```text
final_answer.id          === final_answer.answer_id     ✅ 必须相等
final_answer_chunk.id    !== final_answer_chunk.answer_id  ✅ 必须不等
```

- chunk 与 seal 全程透传同一个 `answer_id`。
- mapper、transport 和 persistence adapter 不得重新分配答案身份。
- 答案 UI `message_id` 由 `conversationMessageIdFromAnswerId(answerId)` 派生（`packages/schemas/src/conversation/message-identity.ts:14`）。

**为什么这条最容易错**：seal 事件本身有自己的 `RuntimeEvent.id`。把它当成新消息身份提交，就会在同一答案上产生第二个 UI 实体 —— 表现为答案 seal 后闪一下变成两条。

### 3.2 Tool UI message（[INV-11](./00-invariants.md#inv-11--tool-ui-身份不属于单个事件)）

Tool UI message 是**产品 read model 实体**，不是某一条 Runtime event。

```ts
// packages/schemas/src/conversation/message-identity.ts:29
conversationMessageIdFromToolIdentity(runId, toolCallId)
```

Host durable projector 与 Renderer live projector 必须**共同**调用它，返回值同时作为 Tool `message_id` 与 `merge_key`（两者必须相等）。

禁止派生来源：

| 禁止 | 为什么坏 |
|---|---|
| 首个到达的 `tool_call_decision / tool_process / tool_output` 的 event id | live 与 durable 的"首个事件"可能不同 → 同一工具产生两个实体 |
| 工具名 | 同名工具可并发多次调用 |
| batch 下标 / 到达顺序 | 并发 batch 顺序不稳定 |
| 裸 `tool_call_id` | 只在 run 内唯一，跨 run 会碰撞 |

历史故障：live `tool_process` 与 durable tool fact 用不同 event ID 创建 UI 实体，导致导航后出现重复卡片与不灭的 loading 光效。

---

## 4. 视觉轮次身份（[INV-12](./00-invariants.md#inv-12--runtime-与视觉轮次身份隔离)）

唯一 owner：`packages/schemas/src/conversation/visual-turn-identity.ts`。

| 类型 | schema | 派生函数 | 用途 |
|---|---|---|---|
| 完整 | `ConversationCompleteVisualTurnIdSchema`（`visual_turn_` 前缀） | `conversationVisualTurnIdFromUserMessageId()` | timeline index、导航、分组 |
| 局部 | `ConversationPartialVisualTurnIdSchema`（`visual_turn_partial_` 前缀） | `conversationPartialVisualTurnIdFromMessageId()` | 仅当前窗口布局 |
| 联合 | `ConversationVisualTurnIdSchema` | — | 消费侧类型 |

规则：

- 完整 visual turn **只能**从可见 user message ID 派生。
- 历史窗口从 assistant 中段开始时只能创建 partial 身份。
- 完整与 partial schema **互斥**；timeline index 只允许完整身份。
- partial 身份不得写入 Runtime fact、持久化 UI row 或 `/turns` 响应。

### 4.1 与 Runtime `turn_id` 的关系：没有关系

这是两个实体：

| | Runtime `turn_id` | `ConversationVisualTurnId` |
|---|---|---|
| 服务 | Agent 执行、上下文、引用关联 | UI 分组、timeline、虚拟化导航 |
| 唯一性 | conversation 内 | 由 message ID 决定 |
| 创建者 | Host orchestration | 共享派生函数 |

禁止：比较、复制、互相 fallback、用普通 `string` 抹掉类型边界、手工拼接 ID。Host turn index、Renderer visual-row、Timeline 和 Virtualizer 必须从包根导入。

---

## 5. command 身份 vs 事实身份

### 5.1 用户输入（[INV-03](./00-invariants.md#inv-03--事实身份只在-durable-commit-后成立)）

```text
Renderer 预分配 messageId          ← 只是 command identity，不是事实
      │  随请求发给 Host
      ▼
Host durable transaction 提交成功
      │
      ▼
user_input_committed（携带同一 messageId）  ← 此刻它才成为正式 message_id
      │
      ▼
features/user-input-admission/ 校验后 commitUserInput()
```

预分配**不授权**本地创建同 ID 的消息。把 command 写进 UI 再等后端"碰巧使用同一 ID"，会让失败、取消和重载产生两套生命周期。

`ConversationUserInputCommittedEventSchema` 是 app-level ack，**不是 RuntimeEvent**，也不进 EventStore。`persist=false` 的请求不产生 ack。

### 5.2 HITL 恢复凭证（[INV-13](./00-invariants.md#inv-13--command-身份不能泄漏到-read-model)）

response command 的 `runId / interactionId / toolCallId / checkpointRevision / resumeToken` 属于控制面与 `RunSupervisor.claimResume()` 的校验职责。工具消息的 `tool_call_id` 位于 payload 顶层；`interaction` 不重复工具身份。

| 工具卡 variant | 可携带 |
|---|---|
| `active` | `runId / interactionId / checkpointRevision / resumeToken` |
| `submitted / skipped / approved / modified` | 只有 `status / submittedAt / response` |

terminal variant 不得复制 command identity。

---

## 6. 产品 read model 身份

`message_id` 是 Linnya 产品 UI read-model 身份，由 `@app/schemas` 约束，**不反向成为** Linnkit Runtime 身份。

`conversation_ui_messages.message_id` 是全局主键。派生规则汇总：

| 消息类型 | message_id 来源 |
|---|---|
| user | Host durable commit 的 command `messageId` |
| answer | `conversationMessageIdFromAnswerId(answer_id)` |
| tool | `conversationMessageIdFromToolIdentity(run_id, tool_call_id)` |
| thought | 在正式 run/execution/turn scope 内按 `thought_message_id` 合并 |
| history_summary | durable fact ID |
| summarization_progress | 从 start event 派生（`ConversationSummarizationPresentationIdSchema`） |

### 6.1 `eventStoreId` 不是身份

Linnkit adapter 的 `PersistedEvent` 只有 `eventStoreId + event`：

- `eventStoreId` 是**存储分页游标**。
- `RuntimeEvent.id` 是**业务事实身份**。

两者不得互相 fallback，也不在外层重复保存 conversation/run/timestamp。

---

## 7. 禁止清单

| # | 禁止 | 正确做法 |
|---|---|---|
| 1 | 用 event id 作为 UI message 身份 | 按 §6 的派生表 |
| 2 | 裸用 `tool_call_id` / `turn_id` 作 conversation 级索引 | 带完整 scope（§2.1） |
| 3 | seal 时提交新 message id | seal 只修订原消息（§3.1） |
| 4 | Runtime `turn_id` 与 visual turn 互相 fallback | 两个实体，永不互换（§4.1） |
| 5 | 手拼 `visual_turn_` 字符串 | 用共享派生函数 |
| 6 | 客户端预分配 ID 后立刻创建消息 | 等 `user_input_committed`（§5.1） |
| 7 | terminal 工具卡保留 `resumeToken` | 只留 `status/submittedAt/response`（§5.2） |
| 8 | `eventStoreId` 与 `RuntimeEvent.id` 互相代用 | 分别用于游标与事实（§6.1） |
| 9 | 从工具名 + 下标生成列表 key | 用正式 `tool_call_id` 透传 |
| 10 | 新 Thought 复用最近一条已完成消息 | 按完整 scope + `thought_message_id` 独立投影（§2.3） |

---

## 8. 术语速查

- **Runtime `turn_id`**：一次用户请求及其 Agent 工作，Host 创建，Runtime scope。
- **`visualTurnId` / `visual_turn_id`**：从可见 user message 派生的展示分组身份。
- **`answer_id`**：答案段身份；首 chunk、seal、live message 与 durable message 保持同一实体。
- **`tool_call_id`**：run 内工具调用身份；Tool UI message 必须与 `run_id` 共同派生。
- **`message_id`**：Linnya 产品 UI read-model 身份。
- **command `messageId`**：请求前预分配的关联身份；durable commit 成功后才成为正式 `message_id`。
