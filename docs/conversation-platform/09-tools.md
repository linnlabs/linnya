# 09 · 工具调用与结果

> **What** · 工具事件语义、工具卡身份、结算保证、结果合同、wrapper 别名、UI 注册表。
> **When to read** · 加工具、加工具卡、加 wrapper 别名、排查"工具卡不更新 / 卡 loading / 结果读不到"之前。
> **不变量** · [INV-11](./00-invariants.md#inv-11--tool-ui-身份不属于单个事件)、[INV-24](./00-invariants.md#inv-24--具体工具没有-runtime-特权)、[INV-25](./00-invariants.md#inv-25--工具-batch-必须完整结算)、[INV-17](./00-invariants.md#inv-17--strict-schema-必须在真实边界执行)、[INV-18](./00-invariants.md#inv-18--工具-wrapper-与底层工具是两个正式合同)、[INV-56](./00-invariants.md#inv-56--工具展示派生只有三个-admission-入口)、[INV-57](./00-invariants.md#inv-57--工具执行合同只承载业务事实)
> **Related** · [04 schema](./04-schema-contract.md) · [10 subrun](./10-subruns.md) · [08 生命周期](./08-lifecycle.md) · [Linnkit Tool runtime](../../packages/linnkit/src/runtime-kernel/tools/README.md)

---

## 1. 事件语义（四个不同的东西）

| 事件 | 含义 | **不**表示 |
|---|---|---|
| `tool_call_decision` | 模型提交了调用清单 | 尚未证明调用开始 |
| `tool_process(start)` | 单个调用**实际开始** | 有结果 |
| `tool_process(update)` | 实时过程 | durable（**只服务实时**） |
| `tool_output` | 每个调用的 **durable 终态**结果 | — |

最常见误解是把 `tool_call_decision` 当成"工具开始了"。它携带的是模型尚未通过 owner admission 的调用清单；批量调用时 decision 一次给出 N 个，但它们逐个 `tool_process(start)`。

`tool_process(start)` 还有一个执行前门槛：工具 owner 的 `validateArguments`、模型输入能力校验和 `tool.allow` 审计都必须成功后才能发布。参数协议错误或能力拒绝不算启动，直接由 ToolNode 产出配对 `tool_output(error)`；这样 live/replay 都不会留下虚假的 loading。

---

## 2. 工具卡身份（[INV-11](./00-invariants.md#inv-11--tool-ui-身份不属于单个事件)）

```text
tool_call_id                       run 内唯一
conversation_ui_messages.message_id  全局主键

message_id = merge_key = conversationMessageIdFromToolIdentity(run_id, tool_call_id)
```

Host durable projector 与 Renderer live projector **必须共同使用**同一函数（`packages/schemas/src/conversation/message-identity.ts`）。

禁止从：首个 event id、工具名、batch 下标、到达顺序派生。

**为什么 `message_id === merge_key`**：让 window ∪ live 合成只需按 `message_id` 匹配，不需要第二套 key（[06 §3.1](./06-read-model.md)）。

**为什么必须带 `run_id`**：`tool_call_id` 只在 run 内唯一。两个并发 run 可以出现相同 `tool_call_id`，不带 run scope 会让两张卡互相串线（教训 5）。

旧 disposable row 已物理清理并重建，不提供兼容合并（[INV-08](./00-invariants.md#inv-08--无历史兼容主链)）。

---

## 3. 状态与 phase 交叉校验

`packages/schemas/src/conversation/tool-message.ts`：

```text
status: 'loading' | 'success' | 'error'
phase:  'start' | 'update' | 'complete' | 'error'
```

schema 强制两者一致，非法组合直接 parse 失败：

| status | 允许的 phase |
|---|---|
| `loading` | `start` 或 `update` |
| `success` | `complete` |
| `error` | `error` |

这排除了"status 说成功、phase 说还在跑"这类无法解释的中间态。

状态**只在 tool metadata**，不存在顶层 message status（[INV-15](./00-invariants.md#inv-15--消息状态只能表达一次)）。

---

## 4. 完整结算（[INV-25](./00-invariants.md#inv-25--工具-batch-必须完整结算)）

**保证**：每个 assistant tool call 最终**必有**一条 durable `tool_output`。

| 场景 | 结算者 |
|---|---|
| 普通串行执行 | ToolNode 串行消费 |
| 工具专属 batch | 可在自身合同内并发，仍须逐个结算 |
| **执行中被取消** | ToolNode 在抛出 `AbortError` **之前**结算 |
| **尚未启动被取消** | 同上 |
| child lifecycle | 再 drain child fact 与 parent trace |

真源：`packages/linnkit/src/runtime-kernel/graph-engine/nodes/toolNode.cancellation.ts`。

**Host、投影器和 Renderer 禁止扫描 loading 行补终态。** 陈旧 live loading 由 window dominance 压过（[06 §3.3](./06-read-model.md)），不是靠前端伪造。

---

## 5. 结果只读正式 payload（[INV-17](./00-invariants.md#inv-17--strict-schema-必须在真实边界执行)）

工具卡按 `ConversationToolMessageMetadataSchema` 获取：

```text
tool_call_id / tool_name / status / phase / args / result
```

需要结构化结果的卡片，再解析各自的 `@app/schemas` 合同：

| 工具 | 合同 |
|---|---|
| Todo | `tools/agent-todo.ts` |
| TaskState | `tools/taskstate.ts` |
| Subagent | `tools/subagent.ts` |
| ToolOutput 续读 | `tools/tool-output-read.ts` |
| Workspace 文档读 | `tools/workspace-document-read.ts` |
| 提问 | `tools/ask-questions.ts` |
| 表格填充 | `tools/write-to-table.ts` |
| subrun batch | `tools/subrun-batch.ts` |

**禁止**从 `observation`、raw payload 或工具名 fallback 取结果。

`data` 与 `observation` 分层：`data` 是给消费方的结构化结果，`observation` 是给模型看的文本。工具卡消费 `tool_output.payload.result`，**不**消费 `observation`。

### 5.1 ToolOutput 续读

- `next_offset` 是**首个未读字符**（0-based 字符偏移）。
- 行号**只服务展示**。
- Renderer **不计算**分页状态。

禁止恢复行 cursor 或从 `end_line` 推断结束位置。

### 5.2 Subagent 协作结果

`subagent` 是 Linnya 产品工具，不是 Linnkit Runtime 特权。它的 canonical `data` 只包含子任务描述、
动态注册类型、权威 `subrun_ids`、唯一 `status`、最终答案和正式 `artifacts`。Workspace inode 来自
`write_file/edit_file` 的成功结果；ToolOutput blob 来自执行层 observation governance 的正式
`tool_output.metadata.observationTruncation.blobId`。禁止扫描 observation、任意 `uri` 字段或 Evidence 引用补造 artifact。

ToolRegistry 与 Renderer 只注册 canonical `subagent`。开发期数据不保留旧 `delegate` 的执行、
展示或 replay 入口；需要验证批量工具投影时也必须使用当前工具合同，不能让测试 fixture
把退役协议重新带回主链。

---

## 6. 具体工具没有 Runtime 特权（[INV-24](./00-invariants.md#inv-24--具体工具没有-runtime-特权)）

Linnkit 只管理**通用**工具执行生命周期和上下文策略：

| Linnkit 不做 | 含义 |
|---|---|
| 不识别具体工具名 | 没有 `if (toolName === 'todo')` |
| 不为工具建专属 RuntimeEvent | 没有 `todo_updated` |
| 不为工具加 SSE 字段 | — |
| 不为工具加 ToolContext 字段 | — |
| 不为工具定制保留策略 | — |

工具的结构化结果属于**产品/工具合同**，不属于 Runtime。

**Todo 是这条规则的样板**：已恢复为普通工具，旧 `todo_updated` 事实和会话快照**物理删除**，不提供兼容读取。

### 6.1 工具状态不旁路 Conversation（[INV-24](./00-invariants.md#inv-24--具体工具没有-runtime-特权)）

具体工具需要恢复状态时，只能从两个地方读：

1. working history 的**正式工具事实**
2. 工具自己的产品存储

Todo 的当前值只来自**最近一条成功 `todo_write` 的正式 result**。`todo_read` / `todo_write` 不创建 Runtime 专属事实，Conversation 也**不保存** `agentTodo` 镜像。

TaskState 采用同一平台原则，但 owner admission 更严格：当前值只来自 working history 中最新一条与此前 `tool_call_decision` 按 `run_id + tool_call_id + tool_name` 配对的成功 `task_write`。命中的最新配对事实损坏时明确失败；其它工具输出不能创建或覆盖 TaskState。TaskState 不建立文件镜像、instance 快照或专属 Runtime 状态。

镜像状态是双事实源，必然漂移。

---

## 7. Wrapper 别名（[INV-18](./00-invariants.md#inv-18--工具-wrapper-与底层工具是两个正式合同)）

别名可以复用展示卡片，**不能**复用 wire shape。

```text
底层 producer            wrapper adapter               Renderer
strict schema A   ──▶  显式字段转换 + 再次 parse  ──▶  strict schema B
       └──────────────── 展示联合（A | B）─────────────┘
                              ▼
                          同一张卡片
```

现有实例：

| 入口 | 合同 | 分页字段 |
|---|---|---|
| `read_file(view="document")` | `workspace-document-read.ts` | `nextOffset` |

`WorkspaceDocumentViewCard.vue` 只消费 `WorkspaceDocumentReadDataSchema` 的正式展示数据。

禁止：在组件内改字段名、猜来源，或用 catch/fallback 吞协议错误。

**新增别名的门禁**：必须覆盖真实 **producer → adapter → Renderer** 契约测试。哨兵 JSON 或仅验证路由命中**不能**证明协议一致。

---

## 8. 工具卡 UI 注册

`apps/renderer/domains/conversation/ui/tools/`：

| 文件 | 职责 |
|---|---|
| `registry.ts` | `getToolUiRegistry()` / `resolveToolUiConfig()` |
| `registry.helpers.ts` | 注册辅助 |
| `types.ts` | `ToolUiEntry` |
| `NoopToolContent.vue` | header-only 工具注册项的明确空内容实现 |
| `shared/` | 跨卡片共享展示组件 |

现有卡片目录：`questionnaire`、`image`、`knowledge`、`knowledgebasesearchcard`、`sharedmemory`、`skill`、`table`、`taskstate`、`todo`、`tool_output`、`webread`、`websearch`、`workspace`。

注册表按 `tool_name` 解析展示配置，并让同一个 `ToolUiConfig` owner 分别声明完整卡片
`presentation` 与紧凑步骤 `compactStep`。完整 projector 只在 live、reload、完整 Subrun child message
三个 admission 入口运行；compact projector 只在紧凑步骤的非响应式 admission scheduler 中运行。
两者共用 enabled plugin registry 和一次 alias 解析，但不能互相调用，也不决定工具状态或身份。

所有 live executable 平台工具与官方插件工具都必须通过 backend manifest ↔ Renderer contribution
构建期门禁：最终非 alias config 必须同时提供 `presentation + compactStep`。未知工具或插件未加载时，
compact port 返回未命中并显示通用诊断标题；已注册 projector 抛出的合同错误必须拒绝 detached 批次，
不得静默回退。registry 只汇聚、查重和解析 alias，禁止理解 query、command、URI 等业务参数。

这是工具卡的**终态规范**。当前 AST baseline 已锁住 Questionnaire、TaskState、AgentTodo、ToolOutputRead、WorkspaceDocumentView、WebSearch、WebRead、Skill、ImageGeneration、ImageRead、DocumentList、DocumentContent、KnowledgeSearch、SharedMemory list/read/write，以及 SubrunCard、SubrunProgressCard、SubrunBatchCollection 共十九张完成迁移的实体卡；独立的 header-only baseline 锁住七个 live 注册项 `list_files / read_file / write_file / edit_file / grep / assemble_documents / evidence_resolve`，以及一个只读历史注册项 `assemble_evidence`，要求 projector 存在且禁止恢复 raw title resolver。已知存量迁移面已经清零，[R-22](./12-open-risks.md) 关闭；新增工具仍必须在同一 vertical slice 补共享 schema、projector、双 admission 与 baseline，禁止重新建立 raw resolver。

卡片需要 subrun trace 或按 conversation scope 读取历史资源时，必须在 `ToolUiConfig.runtime` 逐项声明
capability。Host 只透传被声明的 live/durable trace、历史 lazy source 或 active conversation identity；这些
运行期事实不能进入 presentation，也不能借 capability 扩张为整份 message/store context。Knowledge Search
是当前参考实现：三种工具名共用一个 projector，trace 与历史 Citation Snapshot reader 分别经显式
capability 和 Conversation 窄 port 进入卡片。

统一图片读取卡是同一条 capability 规则的另一个例子。当前 `read_file` 在 loading / error 阶段固定 alias 到
Renderer-only 的 `workspace_read_file`；success 后只有通过 `WorkspaceReadFileEventResultSchema`（或严格历史
replay schema）接纳的 conversation / host JPEG、PNG、WebP 结果才 alias 到 `image_read`。分类不得读取扩展名、
路径片段或 observation。真实工具身份、消息身份和审计仍是 `read_file`，最终 `uiKey` 只决定 Renderer 展示；
因此同一 `tool_call_id` 可从“阅读文件”切换到“查看图片”，不能创建第二条消息。

旧 `resource_read` 的 `asset://` 与 `conversation_file://` 事件也 alias 到同一个 `image_read`，但继续使用独立
historical schema；两种 URI 均已退出 live Resource dispatcher。统一卡声明 `runtime.attachments` 后，Host 只传递
已经落入 `tool_output.attachments` 的 durable 图片引用；组件不得读取 observation、claim URI 或本地路径，也
不得自行请求后端重跑历史工具。图片预览复用 Conversation 的受管 asset 预览端口，因此主会话 live 和 reload
消费同一份事件附件事实。Subrun compact step 使用同一次 alias 规则独立生成标题且不消费附件；成功 child
`tool_output` 的有序 durable 图片引用会随 parent trace 和紧凑历史进入完整 child message admission，详情因此
复用同一图片卡与受管预览端口。失败 output、其他 trace kind 或没有 refs 的旧历史不产生附件，不得从 output
或路径补造附件。
图片读取卡成功后直接展开图片；图片结果复用生成图片的最大宽度、最大高度和宽高比布局，输入附件缩略图仍
保持独立的正方形模式。

Knowledge Search 新结果只接纳 canonical citations 合同，卡片从 citations 派生文档预览；旧 inline
`documents` 与 snapshot pointer 只在 historical replay schema 中存在。新运行不再写 Citation Snapshot，
超长 observation 由 Linnkit ToolOutputStore 统一治理。历史 bundle 读取后必须 strict parse，并复用同一
历史结果 projector；损坏 bundle 明确失败，禁止降级为空列表。

同一卡片承接 wrapper 与旧工具名时，生产方必须先共享业务结果 schema，projector 再在一次 admission
内完成 alias 固定、参数校验与 wrapper 适配。例如 SharedMemoryDocRead 的正式结果以
`data.source` 判别 `shared_memory / evidence / citation_snapshot`；Renderer 不得从 observation、可选字段
组合或 URI fallback 猜测结果类型。

WebRead 由一张卡承接 canonical `web_read`，并在 replay 边界接纳历史 `resource_read(http/https)`。两者共享既有页面事实，历史 wrapper 只增加请求 `uri` 和 `source='web'`；新 Agent 调用只产生 `web_read` 结果。卡片只消费 canonical URL、标题、正文字符数和 citation 摘要等 presentation，不读取原始 payload，也不把工具 `data` 描述成“给前端的字段”。

Skill 卡的新调用只承接 `skill` 三种 action；Skill producer 分 action 返回 strict 结果，projector 只向轻量卡片投影 action 与 Skill 身份，技能正文和资源内容继续只存在于 observation/正式结果中，不复制进 Renderer 派生状态。历史 `resource_read(skill://...)` 的 `uri/next_offset/content` strict wrapper 与 projector 仅服务 replay，不能再作为新模型调用合同。

ImageGeneration 卡只消费经过 admission 的图片路径和可选尺寸。流式阶段允许且只允许 `phase='start' + status='loading' + args={}` 这一种早期占位，完整参数到达后必须通过 strict 参数合同；成功结果中的 `data/media/observation` 必须通过同一 owner schema。`data` 是 Agent 可用的 `conversation:` locator，`media.path` 是 Renderer 受控物理展示路径，两者可以不同，不能靠字符串相等伪造同一身份。组件不得把 observation/content 猜成 JSON 或图片路径。live key 是 `generate_image`；`text_to_image` 只通过同一个 strict projector 回放历史事件。标题、布局等展示配置仍只属于 Renderer registry。

图片生成成功与聊天模型看图能力解耦：Renderer 始终消费同一 `media` 成功结果。模型的 `image_input` 只表达图片理解
能力；生成图能否继续进入模型，还要单独满足实际 route 的 `tool_result_image`。`generate_image` 使用
`modelInputDelivery='when_supported'`：满足时工具事件另带图片 attachment，不满足时仍返回成功 observation、locator 与
用户可见图片，但不创建模型附件。这里不能把 placement 缺失投影成工具失败，也不能由 Renderer 根据模型能力补造附件，
更不能把图片伪装成后续 user message。

未配置图片生成模型属于 `generate_image` 的真实业务失败：工具向 Agent 返回“尚未配置图片生成模型，请提醒
用户配置”，同时以 `tool_output.error_code=image_generation.model_not_configured` 提供稳定分类。live 与
replay 都把该错误码保存到工具消息 payload；错误卡据此直接展示单层“尚未配置图片生成模型｜去配置”并打开
现有添加模型设置页，不再套用通用折叠卡。这里禁止匹配后端自然语言，也不为其它未知失败猜测修复动作。

通用工具失败默认只展示折叠 Header；用户点击后直接看到正式 `error/observation`，不得先显示“未知错误”再把
真实原因藏进“详细信息”二级折叠。只有错误正文确实缺失时才使用“未知错误”。稳定 `error_code` 只服务已有明确
消费者的产品动作、审计或自动化，不要求把所有工具异常统一枚举。

AskQuestions projector 同时接纳已解析的 `tool_call_id` 与 interaction 判别联合：早期空参数占位、完整参数预览、正式 Questionnaire result、active/terminal interaction 各自是显式分支。submitted response 必须通过问卷答案 schema，`approved/modified` 不属于该工具。卡片/composable 只管理表单与调用 `concludeAskQuestionsInteraction`，不得读取整包 message metadata，也不得从非法 payload 构造空问卷继续运行。

DocumentList 卡承接 `list_knowledge_base` 的 live 结果，以及 Knowledge 来源的历史 `resource_list` wrapper。projector 只归一 `id/title` 展示事实。卡片不得兼容 `data: []`、`name/filename` 猜测或其他未声明形状。

DocumentContent 卡的 live 入口是 canonical `knowledge_read`，使用 Knowledge 原生的 1-based chunk 合同。旧 `resource_read(kb://documents/...)` 的 0-based wrapper 与 `browse_document_by_chunk` 都已退出可执行 registry，只为历史事件保留 strict admission/projector。projector 以实际返回窗口生成展示范围，不能用请求范围覆盖文档末尾裁剪结果。卡片只消费 `filename/range/chunks` presentation，禁止恢复 `start_page/end_page`、`data.content` 或 observation 正文猜测。

历史 `sharedmemory_list / read / write` 事件采用 **header-only** 展示：registry 显式设置
`hideContent: true`，因此 replay 时正文组件不挂载；projector 仍必须校验完整结果并生成标题。这是旧事件
的展示合同，不是 executable 兼容入口，也不代表卡片是死代码。live SharedMemory 工具已经退役；若未来
产品重新引入同类能力，必须按新的正式领域重新设计，不能通过恢复旧注册完成。历史事件仍由
同一张业务卡承接展示；恢复正文属于独立 UX 变更，必须移除 `hideContent` 并完成真机验证。

`list_files / write_file / edit_file / grep` 是正式 header-only UI，并共享 `NoopToolContent`；`read_file` 的
非图片最终 config `workspace_read_file` 保持同样的 header-only 语义。它们的生产者与 Renderer projector 共同消费
`workspace-file.ts` strict schema；标题只由 projector 生成，成功结果仍完整 admission。`read_file` 不把
VFS 或文档插件内部读取详情转发到工具结果，分页 continuation 通过 Agent 可见的 observation 表达。
`write_file / edit_file` 不把 Markdown edits 或插件内部写入详情转发到公共结果，只保留具名文件事实、
标准 diagnostics 与 edit 的实际替换数量。插件节点类型按稳定标识符接纳，具体 owner 与启用状态由 registry 判定。

`assemble_documents / evidence_resolve` 保持正式 header-only UI，并分别拥有工具专属 `@app/schemas` 合同。
`assemble_evidence` 已无 live producer，只由独立 `Historical*` schema/projector 严格回放旧事件。三者不共享
“万能 Evidence payload”；历史 projector 也不构成 executable alias。projector 只拥有标题和 admission，
不改变 Deep Search 终止、EvidenceStore 或 citations 注册行为。

引用接纳不是卡片副作用。Citation domain 的 `conversation-presentation` feature 必须按 `toolName` 调用
Knowledge、Web、Evidence、Writer 各自的完整结果 schema；live、durable window 与 subrun output 共用同一
admission 和来源冲突规则。成功结果损坏时明确终止该次投影，禁止依靠跨工具最小 shape、重复 JSON 解析、
catch 后继续或空数组降级。可见 message 只持有正文实际使用的 dependency snapshot，不写全局引用 store。

每个正式暴露给 Agent 的业务工具都必须拥有 Renderer UI 注册。允许多个同一业务语义的工具名通过 alias
共享一张卡，也允许 header-only 卡使用 `NoopToolContent` 作为明确的空内容实现；这两种情况都必须保留
工具自己的标题、图标、布局与 presentation 合同。未命中注册表时的通用内容视图只用于未知工具、插件
未加载或注册异常的诊断展示，不能作为正式工具免建卡片的长期方案。

工具执行合同与展示合同分别由各自 owner 维护：工具结果只包含业务事实；Renderer registry/projector 根据已校验事实生成标题、图标、组件、布局和 presentation。presentation 是 Renderer read model 的派生数据，不进入工具结果、RuntimeEvent 或 SQLite。

---

## 9. Tool 幂等属于 Linnkit Runtime

Tool 幂等是执行合同，不是 Conversation 消息身份，也不是 Renderer 展示语义。唯一 owner 是 [Linnkit runtime-kernel tools](../../packages/linnkit/src/runtime-kernel/tools/README.md)：

- 工具只在确有副作用、同参重试必须复用成功结果时声明 `idempotency`；scope 只能是 `conversation` 或 `turn`。
- key 是 32 hex（128-bit）的 SHA-256 前缀；对应 scope 缺少 `conversationId` / `turnId` 时明确失败，不猜测其它身份。
- 只复用成功 `tool_output`；ToolNode 提供进程内 in-flight 合并与 working history 复用，不承诺跨进程强幂等。
- 历史 16 hex key 不前缀匹配、不双读；升级后的旧调用按 cache miss 处理。
- cache hit 仍要按当前 scope 重新执行模型附件等后处理，不能直接复用旧 durable ref。

Conversation 只透传和投影正式工具事实，不解析 key 长度、不生成幂等 key，也不把幂等 key 当作 `message_id` / `merge_key`。

---

## 10. Host 确定性发起工具

Host 可以跳过首轮 LLM 直接发起工具（`host-originated-tools`）。这类调用仍然：

- 走同一 ToolNode
- 产生同样的 `tool_call_decision` / `tool_process` / `tool_output`
- 使用同一身份派生

不存在"host 特殊工具事件"。

---

## 11. 禁止清单

| # | 禁止 | 正确做法 |
|---|---|---|
| 1 | 把 `tool_call_decision` 当成调用已开始 | 看 `tool_process(start)`（§1） |
| 2 | 从 event id / 工具名 / 下标派生工具 message_id | `conversationMessageIdFromToolIdentity(run_id, tool_call_id)`（§2） |
| 3 | 不带 `run_id` 索引工具状态 | 工具属于 run scope（§2） |
| 4 | 顶层 message status | 只在 tool metadata（§3） |
| 5 | 扫描 loading 行补终态 | ToolNode 结算 + dominance（§4） |
| 6 | 从 `observation` / raw payload 取结果 | 正式 `result` + strict schema（§5） |
| 7 | Renderer 计算分页 / 恢复行 cursor | 只用 `next_offset`（§5.1） |
| 8 | 为具体工具加 RuntimeEvent / SSE / ToolContext 字段 | 通用工具事实（§6） |
| 9 | Conversation 保存工具状态镜像 | 从正式事实或工具存储读（§6.1） |
| 10 | wrapper result 交给底层 schema | adapter 转换 + 再 parse（§7） |
| 11 | 组件内改字段名 / 猜 shape | 展示联合消费正式合同（§7） |
| 12 | 用哨兵 JSON 证明别名协议一致 | 真实 producer→adapter→Renderer 测试（§7） |
| 13 | 用注册表兜底协议错误 | 注册表只管展示（§8） |
| 14 | 把展示配置混入工具执行合同 | Renderer registry/projector 独立拥有展示合同（§8） |
