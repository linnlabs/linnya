# Web Search / Web Read（联网能力）开发指南

本 README 是 **web_search + web_read** 的长期开发指南与规范（协议、边界、关键路径、验收/回归点）。
历史上的“方案/计划”文档已合并到这里，避免双份来源长期漂移。

相关文档：

- [`docs/联网搜索与网页抓取调研.md`](./docs/联网搜索与网页抓取调研.md)：对比 Hermes Agent、Codex 与 Linnya 当前实现，说明费用来源和能力边界。
- [`docs/webupdate_plan.md`](./docs/webupdate_plan.md)：Web 升级实施计划、逐文件施工清单、端到端业务测试与 SLO。

---

## 1. 范围与边界（必须遵守）

### 1.1 本阶段做什么

- **web_search**：联网搜索（多 provider 可替换），输出结构化 citations，支持 `[@ref]` 引用体系与 hover/导出。
- **web_read**：按确定 URL 读取页面正文。默认只使用本地 HTTP → 按需 Electron JS 渲染；用户可在“网络搜索”设置的“第三方网页解析”中主动配置秘塔/Jina。
- **历史 Resource wrapper**：`resource_read(http/https)` 已退出 live runtime；旧事件仍由 strict schema 与 Renderer replay projector 接纳，不再作为 Agent 心智。
- **统一证据接入**：`web_search` / 网页读取成功时都通过 `WebEvidenceWriter` 窄 port 交付 Web 自有 capture DTO；Host 组合层映射为 Evidence command。同 URL 从搜索摘要升级为页面正文后，Resolver 优先回放完整正文。

### 1.2 本阶段不做什么（与深度 KB 检索解耦）

- **不把 Web 混入 deep_search**：deep_search 强依赖 KB SoT（`docId/blockId`），Web URL 语义不兼容。
- **不默认让 deep_research 联网**：深度研究是否允许联网属于产品/交互决策（见第 9 节“未来方向”）。
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

`WebSearchResultSchema` 约束 query、结果数量、Evidence bundle、cache 状态与 Web citation 判别联合。
citation 的 ref、canonical URL 必须唯一，index 必须从当前 execution 的 citation offset 起连续增长；
这些是正式搜索事实，不由 Renderer 补造或纠正。presentation projector 只映射已接纳 citation 的标题、
链接、摘要与发布时间，并保存延迟本地化标题。

### 4.1 目录结构

```
src/tools/web/websearch/
├── index.ts
├── WebSearchTool.ts
├── orchestration/
│   └── searchWithCache.ts
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
│   └── extractArticle.ts
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

产品配置入口与搜索配置合并在设置页“网络搜索”Tab，但读取仍持久化到 AppData 的独立 `config/web_read.json`，并使用独立 gateway/IPC 合同；同页展示不代表两份配置共同保存。Key 由 Electron `safeStorage` 加密，不进入工作区导出。Reader 的服务地址与环境变量名由 Web Read 自己的静态服务定义拥有，不查询 Model Catalog，也不注册模型或模型 Provider。

- `LocalHttpProvider` 是固定的生产首跳，不依赖 Model Catalog 或外部凭证
- 新用户默认关闭“第三方网页解析”开关，对应配置值 `none`；已有配置文件保持用户原选择，不迁移覆盖。开关打开后可选择秘塔或 Jina，工厂按显式 `serviceId` 创建所选 Reader
- 两个 Reader 分槽保存 BYOK；有效凭证优先级是已保存 Key → 所选 Reader 自己声明的环境变量，Renderer 永不拿到明文
- 一次读取开始时只捕获一次 `WebReadConfig` 快照；Provider 选路、渲染开关和缓存身份共享该快照
- 工厂只在阶梯真正需要托管时创建；本地正文合格时，缺 Key 或选择 `none` 都不影响成功返回
- `none` 下本机无法提取完整正文时统一返回 `managed_disabled`，并保留首跳失败类型、升级原因和是否尝试渲染；不静默发送网页地址，也不尝试第三家
- Jina 根端点由 Web Read 服务定义直接声明，模型目录的 URL 归一化与 adapter 逻辑不参与网页读取
- R2 已启用三层生产阶梯：本地 HTTP 合格即返回；JS 壳、空正文、质量信号、`network_error`、单跳 `timeout` 与 DOM 规范化失败按需调用一次本地 Chromium；渲染仍不合格或渲染能力失败才调用一次托管兜底。canonical DOM 上的 Readability 异常会跳过机械渲染，直接进入已配置的托管 Reader。整条阶梯 90 秒总预算触发的 `timeout` 仍是终态
- `text/html` 先由 Cheerio 默认的 WHATWG `parse5` tree builder 规范化成唯一 `html/head/body`，再创建轻量 linkedom DOM；禁止用正则、站点白名单或手工移动第二个 body 修复 tag soup
- HTML 抽取先用 Readability；失败或明显遗漏时，从 `article/main/[role=main]` 的可访问主区域补取正文，并过滤导航、侧栏、页脚和隐藏节点。Readability 抛错但语义正文已存在时保留正文并记录 warning，完全无正文时才产生 `extraction_error`
- GitHub `blob` 地址在本地 HTTP 首跳自动转换为 `raw.githubusercontent.com`，转换后的域名仍完整执行 URL/DNS 校验与 IP 钉扎；`web_read` 只读取 HTML/文本，不支持 PDF，实际响应为 `application/pdf` 时返回明确的 `unsupported_mime` 错误
- 本地抓取每一跳都做 URL/DNS 校验，并用已校验 IP 建立连接；禁止改回 fetch 自动重定向
- 当前读取路由可观察边界是 `failureKind`、`initialFailureKind`、`initialFailureStage`、`escalationReason` 和 `renderAttempted`；`initialFailureStage` 仅用于 `dom_canonicalization/readability` 抽取阶段。尚未记录每一跳 DNS 解析地址、代理 fake-IP 判定或 DNS/连接分段耗时，不得从现有日志推断这些事实
- 兼容 TUN 代理 fake-IP：仅域名 DNS 结果允许 `198.18/15`，字面 fake-IP、内网地址及混入内网地址的解析结果仍拒绝
- `WebPageRenderer` port 由 Electron main 显式注入 backend bundle；渲染 worker/runtime 禁止进入 backend bundle。默认渲染 provider 只在质量信号命中后惰性创建
- 缓存路由身份 version 4 包含渲染开关和选中 Reader，并使旧 DOM 抽取算法缓存自然 miss；开关渲染或切换 Reader 自然 miss，只替换 Key 不强制 miss

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
- 失败分类统一由 `shared/webFailure.ts` 维护；质量不足不是终态失败，M2 只能依据该文件导出的升级子集和独立质量原因决定是否升级。`dns_error` 与 `http_5xx` 仍保持终态，不因本机 DNS 失败而自动把 URL 交给第三方，也不对上游 5xx 做隐式换路或重试
- `data` 额外返回 `provider/renderMode/extractor/renderAttempted/escalated/escalationReason/initialFailureKind/initialFailureStage`，用于判断本次读取实际走了哪条路径并回放首跳失败；`renderMode` 可为 `http/js/managed`
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

### 5.5 本机与增强解析策略

目标：普通页面由本地安全 GET + Readability/语义 DOM 处理，质量不足时按需渲染；只有用户主动配置后，最后才交给第三方增强解析 Provider：

- **infra adapter**：负责 HTTP、鉴权、响应解析（unknown + 类型守卫）
- **provider**：负责把供应商响应映射成内部统一 `WebReadResult`
- **functions**：负责可解释的质量信号判定；不按黑盒分数阈值偷偷改变路由
- **orchestration**：负责 HTTP→Chromium→托管三层选择、90 秒总预算、截断、`[@ref]`、observation 与 Evidence 物化
- **tool facade**：只负责入口参数适配；历史 Resource dispatcher 不承载新的 Web 行为

Firecrawl `/scrape` 可在未来作为新的 BYOK 第三方网页解析 Provider 接入，与秘塔/Jina 同级；它不是零配置免费能力，也不改变 Linnya 默认的本地读取链路。当前不实现 `web_crawl`；若未来重新评估，多页编排仍必须与单页 `/scrape` 分开设计。

Electron 本地渲染是“外网页不进入产品窗口”原则的唯一例外：隐藏窗无 preload，启用 sandbox/contextIsolation/webSecurity、禁用 Node 集成；独立 session 拒绝权限、弹窗、下载、跨 hostname 导航和内网/回环子请求。每次任务拿到 HTML 后立即销毁远程页面，manager 只复用隔离 session，并限制并发与 idle 生命周期。该能力只返回 HTML/finalUrl，不暴露浏览器动作或 IPC 桥。

### 5.6 缓存与并发边界

- 查询缓存 key = 规范化 query + provider + topK + recency；正文缓存 key = canonical URL + 阶梯版本 + provider 序列，`contentHash` 保存在值中，不参与首次查找
- 生产使用 `<workspace-root>/WebCache/v1` 下按 key 分文件的持久缓存；测试通过 `WebCachePort` 注入内存实现，不依赖 Electron 或 SQLite native ABI
- URL 过期且上游提供 validator 时发送 ETag/Last-Modified 条件请求；304 必须有 stale 正文才能复用
- in-flight 只共享 Provider/读取阶梯的纯结果；citation、observation 与调用级正文裁剪仍按每次调用生成
- Evidence 并发合并必须同时满足 conversation、instance、turn 和 parent tool-call 相同，禁止跨 artifact scope 共享
- 调用方取消互相隔离；失败工作不留在 in-flight map 中，后续请求可以正常重试

### 5.7 与统一证据系统的关系

- Web 层只拥有 `WebEvidenceCaptureItem` 和 `WebEvidenceWriter`，不依赖 Evidence DTO、bundle 存储或 concrete writer
- `src/app-hosts/linnya/adapters/tools/webEvidenceWriterToolContextDecorator.ts` 是唯一的 Web → Evidence 字段映射和 conversation scope 注入点
- `web_search`：每条结果会保存为 `capture_kind='web_search_result'` 的 web evidence
- `web_read`：读取成功后会保存 `capture_kind='web_page'` 的页面正文 evidence
- `web_read` observation 提交本次完整捕获正文；超出通用阈值时由 ToolOutputStore 保存，模型通过 `tool_output_read` 分页
- EvidenceStore 保存独立的冻结来源快照，用于 ref 校验、审计与 Citation fallback；不参与 Web 正文分页
- Deep Research 协作文档通过 Workspace citation hydration 保留引用；已退役的 Writer/Evidence snapshot 特殊链不得恢复

### 5.8 与 deep_research 的关系（边界）

- 本阶段：普通对话/普通 agent 通过 `web_read` 读取 Web，deep_research 默认仍 KB-only。
- 若后续让 deep_research 使用 Web，应复用现有 Web citation、Evidence 自动捕获与 Workspace CitationMark，不恢复 Writer 私有链。

### 5.9 逐步探索与 bash 边界

- agent 的默认网页工作流是“搜索或读一页 → 根据正文和链接决定下一页 → 再调用 `web_read`”，不要求预先猜测域名深度、页数与停止条件。
- bash 上线后可用 `curl`/`wget`/脚本处理 sitemap、API 文档等明确批量场景，但命令行请求不会经过 Web 域的 `urlPolicy`、DNS/SSRF 防护、正文质量 gate 或 Evidence 写入。
- Shell 输出不会自动获得 `[@ref]`、Web citation 或 Evidence 回放能力。需要引用的页面仍应走 `web_read`，或由未来明确的窄 port 完成物化，禁止从任意命令输出猜造 Evidence。
- bash 的网络隔离、文件系统隔离、进程权限与资源预算属于 bash 自身安全模型，不能复用“Web 已经安全”这一结论。

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
- hover、复制和另存只读消息 snapshot，不存在全局 citationStore、TTL 或跨 Conversation fallback。

### 6.2 Popover（Web/KB 分支渲染）

组件：`apps/renderer/domains/conversation/ui/message/components/citation/ConversationCitationPopover.vue`

- Web：标题 + 域名/作者/日期 + snippet + “打开原网页”
- KB：标题 + 页码（如有）+ snippet

---

## 7. 导出到编辑器（复制/另存）——已完成

目标：对话侧 Web 引用水合为编辑器 `CitationMark`：

- `data-source-type="web"`
- `data-source-id="{canonical_url}"`
- `data-url="{canonical_url}"`

实现：

- 水合：`apps/renderer/domains/conversation/ui/tools/knowledge/clipboard/hydrateKnowledgeCitationsToEditorCitationMarks.ts`
- 复制：`apps/renderer/domains/conversation/ui/tools/knowledge/clipboard/richClipboardActions.ts`
- 另存：`apps/renderer/domains/conversation/ui/tools/knowledge/export/saveTurnAnswerAsDocument.ts`

编辑器 mark：`apps/renderer/domains/editor/features/citation/marks/CitationMark.ts`

---

## 8. 验收与回归（结项口径：不含 Phase 3）

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
- `src/tools/web/__tests__/webEvidenceStore.test.ts`
- `src/tools/web/__tests__/webEvidenceWriterPort.test.ts`
- `src/tools/web/__tests__/webEvidenceBoundary.test.ts`
- `src/tools/web/__tests__/jinaReaderProvider.integration.test.ts`
- `src/tools/web/__tests__/extractArticle.test.ts`
- `src/tools/web/__tests__/localHttpProvider.integration.test.ts`
- `src/tools/web/__tests__/webCacheInfrastructure.test.ts`
- `src/tools/web/__tests__/webCacheBusiness.integration.test.ts`
- `src/infra/adapters/web-fetch/localHttpFetchAdapter.test.ts`
- `apps/renderer/domains/conversation/ui/tools/webread/functions/projectWebReadPresentation.test.ts`（仅历史 Resource Web 事件回放）
- `scripts/benchmark/web-reliability/statistics.test.ts`
- `scripts/benchmark/web-reliability/read-evaluation.test.ts`
- `apps/renderer/domains/conversation/services/messageProjection/helpers/knowledgeCitations.spec.ts`
- `apps/renderer/domains/conversation/ui/tools/knowledge/clipboard/hydrateKnowledgeCitationsToEditorCitationMarks.spec.ts`

不纳入本阶段结项范围（Phase 3 单独立项）：

- deep_research 的 Web 证据能力（证据 SoT/解析/物化/回放一致性）
- `deep_web_search` 并行链路
- 用户侧“深度联网研究”独立入口/勾选项（产品交互层决策）

---

## 9. 未来方向：交互与产品边界（仅记录，不在本阶段实现）

建议方向（用于 Phase 3 评审）：

- **请求作用域工具视图（availableTools）**：
  - **权威来源**：`AgentDefinition.config.availableTools`
  - **调用方可收缩**：发起调用时可在 `options.availableTools` 传入更小的工具子集（禁止扩权）
  - 用途：为“深度研究是否联网”等交互开关提供安全边界（开关只影响本次请求暴露给模型的工具集合）
  - 参考：`src/features/agent-registry/README.md`（工具策略章节）
- **深度研究（Deep Research）不默认联网**：启动面板增加“允许联网（Web）”开关，默认关闭。
- 开关开启后：
  - Scout/Challenger 可用 `web_search/web_read` 补证据；
  - Writer 是否允许引用 Web，取决于是否引入 Web 证据 SoT 与物化策略（保证可回放/可追溯）。
- 深度联网若要“更像 deep_search”，建议新增 **`deep_web_search` 并行链路**，不要污染 deep_search（KB-only）语义。

---

## 10. 关键代码参考路径（速查）

日常验证优先运行 `pnpm run test:web:e2e`：它只使用 localhost 真实 HTTP 夹具，覆盖搜索、读取阶梯、缓存、Evidence 与 canonical `web_read`，不需要 Electron 或供应商凭证。`pnpm run test:web` 额外覆盖全部 Web 规则/adapter 测试。真实网络只通过 `benchmark:web:live`（搜索 smoke）和 `benchmark:web:read-live`（生产读取阶梯兼容）按需运行。

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
