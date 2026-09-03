# 10 · 父子 Agent 与 Subrun

> **What** · child fact 的隔离路径、parent trace 协议、父卡轻量进度、完整 child message admission、Host 就地详情与 lifecycle owner。
> **When to read** · 改子 agent、Subrun trace、父卡进度或详情 surface，排查“工具步骤缺失 / 重复 / 一直转圈 / 详情空白”之前。
> **不变量** · [INV-44](./00-invariants.md#inv-44--durable-ui-与-foreground-context-按-routing-identity-隔离)、[INV-27](./00-invariants.md#inv-27--subrun-lifecycle-汇总只属于-runsupervisor)、[INV-47](./00-invariants.md#inv-47--subrun-完整消息只有一条正文输入链)、[INV-48](./00-invariants.md#inv-48--subrun-trace-使用稳定-accumulator)、[INV-49](./00-invariants.md#inv-49--subrun-leaf-使用正式身份)、[INV-59](./00-invariants.md#inv-59--完整消息共享同一个-visual-row-展示-owner)、[INV-28](./00-invariants.md#inv-28--subrun-lazy-状态不是运行状态)
> **Related** · [09 工具](./09-tools.md) · [03 持久化](./03-persistence.md) · [05 live 投影](./05-live-projection.md) · [08 生命周期](./08-lifecycle.md)

---

## 1. 四个 owner 必须分清

```text
child fact ──▶ child EventBus / child EventStore       （审计、恢复、child 自身）
                    │ 按 source_event_id 关联
                    ▼
           parent subrun_trace live                    （唯一实时展示协议）
                    │ Host 紧凑历史投影
                    ▼
      subrun_trace_runs / subrun_trace_items            （唯一历史展示 read model）
                    │ Renderer 稳定 accumulator
            ┌───────────┐
            ▼                     ▼
    父卡轻量进度          完整 child message admission
                                  │
                         Host 就地详情 / 插件 SubrunCard

RunSupervisor / runs 表                                  （唯一 lifecycle owner）
```

| owner | 是什么 | 不是什么 |
|---|---|---|
| child EventStore | child 事实源 | 父级正文来源 |
| parent `subrun_trace` | ephemeral live 展示协议 | durable child 事实 |
| 紧凑 trace 历史表 | 可重建的历史展示 read model | 完整 RuntimeEvent 副本 |
| `runs` 表 / RunRegistryStore | lifecycle owner | 展示数据 |

child fact 使用 `lane=child / visibility=parent-trace`，可供 child 恢复与审计，但不进父级 `conversation.messages`。父级展示 child 过程只能消费 parent `subrun_trace`。

`subrun_trace` 不进通用 `events`。Host 紧凑历史只保存展示所需的语义 payload，读取时再通过 Linnkit 合同校验 DTO。父工具 `tool_output.data` 与 `observation` 不是 trace 备份，不得用来补造 child 正文。

---

## 2. 产品活动模型与发起路径

对话栏不是“消息流加特殊任务卡”，而是活动流：一次父 Run 可以包含普通消息、父工具活动和若干隔离 subrun。是否进入主上下文、是否需要独立上下文，决定它的产品形态：

| 渲染在对话中 | 需要独立上下文 | 形态 |
| --- | --- | --- |
| 是 | 否 | 父级普通消息或工具对，进入主上下文 |
| 是 | 是 | 归属于父工具活动的 subrun；过程只进 trace，聚合结果经父 `tool_output` 回主上下文 |
| 否 | 默认独立 | Review、autocomplete 等 `persist:false` 能力，不属于 Conversation 活动 |

```text
Run（一次用户意图）
  └─ 可选父工具活动
       ├─ subrun 1（隔离执行 + UI trace + 结构化结果）
       ├─ subrun 2
       └─ 父 tool_output（有界聚合，进入主上下文）
```

批量执行分成两条真实路径：

- LLM 批量：Agent 在一次决策中多次调用普通 `subagent`；每次调用拥有自己的工具对和 subrun，不承诺并行。
- 系统批量：按钮或确定性业务编排使用 Host-only `subrun_batch`，一次启动 N 个 child run；它可以注册在 Host ToolRegistry，但不能进入任何 AgentDefinition 或模型工具白名单。

系统批量由无工具的 `system_batch_summarizer` 收尾，父工具结果保存完整逐项事实与权威 `subrun_ids`，observation 保持有界。Host 使用标准 ToolNode 合同形成 `tool_call/tool_output`，不能手工合成一套事件；写回副作用通过业务 owner 的窄 port 完成，不能由 child 自报的行列、路径或开放 metadata 决定目标。

表格填充是首个垂直切片：`app/workflows/table-fill` 发起 forced `subrun_batch`，Editor 的 `table-fill-write` port 串行提交真实 ProseMirror 写入，Conversation 只承载活动、trace 和最终展示，不识别 table 业务字段。

术语必须保持单义：

| 语义 | 正式名称 |
| --- | --- |
| 父 Agent 委派动作 | `subagent` 工具 |
| 隔离执行与 UI 下钻 | `subrun`、`SubrunCard`、`subrun_trace` |
| Host 确定性批量 | `subrun_batch`、`subruns[]` |
| 外部活动归属 | Renderer `activityBinding`；wire `options.activity` / `metadata.activity` |
| 历史隔离 | `historyIsolation: 'isolated'`；wire `history_mode: 'isolated'` |
| 结构化工作状态 | `TaskState`、`task_read`、`task_write`，这是独立业务概念，不等于 subrun |

Linnkit 的 `IAgentTask` 等公开上下文装配 API、知识库外部 `task_id` 协议和 Cloud `task_defaults` 不属于 Conversation 命名整理范围；若要修改必须各自设计公开迁移，不能在本模块顺手改名。

---

## 3. Trace 展示协议

child 工具链的三类事实语义与主 ToolNode 一致；已提交的上下文摘要另投影为一类只读展示事实：

| kind | durable payload | 可见步骤 |
|---|---|---|
| `tool_call_decision` | 本次模型提交的 canonical `tool_calls[]` 完整批次 | 否 |
| `tool_process` | 已经 owner admission 的单个 `tool_name + tool_call_id + args + phase + status` | 是，`start` 后进入 loading |
| `tool_output` | 单个调用的 terminal status 与结构化 output；成功结果可带有序 durable attachment refs | 是，收敛为 success/error |
| `history_summary` | 已提交摘要的统计、替换来源 ID 与压缩比；不复制摘要正文 | 是，仅在完整 child message 详情中复用现有 Summary 行 |

`tool_call_decision` 不表示工具已开始，也不创建 queued/pending 可见行。ToolNode 当前串行执行时，用户会看到工具随 `tool_process(start)` 一个个出现；未来并行执行时只会有多个步骤同时 loading，Renderer 无需新增 queue 状态。

### 3.1 decision 为什么必须保存完整批次

- 一个 child fact 对应一个 `source_event_id`，不得拆成 N 个伪事实。
- `tool_output` 在 reload 时可能没有 ephemeral `tool_process`；durable decision 是恢复原 args 的唯一正式来源。
- decision 必须使用 `tool_calls[]`；已退役的标量 `tool_name/tool_call_id/args` 在 decision 上非法，开发环境不保留兼容分支。
- `tool_process.args` 必须是 owner admission 后的正式参数；不得从 decision 直接推断“已启动”。

---

## 4. 稳定 accumulator（[INV-48](./00-invariants.md#inv-48--subrun-trace-使用稳定-accumulator)）

真源是 `features/subrun-trace/functions/createSubrunTraceAccumulator.ts`。

```text
按 subrun_id 分桶
按 source_event_id 接纳
历史确定前缀，live 确定重叠事实与新尾部
```

| 情况 | 处理 |
|---|---|
| 历史前缀 | 只补 live 未覆盖的旧语义项 |
| 重叠事实 | 使用 live DTO 和 live 顺序 |
| live 新事实 | 只追加尾部 |

存在明确 historical source 时必须加载历史前缀，不能因已有 live bucket 而跳过。source epoch 是 `conversation_id + parent_tool_call_id`，单卡再加 `subrun_id`；epoch 改变必须显式 reset。

历史迟到时只替换一次 bucket identity，后续稳定复用并只扫描 live 新尾部。禁止在 computed 中反复创建合并数组、整 bucket 覆盖、按文本去重或按 `answer_id` 猜来源。

完整分页成功后的 durable trace 由 `subrunTraceHistoryCacheStore.ts` 按 exact source
`conversation_id + parent_tool_call_id + subrun_id + kinds + invalidation revision` 共享。这个缓存只保存已接纳的 ready 快照，不保存 loading/error，也不改变 API 的懒加载语义。它用于 Host 在父列表与详情互斥卸载后同步恢复同一父卡首帧高度，并避免重复 HTTP 读取；取消或终态 invalidation 后旧 revision 不能命中新挂载 surface。
缓存按最近使用顺序保留有限数量的完整快照，不能因长时间浏览大量 subrun 无界占用 Renderer 内存。

配套 owner：`buildSubrunTraceBuckets.ts`、`createAppendOnlySubrunStepProjector.ts`、`useSubrunTraceAccumulator.ts`、`useAppendOnlySubrunTrace.ts`。

紧凑历史有一项明确的协议投影：实时 `final_answer_chunk` 不持久化，而 durable `final_answer` 保存完整正文快照。`loadSubrunTrace.ts` 必须在历史边界把该快照确定性投影为一次性 chunk 与原封口，然后交给 accumulator 和正式 message admission。正文因此仍只由 chunk 创建，实时 `final_answer` 缺少 chunk 时仍必须拒绝。历史 chunk 的投影标记只存在于 Renderer 内存，不进入 wire；它与封口共享真实 `source_event_id`，accumulator 使用内部投影身份区分二者。live 出现同一真实 source 后必须整体取代这组历史投影，不能产生两份正文。

---

## 5. 两条 Renderer 投影链，一个 trace 输入

### 5.1 父卡轻量进度

`SubrunTracePanel.vue` 是父卡与 Deep Search 共用的唯一轻量过程 UI。它消费稳定 bucket，
`createAppendOnlySubrunStepProjector.ts` 只产生轻量步骤；`ToolCallsMessage` 持有统一工具卡外壳，
`SubrunProgressCard.vue` 只把父工具 presentation、精确 lazy source 与 Host detail navigation
适配给该面板，不拥有第二套步骤状态、卡片或样式。

- decision 只记录 durable args，不创建步骤。
- process 创建 loading 步骤。
- output 收敛 terminal 状态；reload 缺 process 时从同 identity 的 decision 恢复 args 与标题。
- 父卡轻量步骤只消费工具语义与终态，不解析 attachment refs；图片只在完整 child message 详情中展示。
- `SubrunTracePanel.vue` 统一渲染逐行步骤，并用显式 disclosure mode 区分 surface 行为，不得用“默认展开”间接猜测产品语义。
- 普通 Host subrun 的标准工具外壳默认折叠；运行中标题跟随最新 child compact-step 并显示统一扫光，首步之前与终态使用原始任务标题。用户展开外壳后，内层过程使用 `static-expanded`，不再出现嵌套的“展开/收起”，只通过 action slot 提供“查看详情”。
- Deep Search 使用 `collapsible`：保持默认折叠和“展开/收起”，不注入“查看详情”。两者复用同一 DOM、projector、历史加载与样式 owner。
- 轻量面板只渲染真实工具步骤和真实异步加载/失败状态；终态 0 步时既不渲染 `0 步`，也不渲染“没有可展示的过程”等空正文。
- 父卡不挂载 child `Message.vue`；registry 不得用 `renderAsGroup` 绕开统一工具卡，也不得复制 `SubrunTracePanel` 的 projector、历史加载或 CSS。
- 历史 `VITE_DEEP_RESEARCH_VERBOSE_SUBRUN` 不恢复：compact 是 Host 唯一父卡形态，完整 child messages 只进入就地详情，避免同一产品能力保留两套运行期模式。

紧凑步骤标题通过 Conversation `ToolCompactStepProjectionPort` 进入 app-level adapter，再复用 enabled
Renderer `toolCards` registry 与 alias 规则调用工具 owner 的 `compactStep`。Conversation 不维护工具名或参数
映射。decision 只接纳 args；process/output 在 detached 批次上投影，整批成功后才替换可见快照。
projector 失败保留上一快照并报告 admission error；只有 registry 未命中（未知工具、插件未加载）才使用
“执行「tool_name」”诊断标题。步骤保存延迟本地化 descriptor，切换语言不重跑业务投影。

`compactStep` 输入是正式的 lifecycle 判别联合：

| status | phase | 来源 | owner 可读取的事实 |
|---|---|---|---|
| `loading` | `start/update` | `tool_process` | 仅生成安全进行中标题所需的最小参数 |
| `success` | `complete` | `tool_output` | strict parse 正式 args 与成功 result |
| `error` | `error` | `tool_process/tool_output` | 不解析成功参数或结果，只返回 owner-owned 失败标题 |

error lifecycle 必须能表达“工具执行失败”，即使原 args 正是工具 owner 拒绝的非法输入。Knowledge、Web
与 Command compact projector 不得为 error 补空 `doc_id/query/command`、猜 search mode，或复用带请求
细节的成功标题。registry 命中后的合同异常仍拒绝整个 detached batch；错误上下文只暴露
`sourceToolName/uiKey/toolCallId/status/phase`，同一
`bucket + version + toolCallId + uiKey/sourceToolName` 指纹只报告一次高层诊断。去重不代表接纳成功，
输入或版本改变后仍按新指纹重新报告。

### 5.2 完整 child message admission

`admitSubrunMessageProjection.ts` 是具名 admission owner：

```text
稳定 bucket
  → clone 旧快照
  → 在 detached snapshot 上顺序投影全部新事实
  → 工具消息共用 prepareToolCallMessageCandidate
  → 全部成功后原子替换可见快照
```

`createSubrunMessageAdmissionScheduler.ts` 用新微任务调度 admission。Vue `watch` 只请求调度，不同步 parse、project 或 throw。任一事实失败时只拒绝新快照，保留上一个已接纳快照；不存在跳过非法步骤、补默认参数或仅渲染部分 child 的 fallback。

child 工具消息 ID 统一使用 `conversationSubrunMessageIdFromToolIdentity(subrunId, toolCallId)`，避免与父时间线 ID 冲突，并保证 live/replay 一致。

成功 child `tool_output` 可以在顶层携带有序 durable attachment refs。完整 admission 复用主会话的 attachment 映射与工具卡 capability，把这些 refs 绑定到同一 child 工具消息；live 与紧凑历史重载因此都走现有受管 asset 预览端口。失败 output、其他 trace kind 与旧历史中没有 refs 的 output 都不产生附件，禁止从结构化 output、observation、locator 或本地路径猜测、补造或重新执行工具。trace 只复制资源身份与校验元数据，不复制图片字节或物理路径，也不把 child 图片加入父 Agent 上下文。

完整 child admission 还拥有 Subrun 独立的 Citation workspace。成功 child `tool_output` 必须先通过
Citation domain 的 producer owner schema，再在 detached workspace 上注册；child thought / answer 从该
workspace 生成自己的 `citationDependencies`。同 ref 来源冲突、非法 producer 结果或 message projection
失败时，messages 与 citation workspace 一起保留旧版本，禁止只发布其中一半。

历史 trace 与 live 尾部走同一 admission，因此冷启动详情不依赖主时间线是否曾实时看到 child output。
引用 snapshot 随 child message / ready 快照持有，surface 与缓存释放时自然释放，不使用全局 store、TTL，
也不在 Vue computed / mounted 时扫描 trace。child citation 可用于详情 hover / copy，但不会自动成为父 Agent
的语义上下文；长期跨 Agent 证据仍走 Workspace `CitationMark`。

child 的 `history_summary` 只有 durable commit 成功后才进入 parent trace。完整详情用
`subrunId + source_event_id` 派生独立消息 ID，并复用主会话现有 `HistorySummaryMessage → SummaryMessage.vue`
展示“上下文已压缩”；父卡轻量步骤不展示摘要。parent trace 是展示 read model，因此只携带统计和
替换来源 ID，不复制摘要正文，也不把 compaction 的临时 start/error presentation 伪装成已完成事实。

---

## 6. Host 产品形态

Host 中 `subagent` 与 `subrun_batch` 不再把完整 child 消息树嵌套在父 virtual row。

```text
父 ConversationView
  └─ ToolCallsMessage（统一工具卡外壳）
       └─ SubrunProgressCard（Host 薄内容适配器）
            └─ SubrunTracePanel（与 Deep Search 共用的逐行过程 + 详情 action）

点击详情
  └─ ConversationHost 结构性切换
       └─ SubrunDetailSurface
            └─ 共享 ConversationMessageCanvas / ConversationVisualRow
                 ├─ 父 subagent args.prompt 投影的只读 UserMessage
                 └─ 完整 child messages
       └─ SubrunDetailFooterPanel
            └─ 执行状态 / 模型事实 + 返回主对话
```

### 6.1 详情 scope 与返回

打开时固定：

```text
conversationId + parentMessageId + parentToolCallId + subrunId + description
```

- scope 在详情存续期不可变，由 `subrun-detail` feature 的非持久化 store 保存；它是详情 surface
  与应用 Header 共用的唯一当前身份，不复制进 `layoutStore`、`assistantStore` 或第二份 Header 状态。
- `ConversationHost` 是 navigation 与返回锚点的 lifecycle owner，主 View 与 detail 用 `v-if/v-else`
  互斥挂载，禁止 Transition；切 conversation、Host 失活或卸载时必须清空 feature scope。
- Conversation pane 的应用 Header 显示 `父对话标题 / Subrun description`。父标题实时读取当前
  conversation title，不得复制进不可变 scope，否则自动标题或手动改名会留下过期面包屑。
- 父对话标题是可点击面包屑。Header 只发窄的返回意图，不清理 scope、不保存 callback 或 DOM；
  `ConversationHost` 收到后仍调用同一个 navigation `close()` 恢复返回锚点。
- 打开前按父 `messageId` 记录精确滚动 offset；返回后按同一身份复位，不使用 index 或最近工具猜锚点。
- detail 为只读表面：保留 Host footer 和 `CommandApprovalPanel`，隐藏输入框。底部
  `SubrunDetailFooterPanel` 与主 composer 共用 `conversation-footer-shell/surface` 视觉外壳，
  只展示执行状态、已结算的模型身份和“返回主对话”，不得挂载 editor、草稿或发送能力。
- `subagent` 成功结果的 `data.model_id` 是这次 child 启动时锁定的模型事实。详情重载后只从
  owner-admitted 结构化结果读取；运行中或父工具失败但没有结果时不从当前模型选择、trace 文本
  或全局 store 猜模型。
- detail 正文不重复渲染 Subrun 标题；surface 仍以 `description` 提供无障碍名称。
- 切换 conversation 或 Host 真实卸载时显式 reset detail scope。
- detail 外层只参与 Host 的全宽滚动布局，内部内容列复用父会话的列宽与左右留白变量；禁止把横向 padding 放在同时带 `conversation-view-container` 的根节点上。
- detail 对已接纳 child messages 复用 `ui/messageCanvas` 与主时间线相同的 visual-row DOM、turn 间距、streaming 归属和回答操作；不得直接循环 `Message.vue` 或定义第二套消息 `gap`。
- detail 的首条消息从父 `subagent` 正式 `args.prompt` 投影为只读 `UserMessage`，与 child messages 组成同一 visual turn。它不写入父 Conversation window，不提供编辑或重新发送；复制继续复用 `UserMessage` 既有能力。
- 复用到展示层为止。detail 不 import `ConversationView`、foreground store、message-window、timeline 或 TanStack；这些能力属于主时间线与 Host 编排。

### 6.2 插件公开卡不在 Host 主链

插件公开 `SubrunCard` / `SubrunCollection` 继续保留，并复用同一完整 message admission。它们的 bounded 展开、多卡互斥属于插件合同，不得倒推 Host 重新嵌套 child 树。

`SubrunBatchCollection.vue` 在 Host registry 中只将 batch 归一为多个 `SubrunProgressCard`；Host 不再拥有 `activeSubrunId` 互斥展开状态，因为 `ConversationHost` 一次只有一个 detail scope。

---

## 7. Lazy 状态不是运行状态（[INV-28](./00-invariants.md#inv-28--subrun-lazy-状态不是运行状态)）

`useLazySubrunTrace.ts` 五态：`idle | loading | preparing | ready | error`。

| 状态 | 含义 | 展示 |
|---|---|---|
| `idle` | 历史尚未按需读取 | 不是“正在加载”，不是“后台仍运行” |
| `loading` | 真实请求在途 | 加载态 |
| `preparing` | 后端投影未就绪 | 加载态 |
| `ready` | 已就绪 | 内容 |
| `error` | 读取失败 | 明确错误，历史请求可重试 |

只有真实 `loading/preparing` 或父工具事实仍为 loading 才显示加载。child thought 是否完成只看同 identity 的 trace 完成事实，不从 lazy 状态推断。

历史 API 必须同时按 `conversation_id + parent_tool_call_id + subrun_id` 查询，禁止先读取全部兄弟再由 Renderer 丢弃。取消收尾只自动重读曾请求过的 trace；刷新期保留旧快照，新 bucket 通过 admission 后才原子替换。

---

## 8. Lifecycle 与后端 scope

SQLite `runs` / RunRegistryStore 保存 `parentRunId + status + currentNode + iterationsUsed + errorIfAny`，是按父级查询 child lifecycle 的唯一 owner。Telemetry、CostCollector、LLM Audit 只观测，紧凑 trace 只展示，禁止从 trace 数量或 audit bucket 重建第二套 lifecycle。

composition root 必须将同一 `LinnyaAgentRuntimeScope` 显式交给 Flow、AgentRunner 和 registered child invoker。child invoker 经 ToolContext 注入，递归 child 继承该实例；Flow、runner、child lifecycle 和测试都不得执行期查询全局 fallback。共享 scope 只共享基础设施端口，root / child / recursive child 仍拥有独立 routing identity。

---

## 9. 业务测试要求

Subrun 变更至少覆盖：

1. 单个 decision 携带多个 `tool_calls[]`，不创建可见步骤；各 process 随真实开始出现。
2. live `decision → process → output` 产生真实工具 presentation。
3. reload `decision → output` 在没有 ephemeral process 时恢复同一 ID、args、title 与 terminal presentation。
4. 任一 child 工具 schema/projector 失败时不发布半快照，且错误不在 Vue reactive flush 中抛出。
5. reload 只持久化完整 `final_answer` 快照时，历史边界重建一次性 chunk 与封口并恢复同一完整 child answer；原始 live `final_answer` 缺 chunk 继续被拒绝。
6. 真实 main projection → async registry card → parent progress virtual row 复用 `SubrunTracePanel`，不出现第二套步骤 DOM/CSS。
7. 详情使用真实 parent `args.prompt`、parent trace、正式 child message admission、共享 message canvas / visual-row 与真实工具卡；首条只读 UserMessage 不暴露编辑/重新发送，整体按普通文档流展示，不出现 bounded child 消息树或第二个 virtualizer。
8. 打开详情后应用 Header 显示实时 `父对话标题 / Subrun description`，父标题点击通过 Host 返回；正文不重复标题，关闭、切 conversation 或 Host 卸载后清除子标题。
9. 详情底栏与主 composer 共用悬浮外壳，终态从正式 `subagent` 结果展示状态与 `model_id`；顶部面包屑和底部按钮都走同一 Host 返回编排。
10. child 完成自动压缩后，实时详情与重启后的历史详情都复用现有 completed Summary 行；父卡不增加摘要步骤，失败的压缩不产生伪 `history_summary`。
11. Electron 真机覆盖数据库中仅有 durable decision/output/history summary/final answer 的重启状态、打开详情、Header 层级、两处返回入口、返回锚点、切换 conversation、取消/自然终态与审批 footer。
12. child tool output 与 child answer 分页/重启后，canonical refs 仍绑定同一 message dependency snapshot；
    producer schema 或 ref conflict 失败时不发布半快照。
13. child 使用真实图片读取工具时，当前 child 模型能收到正式 `tool_result_image`；成功 trace、紧凑历史与完整详情保持同一 refs 顺序，Electron 重启后真实图片预览可加载；父卡不渲染图片，父模型也不继承 child 图片。

正式导航 E2E 的隔离 SQLite fixture 必须包含父 `subagent` 历史行与紧凑 trace。reload 场景应只持久化 durable decision/output/final answer，刻意不伪造 ephemeral process 与 answer chunk；图片工具 output 还必须引用真实受管 asset 并等待预览图片加载，从而同时验证 Runtime→SSE 保留 `tool_calls[]` 与 attachment refs、child args 恢复、最终正文历史投影、跨 surface ready 快照复用和返回锚点。

Subrun 历史协议的专用真机门禁是 `test:conversation-subrun-reload:electron`。它使用较短的父时间线隔离无关的长列表滚动时序，但不 mock SQLite、HTTP、Renderer、工具 registry 或 message admission，不能用组件测试替代。

---

## 10. 禁止清单

| # | 禁止 | 正确做法 |
|---|---|---|
| 1 | child fact 进父级正文 | 只走 parent trace（§1） |
| 2 | 用 `tool_output.data/observation` 补 child 正文 | 让 trace 缺失明确暴露（§1） |
| 3 | 把 decision 当可见 queued/pending 步骤 | 只在 process start 创建 loading（§3） |
| 4 | 把 decision batch 拆成多个伪 trace fact | 保存 canonical `tool_calls[]`（§3.1） |
| 5 | reload 时猜 args 或补默认值 | 从 durable decision 按 tool identity 恢复（§3.1） |
| 6 | 已有 live bucket 就跳过历史加载 | 完成历史前缀（§4） |
| 7 | computed 中重建 bucket 或 parse/project child 工具 | 稳定 accumulator + admission scheduler（§4–5） |
| 8 | 失败时跳过单个事实继续发布 | 原子拒绝整个新快照（§5.2） |
| 9 | Host 父 row 内嵌套完整 child 消息树 | 父进度 + Host 就地详情（§6） |
| 10 | 详情重读 active conversation 猜 scope | 打开时固定不可变 scope（§6.1） |
| 11 | 把 `idle` 显示为加载中 | 只有真实请求才是加载（§7） |
| 12 | 从 trace/audit 重建 lifecycle | 读 `runs` owner（§8） |
| 13 | 执行期查全局 EventStore fallback | composition root 显式注入 scope（§8） |
| 14 | detail 直接循环 `Message.vue` 并自定义消息 gap | 复用共享 message canvas / visual-row（§6.1） |
| 15 | detail 复用整个 `ConversationView` | 只复用展示层，Host 继续拥有导航与滚动编排（§6.1） |
| 16 | 把 Subrun 标题复制进 layout/assistant/Header 状态或正文重复显示 | feature scope 保留唯一身份，Header 消费只读投影（§6.1） |
| 17 | 详情从当前模型选择或 trace 文本猜 child 模型 | 读取 `subagent` 正式结果中的 `data.model_id`（§6.1） |
| 18 | Header 直接清 scope 或自己恢复 DOM 锚点 | Header 只发返回意图，Host navigation 独占关闭与锚点恢复（§6.1） |
| 19 | compact error 复用 success parser 或补造查询参数 | error 只生成 owner-owned 失败标题（§5.1） |
| 20 | 在 CitationNode miss、computed 或 mounted 时扫描 child trace | detached admission 生成 message dependency snapshot（§5.2） |
