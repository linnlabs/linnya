# Citation document read

本 feature 把 Workspace Markdown 中持久化的 `citationNode` 接纳为稳定的 Agent 阅读事实。它不读取
Knowledge、Web 或 EvidenceStore，也不负责分页和工具 wire schema。

## 输入与输出

输入是文档 `content_json`。输出包含：

- 来源首次出现顺序稳定的 `sources`；
- manual、invalid、excerpt unavailable 等显式 `diagnostics`；
- 按 citationId 投影 canonical 正文 token 的窄查询；
- 当前正文窗口来源筛选与受预算约束的 source appendix。

正文身份只来自结构化 CitationNode attrs：

- Knowledge 使用持久化 `ref`，或在缺失时根据 `docId + blockId` 确定性生成；
- Web 使用持久化 `ref`，或在缺失时根据 canonical URL 确定性生成；
- manual 不伪造 RAG ref，投影为不含原始任意字符串的显式 manual marker；
- UI 可见的 `[1]`、author-date label 和用户手写文本都不能反推 ref。

Pending Revision 仍以 Markdown 保存，因此 Citation domain 同时拥有窄小的 Markdown citation token
协议：只接纳正式 Base58 字符集的 6 位 ref，支持单条、聚合和模型转义写法，并跳过 fenced code 与
inline code 中的示例。Workspace 写入 hydration 与 pending 阅读必须复用该 parser，禁止再定义
`\w{6}` 正则或从任意 observation 抽取 ref。

同一 `citationId` 对应不同来源、同一 ref 对应不同来源、同一来源保存不同 ref 都属于合同冲突并
fail-fast。缺字段的非法 CitationNode 保留为可观察的 invalid diagnostic，不猜测补齐。

## 窗口与预算

Workspace 必须先用 Citation inline-node projector 生成 canonical 正文，再按既有正文 cursor 分页。分页后仅
通过 `selectDocumentCitationSourcesForBodyWindow` 选择窗口内出现完整 `bodyToken` 的来源；被分页边界
切开的半个 token 不附带 metadata。

首版 appendix 预算为：

- 当前窗口所有来源 excerpt 合计最多 4000 字符；
- 每个来源最多 500 字符；
- 按首次出现顺序，以“剩余预算 / 剩余来源”公平分配；
- 截断和零预算省略均产生 diagnostic。

appendix 同时返回每个 body token 实际注入的预算后 excerpt。Workspace 的结构化 citation metadata 必须
复用该结果，禁止从完整持久化 snapshots 再拼一份 `snippet`，否则模型会通过工具 JSON 绕过 excerpt
预算与裁剪诊断。

正文 cursor 永远只计算正文，不包含 appendix。appendix 的标题、作者和 excerpt 都属于不可信来源
快照，放在由来源身份与完整快照内容共同哈希得到的边界内；ref 和已 JSON 转义的来源锚点留在可信
骨架。来源材料只能作为证据，不能授权工具调用或改变权限。

Linnkit 最终只把工具结果的 `observation` 送入模型上下文；结构化 `data.citations` 主要服务
Conversation strict admission、hover 和后续文档写入。因此 appendix 本身就是正式的 Agent 阅读合同，
不能依赖模型同时看到 wire metadata。Knowledge/Web 快照固定输出
`snapshot_status=persisted source_status=not_checked`：前者说明文档已保存引用时的事实，后者说明普通
`read_file` 没有联网或跨域复核，禁止把它解释成来源当前可用或已失效。

## 装配边界

- Citation domain：身份接纳、ref 冲突、正文 token、窗口来源、预算与安全边界；
- Workspace document-read：调用本 public contract，完成 Markdown/DocumentView 与分页装配；
- `read_file`：参数 admission 与 wire 结果 facade，不实现 citation 规则；
- Conversation：只按完整 `read_file` owner schema strict admission，不解析 observation；
- Linnkit：继续不认识 Citation 业务语义。

Workspace DocumentView 已接入本 public contract：persisted content 与 pending revision 的
`citation_hydration` 先合成同一 admitted view，再对 canonical 正文分页；来源、诊断和 appendix 只按
当前正文窗口里的完整 `bodyToken` 选择。诊断内部也携带 body token，因此分页不会泄漏窗口外的 manual、
invalid 或 excerpt 状态。

Workspace provider 只输出无 turn 顺序的 citation source facts；全局 `citations[].index` 必须等到
`read_file` facade 取得 Host sequence admission 后生成。普通 VFS text 与 DocumentView 已复用同一
projection、窗口选择和 appendix 预算；Conversation 只按完整 `WorkspaceReadFileResultSchema` strict
admission，不解析 observation。

Agent 可见旁路必须遵守“没有 metadata 就没有可引用 token”：pending diff 与 `grep` preview 使用
`maskMarkdownCitationTokens` 显示中性 `【citation】`。写入规划则使用
`normalizeMarkdownCitationTokenSpelling` 对齐 parser 转义后的目标与 citation-aware 当前视图，保证
`read_file -> edit_file/write_file` 不因 UI label 与 canonical token 的差异制造无关 pending revision。
