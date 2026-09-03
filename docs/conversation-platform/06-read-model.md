# 06 · Read model 与窗口

> **What** · durable 窗口分页、window ∪ live 合成规则、加载期缓冲、双槽 truncate。
> **When to read** · 改窗口加载、改合并逻辑、排查"重载后消息重复 / 丢失 / 状态回退"之前。
> **不变量** · [INV-42](./00-invariants.md#inv-42--window--live-双层物理隔离)、[INV-43](./00-invariants.md#inv-43--局部消息为空不代表新会话)、[INV-45](./00-invariants.md#inv-45--加载期-sse-无损缓冲)、[INV-46](./00-invariants.md#inv-46--conversationcontentphase-是内容生命周期唯一口径)
> **Related** · [03 持久化](./03-persistence.md) · [05 live 投影](./05-live-projection.md) · [08 生命周期](./08-lifecycle.md)

---

## 1. 两个 read model 物理分槽

```text
messageWindowStore.rows        ← durable 历史（HTTP 分页，已落盘）
conversation.messages（live）  ← 投影产物（本次运行的实时状态）
        │
        └─ selectors.activeMessages：按 message_id 合成
                    ▼
              渲染消费的视图
```

关键性质（[INV-42](./00-invariants.md#inv-42--window--live-双层物理隔离)）：window 行**不回写** `conversation.messages`。合成只发生在读取侧的 computed 中。

**为什么必须分槽**：普通 UI 打开会话走后端 read model（不做全量前端 replay），而进行中的会话走 SSE 内存投影。两者同时存在——历史部分已落盘，尾部还在流。混成一个数组就无法区分"这条是否已经 durable"。

### 1.1 推论：局部为空 ≠ 新会话（[INV-43](./00-invariants.md#inv-43--局部消息为空不代表新会话)）

live 槽为空只说明本次运行还没投影过东西，不说明会话是新的。任何"第一条 live 消息"判断都不能承担会话生命周期语义。

> 教训 10：历史窗口与 live 投影物理分槽，判空不能推导会话身份。

---

## 2. 窗口加载

代码位置 `apps/renderer/domains/conversation/message-window/`：

| 层 | 文件 | 职责 |
|---|---|---|
| API | `orchestration/messageWindowApi.ts` | HTTP 调用 |
| 编排 | `orchestration/messageWindowLoader.ts` | `loadTail` / `loadBefore` / `loadAfter` / `loadAround` |
| 纯函数 | `functions/` | DTO / citation dependency closure 校验、窗口合并与裁剪 |
| 状态 | `store/messageWindowStore.ts` | **只保存快照** |
| 终态收尾 | `orchestration/reconcileTerminalConversationWindow.ts` | cancel 与自然完成竞争结束后重读 durable truth |

四个加载入口：

| 入口 | 用途 |
|---|---|
| `loadTail` | 打开会话（首屏） |
| `loadBefore` | 向上翻历史 |
| `loadAfter` | 向下补齐 |
| `loadAround` | timeline 跳转到窗口外轮次 |

### 2.1 响应式边界

不可变 window row 使用 `markRaw`，**只有外层数组参与响应式**。更新只能替换行 / 替换数组，禁止原地改 row 或 message。

这与 live 侧相反（live 靠替换对象引用表达修订，见 [05 §7](./05-live-projection.md)），因为 window 行本身就是不可变的 durable 快照。

### 2.2 DTO admission

`functions/uiMessagesDtoGuards.ts` + `mapUiMessageDto.ts` 是 reload 侧的校验边界，必须 `parse`（[INV-17](./00-invariants.md#inv-17--strict-schema-必须在真实边界执行)）。非法 row 显式失败，不做 shape guessing。

### 2.3 工具 reload presentation admission

`mapUiMessageDto.ts` 在完成 `ConversationToolMessageMetadataSchema` 校验后、构造 `WindowMessageRow` 前调用同一个 `toolPresentationProjectionPort`。因此非法工具 payload 在异步加载边界失败一次，不会进入 Pinia，也不会在 selector 或组件更新时反复抛出。

window/live 合并遵循同一 lifecycle dominance，并让胜出的工具事实携带自己的 `toolPresentation`。该字段不写回 DTO，不从 metadata 恢复，也不在合成阶段重新运行 projector。

### 2.4 Citation dependency closure

窗口按行分页，不能保证 citation-bearing answer 与生产其 ref 的 tool row 同窗。Host 在增量 projection 与
全量 rebuild 时，把通过 owner strict schema 的 durable main tool facts 和有正式 parent 归属的 child
`tool_output` 规范化到 `conversation_ui_citation_facts`。窗口读取只按可见正文中的 ref 查询该派生索引，
并通过 `citation_dependencies[message_id]` 返回每条可见 assistant message 实际使用的来源子集或
`unresolved_refs`。

closure 必须按 `sort_seq` 在每条 message 的发生时点 materialize：只接纳该消息之前已经存在的 main tool
facts，以及能通过 `parent_run_id + parent_tool_call_id` 绑定到更早 parent tool row 的 child outputs。未来工具
事实不得反向解析或覆盖历史消息；同一稳定来源的重复 fact 保留首次接纳 snapshot。

fact index、sidecar 与 messages 使用同一 projection revision。Renderer admission 必须验证：

- 每条含 canonical `[@ref]` 的 assistant message 都有且只有一个 snapshot；
- resolved 与 unresolved 的并集精确覆盖正文 refs；
- sidecar 不包含当前 window 之外的 message；
- citation facts 通过严格判别联合，不从 observation 或可选字段猜来源。

mapper 把 snapshot 绑定到不可变 message row。store 不解析 citation、不维护全局 registry；row 被裁剪时其
依赖自然释放。dependency snapshot 与 fact index 都是可重建 read model，不是新 SoT，也不得写入 Linnkit
通用 RuntimeEvent。读取成本随窗口引用及其少量候选事实增长；禁止在窗口 API 回退为全历史扫描。

---

## 3. 合成规则（核心）

真源 `message-window/functions/mergeWindowAndLiveMessages.ts`。

### 3.1 只按规范 message_id 去重

```text
匹配依据：message.id
禁止依据：merge key、tool name、tool call id、文本内容
```

因为 Tool `message_id === merge_key`（[INV-11](./00-invariants.md#inv-11--tool-ui-身份不属于单个事件)），按 id 匹配自然覆盖工具卡；无需第二套 key。

新答案从首个 chunk 到 durable read model 始终使用同一 `answer_id`，**不存在 seal 改名**，所以答案也按 id 天然对齐。

### 3.2 按类型分别合并

每种消息有专属 merge 函数，但合成层不再重复解析 metadata：window DTO 已由
`mapUiMessageDto` 完成 strict admission，live message 已由 MessageProjection 完成 strict
admission；这里仅执行明确的字段优先级：

| 类型 | 函数 |
|---|---|
| user | `mergeUserMessage` |
| thought | `mergeThoughtMessage` |
| tool | `mergeToolMessage` |
| answer（`final_answer` / `tool_preamble` / `partial_answer`） | `mergeAnswerMessage` |
| history_summary | `mergeHistorySummaryMessage` |
| summarization_progress | `mergeSummarizationProgressMessage` |

同一 `message_id` 的跨来源类型一致性，以及同一答案身份的 seal 一致性，只有 window 与 live
相遇时才能判断，单边 DTO admission 不足以证明它。正式交叉 admission 有且只有两个写入方向：

| 写入方向 | admission owner | 失败语义 |
|---|---|---|
| durable window 进入 store | `messageWindowLoader` | snapshot 不落 store，loader 进入 error |
| live projection 提交 Vue 状态 | `projectionStore` | 事件投影失败，未提交 reducer runtime 回滚 |

`messageWindowLoader` 通过显式 `readLiveMessages` port 读取另一侧，禁止直接初始化
Conversation store 图。`projectionStore` 只在当前 window 属于同一 conversation 时交叉校验。
因为 reducer 是就地更新，失败时必须同时丢弃 pending commit，并从已提交 Conversation live
slot 重建 runtime；Citation workspace 是 detached Map，交叉 admission 失败时保留 reduce 前版本，避免把
已提交但尚未被正文消费的 tool fact 一并删除。runtime 正常重新初始化时则只从已提交 main tool result 与
`subrunTrace` child tool output 重放来源，不从 message snapshot 反推 producer fact。只返回失败而保留脏 Map
属于半事务。

`mergeWindowAndLiveMessages` 现在是总函数：不 parse、不 throw、不写 store。它仍返回
`conflicts` 作为绕过 admission 后的诊断证据，并保留 durable row，避免非法状态再次
破坏 Vue flush；生产主链不得把该诊断分支当作兼容或 fallback。

历史事故机制仍值得保留：旧实现的 `rejectIdentityChange()` 与答案 metadata `.parse()` 位于
`selectors.activeMessages` 的 computed 调用链，一次协议错误会中断 Vue flush 并反复重算反复抛，
最终表现为无法切换或新建会话。排查同类问题时仍应在 devtools 开启 *Pause on caught exceptions*，
第一次断点才是原始异常。

### 3.3 显式 lifecycle dominance

一般规则是 live 覆盖 window（live 更新），但工具和答案各有一个由正式生命周期字段决定的例外。

**工具生命周期：**

```text
window tool status !== 'loading'  且  live tool status === 'loading'
   → durable 终态压过陈旧 live 状态
   → 但保留 live-only 的 subrunTrace / subrunTraceVersion
```

**为什么需要这条**：取消或导航竞态下，SSE 可在 `tool_output` 到达前中断，而 durable read model 已完成结算。此时 window 才是工具生命周期的较新权威事实。而 subrun trace 只存在于 live projection，必须保留给父工具卡展示。

这条规则替代了"扫描 loading 行补终态"的做法——后者被 [INV-25](./00-invariants.md#inv-25--工具-batch-必须完整结算) 明确禁止。

**答案生命周期：**

| window | live | 处理 |
|---|---|---|
| sealed | unsealed | durable 已看到 seal，window 胜出 |
| unsealed | sealed | live 已看到 seal，live 胜出 |
| sealed | sealed，reason/content 一致 | 同一事实，允许合成 |
| sealed | sealed，reason/content 不一致 | admission 拒绝；selector 保留 window 并报告 `answer_seal` 冲突 |

seal 的唯一判据是 `metadata.completion_reason !== undefined`。不得比较 timestamp 或 `sort_seq`
猜新旧；它们不属于同一个时钟。新 attempt 必须使用新 `answer_id`，因此
`interrupted → terminal` 同身份不是恢复流程，而是生产方身份复用错误。

### 3.4 尾部处理

```text
hasMoreAfter === true  → 不追加 live-only 消息（当前窗口不是尾部）
否则                   → 追加 live-only 消息
```

窗口不在尾部时追加 live 尾巴会让用户看到"中间历史 + 最新消息"的错乱拼接。

### 3.5 Composer 上下文用量派生

输入框的上下文用量只从 `selectors.activeMessages` 的 `window ∪ live` 合成视图派生，不新建 store，也不查询
telemetry 或成本账本。派生函数从尾部反向读取最近一个带 `metadata.context_usage` 的 `user_input`，其语义是最近一次
成功提交给模型的 Prompt 快照，而不是当前草稿预测、工具事件计数或会话累计用量。

该读取必须同时满足 `activeMessageWindowIncludesConversationTail=true`。历史跳转或 around window 尚未回到尾部时，
当前窗口中的最后一条快照不一定是整段会话的最新事实，UI 必须显示 `tail_unavailable` 中性空态，禁止拿较老快照冒充
最新值。切换会话时弹出层实例随会话 key 销毁，不能把前一个会话的打开状态或快照带到新会话。

当前有效模型只用于判断历史态：当其 ID 与快照 `budget_model_id` 不同时，保留原分子、分母和三项归因，并标记
`historical_model`；禁止按当前模型 route 重算已经发生的请求。新 execution 在第一次 LLM Prompt 成功前仍展示上一份
快照；之后每条 `context_usage_snapshot` 即时修订对应用户消息。`run_execution_metrics` 在结算时覆盖同一字段，保证 reload
与未在线接收中间事件的客户端最终收敛。

---

## 4. 加载期无损缓冲（[INV-45](./00-invariants.md#inv-45--加载期-sse-无损缓冲)）

打开一个**仍在生成**、tail 快照尚未 ready 的会话时：

```text
1. 保留 conversation projection runtime 与 live slot   ← 不清空
2. 开启本世代缓冲（{ conversationId, requestToken } 唯一拥有）
3. 加载窗口
4. 在同一 runtime 按序回放
```

顺序固定，不可调换。`preparing` / 错误 / 过期世代按 token 清理。

禁止：

- 清空已有 chunk 前缀
- 缓冲数量上限（必须无损 FIFO）
- 语义合并（必须原始事件）
- 跨世代回放

普通后台实时流继续投影到**自己的** conversation，不经过当前页面的缓冲。

---

## 5. 内容相位（[INV-46](./00-invariants.md#inv-46--conversationcontentphase-是内容生命周期唯一口径)）

真源 `functions/conversationContentPhase.ts` + `store/conversationContentPhaseSelector.ts`：

```text
无 currentConversationId              → 'draft'
isHistoryReplayLoading               → 'history-loading'
有可渲染内容                          → 'ready'
否则                                  → 'ready-empty'
```

`hasRenderableContent` 同时要求 `hasRenderableSourceMessages && hasRenderableItems`——源消息存在且能产出可见 row。

UI 空态 / 加载态判断**禁止各自拼 messages 信号**。`historyLoadingConversationId` 由 loader 独占写入。

消费方（如 `ConversationChatSurface` 的空态互斥）见 [08 §2](./08-lifecycle.md)。

---

## 6. 截断（编辑 / 重新生成）

编辑或重新生成时必须**同步更新两个槽**：

```text
投影侧：assistantStore.truncateProjectionStateAfterMessage(conversationId, messageId)
窗口侧：裁剪 window rows
```

只截断一侧会让被删尾部从另一个槽复活。

提交顺序固定（[02 §7.2](./02-event-pipeline.md)）：

```text
取消旧流 → 截断旧尾部 → 启动新请求
```

---

## 7. 一致性与假底

后端 `conversation_ui_projection_state` 落后于 events 时返回 `pending`，UI 显示"正在准备窗口"，**不回退全量 replay**（见 [03 §2.3](./03-persistence.md)）。

窗口分页、假底 / 换窗语义的完整实现契约见 `apps/renderer/domains/conversation/docs/conversation-virtualization.md`。

---

## 8. 禁止清单

| # | 禁止 | 正确做法 |
|---|---|---|
| 1 | 把 window 行写进 `conversation.messages` | 只在读取侧合成（§1） |
| 2 | 按 merge key / tool name / 文本匹配同一实体 | 只按 `message_id`（§3.1） |
| 3 | 原地修改 window row 或 message | 替换行 / 替换数组（§2.1） |
| 4 | live 无条件覆盖 window | 注意工具 dominance 例外（§3.3） |
| 5 | 扫描 loading 行伪造终态 | 靠 durable dominance（§3.3） |
| 6 | 窗口非尾部时追加 live 尾巴 | 看 `hasMoreAfter`（§3.4） |
| 7 | 加载 loading 壳时清空已有 messages | 保留 live slot（§4） |
| 8 | 缓冲设上限或做语义合并 | 无损 FIFO（§4） |
| 9 | 组件自己拼空态判断 | 读 contentPhase（§5） |
| 10 | 只截断投影或只截断窗口 | 两侧同步（§6） |
| 11 | 用"live 为空"判断新会话 | 分槽无生命周期语义（§1.1） |
| 12 | 在 merge 里 catch 掉类型冲突 | 让 `rejectIdentityChange` 抛出（§3.2） |
