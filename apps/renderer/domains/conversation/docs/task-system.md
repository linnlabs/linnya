# 对话活动 / Subrun 系统规范

> **全链路权威规范**：[`docs/conversation-platform/`](../../../../../docs/conversation-platform/README.md)。不变量以 [`00-invariants.md`](../../../../../docs/conversation-platform/00-invariants.md) 的 `INV-nn` 为准；本文是实现级说明，冲突时以规范为准。

> 对话栏不是「消息流 + task 特例」，而是「**活动流**」：普通 chat、批量填充、workflow 都是同一原语的实例——一次 **Run**（意图）下挂若干 **subrun**（隔离工作单元）。它们只在**数据**上不同，不在**渲染分支**或**请求 mode 参数**上不同。
>
> 本文是客观设计规范，横跨前端 UI 与后端上下文装配（迭代历史见 git）。展示侧的虚拟化约束见 [`conversation-virtualization.md`](./conversation-virtualization.md)；输入侧对称面（发起 subrun 的公共 port）见 [`input-contribution.md`](./input-contribution.md)。插件视角的任务展示见 `docs/plugins/guides/20-*`。

---

## 1. 统治性不变量

本系统所有取舍都从这一条规则推出，改任何东西前先对照它：

| 渲染在对话框？ | 需要独立上下文？ | 结论 |
|:---:|:---:|------|
| 是（父级） | 否 | **必然进主上下文**——普通消息 / 工具对，父 agent 直接拥有 |
| 是 | 是 | **必然是归属于父工具活动的 subrun**——细节走 `subrun_trace`（UI-only 不进主上下文），聚合摘要经父 `tool_output` 回主上下文，耐久记忆靠收尾 `final_answer`（见 §4.1） |
| 否 | —（默认独立） | **不进上下文，且独立**——如 Review / autocomplete（`persist:false`），本就不属对话活动 |

**推论：再也不存在「渲染在对话框、却不进入主上下文」的旁路。** 旧 task 的逐行消息曾是这种旁路（渲染了、又全量进上下文污染）；统一后它要么是父级工具对（进上下文），要么是 subrun（细节 UI-only + 摘要回父）。

> **术语**：`subrun` 是隔离执行原语，tool activity 是它在父对话中的记录与聚合边界。一个普通 subagent 工具可挂一个 subrun，一个 batch tool 可挂 N 个 subrun；父级只保证一组合法的 `tool_call/tool_output`，每个 child run 不再各自产生顶层工具对。

---

## 2. 统一原语：父工具活动 + subrun

**父工具活动负责主上下文记录与结果聚合，subrun 负责隔离执行与 UI 下钻。** 两者不是一一对应；subrun 可嵌套。

```
Run（一次意图：提问 / 批量请求 / workflow 调用）
  └─ 可选父工具（普通 tool 或 batch tool）
       ├─ subrun 1（隔离工作单元）
       │    ├─ 内部 trace（subrun_trace，仅 UI 下钻）
       │    └─ 结构化结果（回到父工具聚合器）
       ├─ subrun 2
       └─ 父工具输出（有界 observation，进入主上下文）
```

- **普通 chat**：退化情形，0 个 subrun。
- **批量填充**：分两条发起路径（见 §3）。
- **子 agent（Subrun）**：subrun 的当前唯一落地。`subrun` 天然自带隔离 + 只回摘要 + UI 可下钻三个面，直接复用已有 subagent / child-run 机制，不发明平行的 `activity_summary` / `egress` 概念。

### 2.1 subrun 已内建的「三个面」

| 面 | 归属层 | 说明 |
|---|---|---|
| **隔离面** | child lifecycle 的独立 publisher / EventBus / checkpoint / durable facts | 子 run 独立执行；正式事实按 child run 落盘，可展示部分投影为 `subrun_trace`。child 自身上下文可以消费这些事实，但 foreground history admission 只读取 `lane=foreground / visibility=conversation`，因此不污染父级主上下文 |
| **上下文面** | 子 agent `final_answer` 写进父工具 `tool_output.observation`，经 `convertEventsToAiMessages` 进入主上下文 | 「父只看到摘要」是内建行为，不需另造机制 |
| **UI 面** | ephemeral `subrun_trace` 挂到父 `parent_tool_call_id`；Host 紧凑 history read model 提供重载历史 | 父卡轻量进度 + Host 就地详情 |

### 2.2 UI 收敛

Host 统一为**父卡轻量进度 + `ConversationHost` 就地详情**。批量场景仍由父 batch tool 承担唯一 visual-row 锚点，其中只有 N 个轻量进度项；完整 child thought / tool / answer 树不嵌套在该 row。

- 工具 registry projector 在 reactive UI 之前严格接纳父工具 args/result/`subrun_summary`，生成 presentation-only items。
- `features/subrun-trace/` 拥有稳定 bucket 与历史加载；`features/subrun-card/` 分别提供轻量 step projection 消费端和正式完整 message admission，不合并为带模式分支的 projector。
- 点击详情后，`ConversationHost` 在同一滚动视口结构性切换到只读 detail surface，返回时按父 message identity 恢复锚点。
- 插件公开 `SubrunCard/SubrunCollection` 的 bounded 合同仍保留，但不属于 Host 主链。
- 「这一行关于哪个元素」用 per-unit context chip 承载——它是 run 级 `ConversationReference` 在 unit 级的同一原语复用。差异落在数据上，不在 Renderer 分支上。

---

## 3. batch 工具的发起与暴露

> 本节「batch tool」一律特指**系统发起路径**；LLM 批量不使用 batch tool。

**batch 工具永不作为 agent 面工具**：任何 agent / subagent 的 `availableTools` 都不含 batch 工具。据此拆成两条发起路径：

- **LLM 批量**（对话栏）：主 agent 想批量，就在一次决策里**多次调用 `subagent`**——每个 = 一个独立 subagent 工具对 + 一个 subrun 卡，天然复用 `subagent` 的隔离 / trace / `subagent_type`。主上下文里每次委派只回灌有界 observation，收尾由父 agent 自然产出 `final_answer`。当前 `ToolNode` 顺序消费多个 tool calls，**不承诺并发**；LLM 批量并行化若成真需求，必须单独设计，不改变所有工具的执行语义。
- **系统批量**（点按钮填 N 行、非聊天触发）：**仅系统发起**才用 batch 工具；它系统专用，由 host / 确定性编排器直接调用（方案 B），不进任何白名单、模型不可选、agent 看不到。这条路径才是「一组 tool_call/tool_output + 一条耐久 final_answer」的落点。

**归属**：正式 batch 工具位于 `src/tools/agent_control/subrun/batch/`，与 `subagent` 共享 child-run 能力族但保持独立 feature；它注册进 host ToolRegistry，但不进任何 AgentDefinition，**禁带 conversation 域前缀**。

---

## 4. 确定性 batch tool（系统发起专用）

系统发起的批量填充使用一个**确定性 batch tool** 作为父级编排器，避免用 LLM 决定任务拆分与并发（「精确填这 20 行」不该让模型决定调几次）。它在一次工具执行中启动 N 个 Agent child runs，并在结束时确定性聚合结果。

- **父 run 用无工具收尾 Agent `system_batch_summarizer`**：host 确定性指定首个 `subrun_batch` 工具调用，工具结束后回到该 Agent 生成耐久 `final_answer`。不能复用 `default`——`default` 拥有 `list_files/read_file/write_file` 等行动工具，且不知道 renderer 已通过 live trace 完成写回，会把聚合结果误判为原材料并重复写文件。收尾 Agent `enableTools=false`，从结构上杜绝重复副作用；普通对话仍用 `default`。
- **不手工合成事件**：`tool_call / tool_output` 的配对由 `ToolNode` 按构造保证（`tool_call_id` 配对、顺序正确、provider 消息重建有效）。host forced-tool 起点经 Linnkit 业务无关的 `createHostToolCallBootstrap` 构造标准 tool call、配对 `tool_call_decision` 与 `tool` 节点 prime patch；host 不手工复制 Graph 内部不变量，Linnkit 也不建完整系统工具运行器。
- **确定性结果聚合**：共享 subrun-batch DTO + 工具层纯聚合器，`data` 保存完整逐项事实与权威 `subrun_ids`，`observation` 保持有界。
- **结果写回 port**：跨域 command 只认 `sessionId / unitId / content / mode`，写回所需的 Editor / PM / 坐标 / rootBlockId 全留 session 内部（见 §6）。

### 4.1 工具对短命——耐久记忆靠一条 `final_answer`

工具历史默认 `per-run` + `keepLatestRuns:1` + `retentionMode:'drop'`：超出最近 run 窗口的 tool_call/tool_output 对会被直接丢弃。所以「tool_output 即摘要」只在最近两三轮内成立，**不耐久**。

耐久的「AI 知道刚才干了啥」必须落在一条真正的 `final_answer`：父 batch tool 跑完 N 个 child runs 后产出有界 `tool_output.observation`，随后走一步 LLM 产出 `final_answer` 持久留存；父工具对后续按策略被 drop 也不影响长期语义。

**图内自动再入（已定）**：只要 batch tool 在 GraphExecutor 图内执行，`ToolNode` 成功 / 失败后默认 `route → llm`，收尾 `final_answer` 自动发生。降级为两条配置约束：

- 父 batch tool **禁止 `control.terminateRun`**（会直接 yield 跳过收尾 LLM），也**不要用 `control.finalAnswer`**（会与收尾 LLM 产生重复 final_answer）。
- agent **maxSteps ≥ 4**（生产默认 80）。
- 该约束只针对父 `subrun_batch`。child 的终局工具（如 `write_to_table`）必须返回 `terminateRun + finalAnswer=content`，一次成功写入后结束当前 child，否则硬提示会让 child 在 `LLM → tool → LLM` 间重复写入。child control 不终止父 Graph。

---

## 5. subrun 细节的持久化与展示

- **面板可见的 subrun 始终投影 live trace 与紧凑历史**：`subrun_trace` 固定 `ephemeral`，只负责实时逐 chunk 展示；Host history projector 只提交完整 thought、工具 decision/terminal 和完整 answer，细节可随历史重开但不重播动画帧。
- **历史投影串行提交**：child EventBus 将同一 child fact 分发给 durable child persistence 与 parent trace projector。projector 按发布顺序写 `subrun_trace_runs / subrun_trace_items`，首条失败后停止后续投影并让 run 收尾失败，禁止形成有洞的历史序列。
- **child truth 与 parent trace 分离**：child Graph 只向 child publisher 发布一次；child EventBus 同时驱动 child durable facts 与 parent trace projector。父 trace 通过 `source_event_id` 关联 child fact，不替代 child 存储，也不允许在 `ChildRunInvoker` 内直接发布。
- **可见 child 只有一个工具层入口**：subagent、subrun batch、deep research、knowledge deep search 与插件内部 child 统一调用 `runRegisteredSubagent`；该 orchestration 独占 `parentToolCallId` 校验和 `tracePolicy` 组装。业务工具只提供 prompt、执行策略、展示来源和非身份 metadata；缺父工具锚点或 publisher 直接失败，不允许静默执行成不可见 child。
- **四个数据面不得互相代偿**：child durable facts 是子执行审计事实；parent `subrun_trace` 是绑定 `parent_tool_call_id + subrun_id` 的展示 read model；父 `tool_output.observation/data` 是父 Agent 的有界上下文与结构化工具结果；Renderer message 是 trace 的本地投影。工具结果不得补造 UI 正文，Renderer 消息不得反写运行事实，parent trace 也不得冒充 child 存储。
- **child 当前任务先成为唯一 incoming fact**：同步 child 通过深度与 pre-abort 门禁后，在图启动前创建一次 `user_input`，通过 child publisher 获得正式 routing identity；初始 history、request `currentUserEventId`、EventBus 与 EventStore 共用同一个事件 ID。调用前已经取消时不得创建节点或接纳该事实。后续 LLM tick 禁止从 query 重建临时用户消息；`maxSteps` 只控制预算，不用于掩盖输入身份错误。
- **child durable fact 不属于 parent 正文**：child 使用 `lane=child / visibility=parent-trace`，即使与 parent 共用 conversation，也只作为 child run 的原始事实存在。EventStore 默认读取保持无损；durable UI projection、foreground Agent history、会话预览和用户消息计数只接纳 foreground/conversation。缺少正式 routing identity 的事实直接拒绝，不从 runs 关系恢复或猜测；重载时父工具卡仍只消费 parent `subrun_trace`。
- **SubrunCard 答案语义**：卡片复用 conversation 的 `answer-segment` feature，按 `answer_id + seq` 归并。被后续工具调用跟随的答案段展示为过程叙述，末段才是可复制、可导出的最终交付；禁止用单一消息下标拼接多个答案段。
- **答案身份全局唯一，展示归属仍按 child 分区**：`answer_id` 由 Linnkit 身份合同保证全局唯一，`seq` 只在单个答案段内连续。两个并发 child 可以产生相同的 `seq` 和正文，但必须拥有不同的 `answer_id`。Renderer 仍须先按父工具锚点挂载、再按 `subrun_id` 分桶，每张 SubrunCard 独立建立答案状态；这是来源归属与生命周期隔离，不能因为 `answer_id` 全局唯一而省略。foreground 只消费父 RuntimeEvent，SubrunCard 只消费对应 trace，二者不得互相补造正文。
- **实时与历史按 source identity 增量接续**：历史 trace 与 live trace 只向 feature 内稳定 accumulator admission。它按 `subrun_id` 分桶、以 `source_event_id` 去重，历史提供前缀，重叠事实使用 live DTO，后续 live 只扫描新尾部；source epoch 改变时显式 reset。历史迟到只允许触发一次有意义的前缀重排，禁止 computed 每次重建 events 快照或对完整流重复 O(n) 合并。
- **父工具卡 revision 不受尾部位置限制**：parent 继续输出其它消息后，subrun trace version 对早先工具消息的更新仍必须按 message id 传播到 visual row。结构化 revision 由新对象引用表达；builder 只重投受影响 row，结构身份变化才全量 rebuild。
- **业务结果不复制运行过程**：deep search 等工具的 `data` 只保存 documents、citations、summary 等业务结果；步骤、thought 和答案过程统一由 parent `subrun_trace` 展示与回放。禁止再增加 `deep_search_trace` 一类结果内 trace DTO。
- **回放只渲染、不重放副作用**：`tool_output.data.subrun_ids` 提供权威 child 清单，trace summary 只补 live 顺序与事件计数；权威但零 trace 的 child（如启动后即失败）仍在 reload 后保留结构化错误，renderer 不 fallback 猜测。历史读取绝不执行写回。
- **UI summary 不承载 lifecycle**：`subrun_summary` 只保存 child ID 与 trace event count。需要 status、current node、iterations 或错误汇总时，应用层读取 `RunSupervisor.list({ parentRunId })`；禁止让 Renderer、trace accumulator 或工具结果维护第二套 child 状态表。
- **单卡身份与消息 scope 不猜测**：首条 live trace 必须把 `subrun_summary` 与 parent tool presentation 原子提交；terminal `data.subrun_ids` 与 summary 同时存在时必须一致。历史 detail 使用消息窗口固定的 `conversation_id + parent_tool_call_id + subrun_id`，叶子卡片不得读取全局 active conversation。
- **不新增 `subrun_read` 读取工具**：大量 child run 的低频场景不构成扩充工具面的理由；完整细节由 UI 按 `subrunId` 懒加载，父 Agent 只消费有界 observation。

---

## 6. 表格填充：第一个垂直切片

表格填充是 subrun 模型的第一个真实消费者，一步同时消除上下文污染（主上下文只见摘要）与双分组机制（收敛到 subrun 卡）。

- **发起链**：`app/workflows/table-fill` → 一次 `/conversation/next` 的 host forced-tool run → forced `subrun_batch` + `system_batch_summarizer` → `runRegisteredSubagentsInParallel` 起 N 个 child run（固定并发 3、继承父模型）。
- **写回**：Editor `features/table-fill-write/` 提供公开窄 `TableFillWritePort` + 内部 session-owner。每 session Promise chain 保证 FIFO，单项失败不毒死后续队列，取消保留在途 transaction 并以 AbortError 拒绝排队。app workflow 在启动前从共享 `SubrunBatchArgs` 建立 `subrun_id → unit_id` 权威映射，child `write_to_table` 的 live trace 只用顶层正式 `subrun_id` 查找写入目标；开放 metadata 不能决定副作用归属。父 `subrun_batch` output 再校验所有 completed unit 至少真实写入一次。
- **边界（硬约束）**：`TableFillWritePort` 只能是 renderer 进程内边界（main 内 batch tool 无法持有 ProseMirror）；并发 child agent 只能产生结构化写入意图，真实写表必须经 port 串行执行；child 输出的可选 `row/col` **永远不能**越过 host 预绑定的 `unit_id` 目标。
- **状态所有权**：table 模式状态、列引用与写回归 Editor（`table-ai-mode` / `table-fill-write`），跨域装配归 app workflow，conversation 生产代码零 table 业务语义（见 [`input-contribution.md`](./input-contribution.md)）。

---

## 7. 当前活入口快照

| 入口 | 路径 | subrun 分组 | 上下文 |
|------|------|---|---|
| 表格填充 | `app/workflows/table-fill` → forced `subrun_batch` | 一个父工具内含 N 个 subrun | 父上下文只保留有界聚合 + `final_answer` |
| 编辑器批注 | `AnnotationPanel.vue` → `assistantStore.executeAnnotationRun` 兼容入口 → `annotationRunOrchestrator` | 无 | full；执行态独立于聊天 |
| MindMap 右键 | `installBuiltinRendererPluginPorts.ts` → `startHistoryIsolatedRun` | 无 | 只使用当前 MindMap 上下文，不读取会话历史 |
| 子 agent | LLM 调 `subagent` 工具 → `ChildRunInvoker` | 内部 trace | 仅摘要进上下文 |
| 普通 chat | `chatFlowOrchestrator.sendChatMessage` | 无（退化） | full |
| Review / autocomplete | `generateTextStream`，`persist:false` | — | 不落库，不进上下文 |

---

## 8. `task` 命名治理

全库命名迁移已经完成。终局不是机械清空 `task` 字样，而是让每个活跃业务概念使用唯一术语，并把确实需要保留的公开或持久化协议限制在明确边界内。

### 8.1 最终术语（唯一权威口径）

| 语义 | 是什么 | 最终命名 | 约束 |
|---|---|---|---|
| 父 Agent 委派动作 | LLM 请求隔离子 Agent 完成一项工作 | 工具 `subagent`；注册身份 `subagent_*` | 不得恢复 `task` 工具或 `task_*` promptKey；通用 subagent 不拥有再次委派权限 |
| 隔离执行单元 | child run、过程 trace 与对话 UI 下钻 | `subrun`、`SubrunCard`、`subrun_trace` | API、DTO、UI 和目录统一使用 `subrun` |
| 系统批量执行 | host 确定性启动多个 subrun | `subrun_batch`、`subruns[]` | 只由系统编排发起，不进入 Agent 工具白名单 |
| 外部活动归属 | 标记某次 run 属于插件或 app 活动 | renderer `activityBinding`；wire `options.activity` / `metadata.activity` | 归属必须传播到 user input、tool decision、tool output 与 final answer |
| 历史隔离策略 | 控制本轮是否读取已有会话历史 | renderer `historyIsolation: 'isolated'`；wire `history_mode: 'isolated'` | 只控制上下文读取，与 `persist` 正交 |
| 批注执行编排 | 一次 Annotation AI 调用的生命周期 | `annotationRunOrchestrator` / `AnnotationRun*` | 执行态归 Annotation，conversation 只提供窄调用入口 |
| Worker 执行项 | 后台线程队列中的内部工作单元 | `WorkerJob` / `WorkerJobState` | Worker 内部不得重新引入 `Task` / `TaskState` |
| 知识库摄取进度 | 上传、解析、索引进度的内部读模型 | `IngestionProgressSnapshot` / `IngestionProgressStore` | 与外部知识库 task 协议隔离，不复用业务 `TaskState` |
| 辅助模型用途 | autocomplete、translation 等模型选择维度 | `AuxiliaryModelPurpose` / `purposeKey` | settings、store 和业务消费方使用 purpose 语义 |
| 结构化工作状态 | 有目标、多步推进的工作状态 | `TaskState` / `task_read` / `task_write` | 这是业务上的真实 task，长期保留；旧 `taskstate_*` 只用于历史事件回放，不与 Worker 或摄取进度合并 |
| Conversation run 写入分类 | Host 用户输入事实批次 / Agent 执行 | `runs.kind='user_input'` / `runs.kind='agent'` | 只表达耐久 run 类别，不是工具名、任务名或 run status |

### 8.2 明确保留与排除的边界

- **Linnkit 公开 API**：`IAgentTask`、`BaseAgentTask`、`AgentTaskResolver`、`AgentDefinition.task` 保留。它们属于已发布的上下文装配契约，不是 conversation 委派工具；若改名必须单独设计公开 API 迁移。
- **知识库外部协议**：`/knowledge-base/tasks/*`、`task_id`、`task-status-update` 及既有 IPC / 持久化字段保留。内部 Worker 和进度读模型已经使用 job / progress 语义；外部协议迁移必须另立项目。
- **云模型 wire**：Linnya Cloud `/v1/models` 与 renderer 既有响应中的 `task_defaults` 保留；进入模型注册表后立即映射为 `purposeDefaults`。修改该字段需要同步云端、主进程、renderer 和部署版本，不能在客户端内部命名整理中顺手处理。
- **EventStore 持久化值**：当前协议只有 `user_input | agent`，权威定义在 persistence `definitions/conversationRunKind.ts`；EventStore 显式写入与 RunRegistry 注册必须共用该定义。v49 只把旧 `task` 值单向升级为 `agent`，不改 run id、event 归属或 UI read model。
- **独立 domain 与标准术语**：插件私有 `FetchTask`、编辑器调度项、Deep Search 构造器、microtask / macrotask、Long Task、Markdown task list 等按各自领域或技术标准处理，不纳入 conversation 命名。
- **内部审计 API**：`TaskTrackingMeta` / `getTaskAuditPath` 的消费者与删除策略尚未独立确认，保持现状，不扩散新用法。

### 8.3 增量守卫

`scripts/guards/task-naming-guard.ts` 使用 AST 扫描 TypeScript、JavaScript 与 Vue script，拦截未解释的 task 路径、导出 / 契约标识符、wire key、工具名和 promptKey；同时精确扫描根 `index.html` 与 `docs/` 中已经退役的契约名，防止运行时入口和现行指南绕过代码门禁。允许列表必须同时写清语义和退出条件，并满足以下规则：

- 允许范围按具体 domain、协议或精确文件维护，禁止用全仓数量快照或宽泛目录掩盖新命名。
- `task_defaults` 等保留 wire 必须被守卫真实识别后再精确放行，不能只在合成测试中声明允许项。
- 已退役契约名若只用于保存历史，必须放到明确的 archive / research-notes 范围；现行指南和根 HTML 不得引用旧入口。
- 普通自然语言、注释和局部变量不作为失败条件；这不代表它们可以被提升为新的公共契约。
- 新增 conversation 能力一律从 §8.1 选择术语；确实属于新业务 task 的概念必须先明确 domain 边界，再决定是否使用 `TaskState` 语义。

---

## 9. 剩余风险与待启动项

- **R6 Annotation 边界**：执行态已从聊天 `executionState` 分离，空转发 store 已删除；`AnnotationPanel → assistantStore → annotationRunOrchestrator` 兼容入口保留。第二个跨域调用方出现前不得复制该入口；届时迁 application use case 或窄 port。
- **待启动演进项**：脚本 workflow 运行时（不存在，不提前设计，未来复用同一 subrun 父工具模型）；LLM 批量并行化（须单独设计，不改通用 ToolNode 执行语义）；`todo` 退役需先确认 mindmap `reasoning_canvas` 等活依赖并单独设计。
