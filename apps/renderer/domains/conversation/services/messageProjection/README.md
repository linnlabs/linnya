> **全链路权威规范**：[`docs/conversation-platform/`](../../../../../../docs/conversation-platform/README.md)。不变量以 [`00-invariants.md`](../../../../../../docs/conversation-platform/00-invariants.md) 的 `INV-nn` 为准；本文是实现级说明，冲突时以规范为准。

## MessageProjection（前端会话事件投影层）

本目录负责把 Linnkit 正式事件合同 **投影（project）** 成前端可渲染的“会话内存态”（`MessageProjectionState`）。

### 目标与边界

- **高内聚**：这里的职责是“事件分发 + 幂等去重 + 状态机投影”，不在此处写 UI 逻辑。
- **低耦合**：每种事件的投影细节下沉到 `projectors/`，公共逻辑下沉到 `helpers/`。
- **可回放**：同一条事实流走 live SSE 与 durable read model 后必须得到一致的 UI 语义。
- **所有权受限**：这里只拥有消息、消息派生 metadata 和消息活动时间；标题由 `features/conversation-title/` 管理，任何 projector 都不得修改标题。

### 文件结构（按职责分层）

```
messageProjection/
├─ index.ts                # reducer 入口：createInitialProjectionState / reduceEvent
├─ state.ts                # MessageProjectionState 类型定义
├─ projectors/             # 具体事件投影器（按 event.type 分文件）
│  ├─ tool.ts              # action/tool_output → tool_calls 归并（常规模式）
│  ├─ contextUsageSnapshot.ts # 成功 Prompt 的实时上下文占用修订
│  ├─ runExecutionMetrics.ts  # execution 统计与最终上下文占用收敛
│  └─ ...                  # thought/final_answer/subrun_trace 等
├─ helpers/                # 可复用的纯逻辑/辅助逻辑（尽量无 UI 依赖）
│  ├─ messageAccess.ts     # messages 追加/查找/替换/删除，维护 messageId 索引
│  └─ ...
└─ guards/                 # 只放产品语义 guard，禁止重定义 Linnkit 事件 DTO
```

### reducer 入口：`reduceEvent`

核心入口在 `index.ts`：

- **幂等去重**：对带 `event.id` 的事件做 processed 去重。
- **分发**：按 `event.type` 路由到对应的 projector。
- **输入权威**：live 只接受 `linnkit/contracts` 的 `SSEEvent`；durable `user_input`
  是唯一不进入 SSE、但需要生成 timeline message 的 Runtime fact，直接使用正式 `UserInputEvent`。
- **穷尽处理**：`conversationService.ts` 的 SSE dispatch 与 `messageProjection/index.ts` 的 reducer
  必须显式处理每个正式 variant。即使某个 variant 不生成 timeline message，也要写出明确分支和原因。

严禁新增 `Replay*Event`、最小事件 interface、按字段 shape 猜 event type，或把未知正式
variant 留给 `default` 静默忽略。事件字段变化必须先修改 Linnkit contract，再让 TypeScript
推动 Host 与 Conversation 消费者同步更新。
中文备注：本仓库已移除旧的编排概念（及其专用事件/投影/UI），因此本 README 中仅保留通用投影结构说明。

### 消息索引约定

`MessageProjectionState` 内部维护 `messageIndex: Map<messageId, index>`，用于把历史回放和实时流式中的消息 patch 从线性扫描收敛到按 ID 定位。

约定：

- projector 不应直接 `push/splice/findIndex` 修改 `state.conversation.messages`；
- 追加、读取、替换、删除消息必须走 `helpers/messageAccess.ts`；
- 若确实需要整体重建 messages，必须通过 `createInitialProjectionState` 或同步重建 `messageIndex`。

### 运行身份与局部索引

实时归并状态使用固定层级：conversation 下按 `run_id` 分区，run 下按 `execution_id` 分区。`turnState / answerState / thoughtBuffers` 属于 execution；`toolState` 属于 run，以支持 wait-user 后的新 execution 更新原工具卡。`thoughtBuffers` 再按 `turn_id + thought_message_id` 分段，已完成的 Thought A 与后续新身份 Thought B 永远是两条消息。

- `turn_id / answer_id / thought_message_id / tool_call_id` 不是 conversation 级唯一键，禁止创建裸的 conversation 级索引；
- 同一 `execution_id` 不得改绑另一个 run，同一 execution 的 answer 不得改绑 turn，同一 run 的 tool call 不得改绑 turn；
- `transport_end` 只释放一个 execution；terminal `run_status` 才释放整个 run；
- 参与增量归并的 SSE 必须带共享 `SSEExecutionScope`，缺失时应暴露协议错误，不能回退 active run。
- Thought delta/complete 必须按 `run_id + execution_id + turn_id + thought_message_id` 精确归并；禁止扫描最近一条 thought 或只用 `turn_id` 共享 buffer。

### 引用（RAG Citation）在投影层的约束

AI 文本里的 `[@XXXXXX]` 只是一条有作用域的短别名。投影层不再写全局引用 store，而是让
`MessageProjectionState` 持有当前 Conversation 独享的 citation workspace：

- 成功 tool output 先由 Citation domain 按 producer owner schema strict admission；
- citation registration 在 detached `Map` 上计算，同 scope/ref 指向不同来源时明确失败；
- tool message 与 workspace 都通过后才替换 reducer runtime，禁止外部副作用留下半提交；
- thought / answer 从当前 workspace 投影自己的 `citationDependencies`，渲染、复制和导出只消费消息快照；
- workspace 随 projection runtime 释放，不使用 TTL、全局 Pinia、active turn 或跨 Conversation fallback；
- Subrun trace 使用独立 workspace，child tool fact、child message 和 dependencies 由 detached admission
  形成同一版本快照；
- runtime 重建只重放已提交 tool message 的 canonical result 与 `subrunTrace` tool output；交叉 admission
  失败时丢弃未提交 message runtime，并保留 reduce 前的 detached workspace，不能从 message snapshot
  反向恢复来源。

Renderer 薄 feature 位于 `domains/conversation/features/citation-presentation/`，只把 BaseMessage 接到
`src/domains/citation/conversation-presentation.ts` 的公共规则，不复制 toolName 分派、ref parser 或来源身份。
Durable window 的依赖闭包由 Host 在选定 rows 后生成；MessageProjection 不扫描历史窗口 tool rows。

完整合同见 [`Conversation Citation`](../../docs/citation.md)。

### 开发约定（避免退化）

- **不要在 projector 里做猜测/兜底**：结构不符合 producer schema 时应暴露协议错误，不得扫描通用
  `data.citations` shape、静默跳过或注册部分字段。
- **新增分流/新模式时**：如果该模式仍会产生 `tool_output`，必须接入 Citation domain admission，并确认
  message、workspace 与 Subrun 快照的提交边界仍然原子。
- **写日志要有根因信息**：日志应包含 `turnId/toolName/eventType` 等关键上下文，方便定位事件路由分叉导致的数据缺失。
