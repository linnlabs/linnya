# Conversation 规范自动化加固记录

> **状态**：完成。本文保留为决策与实施记录；长期规则已回写 `00-invariants.md`、`11-testing-gates.md` 与对应 owner README，当前事实以这些权威文档为准。
> **范围**：优先把既有规范变成编译期、AST 或业务语义门禁，不借机改写稳定主链。

## 1. 已核实事实

- Linnkit `RuntimeEvent` 当前有 15 个正式 variant；`pending` 是交互状态值，不是事件 variant。
- UI parity fixture 原构造 11 个 variant；现已为 `tool_process`、`final_answer_reset` 补业务场景，共覆盖 13 个正式 variant。
- `audit_envelope` 与 `control` 不进入 Conversation UI parity，已登记 owner 与理由；未分类的新 variant 会使门禁失败。
- Linnkit 已集中定义 Runtime 身份 schema；首期 `RunId + ToolCallId` 已 brand 化并由 assertion guard 锁定，其余身份按风险独立立项。
- Conversation 核心 parity / 并发隔离 / wait-user / history reload 测试 24 项约 1 秒完成，已进入 CI 与 pre-commit。
- Conversation agent 选择已退出开放 metadata：产品身份由显式 `selected_agent_id` 持久化并进入 read model，插件通过 `agentId` 引用同一 `AgentDefinition.id`。
- `promptKey` 只在 Host admission 后作为内部 registry 查找键；旧 `ConversationWorkflow*` 与 Renderer `metadata.promptKey` 已物理删除（详见 §3.3）。
- 清理完全空白 catch 后，仍有分散在多个 domain 的注释型空 catch；它们按业务失败语义分批治理，不在低风险阶段按数量批量补日志。

## 2. 低风险阶段

| 项目 | 目标 | 状态 |
|---|---|---|
| 完全空白 `catch` 清零与 AST guard | 无说明、无处理的 catch 不能重新进入生产代码或构建脚本 | done |
| parity 覆盖完整性 | 新增 RuntimeEvent variant 必须补 fixture 或显式登记非 UI 原因 | done |
| Conversation semantic gate | parity、并发 run、wait-user、history reload 进入 CI | done |
| `types/index.ts` 导出棘轮 | 导出符号只能减少，禁止继续扩张过宽出口 | done |
| agent-choice `workflow` 命名棘轮 | 旧命名按文件、规则、符号与数量只减不增，不封杀合法 workflow | done |
| 本地 / CI 口径 | 新 guard 同时进入 pre-commit 与 CI | done |

## 3. 中高风险阶段（先研究，后决策）

### 3.1 Runtime identity brand

**事实**：Linnkit 已在 `contracts/identity/definitions.ts` 集中声明身份 schema，但 19 个推导类型仍共享普通 `string`；文件注释明确记录了“暂不 brand”的旧决策。Conversation 只有 visual turn 与 summarization presentation 已用 brand，Runtime `run_id / execution_id / answer_id / tool_call_id` 仍可互换。外部输入是 string 并不是拒绝 brand 的理由，正确边界应是 parse 后进入强类型内部，而不是在消费点断言。

**方案**：

| 方案 | 优点 | 代价 | 结论 |
|---|---|---|---|
| 全量一次 brand | 最快达到编译期隔离 | 跨 Linnkit、Host、SQLite、Renderer 的爆炸半径最大，容易诱发断言清场 | 不采用 |
| 分期 `RunId + ToolCallId` → `ExecutionId + AnswerSegmentId + ConversationMessageId` → 其余 | 先锁住工具与并发 run 的高风险身份；每期可独立验收 | 需要逐个标出 admission parse 与内部 creator | **推荐，先做只读编译影响分析** |
| 保持 string，只加 AST 命名 guard | 低成本 | 无法发现两个合法变量之间的错赋值 | 不足以解决根因 |

只读影响分析已完成：生产代码中 Run identity 相关文件约 176 个、Tool-call identity 相关文件约 114 个，57 个同时涉及二者。首期必须同期迁移二者，否则 branded identity 仍可流入另一侧的普通 `string` 参数。边界表已经确认 Provider/HTTP/SQLite/plugin contract 保持 raw，Linnkit Runtime、RunSupervisor、Host 内部编排与 Renderer 运行态保持 brand。实施必须证明不新增身份断言或 `as RuntimeEvent / RunRecord` 一类载体断言。

**已有成功先例，风险低于初判**：`visual-turn-identity.ts` 与 `summary-message.ts` 已使用 `.brand<>()`，其中 visual turn 让 [INV-12](./00-invariants.md#inv-12--runtime-与视觉轮次身份隔离) 成为编译期强制——把 `turn_id` 赋给 `visualTurnId` 编译不过。本项不是引入新模式，是把这个已验证的模式从 2 个文件推广到全部身份。

**编译影响补充**：生产代码很少直接写 `RunId / ToolCallId` 类型名，不代表影响面小；大部分字段
通过 `RuntimeEventSchema / SSEEventSchema` 的 `z.infer` 间接传播。identity schema 一旦 brand，整组
事件联合的字段类型和 creator/generator 返回值都必须同步收窄。只按类型名 `rg` 统计会严重低估
改动，必须先用临时编译实验形成逐阶段错误清单。

**实施切点**：Provider `ToolCall/ToolCallChunk` 是外部流式草稿，允许暂存空 ID；`buildDecisionStage` 是 ToolCallId admission，完成后 Graph `StandardToolCall`、AgentEvent 与 RuntimeEvent 才能使用 brand。SQLite row 与产品 HTTP DTO 保持 wire string，分别在 store mapper 与 Host/Renderer DTO mapper parse。host-only `turnId → RunId` 与 child `subrunId → RunId` 保留现有同值行为，但必须由命名派生函数表达。

### 3.2 Vue reactive callback 抛出边界

**事实**：`ToolCallsMessage.vue` 从 registry 把原始 `unknown args/result` 直接传给动态组件；至少 6 个正式组件在 computed 内 `.parse()` 或抛业务错误：TaskState、AgentTodo、SummaryMessage、ThoughtMessage、ToolOutputRead、WorkspaceDocumentView。部分工具的 registry title 已经 parse 一次，组件又 parse 一次，形成重复 owner。render effect 抛错会破坏当前 Vue patch/flush，这正是历史上“切换不了会话”的故障机制。

**可选方案**：

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 立即上“computed 禁止 parse/throw” AST 红灯 | 快 | 会逼迫 6 个组件用 catch/default 清场，制造 fallback | 禁止 |
| 在 MessageProjection 按 tool name 解析全部结果 | 事件进入后即强类型 | Renderer core 必须理解所有内置与插件工具，跨 domain 耦合 | 不采用 |
| 每个 tool feature 提供 presentation/view-model projector，由 registry 在挂载组件前调用 | 解析 owner 与工具业务归属一致；组件只渲染判别联合；插件可自带 projector | 需要扩展 registry contract，并逐卡迁移 | **推荐** |

规则已固化为 [INV-54](./00-invariants.md#inv-54--parse-与-throw-只允许在-admission-边界)。

**vertical slice 已完成**：先前草案选 TaskState + ToolOutputRead，实际先完成
**`mergeWindowAndLiveMessages` + `selectors.activeMessages`**。

理由是严重性差一个量级，且要在真实事故现场验证模式：

| 抛出位置 | 影响面 |
|---|---|
| 工具卡 computed 内 parse | 只毁一张卡片 |
| `selectors.activeMessages`（`rejectIdentityChange:208`、`mergeAnswerMessage` 裸 `.parse()`） | **毁整个会话视图**，且反复重算反复抛 |

历史上"切换不过去"的实证故障点正是后者。vertical slice 的目的是证明"移出 reactive effect"这一模式能解决那类故障——在没出过事的地方验证证明不了这件事。

实施结果：

- `activeMessages` 调用链已成为不 parse、不 throw、不写状态的纯合成。
- 单边 strict schema admission 保留在 window DTO mapper 与 live MessageProjection。
- 同一消息身份的跨来源合同分别在 window loader 和 live projection 提交前校验。
- window 冲突 snapshot 不落 store；live 冲突事件失败并回滚尚未提交的就地 reducer runtime。
- 合成结果保留显式 `conflicts` 诊断，但生产主链不能依赖它兼容非法状态。
- 业务测试已进入 Conversation semantic gate，真实 Electron A/B 切换、新草稿与返回历史会话通过。

该设计修正了原草案的一处不完整判断：只把失败上移到 `mapUiMessageDto` 不够，因为 window 与
live 可以各自合法、组合后才冲突；因此需要两个写入方向的交叉 admission。

#### 3.2.1 答案 durable/live 优先级（done）

已核实 Runtime 身份事实：

- `callLlmStream()` 每次 provider stream 入口都调用 `generateAnswerSegmentId()`，新 stream 必然得到
  新的 `answer_id`。
- `FinalAnswerAssembler` 只把**同一次 attempt** 的 chunk 封成完整 `final_answer`，明确禁止混入
  另一 `answer_id`，且不会为封口重新生成身份。
- retry 在已下发内容时先发 `final_answer_reset` 清除失败 attempt；下一次 provider stream 再生成
  新 `answer_id`。
- wait-user resume 虽复用同一逻辑 run，但建立新的 execution 并重新进入 provider stream，因此
  不会复用等待前答案的 `answer_id`。

所以同一 `answer_id` 的 window/live 合成只可能是**同一个 answer attempt 的不同到达进度**，不是
“中断答案后来继续写完”。正确状态顺序是：

| window | live | 语义 |
|---|---|---|
| sealed | unsealed | durable 已看到封口、live 仍滞后；**window 胜出** |
| unsealed | sealed | live 已看到封口；live 胜出（durable window 实际不应持久化 chunk） |
| sealed | sealed 且 reason/content 一致 | 同一事实的两份投影；允许合成 |
| sealed | sealed 但 reason/content 不一致 | 同一事实被投影成两个结果；admission 协议错误 |
| `partial_answer(interrupted)` | `final_answer(terminal)` | **协议错误**；新 attempt 必须使用新 `answer_id` |

实施结果：

- 删除“durable partial 用同一 answer identity 收敛为 live terminal”的错误测试合同。
- `completion_reason` 成为唯一 seal 判据；durable sealed 压过陈旧 live unsealed。
- 两侧 sealed 的 reason 或正文不一致时，window/live 两个 admission 方向都拒绝。
- selector 仍是总函数；绕过 admission 的非法状态保留 durable row 并返回可判别 `answer_seal`
  冲突，不在 computed 内抛错。
- live reducer admission 失败时丢弃 pending commit，并从已提交 live slot 重建 runtime，整个非法
  attempt 不留半状态。

不得按 timestamp 猜新旧：window `sort_seq`、event timestamp 与 live 到达顺序不属于同一个时钟；
`completion_reason` 才是正式 seal 事实。

工具卡（TaskState / ToolOutputRead 等 6 个组件）作为第二批，走 registry presentation projector 方案，最后启用 AST guard。失败必须在组件挂载前成为一次明确的协议错误，不能 `safeParse + 空对象` 或静默隐藏卡片。

**registry 复核结果**：当前 `ToolUiConfig` 只注册 `component + title(args: unknown,
result: unknown)`；`ToolCallsMessage` 把原始 unknown 直接传给动态组件，`useRegistryToolUi` 又在 Vue
computed 内调用 title，并用 `try/catch + fallbackTitle` 吞掉解析失败。这同时违反 INV-17 与
INV-54。projector 不能只塞进组件前的另一个 computed；它必须由 registry 暴露窄 presentation
contract，并分别在 live projection admission 与 history DTO admission 调用。Conversation core
只能依赖该 registry contract，不能 import TaskState/Todo 等工具 schema。

**基础设施阶段已完成**：`plugin-host-contract` 已成为 `ToolUiConfig` 唯一真源；app-level registry
通过 Conversation 窄 port 分派 projector；live `toolPatch` 使用 project-then-apply；reload mapper 在
window store 前执行同一 admission；`ToolCallMessage.toolPresentation` 明确为 metadata/wire/SQLite
之外的 Renderer-only 派生字段。alias 最终 key、wrapper 原始身份和延迟本地化 title descriptor 已
进入合同。

**工具卡首期 vertical slice 已完成**：TaskState、AgentTodo、ToolOutputRead、WorkspaceDocumentView 与
SharedMemoryDocRead
的 payload/title 由各自 feature projector 唯一解释；卡片只消费 presentation。通用 registry 不再
硬编码 Todo 空结果，也不再为这些 config 调用 legacy title resolver。历史 `resource_read` 的 Workspace /
ToolOutput wrapper 与旧工具共用 replay schema，不在卡片内二次适配。SharedMemoryDocRead 的历史事件
使用 `ConversationArtifactReadResultSchema` 判别联合；projector 会核对请求 URI 与结果 source，卡片不再
探测字段、解析 URI 或计算缺字段 fallback。已迁卡片进入单调增长 AST 清单，禁止恢复 raw
`args/result`、组件内 parse/safeParse 或 throw。后续各业务切片已把实体卡 baseline 扩展到十六张，
header-only baseline 扩展到八项；已知存量面最终在 R-22 关闭时清零。

**SharedMemory header-only 切片已完成**：历史 list/write/read 事件保留 `hideContent`，但不再因此跳过展示合同。`sharedmemory_list` 和 `resource_list(source=shared_memory)` 的不同持久化 wire shape 由同一个
projector 显式适配；Renderer 消费 `@app/schemas` strict replay schema，两张卡只读取 presentation。live 工具已退役，这一切片只维护历史展示行为。

**ContextCheckpoint 实体卡切片已完成**：参数、结果与可选 TaskState 快照统一进入
`@app/schemas` strict schema；producer 返回前与 Renderer admission 共同校验。卡片只读取
presentation，不再从 result、observation 和 args 逐级猜值；无事实来源的“清理条数”标题分支已删除。
实体卡 baseline 因此由七张增长为八张。

**WebSearch 实体卡切片已完成**：参数范围、结果数量、Evidence bundle、cache 状态与 Web citation
判别联合统一进入 `@app/schemas`。producer 执行入口与返回前、Renderer live/reload admission 使用同一
strict schema；citation ref 与 canonical URL 唯一，index 连续。卡片只读取 presentation，不再在
computed 中运行两层 passthrough parser；实体卡 baseline 因此由八张增长为九张。

**WebRead 实体卡切片已完成**：canonical `web_read` 与历史 `resource_read(http/https)` 分别使用 strict live/replay 合同；projector 按 `sourceToolName` 一次适配两种持久化 wire shape，卡片只读取 presentation。新运行只产生 `web_read`，Resource executable 已退役，历史卡片继续可回放。

**Skill 实体卡切片已完成**：新调用统一使用 `skill` 三种 action 和各自 strict 结果合同；轻量卡片只消费 action/Skill 身份，不缓存技能正文。历史 `resource_read(skill://...)` 仍使用独立 strict wrapper 结果和 projector 供 replay，不能重新进入模型提示或 Skill 激活输出。实体卡 baseline 因此由十张增长为十一张。

**ImageGeneration 实体卡切片已完成**：producer 参数/结果/media 统一到 strict schema；早期流式空参数占位成为显式协议分支，完整调用与成功结果仍严格 admission。projector 只投影图片路径和可选尺寸，组件删除 observation/content JSON 猜测旁路；live `generate_image` 与 historical `text_to_image` 共用该严格投影；实体卡 baseline 因此由十一张增长为十二张。

**AskQuestions 实体卡切片已完成**：projector 在 live/reload admission 同时判别占位参数、正式问卷结果和 active/terminal interaction，提交答案使用独立 strict schema；卡片/composable 不再读取 raw result 或整包 message metadata，提交/跳过仍走原有 orchestration。实体卡 baseline 因此由十二张增长为十三张。

**DocumentList 实体卡切片已完成**：`list_knowledge_base` live 结果与 Knowledge 来源的历史 `resource_list` wrapper 均使用 strict admission；projector 保留各自正式 wire 差异，只归一 `id/title` 展示事实。卡片删除 `data: []` 与 `name/filename` 猜测旁路，实体卡 baseline 因此由十三张增长为十四张。

**DocumentContent 实体卡切片已完成**：canonical `knowledge_read` 与历史 `resource_read(kb://...)` 分别保留 1-based chunk 和 0-based offset 合同；projector 按已持久化的实际结果窗口生成范围。卡片删除 page/content/observation 猜测旁路；旧 Resource 与 `browse_document_by_chunk` 都只保留历史 projector，不再是可执行工具。

**KnowledgeSearch 实体卡切片已完成**：新运行统一使用 canonical citations result，旧 inline
`documents` 与 snapshot pointer 只由 historical replay schema 接纳；卡片只消费 presentation。deep
request 与实际 strategy 分开表达，降级 shallow 不再误报 deep 成功。subrun trace 与 active conversation
identity 由 registry capability 按需透传，历史 Citation Snapshot 经 Conversation 窄 port strict 读取；
生产 snapshot 写入口已删除，超长 observation 交由 ToolOutputStore。实体卡 baseline 由十五张增长为十六张。

**Workspace 浏览/读写/检索 header-only 切片已完成**：`list_files / read_file / write_file / edit_file / grep` 的参数与结果由
`workspace-file.ts` 统一，生产者和 Renderer projector 共同 strict parse；registry 不再用 title resolver
读取 raw payload。因为五者共享 `NoopToolContent`，门禁使用独立的 header-only 注册项 baseline，而不是
制造没有业务内容的 Vue 卡。`read_file` 只暴露通用文件事实，不把 VFS/插件内部详情穿透到工具结果；
分页 cursor 进入 Agent 可见的 observation。`write_file / edit_file` 只暴露具名文件事实、标准 diagnostics
与实际替换数量，不把 Markdown edits 或插件内部写入详情穿透到公共结果。

**Evidence header-only 收尾切片已完成**：`assemble_documents / evidence_resolve` 使用工具专属 live
`@app/schemas` 合同；已退役的 `assemble_evidence` 使用独立 `Historical*` schema/projector。三者保持
`NoopToolContent + hideContent`，但历史注册不构成 executable alias。projector 只拥有标题和 admission，
不改变 Deep Search、EvidenceStore、citation 或 subrun trace 语义。header-only baseline 共八项，R-22 关闭。
后续 Evidence facade 简化不在本加固计划夹带，按
[Evidence owner 文档](../../src/domains/evidence/README.md) 的真实任务退出条件推进。

**Citation admission 收尾切片已完成**：旧注册器的跨工具最小 shape 与 subrun 静默 JSON 跳过已删除。
Knowledge、Web、Evidence 按工具名进入各自完整结果 schema；live、reload、subrun 统一执行
`admit → commit → register`。已经退役的 `research_run_writer` 只由 strict historical replay schema
接纳旧事件，不再拥有 live args/output 合同。主消息和 trace 在协议失败时均保持原快照，R-23 关闭。

**非工具消息与最终门禁已完成**：

- `ThoughtMessage` 的 schema 改为 `is_complete` 判别联合；完成态在类型层强制携带
  `thought_completed_at`，组件不再二次推断或抛错。
- `SummaryMessage` 直接消费已判别的 `history_summary | summarization_progress`，未新增重复
  presentation/projector。
- `user_quote` 按既有专题规范恢复严格语义：字段可缺失，存在即 strict admission；Renderer 组件与
  edit-resend 只转换强类型数据，Host HistoryBuilder 不再把非法引用静默降级为无引用。
- `guard:conversation-vue-reactive-boundary` 已接入 pre-commit、CI 与 semantic gate，扫描 Conversation
  生产 `.vue + .ts`；禁止组件恢复 schema parse，并追踪 reactive callback 同步调用的本地函数，阻止
  schema admission 或业务 `throw` 回流 Vue flush。
- `useStreamingWaitingIndicator.ts` 已直接消费 admission 后的判别类型，不再在 computed 内重复解析。
  异步任务进入新的调度栈后自行处理失败；跨文件同步调用仍由 strict input type 与评审约束。

历史追溯：`4ea9a689e` 首次引入结构化引用时同时加入了与“不 fallback”文档相矛盾的
`safeParse → []/undefined`；`27a85cb46` 收紧 metadata 类型后未删除该旧降级，并在 Thought 组件中
新增 reactive `throw`；`042b61a4d` 拆分摘要事实与进度时又在组件 computed 内重复 parse。以上均已
按 admission owner 收口，不保留兼容路径。

业务验收：loading/error 状态不解析 success payload；success 非法 payload 只失败一次且不破坏 Vue 更新；合法历史 reload 与 live 事件得到同一 presentation；协议错误后仍可切换/新建会话。

### 3.3 `Conversation.metadata` 正式合同（历史决策记录，含 workflow 命名更正）

**迁移前基线**：Renderer `Conversation.metadata` 当时承载 `promptKey / projectId / projectName / projectDescription / documentId / documentTitle`，有 conversationState、assistantStore、projectionStore 三层 merge 入口，并存在 camelCase/snake_case 双读与 `as PromptKey`。它已经形成控制面。与此同时，Host SQLite `conversations.metadata` 的生产写入方当时只定义 `mode`，项目归属已有独立 `project_id` 列；两者同名但不是同一个合同，不能为省事合并成一个共享“大 metadata schema”。当前终态见 §3.3.3，不得把本段历史基线当作现行合同。

**可选方案**：

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 给现有六个 key 加 strict object，继续 merge metadata | 改动较小 | 只是把错误所有权合法化，三写入口和 promptKey 隐藏控制面仍在 | 不推荐 |
| 显式 Conversation 字段 + feature owner | 去掉隐藏控制面；project 走 scope/`project_id`；workflow 走 workflow feature；document 走 workspace port | 涉及 store、history DTO 与 reload | **推荐** |
| 保留开放 metadata，增加 key allowlist guard | 能拦新 key | 现有语义分裂不变，类型仍是 unknown | 仅可作迁移期门禁，不是终态 |

推荐终态：Conversation read model 显式表达 `projectId`；workspace 名称/描述/当前文档从 workspace port 派生，不复制进 Conversation。

#### 3.3.1 命名更正：旧 "workflow" 不是 workflow（已完成）

先前草案建议"新增显式 `workflow_id` 合同 + 存储字段 + 列表 DTO"。**该建议已作废**，因为它会把一个错误命名固化进数据库与跨端 DTO。

核实到的事实：

- `agentDefinitionResolver.ts` 中 `promptKey` 的唯一用途是 **agent registry 查找键**（`definition.promptKey === promptKey`）。
- 旧 `ConversationWorkflowDescriptor` 六个字段是 `id / promptKey / menuText / pillText / ariaLabel / iconComponent`——四个 UI 展示字段、一个产品 ID 与一个 agent 查找键，**不含任何步骤或编排语义**。
- PPT / Deep Research 是两个注册的 `AgentDefinition`，靠系统提示词与 skill 约束行为并保留自主权。
- 未来的真 workflow 是可注册、可配置、可执行的显式编排产品；节点可以调用 tool、Agent/subrun 或其它公开能力，与上述机制完全不同。

结论：**旧所谓 workflow 就是 agent 选择，命名占用了未来真编排产品的名字**（同 `task` 治理的同类问题）。规则已固化为 [INV-55](./00-invariants.md#inv-55-workflow-product)，旧表面已删除。

#### 3.3.2 产品决策与终态：持久化选中的 agent

迁移前，Renderer `metadata.promptKey` 没有写入 SQLite，历史列表 DTO 也没有该字段；它只在当前应用进程的 Conversation 状态中保留。用户重启后重新打开 PPT / Deep Research 对话会丢失 agent 选择。

产品决策：**补齐持久化，保存选中的 agent 身份。** 这是明确修复现有缺口，不以错误现状作为产品语义。

当时评估的实施形状如下，最终采用 B：

| 选项 | 内容 | 评价 |
|---|---|---|
| A · 只正名 + 写入 metadata | Renderer 侧 `ConversationWorkflow*` → `ConversationAgentChoice*`，并把 promptKey 新写入 Host `metadata TEXT` | 表面改动较小，但新增 metadata 控制面并固化实现键 |
| B · 正名 + 显式列 | 同时把持久化提升为 `conversations.selected_agent_id`，值是 `AgentDefinition.id` 而非 `promptKey` | **已采用**：同时消除 metadata 控制面并满足 INV-16 / INV-55 |

采用 B 的理由：`promptKey` 是路由实现细节，`agent id` 才是产品身份。终态 selected-agent 路径使用 `findRegisteredAgentDefinitionById` 精确匹配，不接受 `promptKey` 兼容别名。

**实施前核实结果**：旧 Renderer contribution 的选择 ID（`ppt / deep_research /
supplychain`）与 Backend `AgentDefinition.id`（当前分别等于对应 promptKey）不是同一个值，不能把旧
`workflow.id` 机械改名后直接写进 `selected_agent_id`。正确做法是让插件共享层声明正式 agent
identity，Renderer contribution 通过 `agentId` 引用它，Backend `AgentDefinition.id` 复用同一个
定义；否则只是把“Renderer ID → promptKey”的隐式映射改成另一份跨 bundle 字符串重复。

本项因此确属中高风险 vertical slice：它同时跨越 plugin contribution、Renderer 会话选择、请求
路由、SQLite 显式列、历史列表/metadata DTO 与更新 IPC。不能只加数据库列，也不能只正名 UI。

#### 3.3.3 已落地链路与护栏

- **不留 fallback**：Renderer 旧 `metadata.promptKey` 与三处 shape probing 已物理删除；会话请求只发送 `selected_agent_id`（[INV-08](./00-invariants.md#inv-08--无历史兼容主链)）。
- **单一 owner 与写入口**：Conversation read model 只保存 `selectedAgentId`；持久化只保存
  `selected_agent_id`。选择与清空由 agent-choice orchestration 捕获 `conversationId` 后调用专用
  Host mutation，成功后再提交 store；history list 与 metadata reload 直接返回该列，不从消息、
  run 或 metadata 推导。
- **Host 才解析执行键**：Renderer 与插件只传 `selected_agent_id`。Host 在 request admission 后按
  `AgentDefinition.id` 精确查找并取得 `promptKey`；默认会话没有 selected agent 时才选择默认 agent。
  `findByIdOrPromptKey` 不得成为 selected-agent 路径的兼容入口。
- **共享产品身份**：plugin contribution 保留 UI 菜单项自己的 `id`，另以 `agentId` 引用正式
  `AgentDefinition.id`；删除 `promptKey`。内置 Slides / Deep Research 的 Renderer 与 Backend 必须
  复用同一份 agent identity 常量，禁止跨 bundle 重写字符串。
- **原子正式化**：空草稿选择 agent 时，Host 在同一事务内创建 conversation 并写入选择；Renderer 只在 mutation 成功后提交指定 conversation 的 read model。编排在 `await` 前捕获 conversation/project 身份，切换页面不会串写。
- **双 guard 收口**：`guard:conversation-agent-choice-naming` 已收紧为零基线；`guard:conversation-agent-control-plane` 拦截 `metadata.promptKey`、metadata merge/解构与 agent-choice contribution `promptKey`。真正的 tool → subrun workflow、one-shot 与 subrun worker 内部执行键不受影响。

迁移按可独立回退的提交完成：文档决策 → 显式列与持久化 → history reload → 空草稿原子正式化 → Renderer/Host 主链与旧旁路删除 → guard。业务测试覆盖选择/清空、切换期间的身份捕获、history reload、Host unknown/disabled admission、PPT 元素 AI edit 与插件 contribution。

### 3.4 注释型空 catch

当时 AST 复核发现一批“无语句、只有注释”的 catch，分散在 Renderer、Linnkit、插件、解析器与基础设施。其中 JSON.stringify 失败后继续下一数据源、非 JSON 工具原文不提升为结构化结果，属于明确的可忽略分支；另有可选引用日志解析失败时不打印的分支。

**结论**：不升级为“注释 catch 全禁”的全仓红灯。是否应记录/转换/忽略取决于业务语义，静态工具无法仅凭空 block 判断。后续按 domain 修改时随手治理，优先删除仅为 debug 二次解析而存在的 catch；不得为清零数量批量补 `console.warn`。

## 4. 中高风险性价比排序

| 顺序 | 项目 | 收益 | 风险/成本 | 当前动作 |
|---|---|---|---|---|
| — | INV-54 / INV-55 写入不变量总表 | 固化两条规则，为后续实施立规 | 纯文档 | **done** |
| 1 | `activeMessages` / `mergeWindowAndLiveMessages` 移出 throw | 高，直接防已发生过的渲染树失效 | 中 | **done**：双向 admission + reducer 回滚 + semantic/Electron E2E（§3.2） |
| 1.5 | answer durable 终态与陈旧 live partial 优先级 | 中高，防答案 presentation 回退，并删除错误测试合同 | 中低 | **done**：sealed dominance + 双向 seal admission + reducer 回滚（§3.2.1） |
| 2 | `workflow` 命名 guard 基线 | 中，止血：防命名继续扩张 | 低 | **done**：AST + 精确数量棘轮，本地/CI 同口径（§3.3.3） |
| 3 | 正名 + `selected_agent_id` 迁移（选项 B） | 很高，消除三写入口 + metadata 控制面 | 中高 | **done**：显式列/DTO、原子正式化、Renderer/Host 主链、旧旁路物理删除与双 guard（§3.3.2） |
| 4 | 工具 presentation projector 首期与 header-only 切片 | 中高 | 中 | **done**：十六张实体卡、Workspace 五项与 Evidence 三项 header-only 均已完成；项目文档创建由 `write_file` 承接，R-22 关闭 |
| 5 | Runtime identity brand 分期 | 很高，让身份混用编译不过 | 高 | **首期 done**：`RunId + ToolCallId` 同期迁移，外部 raw / 边界 parse / 内部 brand，并由 assertion guard 锁定（§3.1） |
| — | 存量注释型 catch | 低且语义不一 | 批量改反而高风险 | **不立项**；新增 catch 须写明可忽略理由，按语义评审而非按数量 |

排序原则：先纯文档立规，再低成本止血，再有实证故障支撑的实施，最后工程量最大的编译期改造。第 2 项插在第 3 项之前，因为它一天可完成且能防止正名期间命名继续扩张。

## 5. 完成条件

- 所有低风险门禁在本地和 CI 同口径运行。
- parity 新 variant 缺 fixture 时必然失败。
- 中高风险项已有明确 owner、迁移顺序、边界 parse 方案和业务验收矩阵。
- 长期规范已回写权威文档；本文只保留决策与实施记录，不再作为当前合同来源。
