# 04 · Schema 合同

> **What** · 三层 schema 的 owner 划分、metadata 的判别式约束、校验必须发生的边界、字段新增纪律。
> **When to read** · 新增字段、新增消息 variant、新增工具 payload、判断"这个字段该放哪"之前。
> **不变量** · [INV-14](./00-invariants.md#inv-14--产品-ui-schema-是唯一真源)、[INV-15](./00-invariants.md#inv-15--消息状态只能表达一次)、[INV-16](./00-invariants.md#inv-16--metadata-不是控制面)、[INV-17](./00-invariants.md#inv-17--strict-schema-必须在真实边界执行)、[INV-18](./00-invariants.md#inv-18--工具-wrapper-与底层工具是两个正式合同)、[INV-56](./00-invariants.md#inv-56--工具展示派生只有三个-admission-入口)、[INV-57](./00-invariants.md#inv-57--工具执行合同只承载业务事实)
> **Related** · [01 身份](./01-identity.md) · [03 持久化](./03-persistence.md) · [09 工具](./09-tools.md)

---

## 1. 三层 owner

判断字段归属只问一个问题：**这个字段描述的是通用 Agent 运行，还是 Linnya 产品交换的东西？**

| 层 | 包 | 拥有什么 | 不拥有什么 |
|---|---|---|---|
| **通用运行时** | `@linnlabs/linnkit/contracts` | `RuntimeEvent` / `EventEnvelope` / `SSEEvent` / `AiMessage` 家族、Runtime 身份、路由字段 | Linnya 的消息形态、工具业务 payload |
| **产品共享合同** | `@app/schemas` | Conversation UI read model、各类 metadata、工具 payload、Workspace / TaskState DTO | Runtime 路由身份 |
| **Renderer 绑定** | `apps/renderer/domains/conversation/types/index.ts` | 把正式合同绑定到 Vue message variant | **不得新增定义**（见 [12](./12-open-risks.md)） |

字段位置速查：

| 字段性质 | 放哪 |
|---|---|
| Runtime 路由身份（`run_id` / `lane` / `visibility`） | Linnkit **顶层**字段 |
| HTTP command 身份 | API DTO 与控制面 |
| Conversation message 内容与展示 | `@app/schemas` read model |

**禁止为了少传一次参数**把字段复制进 metadata、payload、store 或另一条事件（[02 §8.9](./02-event-pipeline.md)）。

---

## 2. `@app/schemas` 目录职责

`packages/schemas/src/`：

| 路径 | 拥有 |
|---|---|
| `json-value.ts` | 递归 JSON 值（插件扩展数据的唯一容器类型） |
| `conversation/ui-message.ts` | Host row / HTTP DTO / Renderer window input 的统一 DTO |
| `conversation/message-metadata.ts` | user / thought / answer metadata 判别联合，以及用户消息上的 `agent_work` / `context_usage` read model |
| `conversation/tool-message.ts` | 工具消息 lifecycle、payload、interaction 联合 |
| `conversation/message-identity.ts` | `message_id` 派生函数 |
| `conversation/visual-turn-identity.ts` | 视觉轮次身份 |
| `conversation/summary-message.ts` | 摘要事实 payload、进度 metadata、presentation ID |
| `conversation/presentation.ts` | presentation kind 判别 |
| `conversation/attachment-ref.ts`、`reference-identity.ts`、`user-quote.ts` | 附件与引用 |
| `conversation/subrun-trace-summary.ts` | subrun trace 展示摘要 |
| `tools/*.ts` | 每个工具的 strict result 合同 |
| `plugins/manifest.ts` | 插件清单 |

现有工具合同包括 `agent-todo.ts`、`ask-questions.ts`、`assemble-documents.ts`、`assemble-evidence.ts`、`conversation-artifact-read.ts`、`evidence-resolve.ts`、`image-generation.ts`、`resource-read.ts`、`shared-memory.ts`、`skill.ts`、`subrun-batch.ts`、`taskstate.ts`、`tool-output-read.ts`、`web-common.ts`、`web-read.ts`、`web-search.ts`、`workspace-document-read.ts`、`workspace-file.ts` 与 `write-to-table.ts`。

Conversation 合同已有 `message-identity`、`message-metadata`、`summary-message`、`tool-message`、`ui-message` 的包级测试。工具合同中目前只有 `agent-todo` 与 `tool-output-read` 有同目录 `.test.ts`；其余工具合同不能被描述成“已有包级测试”，新增或修改时必须由对应的真实 producer → adapter → consumer 业务链测试覆盖合同语义。

---

## 3. metadata 是判别合同，不是扩展袋

这是最常被违反的一条（[INV-16](./00-invariants.md#inv-16--metadata-不是控制面)）。

### 3.1 判别方式：type 与 metadata 一起解析

`ui-message.ts` 提供成对的解析入口：

```ts
parseConversationUiMessageVariant({ ... })   // ui-message.ts:77
parseConversationUiMessageKind({ ... })      // ui-message.ts:104
```

答案消息必须用 `parseConversationAnswerMessageMetadata()`（`message-metadata.ts:203`，四个重载）**一次性**解析 type 与 seal reason。禁止拆开赋值——拆开就等于允许出现"type 说是终答、metadata 说是工具前播报"的非法组合。

工具消息用 `parseConversationToolMessageMetadata()`（`tool-message.ts:145`）。

### 3.2 answer metadata 的判别结构

`message-metadata.ts` 中答案 metadata 是显式联合，不是可选字段拼装：

```text
ConversationAnswerMessageMetadataSchema
├─ ConversationUnsealedAnswerMessageMetadataSchema      未封口
└─ ConversationFinalAnswerMessageMetadataSchema
   ├─ ConversationTerminalAnswerMessageMetadataSchema   completion_reason='terminal'
   ├─ ConversationToolPreambleMessageMetadataSchema     completion_reason='tool_call'
   └─ ConversationPartialAnswerMessageMetadataSchema    completion_reason='interrupted'
```

payload 同样成对（`ConversationTerminalAnswerPayloadSchema` / `ConversationToolPreamblePayloadSchema` / `ConversationPartialAnswerPayloadSchema`）。

`ConversationAnswerCompletionReasonSchema` 是 `completion_reason` 的唯一 enum。语义见 [INV-19](./00-invariants.md#inv-19--实时与历史答案职责分离)。

### 3.3 硬性约束

| 禁止 | 为什么 |
|---|---|
| 开放索引签名 `[key: string]: unknown` | 让 metadata 变成控制面，删字段就改行为 |
| 顶层 message `status` | 状态只能表达一次（[INV-15](./00-invariants.md#inv-15--消息状态只能表达一次)）；工具状态只在 tool metadata |
| `messageMetadata` / `userInputMetadata` 这类平行袋 | 同一语义两个 owner |
| 任意 `...spread` 进 metadata | 绕过 strict schema |
| 消费方 shape probing（`if ('foo' in meta)`） | 隐式控制面 |
| 根据缺字段推断 variant | 判别必须显式 |

### 3.4 插件扩展的唯一形状

```ts
messageExtension: { namespace: string, data: JsonRecord }
```

`ConversationMessageExtensionSchema`（`message-metadata.ts:20`）。`data` 必须是 `json-value.ts` 的 JSON 值，不允许类实例、函数或 `undefined`。

### 3.5 metadata 的判定测试

删除任意 metadata 字段后，以下四件事**必须不变**：

1. 事件归属（哪个 conversation / run / execution）
2. 消息身份（`message_id`）
3. run / execution 状态
4. 恢复目标与写入目标

任一项改变，说明该字段是控制面，应提升为共享正式字段或 app workflow 的显式 ID 映射（教训 12）。

---

## 4. 校验边界（[INV-17](./00-invariants.md#inv-17--strict-schema-必须在真实边界执行)）

schema 不是给 TypeScript 推导用的。以下边界**都必须 `parse`**：

| 边界 | 位置 |
|---|---|
| Host durable transaction | `event-store/functions/runtimeEventStorageCodec.ts`、`ui-projection/projectEvent.ts` |
| Host 产品 metadata admission | `flow.history-builder.service.ts` 等将通用 RuntimeEvent 翻译为 Linnya 产品请求的 adapter；字段缺失可接受，存在但非法必须失败 |
| HTTP DTO admission | API 层 |
| Renderer live projection | `services/messageProjection/` |
| Renderer reload mapper | `message-window/functions/uiMessagesDtoGuards.ts`、`mapUiMessageDto.ts` |
| Renderer Subrun message admission | `features/subrun-card/functions/admitSubrunMessageProjection.ts` |

失败处理：**终止当前操作并保留原事实**。禁止：

- `catch` 后删除字段
- `catch` 后补默认值
- 降级为空对象
- `value as SomeType` 替代 `parse`

> 教训 4：空 `catch {}` 是掩盖 bug 的元凶。捕获处必须打真实错误上下文。

`user_quote` 是这条规则的标准例子：它可以不存在；一旦存在，Host 历史构建、Renderer live projection 与 reload mapper 都必须按 `UserQuoteSchema` 接纳。Vue、edit-resend 反向映射和历史合成只消费接纳后的强类型对象，不得 `safeParse` 后当作“没有引用”。结构与产品语义见 [输入贡献 §4](../../apps/renderer/domains/conversation/docs/input-contribution.md#4-user_quote-结构化多引用-wire)。

`context_usage` 遵循同一规则：通用 Runtime/SSE 事实由 LinnKit `ContextUsageSnapshot` 接纳。ephemeral
`context_usage_snapshot` 表示运行中每次成功 Prompt 的最新值，durable `run_execution_metrics.context_usage` 表示 execution
结算时的最终值；Host 在两者上写入同一正式 `user_message_id`，Renderer live projector 再通过
`projectConversationContextUsage()` 显式挑选产品字段并原子写入用户消息。事件未携带新快照时保留已有值；字段存在但非法时
不得只更新 `agent_work`。reload mapper 只消费已经由 `ConversationUserMessagePayloadSchema` 接纳的 payload，不重新计算
token，也不尝试恢复 ephemeral 中间值。

`context_usage_snapshot` 和 `run_execution_metrics.context_usage` 只接纳成功 Provider attempt 提交的 `ContextUsageSnapshot`。Graph 测量但在 `admit_prompt_capacity` 超限的候选值只能成为 `llm.prompt.input_budget_exceeded` 的 typed error metadata，不是可投影快照；Host 不得为了显示 token 数将它包装成 SSE 或 metrics 的 `context_usage`。

### 4.0 抛在哪里同样是合同（[INV-54](./00-invariants.md#inv-54--parse-与-throw-只允许在-admission-边界)）

上表这些边界之外，还有一个位置**明确禁止** parse 与业务 `throw`：**Vue reactive effect**——`computed`、`watch` 回调、render 函数，以及被它们同步调用的纯函数。

原因是机制性的，不是风格偏好：

```text
admission 边界抛出   → 失败一次，终止该次操作
computed 内抛出      → 中断当前 Vue flush
                     → computed 反复 dirty 反复抛
                     → 整棵渲染树失效，且不走 ErrorBanner
```

真实案例：`selectors.activeMessages` 内的身份冲突 `throw` 曾导致会话切换永久失败（详见 [06 §3.2](./06-read-model.md)）。

该案例还说明：单边 DTO parse 与跨来源合同不是一回事。window 与 live 各自合法，仍可能在
同一 `message_id` 上互相冲突；这类关系必须在两个写入方向做交叉 admission，不能留到
computed 合成时才判断。

需要在组件消费结构化结果时，解析应由 registry owner 的 presentation projector 完成，组件只渲染判别联合。projector 不是组件挂载前的 computed：它通过 Conversation projection port，只能在 live tool patch、reload DTO mapper 与 Subrun 完整消息 admission 三个具名边界执行。Subrun 边界对脱离 Vue 响应式树的快照执行全量接纳，成功后才原子发布。

**注意**：满足本条的唯一正确方式是把解析**上移到边界**。改用 `safeParse` + 默认值、空对象或静默隐藏，同时违反 INV-17 与上面的失败处理规则——那是用一个更难查的问题换一个好查的问题。

### 4.1 前端为什么也要 parse

前端处理的 RuntimeEvent / SSEEvent 来自网络，属于**不可信输入**。从 `@linnlabs/linnkit/contracts`（browser-safe）按需导入 schema 执行 parse。不要为省 bundle 体积复制 interface 或退回断言。

### 4.2 工具 presentation 的字段归属

`packages/plugin-host-contract/renderer/toolUi.ts` 是插件与 Host 共同使用的 presentation 合同真源。`ToolUiConfig.presentation` 由工具 feature 实现，app-level registry 负责分派；Conversation 数据层只依赖 `ports/toolPresentationProjectionPort.ts`。

派生结果只使用 `ToolCallMessage.toolPresentation`，并且只存在于 Renderer read model。工具执行结果、RuntimeEvent 与 durable row 不复制该派生数据；工具业务 `metadata` 仍只服从自身 owner 的 strict schema。

`toolPresentation` 必须完整携带 alias 最终 `uiKey`、正式 lifecycle 与已判别 data。wrapper 的原始工具名仍传给 projector，以便同一次调用完成 adapter 转换。标题保存 message key、fallback 与 params 描述符，展示时才按当前语言解析。

工具 presentation 的 lifecycle 与 success 是两份不同的 admission 合同：`tool_call_decision`、早期 `tool_process` 和 admission 失败只能使用显式 lifecycle 参数合同；只有已成功的 `tool_output` 才允许 projector 解析 owner 的正式参数和结果。Linnkit 的流式 policy 只决定是否发布通用生命周期事件，不改变这一 Renderer 边界。

---

## 5. 工具 wrapper 与底层工具（[INV-18](./00-invariants.md#inv-18--工具-wrapper-与底层工具是两个正式合同)）

工具别名可以复用展示卡片，但**不能复用 wire shape**。

```text
底层 producer          wrapper adapter              Renderer consumer
strict schema A  ──▶  显式转换 + 再次 parse  ──▶  strict schema B
                                                       │
                                          展示联合（由 A、B 组成）
                                                       ▼
                                                  同一张卡片
```

已有实例：

| 入口 | 合同 | 分页字段 |
|---|---|---|
| `read_file(view="document")` | `workspace-document-read.ts` | `nextOffset` |

卡片只消费 strict schema 接纳后的正式 DocumentView 数据。

禁止：在 Vue 组件里改字段名、猜来源，或用 catch/fallback 吞协议错误。

新增别名时必须覆盖**真实 producer → adapter → Renderer** 契约测试。哨兵 JSON 或仅验证路由命中**不能**证明协议一致。

---

## 6. 变更纪律

新增或修改消息 variant 时必须**同时**更新，缺一即合同回退：

1. `@app/schemas` 的 schema
2. Host durable producer（`ui-projection/projectEvent.ts` / `toolProjection.ts`）
3. Renderer live projector（`services/messageProjection/`）
4. Renderer reload mapper（`mapUiMessageDto.ts`）
5. Renderer Subrun message admission（若该 variant 可进入 child detail）
6. parity 业务测试
6. `scripts/guards/conversation-contract-guard.mjs`

新增工具 wrapper 或展示别名时必须同时更新：wrapper schema、adapter、Renderer 展示联合、真实 producer → adapter → Renderer 契约测试。

**以下都视为合同回退**：

- 只改组件
- 只加可选字段
- 用 fallback 兼容旧 shape
- 在消费侧写 shape probing

### 6.1 新增语义的正确顺序

```text
1. 扩展 owner schema（明确 owner 与生命周期）
2. 生产者穷尽处理
3. 消费者穷尽处理
4. parity fixture
5. guard
```

不要反过来——先在消费侧加个可选字段读一读，是所有隐式控制面的起点。

---

## 7. 禁止清单

| # | 禁止 | 正确做法 |
|---|---|---|
| 1 | 各层重新声明 role / type / presentation / status union | 从 `@app/schemas` 导入（[INV-14](./00-invariants.md#inv-14--产品-ui-schema-是唯一真源)） |
| 2 | metadata 开放索引签名 | 显式判别联合（§3.3） |
| 3 | 顶层 message `status` | 状态只表达一次（§3.3） |
| 4 | 拆开解析 answer type 与 seal reason | `parseConversationAnswerMessageMetadata()`（§3.1） |
| 5 | `as SomeSchema` 代替 `parse` | 四个边界都 parse（§4） |
| 6 | catch 后补默认值 / 空对象 | 终止操作，保留原事实（§4） |
| 7 | wrapper payload 交给底层 strict schema | adapter 显式转换 + 再 parse（§5） |
| 8 | 插件数据放非 JSON 值 | `{ namespace, data: JsonRecord }`（§3.4） |
| 9 | 在 `types/index.ts` 新增定义或 re-export | 归属到对应 domain/feature；`guard:conversation-types-exports` 会拒绝扩张（[12](./12-open-risks.md)） |
| 10 | 在 `computed` / `watch` / render 内 parse 或 throw | 上移到 admission 边界或 registry projector（§4.0） |
| 11 | 为绕开 §4.0 而改用 `safeParse` + 默认值 | 上移解析位置，不放宽校验（§4.0） |
