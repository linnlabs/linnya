# Citation document read

本 feature 把 Workspace Markdown 中持久化的 `citationNode` 接纳为稳定的 Agent 阅读事实。它不读取
Knowledge、Web 或 EvidenceStore，也不负责分页和工具 wire schema。

## 输入与输出

输入是文档 `content_json`。输出包含：

- 来源首次出现顺序稳定的 `sources`；
- manual、invalid、excerpt unavailable 等显式 `diagnostics`；
- 按 citationId 投影 canonical 正文 token 的窄查询；
- 当前正文窗口来源筛选与受预算约束的 source appendix。

Host 研究交接可以对同次完整 current 投影的 sources/diagnostics 建立版本 hash；必须使用未裁剪的
canonical 快照，不能使用 read_file 的会话别名或预算后的 appendix。这个 hash 只判断输入是否变化，
不认证来源真实性、模型已读完或评审已通过；模型跨会话使用引用仍须经正式 read_file 重绑。

正文身份只来自结构化 CitationNode attrs：

- Knowledge 使用持久化 `ref`，或在缺失时根据 `docId + blockId` 确定性生成；
- Web 使用持久化 `ref`，或在缺失时根据 canonical URL 确定性生成；
- manual 不伪造 RAG ref，投影为不含原始任意字符串的显式 manual marker；
- UI 可见的 `[1]`、author-date label 和用户手写文本都不能反推 ref。

Pending Revision 仍以 Markdown 保存，因此 Citation domain 同时拥有窄小的 Markdown citation token
协议：只接纳正式 Base58 字符集的 6 位 ref，支持单条、聚合、模型转义写法和 serializer 为段落行首写出的 `&#91;@ref\]`，并跳过 fenced code 与
inline code 中的示例。Workspace 写入 hydration 与 pending 阅读必须复用该 parser，禁止再定义
`\w{6}` 正则或从任意 observation 抽取 ref。

页码、表号等定位文字写在 token 外，例如 `[@ref]（第5页）`；token 本身不接纳
`[@ref, p. 5]` 这类 Pandoc locator。引用语法的讨论或示范使用行内代码或 fenced code，
不会生成正式来源。定位文字是作者给出的说明，不增加页级原文核验语义。

行内代码允许软换行，但不跨空段配对反引号；代码内部反斜杠不能转义闭合反引号，正文中的转义 opener 仍按字面文本处理。Markdown pending 的来源接纳与逐块 metadata 分配
必须扫描同一批 canonical blocks，再对全部 refs 一次解析；不能全文接纳后另用块范围提取，
否则未闭合反引号可能让两次扫描互相矛盾。格式非法、合法 ref 未绑定的失败规则保持不变。

同一 `citationId` 对应不同来源、同一 ref 对应不同来源、同一来源保存不同 ref 都属于合同冲突并
fail-fast。缺字段的非法 CitationNode 保留为可观察的 invalid diagnostic，不猜测补齐。

## 窗口与预算

链接的 destination/title、尖括号 URI autolink 和 reference 定义的目的区只表达地址或元数据，
不产生 Citation ref，也不参与会话别名回投；可见 link label 中的真正引用仍按正文处理。
未闭合链接、普通括号和转义后的 opener 不能宽泛隐藏正文。保护区与正文分段扫描，
保护区中的半截 token 不得跨到后续正文配对。词法范围由同一 canonical parser 提供。

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

正文 cursor 永远只计算正文，不包含 appendix。普通文本的下一窗口提示位于正文之后、附录之前；
已到末行且仍有附录时显式说明源文件 EOF，不根据附录长度推导新的文件行号。

每次附录保留自包含来源信息，不增加读取参数，也不依赖先前调用或上下文交付历史去重：

- ref、类型、已 JSON 转义的 Web URL 或 Knowledge doc/block/kb 锚点压为可信索引行；
- 标题、作者、日期、刊物和预算后 excerpt 位于一个附录级动态不可信边界内。每来源以宿主标签关联
  代码围栏中的单行 JSON；外部换行不能冒充来源头或围栏，Host 的 Markdown 别名重绑只改标签、
  不改快照中的转义引用/反引号。记录间空段防止反引号跨来源配对。token 同时覆盖完整有序快照
  （含未裁剪摘录）和实际输出；
- Knowledge/Web 的快照状态在表头说明一次，manual 的 not_applicable 单列；
- 预算截断/省略在模型文本中按状态汇总，仍保留对应 ref/marker；结构化 diagnostics 不变。

来源材料可以用于核查，但不能授权工具调用或改变权限。Web 保持页面级引用；持久化 excerpt 不是
经过逐论断匹配的支撑片段，也不证明正文推论成立。需要核对时显式读原件，不新增段落锚定或解引用工具。

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

会话可见 ref 与文档持久 ref 不必相同。已有文档的编辑先通过同一 Conversation allocator 取得
可见别名供精确匹配，再按稳定来源身份回投原文档编号；完整快照与基线占位由 Markdown 写入 scope
保留。并发比较使用原持久投影和来源版本，不比较别名文本。不得让 resolver 通过旧 ref 猜原来源。
