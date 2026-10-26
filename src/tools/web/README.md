# Web Search / Web Read（联网能力）开发指南

本 README 是 **web_search + web_read** 的长期开发指南与规范（协议、边界、关键路径、验收/回归点）。
历史上的“方案/计划”文档已合并到这里，避免双份来源长期漂移。

Electron 隐藏渲染窗的生命周期与网络准入见[本地网页渲染](../../electron-main/web-render/README.md)。

---

## 1. 范围与边界（必须遵守）

### 1.1 本阶段做什么

- **web_search**：联网搜索（多 provider 可替换），输出结构化 citations，支持 `[@ref]` 引用体系与 hover/导出。
- **web_read**：按确定 URL 读取页面正文。默认只使用本地 HTTP → 按需 Electron JS 渲染；用户可在“网络搜索”设置的“第三方网页解析”中主动配置秘塔/Jina。
- **历史 Resource wrapper**：`resource_read(http/https)` 已退出 live runtime；旧事件仍由 strict schema 与 Renderer replay projector 接纳，不再作为 Agent 心智。
- **统一证据接入**：`web_search` / 网页读取成功时都通过 `WebEvidenceWriter` 窄 port 交付 Web 自有 capture DTO；Host 组合层映射为 Evidence command。同 URL 从搜索摘要升级为页面正文后，Resolver 优先回放完整正文。
- **开发 CLI**：可通过临时开关调用同一搜索/读取工具，默认关闭。开关和普通搜索限制归 Conversation Control，不进入 Web 实现；使用说明见 [CLI 工具入口](../../../apps/linnya-cli/README.md#31-调用工具)。

### 1.2 本阶段不做什么（与深度 KB 检索解耦）

- **不把 Web 混入知识库 `deep_search` Agent**：知识库组装强依赖 KB SoT（`docId/blockId`），Web 使用独立的网页组装合同。
- **不恢复旧 Deep Research**：网页深搜由独立内部 `deep_web_search` 提供；知识库 `deep_search` 的两次限额和块语义保持不变。
- **不做浏览器自动化与反爬伪装**：不引入 Playwright/Puppeteer，不开放点击、表单、登录态或多标签动作。唯一例外是复用 Electron 自带 Chromium 的隐藏渲染窗，只执行页面自身 JS 并读取最终 DOM，用于正文抽取。
- **不新增 `web_crawl`**：agent 默认用 `web_read` 逐页读取、观察链接后再决定是否继续。专用站点爬取工具延后至 Shell 落地且出现真实批量需求后评估。

---

## 2. 核心协议（引用体系对齐）

### 2.1 StructuredToolResult

所有工具输出必须是 JSON 字符串，结构为：

- `data`：供持久化、审计和后续业务流程消费的结构化事实；Renderer 只在 admission 边界从正式字段派生 presentation
- `observation`：给模型使用（必须包含 `[@ref]`）

通用定义见 `src/tools/types.ts`；`web_search` 与网页读取的参数/结果合同分别由
`packages/schemas/src/tools/web-search.ts`、`packages/schemas/src/tools/web-read.ts` 唯一拥有。直接
live `web_read` 使用 canonical 结果 shape。历史 `resource_read(http/https)` wrapper 只增加 `uri/source`，由独立 replay schema 接纳。工具执行入口与返回前、Renderer live/reload admission 使用严格 owner schema；Vue 卡片不读取 raw `args/result`，也不从 observation 恢复引用。
cache 状态、失败分类与读取升级原因由 `packages/schemas/src/tools/web-common.ts` 统一定义，Provider、读取阶梯和展示结果不得各自复制枚举。

### 2.2 稳定短引用 `[@ref]`（硬约束）

- 引用 token 是 **稳定短引用** `[@XXXXXX]`（6 位），不是“结果编号”。
- citations 每条 **必须**包含 `ref`；缺 ref 必须暴露数据源问题（禁止前端兜底推断）。
- ref 由 Citation domain 的 Conversation 级 allocator 分配；Web 只提交规范化 canonical URL，禁止维护工具调用内的局部 `used Set` 或扫描历史。
- **编号连续**：Linnya host 在每个 Web/Knowledge producer 执行前，通过 Citation domain 按当前 turn 的 working history 绑定生产顺序，令 `citations[].index` 连续递增。

相关：`src/domains/citation/README.md`

---

## 3. 数据模型（SearchResultCitation）

`@app/schemas` 里的 `SearchResultCitation` 通过 `sourceType` 区分来源（至少包含 `knowledge_base` / `web` / `manual` / `conversation_turn`）。

### 3.1 Web 引用最小字段集合

Web citation 至少需要：

- `sourceType: 'web'`
- `url`（规范化 canonical URL，作为编辑器 `sourceId`）
- `docTitle`（标题）
- `snippet`（短片段）

> 中文备注：字段必须“显式可判别”，禁止通过“是否存在 docId/blockId”去猜来源类型。

---

## 4. 后端实现：web_search

生产搜索服务由独立 Web Search 配置显式选择，产品默认是无需 Key 的 Parallel Free。当前支持 Parallel Free、DuckDuckGo、SearXNG、百度千帆、Serper、Jina Search 与 Tavily；四个需要凭据的服务均使用本机 BYOK/env，Jina/Tavily 注册后可使用其官方免费额度。每次请求只调用当前选中的一个搜索服务，失败、限流或缺凭证时显式报错，不会静默换家。若未来要引入自动 failover，必须另行定义失败子集、重试预算、计费与结果语义，不能在 factory 内补一个宽泛 fallback。

搜索在同一次缓存/in-flight 取得内，对明确的 `timeout/network_error/rate_limited/http_5xx`
最多退避重试一次；250ms 起；已知 `Retry-After` 不超过 1s 且剩余预算容纳时完整等待，超过则保留原失败、不提前补发。两次尝试、Parallel MCP
初始化及等待共享 60s 总预算和父取消信号，不新增工具调用身份，不切换供应商。GET adapter 同样不裁短已知 `Retry-After`，超过其 1s 退避上限或剩余预算则不补发；
已报告用过一次重试时不叠加外层循环。403/验证码、认证、策略、DNS、无效结构及仅有 MCP
`-32000` 的错误均不据此重试；同样的错误码不保证瞬态，不能从供应商文案猜测。
失败记录已知 HTTP/RPC 数值状态、阶段、尝试及重试次数；补发成功后才写一次引用/Evidence，
失败不缓存，也不写成功 Evidence。共享查询的等待者保持各自的取消语义。

`WebSearchResultSchema` 约束 query、结果数量、Evidence bundle、cache 状态与 Web citation 判别联合。
citation 的 ref、canonical URL 必须唯一，index 必须从当前 execution 的 citation offset 起连续增长；
这些是正式搜索事实，不由 Renderer 补造或纠正。presentation projector 只映射已接纳 citation 的标题、
链接、摘要与发布时间，并保存延迟本地化标题。

### 网页 Deep Search

`web_search` 的 `deep_search` 默认为 false。true 时内部 `deep_web_search` 继承父模型，
保持可选，不强制研究任务调用；简单检索仍使用默认浅搜。内部运行使用 30 个 Graph 步预算，在搜索候选、读取、补查与筛选之间迭代；不新增用户可选 Agent。
内部白名单仅含 `search_web`（无深搜参数）、`web_read`、`tool_output_read` 和
`assemble_web_sources`，不能递归深搜。两种搜索入口复用 `runShallowWebSearch`，不会引入第二套抓取器。

`web_search` 是普通 Agent 的唯一网页搜索入口；`search_web` 只向内部深搜 child 暴露，
不是供父 Agent 选择的第二个搜索工具。它的严格参数合同不接受 `deep_search`，父子名单在
模型工具目录和执行准入两处生效。保留这个窄入口是为了从能力边界阻止递归；不能仅隐藏参数、
仍让内部 child 通过普通 `web_search` 启动另一个深搜。历史审计按真实工具名分别记录，
分析搜索供应商故障时可合并两者，但仍保留父子角色及深浅层次。

深浅搜索返回同一套 `data.query / resultCount / citations / evidence_store`，父 Agent 可继续
按 URL 调用 `web_read`。深搜仅追加 `search_strategy / subrun_ids / research`，后者保存简短总结、
每个 ref 的用途与取得限制、冲突线索及缺口。浅搜独有的 cacheStatus 在深搜不伪造；历史浅搜结果
无需补字段。用途、总结、冲突与缺口属于模型判断，不是系统验证。

组装参数只有选中的 ref、短用途、总结、冲突和缺口，不接受模型提供的 URL、标题或原文摘录。
工具从当前 child 正式取得结果回填网页列表与最多 800 字符的原文短摘要；完整快照留在 Evidence，
不再次消耗生成 token。每个 ref 绑定最后一次成功取得的 call / bundle，校验精确快照，不能调用
默认的“最完整版本”解析来掩盖版本差异。摘要、空正文、失败与截断分别保留；后续失败不会抹掉
先前取得事实，也不会被先前成功掩盖。来源数量只受 top_k 上限约束，不要求凑满。

这里的 `truncated` 描述来源读取时的截断，不描述最终 800 字符摘要的覆盖范围；
`page_content + truncated=false` 不表示父 Agent 收到了完整正文。当前短摘要固定从正文开头截取，
后段关键数字或条件可能未交接；完整快照仍保存。父任务对核心来源应按返回 URL 继续读取并核对
版本，不能用子任务已读取的事实代替自身取得关键段落。保持深浅搜索的同一网页结果结构，
不要为此恢复模型抄写长摘录或默认回传全文。模型 observation 明示这是正文前缀预览，
将读取截断标为 `source_read_truncated` 并提示关键证据继续 `web_read`；JSON 结果结构不变。

资料注释的输出预算为用途 300、总结 1200、单条冲突/缺口 500 字符。工具说明要求模型写得
更短；超过展示预算时只缩短模型注释，并返回 `notes_truncated`。这不是来源核验降级：
ref、取得版本、URL 和自动回填的原文摘要仍严格校验。因说明超长反复拒绝整包会浪费生成
预算，因此展示预算不承担来源 admission 的职责。模型输入仍有单字段 10000 字符上限。

正常组装必须发生搜索；有候选须至少尝试读取。没有候选或都不可读时可返回带限制的空结果。
只有成功组装工具是业务产物，不解析自由文本终答。`resultToolName` 映射到框架的结果提取入口，
结束 control 只用于执行，历史事件仅保存业务结果。

每个父 run 最多启动四次；Host admission 事务按 parent run 与 Agent 身份计数，与 descriptor
写入同事务。进入 child 后失败也占额度；同 tool call 恢复读取原 child，不再启动或扣额。
第五次明确返回 shallow + deep_search_limit 并执行普通搜索；已启动的深搜失败不得静默降级，
取消向上传播。知识库的两次限制没有变更。

测试涵盖真实子 Graph 与 localhost 上游、实际 Evidence 回填、伪造身份拒绝、空正文/失败、
截断、SQLite 并发限额与恢复、父工具失败/取消以及同一投影器实时与历史接纳。
真实能力对照使用 Benchmark 的 `web_search_materials_v1`；完成、成本和材料质量分别报告，
不得从数量或耗时推断深搜优势。

### 4.1 目录结构

```
src/tools/web/websearch/
├── index.ts
├── WebSearchTool.ts
├── SearchWebTool.ts                 # deep child 的浅搜索入口
├── orchestration/
│   ├── runShallowWebSearch.ts
│   └── searchWithCache.ts
├── deep/
│   ├── AssembleWebSourcesTool.ts
│   ├── orchestration/
│   ├── functions/
│   └── ports/                       # Web 域只接收 Host 投影的采集事实
├── functions/
│   ├── buildWebSearchObservation.ts
│   └── createSearchResults.ts
├── citations/
│   └── normalizeUrl.ts
└── providers/
    ├── types.ts
    ├── factory.ts
    ├── baiduQianfan.ts
    ├── serper.ts
    ├── parallelFree.ts
    ├── duckDuckGo.ts
    ├── searxng.ts
    ├── jina.ts
    └── tavily.ts

src/tools/web/webread/
├── index.ts
├── WebReadTool.ts
├── definitions/
│   ├── readLadder.ts
│   └── webReadConfig.ts
├── functions/
│   ├── assessWebReadQuality.ts
│   ├── buildWebReadObservation.ts
│   ├── createWebReadResult.ts
│   ├── normalizeWebReadConfig.ts
│   ├── projectActiveWebReadConfig.ts
│   └── resolveWebReadConfigUpdate.ts
├── extraction/
│   ├── extractArticle.ts
│   ├── extractPageResources.ts
│   ├── extractSemanticDom.ts
│   ├── parseCanonicalHtmlDocument.ts
│   ├── prepareReadableDocument.ts
│   └── renderReadableMarkdown.ts
├── orchestration/
│   ├── readLadder.ts
│   ├── readWithCache.ts
│   └── readWebPage.ts
└── providers/
    ├── types.ts
    ├── factory.ts
    ├── metaso.ts
    ├── jina.ts
    ├── localHttp.ts
    └── localRender.ts

src/tools/web/shared/
├── cache/
│   ├── adapters/
│   ├── definitions/
│   ├── functions/
│   ├── orchestration/
│   └── ports/
├── definitions/
│   └── webEvidenceCapture.ts
├── orchestration/
│   └── webEvidenceWriterContext.ts
├── ports/
│   └── webEvidenceWriter.ts
├── observation/
│   └── untrustedWebContent.ts
├── urlPolicy.ts
└── webFailure.ts

src/tools/web/definitions/
├── searchResult.ts
└── webDocument.ts

src/infra/adapters/web-http/
└── webHttpFetch.ts

src/infra/adapters/web-read/
├── metasoReaderAdapter.ts
└── jinaReaderAdapter.ts

src/infra/adapters/web-fetch/
└── localHttpFetchAdapter.ts
```

### 4.2 搜索服务目录与凭据边界

搜索引擎不是模型 Provider。服务地址、环境变量名和展示身份由
`websearch/definitions/webSearchService.ts` 统一拥有；用户选择与加密 BYOK 槽位由
`config/web_search.json` 拥有。工厂只把当前显式配置投影为一次搜索请求，不查询 Model Catalog、
Provider Catalog 或 AI SDK registry。

当前没有 Linnya Cloud 搜索产品入口。历史入口依赖 `/v1/models` 中的 Web 伪模型，但生产目录已经不再发布该条目，客户端入口也因此删除。未来若提供 Cloud 搜索，必须新增 Web-owned 公共服务目录、Web 代理身份头和额度资源；允许共享设备身份/额度基础设施，禁止重新使用 `ModelConfig`、`X-Linnya-Model` 或模型 Provider 身份。

### 4.3 URL 规范化与 ref 分配（必须单一真源）

- URL 规范化：`src/tools/web/websearch/citations/normalizeUrl.ts`
- ref 分配：`src/domains/citation/features/reference/`

约束：

- Web producer 先按 **规范化后的 canonical URL** 去重结果，再把 URL 批量提交给 `CitationRefAllocatorPort`；
- 同 URL 在同一 Conversation 的 `web_search → web_read` 以及后续 turn 中复用同一 ref；
- 不同 URL 的 6 位候选碰撞时，由 Citation domain 在 Host 原子 claim 事务内递增 salt；Web 不感知 attempt、claim store 或 SQLite。

### 4.4 搜索结果的不可信内容隔离

- `web_search` observation 中，`[Result]`、`[@ref]` 和 canonical URL 是可信引用骨架，必须留在隔离边界外。
- 供应商返回的 title/snippet 属于不可信外部内容，每条结果分别用 `BEGIN/END_UNTRUSTED_WEB_CONTENT` 边界包裹；伪造 ref 即使出现在摘要里，也只能留在不可信块内。
- 同次搜索的边界 token 由全部 title/snippet 的 SHA-256 内容哈希确定性派生，所有结果共享该 token；安全声明在 observation 顶部和尾部各出现一次。
- `web_search` 与 `web_read` 必须复用 `shared/observation/untrustedWebContent.ts` 的边界格式与安全措辞，禁止各自手写。
- 空结果不生成隔离块，保持 `No web search results found...` 合同。

---

## 5. 后端实现：web_read

网页读取目标：通过本地 HTTP、Electron 自带 Chromium 的受限 JS 渲染和用户可选的第三方网页解析，提供“按 URL 读取网页正文”的能力，输出可被模型引用的正文文本，并复用现有 `[@ref]` 引用体系与 UI Popover。新用户默认仅使用前两层；第三方 Provider 只在用户主动配置后、且本机解析失败或质量不足时惰性创建。

普通 Agent 的正式入口是 `web_read`。`WebReadTool` 是参数适配薄壳，直接调用
`webread/orchestration/readWebPage.ts`；禁止通过实例化另一个工具类复用业务逻辑。

### 5.1 目录结构

```
src/tools/web/webread/
├── index.ts
├── WebReadTool.ts
├── definitions/
│   ├── readLadder.ts
│   └── webReadConfig.ts
├── extraction/
│   └── extractArticle.ts
├── functions/
│   ├── assessWebReadQuality.ts
│   ├── buildWebReadObservation.ts
│   └── createWebReadResult.ts
├── orchestration/
│   ├── readLadder.ts
│   ├── readWithCache.ts
│   └── readWebPage.ts
├── providers/
│   ├── types.ts
│   ├── factory.ts
│   ├── metaso.ts
│   ├── jina.ts
│   ├── localHttp.ts
│   └── localRender.ts
└── ports/
    ├── webPageRenderer.ts
    └── webReadConfigReader.ts
```

### 5.2 显式读取配置与 Provider 选择

产品配置入口与搜索配置合并在设置页“网络搜索”Tab，但读取仍持久化到 AppData 的独立 `config/web_read.json`，并使用独立 gateway/IPC 合同；同页展示不代表两份配置共同保存。Key 由 Desktop 与 CLI 共用的系统 keyring master key 加密，不进入工作区导出；新版 Desktop 会在各配置文件自己的事务内重包旧 `safeStorage` 密文。Reader 的服务地址与环境变量名由 Web Read 自己的静态服务定义拥有，不查询 Model Catalog，也不注册模型或模型 Provider。

- `LocalHttpProvider` 是固定的生产首跳，不依赖 Model Catalog 或外部凭证
- 新用户默认关闭“第三方网页解析”开关，对应配置值 `none`；已有配置文件保持用户原选择，不迁移覆盖。开关打开后可选择秘塔或 Jina，工厂按显式 `serviceId` 创建所选 Reader
- 两个 Reader 分槽保存 BYOK；有效凭证优先级是已保存 Key → 所选 Reader 自己声明的环境变量，Renderer 永不拿到明文
- 一次读取开始时只捕获一次 `WebReadConfig` 快照；Provider 选路、渲染开关和缓存身份共享该快照
- 工厂只在阶梯真正需要托管时创建；本地正文合格时，缺 Key 或选择 `none` 都不影响成功返回
- `none` 下本机无法提取完整正文时统一返回 `managed_disabled`，并保留首跳失败类型、升级原因和是否尝试渲染；不静默发送网页地址，也不尝试第三家
- Jina 根端点由 Web Read 服务定义直接声明，模型目录的 URL 归一化与 adapter 逻辑不参与网页读取
- R2 已启用三层生产阶梯：本地 HTTP 合格即返回；JS 壳、没有可用正式资源的空正文、质量信号、`network_error`、单跳 `timeout` 与 DOM 规范化失败按需调用一次本地 Chromium；正文为空但已捕获正式资源的 `metadata_only` 是终态，不重复升级；渲染仍不合格或渲染能力失败才调用一次托管兜底。canonical DOM 上的 Readability 异常会跳过机械渲染，直接进入已配置的托管 Reader。整条阶梯 90 秒总预算触发的 `timeout` 仍是终态
- `text/html` 先由 Cheerio 默认的 WHATWG `parse5` tree builder 规范化成唯一 `html/head/body`，再创建轻量 linkedom DOM；禁止用正则、站点白名单或手工移动第二个 body 修复 tag soup
- HTML 抽取先用 Readability；失败或明显遗漏时，从 `article/main/[role=main]` 的可访问主区域补取正文，并过滤导航、侧栏、页脚和隐藏节点。Readability 抛错但语义正文已存在时保留正文并记录 warning；完全无正文且没有可用正式资源时才产生 `empty_content` 失败
- 没有语义主区域且文章抽取不足时，可选择 `tabular_dom` 窄视图：只保留清理后的叶子数据表（有表头至少两行独立数值、无表头至少三行），保留原行列、空单元格、caption/summary 和显式关联说明，再附已选正文中的表外说明。布局表、空骨架和导航不因原 HTML 表格行数多而获得正文资格；空内容与 JS 壳仍执行质量升级。Readability 残表只有全部数据行对应同一已捕获表时才去掉，不凭共同表头删掉另一张表。不回退整个 body，也不承诺恢复全页脚注或尚未加载的数据
- 主区域选择与内容表达分离：Readability 选中的 HTML 与语义主区域共用 Turndown 转换为 Markdown，保留来源链接、代码缩进、有序列表、删除线、图注与图片 alt。质量判定使用可见文字长度，避免链接地址和标记抬高质量信号
- 两条路径在选区前共用隐藏节点/内联隐藏样式清理。先移除导航、脚本与 inert 区域，再识别同一主区域内可见、可用按钮声明的折叠正文：`aria-expanded=false` 配合 `aria-controls` 的明确目标，或 read/show-more 命名的按钮与相邻同类命名正文（允许仅包裹按钮的一层容器）。只移除该目标层的隐藏状态，其内部独立隐藏的旧值仍排除；不按域名匹配，不点击控件、不执行额外脚本，也不凭单个类名恢复任意隐藏内容。未识别的折叠方式仍可能遗漏，`truncated=false` 只表示未触及字符上限，不承诺正文完整
- HTML 相对链接依据最终 URL 与有效 base URL 还原，只保留符合既有同步 URL 策略的地址；链接出现不代表目标已读取，后续请求仍须完整校验 DNS 和连接
- 表格保留精简 HTML 中的空单元格、caption、rowspan/colspan 和表头关联属性；不展开跨度、不猜测会计口径。保留的 HTML 删除事件、样式等非内容属性。静态抽取不承诺解析外部样式表的完整可见性或理解图片里的数字
- 同一安全 GET 通过 Accept 优先请求来源站点的 Markdown；按实际 Content-Type 分流，不额外请求或自动换 Provider。原生 Markdown 保留来源表示（包括相对链接），不伪造未取得的标题/日期元数据；HTML 不支持协商时继续走原抽取链
- GitHub `blob` 地址在本地 HTTP 首跳自动转换为 `raw.githubusercontent.com`，转换后的域名仍完整执行 URL/DNS 校验与 IP 钉扎；`web_read` 读取 HTML/文本，并在独立 30 MiB 单文件上限内保存通过类型检查的 PDF/CSV/XLSX 原文件（网页正文仍为 5 MiB，会话文件总量 50 MiB），解析交给 Shell（见下节）
- 本地抓取每一跳都做 URL/DNS 校验，并用已校验 IP 建立连接；禁止改回 fetch 自动重定向
- 当前读取路由可观察边界是 `failureKind`、`initialFailureKind`、`initialFailureStage`、`escalationReason` 和 `renderAttempted`；失败日志还会记录状态码、响应 MIME、最终 URL、重定向数、请求尝试次数和重试次数（不记录响应正文）。`initialFailureStage` 仅用于 `dom_canonicalization/readability` 抽取阶段。尚未记录每一跳 DNS 解析地址、代理 fake-IP 判定或 DNS/连接分段耗时，不得从现有日志推断这些事实
- 兼容 TUN 代理 fake-IP：仅域名 DNS 结果允许 `198.18/15`，字面 fake-IP、内网地址及混入内网地址的解析结果仍拒绝
- `WebPageRenderer` port 由 Electron main 显式注入 backend bundle；渲染 worker/runtime 禁止进入 backend bundle。默认渲染 provider 只在质量信号命中后惰性创建
- 缓存路由身份 version 9 包含渲染开关和选中 Reader，并使旧表格遗漏、旧纯文本抽取、旧 Accept 策略及误删折叠正文的缓存自然 miss；同一路由固定请求表示偏好，条件请求仅复用该路由记录的 validator 和正文。开关渲染或切换 Reader 自然 miss，只替换 Key 不强制 miss

### 5.3 与 citations 的关系（V1：页级引用先行）

硬约束：

- 一次 `web_read` 调用产出 **1 条 citation**（页面级），`index = 本次 host 绑定的 offset + 1`
- `observation` 必须包含 `[@ref]` 和本次实际捕获的不可信网页正文；工具自身不做第二套摘录，超长结果统一交给 Linnkit observation governance 与 ToolOutputStore
- `ref` 复用 Conversation allocator（来源是 canonical URL）：
  - URL 规范化：`src/tools/web/websearch/citations/normalizeUrl.ts`
  - ref 分配：`src/domains/citation/features/reference/`

实现参考：

- tool：`src/tools/web/webread/WebReadTool.ts`
- provider：`src/tools/web/webread/providers/metaso.ts`
- infra adapter：`src/infra/adapters/web-read/metasoReaderAdapter.ts`

### 5.4 返回结构（要点）

- Provider 统一返回 `WebReadResult`：保留原始 URL 与最终 URL，并携带抽取器、渲染模式、正文哈希、质量信号和耗时；未知质量分不填充虚假默认值
- 搜索 Provider 统一返回 `SearchResult`：在 Provider 边界完成排名、canonical URL 与调用观测映射，工具层只做去重、引用与 Evidence 物化
- 失败分类统一由 `shared/webFailure.ts` 维护；质量不足不是终态失败，M2 只能依据该文件导出的升级子集和独立质量原因决定是否升级。访问挑战由 `shared/webAccessChallenge.ts` 统一判定：厂商公开文档定义的响应头优先，AWS WAF `x-amzn-waf-action: challenge|captcha`（通常分别配 202/405）与 Cloudflare `cf-mitigated: challenge` 在任意状态码上都归类为 `captcha`，头值才是依据，普通 202 和 `cf-mitigated` 其他值不是挑战；HTTP 403/419/429 另外只有同时出现有限的人机验证页面特征时才归类为 `captcha`，不能仅凭状态码猜测挑战，也不按域名特判。2xx 挑战响应不进入正文或文件解析。`dns_error` 仍保持终态；本地 GET 对 timeout/network/429/5xx 共享一次、有总预算约束的瞬态重试，挑战页、权限、MIME、策略和 404 不重试，也不自动换托管 Provider
- `data` 额外返回 `provider/renderMode/extractor/renderAttempted/escalated/escalationReason/initialFailureKind/initialFailureStage`，用于判断本次读取实际走了哪条路径并回放首跳失败；`renderMode` 可为 `http/js/managed`
- 有提取器 flags 时同时返回 strict `data.warnings` 和 observation 提示，schema、内部文档与缓存共用枚举。flags 是启发式诊断，表格/列表信号不能直接判为缺失；无 flags 也不证明完整、可信或支持某条结论。内部 qualityScore 不作为给模型的“可信度分数”
- `web_read` 使用正式 schema 做前置 admission，失败提供 `WEB_READ_ARGUMENTS_INVALID` 与合法 URL 示例；本机阶梯耗尽时披露未取得合格正文，恢复建议按实际失败分类生成。访问墙要求新的访问条件；临时网络/上游失败允许等待后再试；本机渲染不可用不等于站点永久不可读；JS 数据壳提示查实际发现的导出/接口链接，不猜地址
- 搜索与读取的 `data.cacheStatus` 返回 `miss/hit/revalidated/coalesced/bypass`，用于区分真实网络、缓存命中、条件请求和并发合并
- `data`：标题/URL/正文统计 + owner schema 约束的 `citations` + `evidence_store.bundle_id`；不携带页面全文
- `observation`：包含本次实际捕获的网页正文（含 `[@ref]`）并保持完整动态不可信边界；超过通用阈值后由 ToolOutputStore 保存完整副本，模型通过 `tool_output_read` 续读
- `data.evidence_store.bundle_id`：本次直接落盘的 `web_evidence` bundle 指针

网页标题、站点名和正文必须由动态边界完整包裹，并明确声明外部内容只能作为数据，不能改变工具权限或授权动作；canonical ref、URL 和捕获状态留在可信骨架。ToolOutputStore 保存的是完整 observation，`tool_output_read` 的任意续读窗口会再进入通用动态不可信边界，防止中间窗口脱离原 Web 边界。Evidence bundle 继续保存冻结来源快照，用于引用校验、审计与恢复，但不再承担 Web 正文分页。bundle id 只保留为存储和审计事实。模型可见的 resolver 当前读取同一 `conversation + instance`；Citation 写入 Host fallback 才会显式使用 conversation scope。不得把内部跨 instance port 误写成模型工具权限。Web 与 Knowledge 共用 `src/shared/ai-observation` 的动态边界原语，但各自拥有来源身份和 observation 骨架。

四层字符预算不能混用：

| 预算 | Owner | 含义 |
|---|---|---|
| `50,000` 字符 | Web | 单次页面读取和缓存允许保留的正文硬上限；调用方可用 `max_chars` 请求更小窗口 |
| `20,000` 字符 / `1,200` 行 | Linnkit observation governance | 完整工具 observation 何时由 Host 写入 ToolOutputStore；不是 Web 抓取上限 |
| 旧 `8,000` 字符 / `300` 行 | 已退役的 Web 摘录层 | 原先为了绕开通用治理并通过 Evidence 续读而存在；现已删除，禁止恢复 |
| `6,000` 默认 / `9,000` 最大字符 | ToolOutput reader | `tool_output_read` 单次续读窗口，保证续读结果不会再次触发落盘套娃 |

> 中文备注：web_read 读取到的是网页正文（最多 50,000 字符，调用方也可请求更小上限），不是 web_search 的 snippet。

### 5.4 原文件取得与 Shell 解析

PDF、CSV、XLSX 通过同一安全 GET 取得，限额内自动保存到会话物理目录；CSV 保留直接文本视图，PDF/XLSX 不假造正文。Web 只调用物化窄 port，Host 绑定会话生命周期，文件 IO 在 infra adapter。`data.file` 记录实际 URL、时间、字节数、hash 与相对路径，Citation 快照保留文件身份，页码由作者核对后在正文注明。完整合同、配额、类型检查与限制见 [原文件取得](./webread/file-acquisition/README.md)。

### 5.5 本机与增强解析策略

目标：普通页面由本地安全 GET + Readability/语义 DOM 处理，质量不足时按需渲染；只有用户主动配置后，最后才交给第三方增强解析 Provider：

- **infra adapter**：负责 HTTP、鉴权、响应解析（unknown + 类型守卫），并在本地 GET 边界执行一次有界瞬态重试
- 网络异常与上游瞬态响应都必须先释放本次 dispatcher，再退避 / 重试；退避不重置总 deadline，取消后不得发送下一次请求。
- **provider**：负责把供应商响应映射成内部统一 `WebReadResult`
- **functions**：负责可解释的质量信号判定；不按黑盒分数阈值偷偷改变路由
- **orchestration**：负责 HTTP→Chromium→托管三层选择、90 秒总预算、截断、`[@ref]`、observation 与 Evidence 物化
- **tool facade**：只负责入口参数适配；历史 Resource dispatcher 不承载新的 Web 行为

Firecrawl `/scrape` 可在未来作为新的 BYOK 第三方网页解析 Provider 接入，与秘塔/Jina 同级；它不是零配置免费能力，也不改变 Linnya 默认的本地读取链路。当前不实现 `web_crawl`；若未来重新评估，多页编排仍必须与单页 `/scrape` 分开设计。

Electron 本地渲染是“外网页不进入产品窗口”原则的唯一例外：隐藏窗无 preload，启用 sandbox/contextIsolation/webSecurity、禁用 Node 集成；独立 session 拒绝权限、弹窗、下载、跨注册域导航和内网/回环子请求。每次任务拿到 HTML 后立即销毁远程页面，manager 只复用隔离 session，并限制并发与 idle 生命周期。DOM 提取不再固定等待一个不可解释的时长，也不再以 load 事件为前提：从主框架 DOM 就绪起，按可见正文稳定性、`document.readyState` 与页面 xhr/fetch 是否结束轮询，并受既有加载、渲染阶段与总墙钟上限约束；前端应用壳空白稳定不算就绪，在预算内仍未渲染出正文时报告 `app_shell_not_rendered`，Web 映射为 `js_required` 并在诊断中保留 `render=app_shell_not_rendered`，建议改查该页实际提供的原件、导出文件或接口链接（规则见[本地网页渲染](../../electron-main/web-render/README.md)）；该能力只返回 HTML/finalUrl 与主框架实际响应的状态码及挑战判定所需头，不暴露浏览器动作或 IPC 桥。主文档响应头命中访问挑战时，在正文交给页面前取消该响应并以 `access_challenge` 结束，挑战脚本不执行；`LocalRenderProvider` 仍按同一 Web 规则复核并归类为 `captcha`，渲染端的停止只是安全动作，不是分类来源。

#### 5.5.1 正文抽取器合同与差分验证

当前生产 baseline 是 `linnya_readability_semantic`：同一份 canonical HTML 先经过隐藏内容和安全链接准备，再分别生成 Readability 与 semantic DOM 候选，最后按可解释规则选择一个结果。`extractArticle` 同时返回内部 diagnostics（候选长度、候选数量、最终选择和 Readability 是否成功）；diagnostics 只供测试、审计和候选抽取器比较，不进入 WebRead 的模型可见可信字段，也不能被解释成来源可靠性分数。

未来引入新的正文抽取器时，必须实现同一内部 adapter 合同，并在同一份已取得 HTML 上与 baseline 做差分。候选抽取器不得自行联网、执行浏览器动作或写入 Evidence；读取、缓存、引用和证据仍由 Web Read orchestration 统一拥有。只有固定断言显示关键正文、表格、脚注、代码和来源链接的保留率稳定改善，才可考虑改变生产默认路径。

#### 5.5.2 Landing page 与页面资源

网页不都属于文章。报告、论文和技术资料经常使用 landing page：摘要在页面上，完整内容、DOI 或正式来源通过页面链接提供。正文抽取与页面资源提取必须分开：

- `extractArticle` 从原始 DOM 读取 JSON-LD 与 citation meta，再从清理后的可见主体读取少量、有语义信号的 `document`、`doi`、`source` 资源；导航、侧栏、页脚和隐藏链接不进入资源集合，也不会访问这些链接；`schema.org/sameAs` 只表示实体同一性，不直接视为来源资源；页面 `<base href>` 同时用于正文链接和资源地址解析；
- Readability/semantic DOM 只决定模型看到的正文；资源不会因为正文清理删除而丢失；
- `WebDocument.resources` 由 Web Read provider 传递，经 `@app/schemas` 严格校验、文件缓存持久化，并在 observation 的动态不可信边界内展示；
- 资源 URL 是页面外部内容，不是用户授权或可信操作指令。Renderer 或 Agent 若要读取它，必须重新经过 `web_read` 的 URL 策略和 Evidence 流程；
- 当前只识别显式 DOI、全文/下载语义、常见文献仓库/正式来源链接。不要把页面所有链接暴露为“相关资源”，也不要在没有固定断言的情况下引入站点专用规则。
- 如果正文抽取为空但页面仍提供标题、摘要或正式资源，Provider 返回成功结果并带 `metadata_only` flag；这表示“已取得页面元数据/资源，未取得正文”，不会伪装成正文成功，也不会反复升级同一 URL。没有资源的空页面仍按 `empty_content` 进入读取阶梯。
- 短正文/质量不足进入后续读取后失败，保留此前实际发现的文件与数据资源：最多 8 条、总计约 6,000 字符（标签最多 200 字符，过长 URL 跳过而不截成新地址），全部放入失败消息的动态不可信边界。CSV/TSV 及明确的下载数据链接也可作为资源；不自动下载、换来源、分配目标 ref 或写成功 Evidence，失败不进入正文缓存。总预算 timeout 仍可交付这些线索，调用者取消不附恢复链接，策略拒绝不附资源。

这一层吸收了成熟正文抽取器“正文与 metadata 独立”的经验，但不把候选库的正文选择逻辑整体移入生产。landing page 的后续扩展应先以标题、摘要、作者、日期、DOI、全文链接和正式来源链接的冻结断言验证，再决定是否新增页面角色。

### 5.6 缓存与并发边界

- 查询缓存 key = 规范化 query + provider + topK + recency；正文缓存 key = canonical URL + 阶梯版本 + provider 序列，`contentHash` 保存在值中，不参与首次查找
- 生产使用 `<workspace-root>/WebCache/v1` 下按 key 分文件的持久缓存；测试通过 `WebCachePort` 注入内存实现，不依赖 Electron 或 SQLite native ABI
- URL 过期且上游提供 validator 时发送 ETag/Last-Modified 条件请求；304 必须有 stale 正文才能复用
- 原文件只参加调用期 in-flight，不保存到公共正文缓存；每个会话分别物化受控副本。
- in-flight 只共享 Provider/读取阶梯的纯结果；citation、observation 与调用级正文裁剪仍按每次调用生成
- Evidence 并发合并必须同时满足 conversation、instance、turn 和 parent tool-call 相同，禁止跨 artifact scope 共享
- 调用方取消互相隔离；失败工作不留在 in-flight map 中，后续请求可以正常重试

`WebSearchTool`、`SearchWebTool` 和 `WebReadTool` 构造器接受各自 orchestration 的依赖合同，
供 Host composition 装配 Provider、Evidence writer 与缓存。无参构造保留现有默认路径；
注入首跳 Provider 且未传缓存时，每个工具实例保留自己的内存缓存。需要跨实例共享缓存的
composition 必须显式传同一 `cacheRuntime`。`WebReadTool` 原样传递读取配置及
`renderProvider` / `managedProvider`：`undefined` 延续默认选路，`null` 明确关闭对应阶梯。
仅替换首跳 Provider 不代表关闭其他读取路径，也不构成运行隔离。

### 5.7 与统一证据系统的关系

- Web 层只拥有 `WebEvidenceCaptureItem` 和 `WebEvidenceWriter`，不依赖 Evidence DTO、bundle 存储或 concrete writer
- `src/app-hosts/linnya/adapters/tools/webEvidenceWriterToolContextDecorator.ts` 是唯一的 Web → Evidence 字段映射和 conversation scope 注入点
- `web_search`：每条结果会保存为 `capture_kind='web_search_result'` 的 web evidence
- `web_read`：正文读取保存 `capture_kind='web_page'`；原文件取得保存 `web_file` 身份说明，不能当作已读 PDF 正文
- `web_read` observation 提交本次完整捕获正文；超出通用阈值时由 ToolOutputStore 保存，模型通过 `tool_output_read` 分页
- EvidenceStore 保存独立的冻结来源快照，用于 ref 校验、审计与 Citation fallback；不参与 Web 正文分页
- Deep Research 协作文档通过 Workspace citation hydration 保留引用；已退役的 Writer/Evidence snapshot 特殊链不得恢复

### 5.8 与 deep_research 的关系（边界）

- Default 与 `research_v1` 父子角色都使用同一 Web 合同；网页深搜只承担资料搜集，不替父 Agent 作综合判断。研究编排由 Agent Registry 与普通 subagent 拥有，不进入 Web owner。
- 旧 `deep_research` 不属于本次调用链，不恢复 Scout/Challenger/Writer 或其私有证据链。知识库深搜仍独立维护。

### 5.9 逐步探索与 bash 边界

- agent 的默认网页工作流是“搜索或读一页 → 根据正文和链接决定下一页 → 再调用 `web_read`”，不要求预先猜测域名深度、页数与停止条件。
- bash 上线后可用 `curl`/`wget`/脚本处理 sitemap、API 文档等明确批量场景，但命令行请求不会经过 Web 域的 `urlPolicy`、DNS/SSRF 防护、正文质量 gate 或 Evidence 写入。
- Shell 输出不会自动获得 `[@ref]`、Web citation 或 Evidence 回放能力。需要引用的页面仍应走 `web_read`，或由未来明确的窄 port 完成物化，禁止从任意命令输出猜造 Evidence。
- bash 的网络隔离、文件系统隔离、进程权限与资源预算属于 bash 自身安全模型，不能复用“Web 已经安全”这一结论。

### 5.10 失败内容与工具错误码

- HTTP 失败的 `bodyText`、`statusText`，以及供应商 JSON / MCP 错误中的 `message/detail` 都是不可信外部内容，不能拼入工具异常、observation、RuntimeEvent、审计或日志。错误文案由 Web owner 的固定模板与数值状态生成；成功网页正文仍走现有动态不可信边界。
- 挑战页识别只在 HTTP 响应边界读取响应头与有限正文，错误对象仅保留 `challengeSignal`（`aws_waf_challenge/aws_waf_captcha/cloudflare_challenge/page_marker`），不携带 `bodyPreview` 或原始头值。重试与读取阶梯复用该判定；阶段包装把 HTTP 状态提升到顶层后，已确认的挑战信号仍先于 403/404 状态归类，不能为删正文或补诊断而丢失 captcha 分类或改变升级规则。诊断以 `challenge=<signal>` 展示信号，恢复建议明确工具不执行或绕过验证。
- `WebHttpError` 通过既有分类函数暴露只读 `code`，`WebFailureError.code` 通常与 `kind` 一致；唯一例外是 `kind=managed_disabled` 且结构化根因已确定为 `captcha/http_403/login_required`，此时 code 保留该访问拦截根因。读取阶梯与诊断仍保留 `managed_disabled`，不改变升级/重试规则；Host ToolRegistry 只转交通用错误合同，不理解 Web 枚举。运行时的 `errorKind=execution` 与 owner 的 `error_code` 分别保留，不能互相覆盖。
- 无内容失败不能写成功 Evidence；401 不因错误文案或状态码而自动交给第三方 Reader。错误安全不新增 fallback、审计开关或新的导出协议。
- 安全诊断统一由 `shared/webFailure.ts` 投影：保留实际执行阶段（search/local_http/local_render/managed_reader/read_ladder）、已知首跳/前跳 kind、抽取阶段、本地渲染具体 kind、HTTP/RPC 数值状态及尝试次数。另保留已知 Retry-After 毫秒值、重试停止原因（非瞬态/次数已用尽/等待超限/预算不足）、超限或正文下载超时时实际已收字节、上限及声明 Content-Length、是否已尝试本机渲染（`render_attempted`）、质量不足时实际取得的正文字符数（`extracted_chars`），以及本地渲染主框架加载失败的 Chromium 数值错误码（`net_error`）和脚本/样式表下载失败次数与首个合法错误名（`subresource_failures`、`subresource_error`）。声明长度可能对应压缩传输，不能当完整解压大小。模型收到的持久工具错误附同源诊断；后端日志复用同一投影，不要求 Audit 开启，也不从正文复原字段。`max_chars` 不扩大下载预算。
- 本地渲染主框架加载失败（`load_failed`）按 Chromium 错误码归类：`-20`（本地 URL/DNS 准入拦截）为 `policy_denied`；`≤ -100`（连接、TLS、证书、HTTP 协议、DNS）为 `network_error`，建议说明站点或本机网络路径问题；其余（如 `-3` 导航中止）仍为渲染能力失败。应用壳未渲染或 DOM 未就绪时若有脚本/样式表下载失败，建议改为网络或站点暂时问题，不再断言重复读取无效。
- XHR/fetch 的传输失败另以 `data_request_failures` 与首个合法 `data_request_error` 进入同一安全诊断；仅计本次渲染已发出的请求，排除主动中止、成功、重复或迟到的终态。它与脚本/样式表计数分开，不记录 URL、正文或任意错误文案，不把 HTTP 错误响应或应用解析错误当成传输失败。应用壳未渲染或 DOM 加载超时时，建议披露数据请求失败并允许稍后重试，不再断言重复读取无效，也不据此认定正文缺失的原因。该事实不改变失败 kind、读取阶梯、自动重试或成功正文的接纳规则。
- `managed_disabled` 标题只陈述“本机网页读取未取得合格正文（原因）”，不把第三方增强读取暗示为访问拦截或网络失败的补救；“当前未配置第三方增强读取”只在质量类建议中作为中性事实出现。质量不足（正文过短、模板/表格/列表为主）仍是失败：建议报告实际字数与是否已渲染，并在动态不可信边界内附本次已取得正文中最长一份的前 1000 字，明确它不是可引用来源，不写 Evidence、诊断或日志；页面已取得但无可读正文时单独说明，不附摘录。
- `managed_disabled` 仍表示配置终态，不伪装成另一种读取策略；其诊断可以说明例如 `local_render + unavailable` 或 `render_process_gone`，供 Agent/维护者分清网页、抽取与渲染能力问题。没有可核根因时保留 `provider_error + stage`，不假装已定因。
- 删除 `previousFailureMessage` 任意文案传递；Chromium/供应商原始异常文字、message/detail/body、凭据与 URL 查询参数不进入新诊断。MIME 只保留合法类型，URL 去用户信息/查询/fragment。网络日志同样不再序列化原始 cause 链。
- 失败消息只例外展示这次已捕获的有界资源链接，并使用与成功内容相同的动态不可信边界；它们不进入安全诊断/日志。HTTP 错误正文仍不返回，也不从挑战页推导资源。


### 5.11 同主机访问拦截反馈

- `web_read` 确认遇到验证码（含响应头识别的访问挑战）、HTTP 403 或登录墙时，通过 Host 注入的 `WebReadAccessHistoryPort` 读取当前会话（含 child）已完成的 `web_read` 事实。仅统计请求 URL 的精确 hostname；不合并子域、不从正文或重定向猜域名。
- 提示“已确认访问拦截 N 次、成功返回 N 次”，当前失败计入一次。计数单位是 `(runId, toolCallId)` 的已完成工具调用，不是网络尝试；恢复同一调用不会重复计数。成功返回也不代表取得完整正文。
- 超时、取消、一般 Provider 错误、抽取失败不算访问拦截。历史 `managed_disabled` 或缺少 error_code 的失败单列为“根因未分类”，不从旧错误文案猜成验证码，也不回填成零次拦截。
- 反馈建议寻找其他主机的官方副本或可核的替代来源；已有的“搜索同一来源的可读 HTML”引导已移除。没有禁止同主机新页面，没有新增自动重试、域名黑名单或路由变化。
- Host 从 EventStore 的正式 decision/output 窄投影派生，不另存计数、不依赖可关闭的 Audit。查询只在这类实际失败后执行；SQLite 先筛 conversation/tool，再逐行返回调用参数及终态，不向 Node 读取网页正文、其他工具参数或 observation。聚合按调用身份流式进行，内存不随正文或调用数增长。并发结果只包含查询时已持久化的完成事实；当前失败另加一次，不承诺同时执行调用之间的强序。
- 重载沿用事实；删除/截断后只统计剩余事实。缺少 Host port 的独立 Web 基准继续返回原错误，不伪造会话历史。缓存/in-flight 共享原始取得结果，会话提示在调用侧生成，不写入共享错误对象。
- 404 还可查询同一 Host port 的 `hasObservedUrl`，仅核对当前会话及 child 成功 Web 搜索/读取的正式来源、资源和受管文件地址，复用 canonical URL 规则；排除当前调用，不扫描任意正文或模型请求。未命中只说明正式记录未收录，普通正文链接不一定进入资源集合，不能据此断言地址编造。提示先用 `site:` 定位实际页面；没有该能力时不宣称地址未出现。

增强读取的离线评估只能比较已取得 HTML 及现有夹具的抽取效果。失败 URL 清单、403 或验证码页没有被拦住的正文，不能据此声称某个付费 Reader 能恢复；本修复不重抓历史 URL、不启用第三方服务，也不改变凭证或配置。


---

## 6. 前端：引用依赖投影与 hover

### 6.1 引用接纳与消息依赖闭包

`tool_output status==='success'` 时先进入 Citation domain 的 Conversation admission：

- 公共 owner：`src/domains/citation/features/conversation-presentation/`
- Renderer 薄适配：`apps/renderer/domains/conversation/features/citation-presentation/`
- durable closure：`src/app-hosts/linnya/adapters/persistence/event-store/ui-projection/citationDependencies.ts`

约束：

- citation producer 必须走 toolName 白名单和自己的完整 strict schema；
- 结构不符合合同时投影失败，禁止猜字段、吞错或空数组降级；
- live / Subrun 使用 projection-owned workspace，durable window 返回 message dependency sidecar；
- 接纳后使用完整 `ConversationCitation`，保留作者数组、刊名和日期；搜索 producer 的
  `author/siteName` 只在 Citation 边界转换一次，读回文档的完整快照不降成搜索摘要结构；
- hover、复制和另存只读消息 snapshot，不存在全局 citationStore、TTL 或跨 Conversation fallback。

### 6.2 Popover（Web/KB 分支渲染）

组件：`apps/renderer/domains/conversation/ui/message/components/citation/ConversationCitationPopover.vue`

- Web：标题 + 域名/作者/日期 + snippet + “打开原网页”
- KB：标题 + 页码（如有）+ snippet

---

## 7. 导出到编辑器（复制/另存）——已完成

目标：对话侧 Web 引用水合为编辑器 `CitationNode`：

- `data-source-type="web"`
- `data-source-id="{canonical_url}"`
- `data-url="{canonical_url}"`
- 已取得的完整 `data-authors`、`data-container-title`、`data-date`；Knowledge 来源同时保留 `data-kb-id`

实现：

- 水合：`apps/renderer/domains/conversation/features/citation-presentation/functions/projectConversationCitationsToEditorHtml.ts`
- 复制：`apps/renderer/domains/conversation/ui/tools/knowledge/clipboard/richClipboardActions.ts`
- 另存：`apps/renderer/domains/conversation/ui/tools/knowledge/export/saveTurnAnswerAsDocument.ts`

编辑器节点：`apps/renderer/domains/editor/features/citation/nodes/CitationNode.ts`。
富复制与另存共用同一完整来源投影；显示首作者或域名不改变保存的元数据。

---

## 8. 验收与回归

当以下条件成立时，可将“联网能力（web_search + web_read）”判定为本阶段已完成：

- `web_search` 在普通对话链路可稳定使用（引用依赖投影、hover 展示、复制/另存水合可用）
- `web_read` 在普通对话链路可稳定使用（正文读取、引用依赖投影、工具卡片展示可用）
- 核心默认 Agent 与需要网页正文的插件只暴露 canonical `web_read`；历史 Resource wrapper 不再指导新调用
- Web HTTP deadline、取消、响应体上限、URL 字面地址策略和结构化失败分类均有确定性测试
- 本地真实 HTTP 上游能贯通 adapter → provider → `web_read` → Evidence 回放
- 关键回归测试通过（至少覆盖 Web 引用水合与会话侧 dependency closure 链路）

相关测试（已落地）：

- `src/infra/adapters/web-http/webHttpFetch.test.ts`
- `src/tools/web/shared/urlPolicy.test.ts`
- `src/tools/web/__tests__/webBusiness.integration.test.ts`
- `src/tools/web/__tests__/webSearchRetry.integration.test.ts`（localhost 瞬态、共享取得、取消、预算与终态）
- `src/tools/web/__tests__/webFailureDiagnostics.integration.test.ts`（渲染前因和安全诊断）
- `src/tools/web/__tests__/webEvidenceStore.test.ts`
- `src/tools/web/__tests__/webEvidenceWriterPort.test.ts`
- `src/tools/web/__tests__/webEvidenceBoundary.test.ts`
- `src/tools/web/__tests__/jinaReaderProvider.integration.test.ts`
- `src/tools/web/__tests__/extractArticle.test.ts`
- `src/tools/web/__tests__/localHttpProvider.integration.test.ts`
- `src/tools/web/__tests__/webCacheInfrastructure.test.ts`
- `src/tools/web/__tests__/webCacheBusiness.integration.test.ts`
- `src/infra/adapters/web-fetch/localHttpFetchAdapter.test.ts`
- `src/tools/web/shared/webAccessChallenge.test.ts`（厂商挑战响应头与正文标记判定）
- `apps/renderer/domains/conversation/ui/tools/webread/functions/projectWebReadPresentation.test.ts`（仅历史 Resource Web 事件回放）
- `scripts/benchmark/web-reliability/statistics.test.ts`
- `scripts/benchmark/web-reliability/read-evaluation.test.ts`
- `apps/renderer/domains/conversation/services/messageProjection/helpers/knowledgeCitations.spec.ts`
- `apps/renderer/domains/conversation/ui/tools/knowledge/clipboard/hydrateKnowledgeCitationsToEditorCitationMarks.spec.ts`

不纳入本次验收：浏览器交互式检索、用户侧独立“深度研究”入口、旧 Deep Research 的恢复。

---

## 9. 产品与扩展边界

网页深搜由现有 `web_search` 参数进入；内部工具白名单是递归和能力范围的实际边界。
父 Agent 可继续读取资料、补充普通搜索和完成研究文章。未来若增加联网权限开关，应在
请求作用域收缩已注册工具集合，不在 Web owner 恢复多角色研究编排。

浏览器自动化与新的用户入口仍需独立设计；没有承诺启动面板、默认联网状态或新的研究 Agent。

---

## 10. 关键代码参考路径（速查）

日常验证优先运行 `pnpm run test:web:e2e`：它只使用 localhost 真实 HTTP 夹具，覆盖搜索、读取阶梯、缓存、Evidence 与 canonical `web_read`，不需要 Electron 或供应商凭证。`pnpm run test:web` 额外覆盖全部 Web 规则/adapter 测试。真实网络只通过 `benchmark:web:live`（搜索 smoke）和 `benchmark:web:read-live`（生产读取阶梯兼容）按需运行。

读取基准中的 `codeBlockMarkupPresent/tableMarkupPresent` 只表示格式标记存在，不是内容正确率。冻结来源的 `contentAssertions` 可以核对来源链接、代码缩进、作废文字以及表格行/列顺序和跨度；Node 与 Electron runner 均记录 `contentChecks`。`checked=0` 是未验证，任何已声明断言失败都不能记内容核验通过；断言通过也只覆盖这些局部事实。普通表格与合并表格、默认 Readability 与 semantic_dom 两条路径必须分别有确定性回归。

独立 Node 基准通过 `scripts/benchmark/web-reliability/createWebBenchmarkContext.ts` 装配单次 producer 的 Citation sequence、正式分配规则的内存测试 store 与 Host Evidence writer；Evidence 写入临时 workspace 后从 domain 公开接口回放。它不模拟用户对话数据库的持久分配，也不能省略必需的 Host admission 后把装配失败统计成站点失败。

- **Citation 顺序与 host admission**：`src/domains/citation/README.md`
- **StructuredToolResult**：`src/tools/types.ts`
- **WebSearchTool**：`src/tools/web/websearch/WebSearchTool.ts`
- **WebReadTool**：`src/tools/web/webread/WebReadTool.ts`
- **网页读取编排**：`src/tools/web/webread/orchestration/readWebPage.ts`
- **URL 安全策略**：`src/tools/web/shared/urlPolicy.ts`
- **统一 Web HTTP**：`src/infra/adapters/web-http/webHttpFetch.ts`
- **真实 Provider 可靠性 runner**：`scripts/benchmark/web-reliability/runner.ts`
- **生产读取阶梯 live runner**：`scripts/benchmark/web-reliability/read-runner.ts`（默认：`WEB_LIVE_TEST=1 pnpm run benchmark:web:read-live -- --managed metaso`；显式三路比较：`--managed all`）
- **Conversation 引用投影**：`src/domains/citation/conversation-presentation.ts`
- **Renderer message snapshot**：`apps/renderer/domains/conversation/features/citation-presentation/`
- **Popover**：`apps/renderer/domains/conversation/ui/message/components/citation/ConversationCitationPopover.vue`
- **编辑器 CitationMark**：`apps/renderer/domains/editor/features/citation/marks/CitationMark.ts`
