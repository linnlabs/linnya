# @app/schemas

> **全链路权威规范**：[`docs/conversation-platform/`](../../docs/conversation-platform/README.md)。不变量以 [`00-invariants.md`](../../docs/conversation-platform/00-invariants.md) 的 `INV-nn` 为准；本文是实现级说明，冲突时以规范为准。

## 1. 模块定位

`@app/schemas` 保存 Linnya 前后端共同依赖的**产品边界与 API 合同**。它提供稳定类型、Zod schema、解析函数和少量与合同一致性直接相关的纯函数。

本包的目标是让跨进程、跨端和跨插件的数据边界具备同一个事实来源，而不是承载业务流程或运行时内核。

当前主要覆盖：

- Conversation API DTO。
- Conversation CLI 与 App bridge 的版本化 command、response、handshake 和连接描述合同。
- Conversation UI message、tool message 与稳定身份合同。
- 内置 Agent prompt key 与配置合同。
- DocumentView 文本视图合同。
- Citation 引用合同。
- 插件 manifest 与插件商店共享合同。
- Workspace mutation 事件合同。
- Shell command owner 与 process control 的跨进程合同。
- Conversation 的轻量 subrun 索引合同。
- 系统 subrun-batch 输入与结果合同。
- Todo、TaskState、Subagent、Workspace document read 与 tool-output read 工具结果合同。
- 用户可见错误消息与操作结果合同。
- Model inference 的 language/embedding/reranking、document OCR 与音频转写跨端 route 合同；完整模块边界见 [Model Inference README](../../src/domains/model-inference/README.md)。
- Provider Catalog 的公开生成资产和 HTTP list/get read model；Host 私有 runtime binding 不属于共享合同。
- Provider Account 授权状态、授权结果和脱敏错误的 HTTP 合同；OAuth token 与刷新凭据不属于共享合同。

## 2. 边界

### 2.1 本包拥有

- 前后端都必须理解且需要独立校验的产品 DTO。
- IPC、HTTP、持久化投影或插件 manifest 等边界上的稳定数据形状。
- 与 schema 本身不可分割的一致性校验和严格 parser。
- 内置 prompt key 等跨端稳定常量。

### 2.2 本包不拥有

- Agent/runtime 事实事件、执行状态、SSE 事件与事件工厂。这些属于 `linnkit/contracts`。
- Graph、ToolNode、child run、上下文管理或模型调用。
- 具体工具实现、并发编排、结果聚合策略和取消流程。
- Renderer 组件、展示状态、虚拟化或滚动行为。
- 某个 domain 的内部实体、store 或 orchestration。
- Slides 等插件自己的业务合同；插件私有合同应留在对应插件包。

严禁为了方便把业务内部类型放进本包。只有当两个独立边界确实需要交换同一份稳定数据时，才应提升为共享 schema。

`src/commands/` 只拥有 Electron host、短命 runner 和 Renderer 必须共同校验的 wire DTO。它不拥有进程 registry、授权规则或生命周期编排，也不依赖 Linnkit。进入 host 后，conversation、Agent run 和 tool call 仍须通过显式 mapper 校验成各自的 Runtime 名义类型；现有 Linnkit `ExecutionId` 表示前端执行流，不能复用为一条 Shell 命令的 `CommandExecutionId`。

## 3. Runtime 合同迁移说明

2026-04-24 的 schemas-detach 已将 Agent/runtime 协议物理迁移到 `linnkit/contracts`，包括：

- `AiMessage`、`RuntimeEvent`、`SubRunTraceEvent`。
- `EventEnvelope`、`ExecutionTraceContext`。
- `SSEEvent`、SSE 创建函数和运行时事件创建函数。
- `DEFAULT_MAX_STEPS` 等执行内核合同。

旧的 `domain-models`、`runtime-events`、`runtime-models`、`view-models`、`execution-events`、`sse-events` 和 `sse/` 已删除，不提供兼容导出。

判断规则很简单：

- 描述“Agent 执行过程中发生了什么”的事实，放 `linnkit/contracts`。
- 描述“Linnya 产品边界交换什么数据”的合同，才考虑 `@app/schemas`。

## 4. 目录职责

| 路径 | 职责 |
|------|------|
| `src/api-dtos.ts` | Conversation 请求、响应、选项和 API 校验 |
| `src/agent-config/` | 内置 `PromptKeys`、Agent 配置 schema 与相关稳定常量 |
| `src/document-view.ts` | 文档元数据、块引用、文本视图和窗口裁剪合同 |
| `src/citation.ts` | KB/Web 等引用来源、引用元数据与上下文 DTO |
| `src/plugins/` | 插件 manifest、能力声明、发布产物和商店共享合同 |
| `src/workspace-mutation-events.ts` | Workspace 节点与文档变更事件 |
| `src/commands/` | Shell command identity、owner binding 与 process control 的严格版本化 DTO |
| `src/model-inference/` | language、embedding、reranking 的严格 typed route |
| `src/provider-catalog/` | Provider/模型公开资料、generation 与 HTTP list/get DTO；不含 package/route/auth |
| `src/provider-account/` | Provider 账号授权状态、结果和脱敏错误 DTO；不含 token/refresh secret |
| `src/document-ocr/` | Paddle layout/job 文档 OCR 的严格 typed route |
| `src/transcription/` | OpenAI Audio 与 DashScope Qwen ASR 的严格 typed route |
| `src/conversation-control/` | CLI ↔ App 的版本化 command、response、status frame、handshake 与私有连接描述合同；不含业务编排和 HTTP 实现 |
| `src/conversation/ui-message.ts` | Host → HTTP → Renderer 共用的 Conversation timeline message 判别联合 |
| `src/conversation/message-metadata.ts` | user/thought/answer metadata、answer seal 状态联合与插件 message extension |
| `src/conversation/tool-message.ts` | Conversation 工具消息 lifecycle、payload 与 Renderer metadata 合同 |
| `src/conversation/presentation.ts` | durable message presentation 与请求 UI spec |
| `src/conversation/summary-message.ts` | durable history summary payload、Renderer 摘要进度 metadata 与 presentation identity |
| `src/conversation/message-identity.ts` | Conversation 产品 read model 的消息身份 |
| `src/conversation/visual-turn-identity.ts` | Conversation 视觉分组、timeline 与虚拟化导航身份 |
| `src/conversation/subrun-trace-summary.ts` | 父工具行上的轻量 subrun 清单与事件计数 |
| `src/conversation/file-link.ts` | Conversation 文件链接 resolve/reveal 的 IPC DTO、状态与失败码 |
| `src/tools/subrun-batch.ts` | 系统 batch 的输入、逐项结果和整体结果合同 |
| `src/tools/subagent.ts` | 通用子 Agent 协作的参数、唯一终态与正式 artifact 结果合同 |
| `src/tools/agent-todo.ts` | Linnya Todo 普通工具的参数与结构化结果合同；不是 Runtime 状态 |
| `src/tools/taskstate.ts` | TaskState 读写参数与结构化结果 |
| `src/tools/workspace-document-read.ts` | Workspace 文档读取结果与展示判别联合 |
| `src/tools/tool-output-read.ts` | 长工具输出的续读窗口合同 |
| `src/tools/shared-memory.ts` | SharedMemory list/write 与 `resource_list(shared_memory)` wrapper 合同 |
| `src/tools/document-list.ts` | KnowledgeBase 文档列表及其历史 `resource_list` wrapper 合同 |
| `src/file-locator.ts` | `workspace:`、`conversation:`、`file:` 的 browser-safe canonical locator 合同 |
| `src/tools/workspace-file.ts` | Workspace 文件工具 live locator、节点、分页与检索结果合同 |
| `src/tools/workspace-file-history.ts` | 旧 path 事件的严格 replay-only 合同；禁止用于 live 工具执行 |
| `src/user-facing-message.ts` | 可本地化用户消息与通用操作结果 |
| `src/json-value.ts` | 跨进程和插件扩展允许的递归纯 JSON 值 |
| `src/index.ts` | 包根公共出口 |

## 5. 核心合同

### 5.1 API DTO

`api-dtos.ts` 是 renderer 与 backend Conversation API 的数据边界。它负责请求和响应的结构校验，不负责请求执行、持久化或 Agent 编排。

`promptKey` 的 wire contract 保持为字符串。内置 key 由 `PromptKeys` 提供，插件 key 则由 app-host registry 注册与校验，不能要求每个插件回到 schemas 包扩充枚举。

`ConversationOptions.host_tool_call` 是 host 主动发起单次已注册工具的通用请求合同。调用方只提供非空 `tool_name` 与可序列化 JSON `args`；事件 ID、tool call ID、配对 decision 和 Graph 起点均由 host/runtime 生成。该字段不把工具暴露给 Agent，也不承载具体 batch、table 或 workflow 语义。

`ConversationUserInputCommittedEventSchema` 是 Host durable commit 到 Renderer 的 app-level ack，不是 RuntimeEvent，也不进入 EventStore。它证明指定 conversation、message 与 append/replace operation 已原子提交。Renderer 可以预分配请求 `messageId`，但在该 ack 到达前不得把它当作 UI message；`persist=false` 的请求不产生 ack。

### 5.2 Agent 配置

`agent-config/` 保存内置 prompt key 和前后端共同读取的配置形状。

新增内置 key 时必须确认它确实由宿主共同识别。临时实验 key 必须有明确门禁和退出计划，不能演变为默认产品能力。

### 5.3 DocumentView

DocumentView 是 Editor、Workspace 工具与模型上下文之间的稳定文本视图合同。

- `markdown` 是平台内置文档类型。
- 插件文档可使用自己的稳定 `docType`，这里不枚举官方插件。
- `DocumentBlockIdSchema` 是 DocumentView 可引用块身份的唯一共享定义；ID 必须非空且没有首尾空白。
- block ID 由文档实体创建链分配。序列化、持久化读取和展示只能校验并原样透传，禁止修剪、按下标补造或从 `ref` 恢复。
- 同一文档内的 block ID 必须唯一；`ref` 只是从 block ID 确定性派生的短展示引用，不是第二身份。
- 块引用、字符窗口、截断信息必须保持可恢复和可继续读取。
- schema 只描述视图，不拥有 Editor 节点和插件内部文档模型。

### 5.4 Citation

Citation 合同通过显式 `sourceType` 区分知识库、Web、手工来源与 conversation turn，禁止消费方根据可选字段是否存在来猜来源。

搜索工具当前只产生 `knowledge_base` 与 `web` 子集；编辑器或 MindMap 的其它引用来源不应混进搜索结果合同。

### 5.5 Plugin manifest

插件 manifest 是插件身份、入口、兼容性、发布产物、权限与数据归属的共享事实来源。

manifest schema 只定义静态合同。插件加载、依赖解析、权限执行、安装和升级流程属于 plugin host，不在本包实现。

### 5.6 Workspace mutation

Workspace mutation 合同用于跨模块广播已发生的节点和文档变更。事件携带稳定身份、来源和变更类型，但不负责修改 workspace store 或执行副作用。

新增事件类型时应优先扩展判别联合，保证生产者和消费者都能进行穷尽处理。

### 5.7 用户可见消息

`UserFacingMessage` 以本地化 key、参数、fallback 和 diagnostic 分离用户展示与工程诊断。

- `fallback` 面向用户，不应包含内部堆栈。
- `diagnostic` 面向日志和排障，不应直接展示。
- `OperationResult` 只表达跨边界成功或失败事实，不承载业务流程。

## 6. Subrun trace summary

`SubrunTraceSummary` 是父工具消息上的**轻量索引**，只包含：

- 已出现的 `subrun_ids`。
- 每个 subrun 的事件计数。

完整 trace 仍由 EventStore 和 `linnkit/contracts` 的运行时事件持有，不能复制进列表投影。

顺序规则：

1. live 阶段按 trace 首次出现顺序追加 ID。
2. tool output 到达后，结构化结果中的 `data.subrun_ids` 成为权威顺序。
3. 权威清单中没有 trace 的 child 仍必须保留，并记为 0 次事件。
4. trace 中额外出现的真实 child 可以追加，但不能覆盖权威顺序。

该合同服务 conversation 投影，不定义 renderer 如何展示卡片。

## 7. Conversation UI read model

`src/conversation/ui-message.ts` 是 Linnya Conversation durable message 的唯一产品合同。Host projection、HTTP response、Renderer window DTO 和运行时 reader 都从这里导入，不再各自维护 role、message type 或 presentation 字符串列表。

硬性规则：

- `role + message_type` 是判别联合，不允许分别合法但组合无意义的数据。
- 每个 `message_type` 绑定自己的 payload；Host row、HTTP reader 与 Renderer admission 都必须 parse 整条联合，禁止先拆成三个 string 再猜组合。
- `ui_card` 不是 timeline message；它是 Renderer 从正式消息派生的 presentation entity。
- presentation 只允许 `message | hidden`。
- `tool_calls` payload 必须通过 `ConversationToolMessagePayloadSchema`，并携带真实 `tool_call_id`、`tool_name` 与 lifecycle 状态。
- 工具 interaction 是 strict 判别联合：`active` 保存恢复凭证；terminal 只保存 `status/submittedAt/response`。response command 的 run、interaction、checkpoint 与 resume 身份不得复制进 terminal UI payload。
- 工具 lifecycle 只允许 loading/start|update（无 `completed_at`）、success/complete（有 `completed_at`）、error/error（有 `completed_at`）。状态不得在 message 顶层重复。
- answer seal 使用严格状态联合：未 seal 的 live answer 没有 `completion_reason`；terminal/tool_call 必须 complete；interrupted 必须 incomplete。Renderer type 必须通过 `parseConversationAnswerMessageMetadata()` 与 reason 一起解析。
- 插件消息扩展唯一形状是 `ConversationMessageExtension { namespace, data: JsonRecord }`。禁止任意 metadata、函数、Date、undefined 或插件顶层字段。
- Host row 与 Renderer message 可以使用不同字段命名，但必须由同一联合机械派生并在边界 parse。
- API incoming `tool_output.metadata` 不是开放字典，只接受 `ConversationInteractionResponseToolMetadataSchema`。其它路由、活动或展示字段必须走各自已有的正式 owner，不能借 metadata 透传。

上述规则不提供历史 shape 兼容。旧 read model 应清理或重建；reader 遇到非法行必须失败，不能补字段、改拼写或生成身份。
- 非法 row 是 read model corruption，必须显式失败；不得猜类型、补身份或降级为空对象。

`src/conversation/message-identity.ts` 只拥有产品 read model 身份及明确派生函数，不拥有 Linnkit Runtime identity。Runtime 的 answer/tool/event 身份继续由 `@linnlabs/linnkit/contracts` 定义。

Tool UI message 是 Conversation 产品 read model 实体，不是某一条 Runtime event。`tool_call_id` 只在 run 内唯一，因此 Host durable projection 与 Renderer live projection 必须共同调用 `conversationMessageIdFromToolIdentity(runId, toolCallId)`；返回值同时作为 Tool `message_id` 与 `merge_key`。禁止使用首先到达的 `tool_call_decision / tool_process / tool_output` event id，也禁止用工具名、批次下标或裸 `tool_call_id` 生成 UI 身份。

`src/conversation/visual-turn-identity.ts` 是 Linnya 视觉轮次身份的唯一 owner。完整 visual turn 只能从可见 user message ID 派生，使用 `visual_turn_` 命名空间；历史窗口从 assistant 中段开始时只能创建 `visual_turn_partial_` 局部分组。完整与 partial schema 互斥，timeline index 只允许完整身份。partial 身份不得写入 Runtime fact、持久化 UI row 或 `/turns` 响应。

Runtime `turn_id` 与 Conversation visual turn 是两个实体：前者属于 Agent 执行和上下文关联，后者属于 Linnya UI 分组、timeline 与虚拟化导航。任何生产者和消费者都不得比较、复制、互相 fallback，也不得用普通 `string` 抹掉两者的类型边界。Host turn index、Renderer visual-row、Timeline 和 Virtualizer 必须从包根导入这里的类型、schema 与派生函数，禁止自行拼接 ID。

## 8. 结构化工具结果

工具 observation 是给 Agent 的文字摘要。`data` 保存持久化、审计和后续业务流程需要的结构化事实，
必须由共享 schema 校验；Renderer 只能从这些已接纳事实派生本地 presentation，不能让工具结果承担展示配置。

### Todo

`src/tools/agent-todo.ts` 只定义 Linnya `todo_read/todo_write` 的参数和正式 result。Todo 是可选的普通工具，不是 RuntimeEvent、Conversation metadata 或框架状态；当前值只允许从正式工具历史恢复，不提供旧快照或 observation 兼容。

### TaskState

`src/tools/taskstate.ts` 定义唯一 live TaskState、读写参数、显式字段/数组上界、8000 字符总预算和结果。live 结果不复制 conversation/instance 路由字段；消费者只能读取结构化 `taskstate`，禁止解析 observation 或 Markdown 恢复状态。旧 SharedMemory-backed 结果由独立 `HistoricalTaskState*` schema 回放，不受新增 live 预算反向约束。

### Subagent

`src/tools/subagent.ts` 定义 `subagent` 的稳定参数与 canonical 结果。插件 registry 动态拥有
`subagent_type` 的具体 enum，共享 schema 只校验非空稳定字段。`status` 是唯一终态；`subrun_ids`
提供 Conversation 父工具行的权威 child 顺序。`artifacts` 只允许 Workspace VFS inode 与
ToolOutputStore durable blob ref，不接纳 SharedMemory、Evidence 或任意 Resource URI。旧
`delegate` 不存在 executable schema；Renderer 只按历史工具名展示既有事件。

### Web Search

`src/tools/web-search.ts` 是 `web_search` 参数和结果的唯一 owner。参数默认值、整数范围与公开工具
schema 一致；结果严格约束 query、结果数量、Evidence bundle、cache 状态，以及仅允许 Web 来源的
citation。citation ref 与 canonical URL 必须唯一，index 必须连续。producer 返回前和 Renderer
live/reload admission 使用同一 schema；卡片只消费派生 presentation。

### SharedMemory

`src/tools/shared-memory.ts` 只定义历史 Conversation 事件的严格 admission 合同。SharedMemory live
工具和 `resource_list(source=shared_memory)` 已删除；Renderer projector 仍按旧 producer 的完整 wire
shape 回放存量卡片，但这些 schema 不得重新用于注册 Agent executable。

### Workspace file

`src/file-locator.ts` 是跨模型与 Renderer 的文件地址合同 owner。它只解析、格式化地址空间，不读取文件，也不依赖 Node；`file:` 到宿主路径的转换必须留在 Node adapter。`workspace:` 和 `conversation:` 禁止 query、fragment、反斜杠、空段、`.`、`..`，`file:` 必须是 canonical file URL。

`src/tools/workspace-file.ts` 是 Workspace 文件工具 live 合同的 owner。当前已收口
`list_files / read_file / write_file / edit_file / grep`：工具参数边界、最大值与公开 JSON Schema 一致；结果中的节点来源、
分页关系、命中数量均由 strict schema 接纳。文件系统 `updated_at` 允许毫秒小数，不能套用 SQLite 整数时间戳假设。
`read_file` 只暴露通用文件事实，不把 Workspace VFS 或文档插件的内部读取详情转发到工具结果；分页时
由 observation 明确给出下一次字符 offset。Markdown 正文窗口含已接纳引用时，VFS text 与 DocumentView
结果可成对携带 `data.citations.citations` 和 `data.citation_diagnostics`：ref 与来源身份必须唯一，index
必须连续，diagnostic 只能指向同结果的 ref。结构化 snippet 与 observation source appendix 使用同一份
预算后 excerpt，不能绕过预算。`write_file` 只保留路径、节点、
操作、文档身份与标准 diagnostics；`edit_file` 额外保留实际替换数量。Markdown edits 和插件内部写入详情
不进入公共结果。插件节点类型按稳定标识符接纳，具体 owner 与启用状态由文档类型 registry 判定。

`read_file` 的 `view` 只选择普通读取或 VFS DocumentView，不声明文件媒体类型。conversation 文件
只传 path；reader 按真实内容识别文本或图片，图片通过模型附件返回且没有字符窗口。`max_chars` 已从
live admission 删除；文本默认窗口仍由 owner schema 在 admission 后物化，公开工具 schema 不再用
default 诱导模型给图片补齐文本参数。

### Workspace document read

`src/tools/workspace-document-read.ts` 使用 `presentation.kind` 判别联合：

- `blocks`：稳定 block ID、ordinal 与 Markdown 文本。
- `outline`：稳定 item ID、层级和子节点标记。
- `text`：保持原样的文本窗口。

文档身份、类型、名称、截断标记与 cursor 都是正式字段。插件私有材料只能进入 `details`，不能在 Renderer 建第二套展示 shape。列表项缺 ID、ID 重复或 cursor 与截断状态矛盾时必须失败。

结构化 Workspace 阅读只保留一个正式合同：

- `WorkspaceDocumentReadResultSchema` 属于 `read_file(view="document")` 的结构化结果，cursor 为 `nextOffset`。
- Workspace DocumentView provider 可在内部结果顶层携带成对出现的 `citationSources/citationDiagnostics`。这些字段只描述当前正文窗口的已接纳来源与安全诊断，不包含 Agent turn 的全局 citation index；`read_file` facade 把它们映射为公开 `data.citations/citation_diagnostics`。

Renderer 复用底层工具卡时只能消费正式结构化结果。admission/projector 测试必须传入真实完整结果；只返回 `kind` 等哨兵字段的 fake 无法覆盖协议一致性。

### Tool output read

`src/tools/tool-output-read.ts` 定义独立续读窗口：blob identity、字符范围、总字符数、cursor 和 `window_text` 必须严格一致。`next_offset` 是第一个未读 UTF-16 字符偏移；行范围只服务展示，不能推断 `has_more`。因此单个源行可以跨多页，所有窗口按 cursor 拼接后必须等于原文。合同不接受 `offset_line/max_lines/max_units/next_offset_line`。它是一次新的工具结果，不冒充原工具卡，也不从 observation 重建文本。

## 9. Subrun-batch 合同

`src/tools/subrun-batch.ts` 是系统发起 batch、正式 `subrun_batch` 工具与 renderer collection 之间的共享 DTO。工具实现位于 `src/tools/agent_control/subrun/batch/`，只注册到 host ToolRegistry，不进入 AgentDefinition 的模型可见工具清单。

### 9.1 输入

每个 task 必须显式携带：

- 顶层 `worker_prompt_key`：本批 child runs 共用的已注册 Agent prompt key。

- `unit_id`：调用方业务单元身份。
- `subrun_id`：child run 稳定身份。
- `description`：用户可识别的任务描述。
- `prompt`：交给 child 的自包含任务内容。

同一 batch 内 `unit_id` 和 `subrun_id` 均必须唯一。正式消费者不得从 ID 后缀推断任务位置或归属。

### 9.2 逐项结果

逐项状态为：

- `completed`：child 正常完成。
- `failed`：child 执行失败。
- `cancelled`：child 被取消；该事实不能降级成普通失败。

每项结果保留输入身份、描述、完整 final answer 与可选错误。完整结果供 UI、回放和后续业务使用，不应整批复制进 Agent observation。

### 9.3 整体结果

整体状态为 `completed`、`partial`、`failed` 或 `cancelled`。schema 会验证：

- `subrun_ids` 与 `results` 的 ID 顺序完全一致。
- `total`、`succeeded`、`failed`、`cancelled` 与逐项结果一致。
- 整体状态与逐项状态组合一致。
- 结果中的 `unit_id` 与 `subrun_id` 不重复。

`data` 保存完整结构化事实；`observation` 是提供给父 Agent 的有界摘要。schema 验证两者形状，具体截断和摘要策略由 `src/tools/agent_control/subrun/batch/` 的正式聚合函数负责。

### 9.4 生产者与消费者

- 正式聚合：`src/tools/agent_control/subrun/batch/`。
- 正式 renderer：`apps/renderer/domains/conversation/features/subrun-collection/`。
P1 兼容脚手架已在 P4 删除；固定三项、环境开关、conversation 前缀和 ID 后缀协议从未进入共享合同。

### 9.5 `write_to_table` 输出

`src/tools/write-to-table.ts` 定义声明式 `write_to_table` 工具的正式输出合同。main 工具负责产生该 JSON，renderer 的 live subrun consumer 通过 `readWriteToTableOutput` 读取 `content/mode`；表格坐标仍以 host 预绑定的 `unit_id` 为准，工具输出中的可选 `row/col` 不参与正式写回定位。

该工具是 `table_ai_fill` child 的最终产物出口，因此生产输出同时携带 `control.terminateRun=true` 与 `control.finalAnswer=content`：一次成功写入后结束当前 child，并把真实写入文本交给父 `subrun_batch` 聚合。这个 control 只作用于当前 child Graph；父 `subrun_batch` 仍不得携带 control，必须回到调用方选择的父 Agent 生成总结。表格系统批次使用无工具的 `system_batch_summarizer`，避免已完成写回后再次执行文件工具。

## 10. Reader 与校验约定

对外部 `unknown` 数据应优先使用本包提供的 schema 或 reader，不要在消费方重复手写字段解析。

- 正式边界使用 Zod `parse`，让非法输入显式失败。
- `safeParse` 只允许用于“无数据”和“非法输入”本来就是不同业务分支的可选探测，不能用于历史兼容、shape guessing 或静默降级。
- 不得用不安全类型断言绕过校验。
- reader 只做结构收敛，不执行网络请求、写 store 或触发业务副作用。

`readSubrunTraceSummary` 返回空 summary，是因为它服务可渐进出现的投影状态；subrun-batch reader 返回 `null`，是因为调用方必须区分“尚无结果”和“存在合法结果”。不要把两种语义混用。

## 11. 导入与公开出口

应用代码优先从包根 `@app/schemas` 导入公共合同；需要限制依赖面的仓外消费者应使用 `package.json#exports`
声明的窄子入口。Cloud 当前只消费 `@app/schemas/model-inference` 与
`@app/schemas/document-ocr`，不得改为内部源码路径或从包根随意扩大依赖面。

禁止直接导入 `packages/schemas/src/*` 内部路径。新增子入口必须同时更新 package exports、CommonJS/ESM 构建和类型产物，不能只依赖 monorepo tsconfig 别名碰巧可用。

Agent/runtime 类型必须从 `linnkit/contracts` 导入，不允许在 `@app/schemas` 恢复兼容别名。

## 12. 变更纪律

修改共享 schema 前必须先识别所有生产者、消费者和持久化数据，并安排同一变更中的数据清理或 read model rebuild。

### 新增字段

- 只有真实跨端需求才能新增。
- 必须明确必填、可选和默认值；参与身份、routing、cursor 或 lifecycle 的字段不得 optional。
- 必须同步生产者、消费者、reader 和业务测试。

### 修改或删除字段

- 先审计数据库、EventStore、tool output、IPC 与插件 manifest 中是否已有存量数据。
- 不允许只改 TypeScript 类型而不改运行时校验。
- 不允许通过宽泛 union、passthrough 或随意 optional 掩盖迁移问题。
- 破坏性变更必须在启用新合同前完成显式数据清理、迁移或可重建 read model 的重建；运行时不保留双合同兼容窗口。

### 禁止事项

- 禁止 `any` 和不安全断言。
- 禁止把 domain 内部状态提升成全局合同。
- 禁止在 schema 中加入网络、store、数据库或 UI 副作用。
- 禁止复制 Linnkit runtime 合同。
- 禁止在 Host、Renderer、timeline 或 virtualizer 中重写 visual turn schema、手拼 visual turn ID，或把 Runtime `turn_id` 当 visual turn。
- 禁止让 schema 反向依赖应用层、renderer 或具体工具实现。
- 禁止为旧字段、旧 payload、未知 type 或缺失 identity 添加 fallback。

## 13. 构建与验证

常用门禁：

- 构建包：`pnpm --filter @app/schemas build`。
- 验证真实 tarball：`pnpm --filter @app/schemas pack-smoke`。该命令只在临时目录生成制品，不发布到 npm；它会验证
  Cloud 所需子入口的 types/CommonJS/ESM 产物与真实运行时解析，并拒绝源码、测试实现和测试声明进入 tarball。
- 包构建会对账全仓业务 import 与 package exports，并检查 types、CommonJS、ESM 产物及真实运行时加载；新增正式子入口时不得只依赖 tsconfig 别名。
- 运行 Conversation schema 业务测试：`pnpm exec vitest run packages/schemas/src/conversation`。
- 检查全仓类型基线：`pnpm run guard:tsc-baseline`。
- 检查包边界：`pnpm run guard:agent-boundary`。
- 检查 Conversation 身份与投影旁路：`pnpm run guard:conversation-contract`。

测试应验证真实合同规则，例如非法输入拒绝、唯一身份、顺序、计数和状态一致性；不要为字段声明或 README 写快照测试。

## 14. 相关文档

- Agent/runtime 公共合同：[独立 Linnkit 仓的 `src/contracts/`](https://github.com/linnlabs/linnkit/tree/main/src/contracts)。
- Linnkit 集成说明：[`docs/integration/README.md`](https://github.com/linnlabs/linnkit/blob/main/docs/integration/README.md)。
- Conversation 活动 / subrun 系统规范：[`docs/conversation-platform/10-subruns.md`](../../docs/conversation-platform/10-subruns.md)。
- 正式 subrun renderer：`apps/renderer/domains/conversation/features/subrun-collection/README.md`。
