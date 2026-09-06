# Web 能力升级方案（搜索 / 读取 / 爬取）

> **历史执行台账**：本文中的 `resource_read` / SharedMemory / Evidence 全文续读链记录的是当时阶段，不再是当前 API。现行 Web 工具为 `web_search` / `web_read`，长 observation 由 ToolOutputStore + `tool_output_read` 续读，Evidence 只保留冻结引用快照；当前权威合同见上级 [`README.md`](../README.md)。

> 适用范围：Linnya 桌面端联网搜索、网页读取、站点爬取的产品与工程升级。
>
> **当前进度**：本轮 Web 能力升级已于 2026-07-19 **完成并关闭**。Phase 0、Phase 1、治理清单主体、S1–S6、R1–R3、本机抽取补强与 R5 文档收尾均已完成；live 正文覆盖 11/14（78.57%）。R4（站点爬取）不是遗留施工项，延后至 bash 工具落地且出现真实批量需求后重新评估。
>
> 本文档是**长期契约与进度台账**：已完成单元只留“结论 + 关键决策/债”，实现细节以代码和 git 提交为准；未完成单元保留完整规格与触发条件。

---

## 一、核心结论

1. **能力分层不等于逐层必做**：搜索与单页读取已经落地；站点爬取仅是条件触发的候选能力；浏览器动作自动化不做。
2. **先补地基**：超时、取消、错误分类、观测、URL 安全，是后续所有能力的共同底座。
3. **第三方 API 只做可选增强**：本地优先，新用户不依赖 Linnya 提供网页读取 API；秘塔/Jina 及未来 Firecrawl 仅由用户主动配置，不做默认。
4. **Evidence 承载结果**：网页内容一律以 Evidence 留存，支持 `[@ref]` 引用与跨实例回放；页面全文只存 Evidence，`data` 不再冗余全文。

## 二、四项基础决策

1. **orchestration 抽取**：抓取/抽取/质量判定/升级逻辑抽到独立 orchestration，工具层只做参数校验与结果组装。
2. **统一 HTTP 出站**：所有 Web 请求走 `webHttpFetch`（超时、取消、重定向控制、错误分类）。
3. **URL 安全**：统一 `urlPolicy`，禁止内网/回环/凭证 URL，DNS 解析校验 + 每跳重定向重校验。
4. **Provider 抽象**：搜索与读取都用 Provider 抽象，工厂按用户显式配置选择后端。

## 三、复用现有基建（不重复造）

- `ToolContext` + `abortSignal` 已贯穿工具执行链。
- EvidenceStore、`[@ref]`、bundle 回放、跨实例解析（G3）已就绪。
- `urlPolicy`、`webHttpFetch`、`assessWebReadQuality`、observation 注入隔离均可复用。
- bash 工具**不是**前置依赖，独立立项（见第六节）。

## 四、产品设计

### 4.1 能力分层与用户可感知形态

| 层级 | 工具 | 用户可感知形态 | 触发 | 默认启用 |
| --- | --- | --- | --- | --- |
| 搜索 | `web_search` | 结果列表（标题/URL/摘要/来源） | 模型自动或显式 | 是 |
| 单页读取 | `resource_read`（http/https 分支） | 正文卡片（标题/正文/引用） | 模型自动或显式 | 是 |
| 站点爬取 | 暂无专用工具（R4 延后） | 默认由 agent 逐页探索；批量需求待 bash 后评估 | 条件触发 | 否 |
| 浏览器自动化 | 不做（第七节） | —— | —— | 否 |

### 4.2 定位

- **搜索**：多 provider 聚合，先做稳定聚合，不做结果重排 ML 模型。
- **读取**：默认使用 Linnya 自带的网页解析，第三方网页解析由用户按需配置，正文抽取不默认外包。
- **爬取**：不预设“域名 + 深度 + 页数”的批量工具；先让 agent 用 `resource_read` 逐页决策，待 bash 后依据真实需求评估。

## 五、技术架构

```text
tools/web/
  websearch/   # web_search 工具 + provider 工厂
  webread/     # resource_read http 分支的读取编排 + provider 工厂 + 渲染 port
  # 当前没有 webcrawl；若未来立项，必须作为独立 feature 重新设计
  shared/      # URL 安全、HTTP 出站、缓存、失败枚举、observation 隔离
  definitions/ # 类型契约
```

已完成：**Phase 0** 地基（✅）→ **Phase 1** 单页读取（✅）→ **Phase 2** 本地渲染与配置（R1–R3，✅）。R4 条件触发、不排期。

## 六、与 bash 工具的关系

Web 能力与 bash 工具在实现和安全边界上完全解耦。`resource_read` 会执行 `urlPolicy`、DNS/SSRF 防护、超时/体积限制、注入隔离与 Evidence 物化；bash 中的 `curl`/`wget`/脚本**不会自动继承这些合同**，其输出也不会自动成为带引用的 Web Evidence。

bash 立项时必须独立评审网络隔离、文件系统隔离、进程权限、资源预算与审计策略。不得因为 bash 能访问网络，就把它描述成 `resource_read` 的安全等价入口。

## 七、浏览器自动化选型

- **本地渲染**：已选 Electron 自带 Chromium（第十六节），用于读取阶梯的 JS 渲染层。
- **动作自动化**（点击/表单/多标签）：不做，属不同权限模型，需单独立项。
- 不引入 Playwright/Puppeteer/Skyvern/Firecrawl/Crawl4AI（避免额外 Chromium 分发与 AGPL）。

## 八、Phase 0：生产级地基（已完成 2026-07-18）

统一出站合同、Provider 取消信号、adapter 接入统一出站、Serper 激活、`urlPolicy`、read-web-page orchestration 抽取、删除 `findPriorWebSearchTitle` 全目录扫描、观测统一。

关键实现约定（长期有效）：

- 读网页能力由 `resource_read`(http/https) 承载同一编排；`WebReadTool` 保留实现但**不进任何 Agent 白名单**（备用入口，触发条件见决策 1），文件头注释已锁定，防止变成“看似该注册的死代码”。
- adapter 统一抛带稳定 `kind/status` 的错误，工具层 `getWebFailureKind` 分类，禁止靠错误文案猜 429/鉴权/5xx。
- 标题优先级：`readResult.title` → `titleHint` → canonical URL（热路径不再扫全部 bundle）。
- 搜索结果按 canonical URL 去重后再分配连续 `citationOffset`。

验证基线：18 文件/112 测试、TypeScript 290/290、backend bundle 13.33 MB，全程无需 Electron。

## 九、测试、可靠性与性能验收（口径长期有效）

### 9.1 确定性可靠性与真实站点兼容率

> 确定性合同、本地集成和业务 E2E 必须 100% 通过；真实站点 live 只报告分层兼容覆盖与延迟，不用少量样本伪造生产 SLO。

- 策略拒绝、无效输入、用户取消**独立统计**，不混入成功率，也不伪装成 Provider 故障。
- 发布前/按需运行分层 live smoke，报告正文覆盖、稳定终态、失败分布与 p50/p95；当前本机基线为 11/14，不设人为 95% 小样本门禁。
- 若未来需要正式 95% SLO，必须先定义支持范围，并使用生产滚动自然样本与置信区间；禁止集中重复请求 Provider 或挑样本凑数。

### 9.2 五层测试结构

| 层级 | 时机 | 网络 | 门禁 |
| --- | --- | --- | --- |
| 规则/合同 | 每 PR | 无 | 100% |
| 本地 HTTP 集成 | 每 PR | localhost | 100% |
| 确定性业务 E2E | 每 PR | localhost | 100% |
| 真实 Provider / 站点 smoke | 发布前/按需 | 有 | 只做分层观测 |
| 生产滚动 SLO | 有真实流量后 | 真实流量 | 另行定义支持范围与阈值 |

前三层完全离线可重复，**不启动 Electron**（Vitest Node env + `node:http` 本地上游夹具 `webUpstreamFixtureServer.ts`）。命令：`test:web` / `test:web:e2e` / `benchmark:web:live`（需 `WEB_LIVE_TEST=1` + 真实凭证，否则退出为“未执行”，不输出绿色通过）。

### 9.3 延迟 SLO（暂定，采基线后转硬门禁）

| 路径 | 暂定 p50/p95 | 硬 deadline |
| --- | --- | --- |
| `web_search` 真实 Provider | 2.5s / 8s | 30s |
| 本地静态页读取 | 1s / 3s | 12s |
| Jina/秘塔读取 | 5s / 15s | 60s |
| 搜索→读取→Evidence | — / 20s | 45s |
| URL 内容 cache hit | — / 100ms | 500ms |

优化顺序按数据执行：先消除本地热路径浪费 → 共享连接池 → 流式读取超预算即 cancel → 缓存 + in-flight 合并 → 渐进式少量高价值来源 → 质量达标即结束、仅约定原因升级 → 本地 GET 仅对瞬态失败执行一次有界重试（禁止多层 fallback 掩盖根因）。

### 9.4 生产可观察性

结构化日志维度：`operation` / `provider` / `route` / `cacheStatus` / `outcome` / `failureKind` / `tookMs` / `resultCount|charCount` / `bodyBytes`；WebRead 本地 GET 另外记录 `status` / `contentType` / `finalUrl` / `redirectCount` / `attempt` / `retryCount`；**不记** API Key、完整 query string、网页正文、敏感 URL 参数。

## 十、关键待评估决策（已决策留档）

- **真实 Provider 基准频率**：采用“发布前 + 故障排查时运行”（成本可控），不做每 PR live。
- **95% 判定**：取消少量 live 样本的 95% 发布门禁；若未来建立正式 SLO，只使用定义过支持范围的生产滚动样本与置信区间。
- **搜索跨供应商 failover**：**不自动 failover**（行为/费用/数据流向可预测，能暴露根因）。读取链路的“本地抽取→Jina”是能力升级管道，只能由正文质量/JS shell 等约定原因触发一次，不等于搜索 failover；本地 GET 对 timeout/network/429/5xx 共享一次有界退避重试。

## 十一~十三、Phase 1：单页读取（已完成 2026-07-18）

- **前置**：`WebEvidenceWriter` 窄 port 收口；Web 自有 capture DTO，平台 ToolContext decorator 连接 Evidence command。Web 业务禁止穿透 Evidence feature 或直接处理 bundle 路径。
- **M1 本地抓取**：`localHttp` provider + `extractArticle`（parse5 规范化 + linkedom + Readability；parse5 由现有 Cheerio 依赖提供）。
- **M2/M3 阶梯 + 契约**：`readLadder`（本地首跳 → 质量判定 → 托管升级）、`WebReadResult` 契约 + `WebFailureKind` 枚举。
- **M4 缓存**：查询缓存、URL 正文缓存、ETag/304、in-flight 合并、`cacheStatus` 可观测。搜索缓存 key 已含 provider；**读取 URL 缓存 key 不含 provider**（隐患，R3 修）。
- **M5 observation 收敛（历史实现，现已替代）**：当时 observation = 元数据 + 注入隔离摘录（≤8000 字/300 行）+ `evidence://bundles/<id>` 续读指针；现行实现返回完整安全 observation，并由 ToolOutputStore 统一治理与续读。

## 十四、后续治理清单（债务 / 隐患 / 分裂统一）

> 来源：2026-07-18 四路全链路调研。均不阻塞产品单元，登记以免遗忘。

### 已完成

| 项 | 结论 |
| --- | --- |
| G1 | 修复 `sharedmemory_write` 跨实例自愈的 `toolName` gate 缺陷：改按**数据形态**（`data.contentText` 存在性）判别，覆盖 `web_read` 直调与 `resource_read(https)` 委托。后被 G2 收口。 |
| G2 | 删除 `data.contentText` 长正文（消除 README line 139 违规）：页面全文只存/读 Evidence；历史 Web citation 缺 Evidence 时只能按 snippet 物化为 `web_search_result`，不伪装页面全文。 |
| G3 | 跨实例证据可达性基建：SharedMemory/Writer/`resource_read(evidence://)` 可在**同 conversation** 内跨 instance 回放；当前 instance 优先，一致副本确定性选择，冲突副本 fail-fast，不跨 conversation。 |
| G5 | 统一 `resource_read` 续读协议：KB/Workspace/Skill/ToolOutput 经 `resource_read` 均返回 `data.next_offset`，cursor 统一为 `Cursor: to continue, set offset=N.`；底层直调保留旧字段；协议漂移 fail-fast。 |
| G6 | 历史阶段曾统一为 `resource_read(tool_output://blobs/<id>)`；该决策已被 ToolOutput 边界重构取代，现行入口为 `tool_output_read(blob_id=...)`。 |
| G8 | `web_search` 结果注入隔离：抽取共享原语 `shared/observation/untrustedWebContent.ts`，逐条包裹 title/snippet，可信的序号/`[@ref]`/canonical URL 留边界外；组合 token 防伪 END 边界。 |
| G12 | 文档漂移收口（researcher 注释、README、计划口径统一）。 |

### 条件触发（未做，勿提前优化）

| 项 | 内容 | 触发条件 |
| --- | --- | --- |
| G4 | `evidence://` 整包返回、忽略 offset/limit，缺窗口续读 | 观测到续读整包 evidence 频繁占用大量上下文 |
| G7 | Writer 证据快照超长走 `tool_output://` 而非 `evidence://`，产生并行全文副本 | `evidence://` 续读模式验证后（弱依赖 G4） |
| G9 | 无平台级“工具结果=数据非指令”统一约定，各工具 observation 各自为政 | 出现第三个需隔离的外部内容源时立项 |
| G10 | `payload.output`(未治理全文) 与 `payload.result`(治理后) 语义分裂 | 存储成本/回放一致性成为实际问题时评估 |
| G11 | Evidence `content_text` 5 万字上限 | 出现真实“>5 万字正文不够用”反馈时评估 |
| G13 | conversation scope Evidence 解析按目录**线性扫描**兄弟 instance | 单会话大量 instance/bundle 或解析延迟上升时，引入 conversation 级 Evidence 索引（与 W7 遗留方向合并） |
| **G14** | **既有 backend bundle 已耦合 Electron 依赖**（非本次渲染引入）。真实红线是“Web 渲染实现不得进入 backend bundle”，但 backend 与 Electron 的既有耦合本身是独立架构债 | 重构 backend 分层或做纯 Node 复用时评估解耦 |

## 十五、搜索引擎配置升级（S1–S6 已完成 2026-07-19）

> 目标：新用户零 Key 即可搜索，并能清楚切换到更稳/更适合中文的 Provider。`parallel_free` 为零配置默认，`duckduckgo` 为实验性选项；搜索选择不再依赖 Model Catalog 条目顺序。

### 架构决策（方案 A，用户拍板）

> 2026-08-21 边界修订：以下 S3/Cloud 内容是历史实现记录，不再是现行合同。生产 `/v1/models` 已无 Web 条目；客户端删除了不可用的 Cloud 搜索入口、`X-Linnya-Model` 和 `extra_headers` 路径。当前搜索只有 `none` / `byok`。未来 Cloud 搜索必须使用 Web-owned 服务目录与代理合同，不能恢复 Web 伪模型。

- **adapter 全在客户端，cloud 只做透明代理**。内置引擎与 BYOK 共用同一份客户端 provider 代码，只有 `api_base` 与 Key 来源不同；归一化/缓存/Evidence/注入隔离全留 web domain，cloud Worker 保持“验设备→限额→Key 替换→转发→日志”薄代理。**否决**“cloud 上部署统一搜索服务”（BYOK 会被迫二选一：用户 Key 上云=隐私炸弹 / 双份 adapter=必然漂移）。
- **现行配置 = 引擎 × 本机凭据来源**：千帆/Serper/Jina/Tavily 固定 `byok`（可由开发环境变量补充）；`parallel_free`/`duckduckgo` 固定 `none`；SearXNG 是自托管 URL。
- **运行时只走当前选中的一个 Provider**：无配置/限流/挑战/超时/服务错误都明确失败，**不静默降级**、不暗中切付费。

### 各单元结论

- **S1** 接入 Parallel Free（最小 MCP-over-HTTP，只用 `web_search` 不接 `web_fetch`）、DuckDuckGo（实验性 HTML 抓取）、SearXNG（REST）。
- **S2** `WebSearchConfig` + 主进程独立文件持久化 + 窄 IPC（get/set/testConnection）；工厂改为按用户显式选择。
- **S3** cloud Worker：`X-Linnya-Model` 识别模型、当时的 `provider:*` KV 鉴权、客户端 `extra_headers` 合并。当前 Cloud v2 已把该私有路由 key 不兼容地迁为 `upstream_endpoint:*`，权威合同见 `cloud/README.md`。
- **S4** 设置页“网络搜索”tab：引擎/Key 来源选择、BYOK 输入（`PasswordInput` + `safeStorage`）、连接测试。
- **S5** 接入 Jina Search、Tavily（BYOK），各 BYOK 引擎给官方 Key 申请链接。
- **S6** 每引擎独立 BYOK 凭证槽位（`WebSearchSettings`），解决切换引擎凭证覆盖；当时包含 v1→v2 迁移。现行开发版本为严格 v3，只读取当前格式。

### 待办 / 风险

- **Cloud 搜索已撤回**：历史 S3 从未完成远端真实凭据与产品验收，生产模型目录也不再发布 Web 条目；不得把它作为已交付能力。未来如重启，单独建立 Web Cloud 合同。
- **读取缓存身份**：已在 R2 前修复为“规范 URL + 整条读取路由身份”；R3 已用真实渲染开关与选中 Provider 身份替代 `managed_default` 占位符。
- **Linnya 托管 SearXNG**（Worker + Containers/VPS）：条件触发，不在本单元。
- **不建通用 MCP client**：仅为 Parallel Free 做最小 MCP-over-HTTP。

## 十六、抓取升级：本地 JS 渲染（完成）+ 站点爬取（延后）

> 状态：**R1、R2、R3、本机抽取补强与 R5 已完成（2026-07-19）**。新用户默认使用本机两层，第三方 Provider 作为用户可选增强保留；R4 条件触发、不排期，本轮升级关闭。

### 16.1 方向与决策（用户拍板）

- **自建本地 JS 渲染层**：用 Electron 自带 Chromium 起隐藏 `BrowserWindow` 渲染 JS 重/反爬页面；新用户不依赖第三方网页读取 API，秘塔/Jina 降为可选增强。
- **站点按需爬取**：当前不新增 `web_crawl`。agent 优先通过 `resource_read` 逐页探索；bash 后若仍有稳定、重复的批量场景，再重新立项。
- **读取阶梯重排**：本地 HTTP 首跳 → 本地渲染 → 第三方 Reader（可选兜底）。
- **不做**浏览器动作自动化。

### 16.2 调研结论（约束施工）

- backend 已依赖 Electron（主进程），渲染用 `BrowserWindow` **零新增依赖、无需额外分发 Chromium**。
- 渲染远程不可信内容必须独立 session、无 preload、sandbox、禁 node、拦截导航/弹窗/权限/下载、子资源走公网 DNS 校验；与 `HiddenWorkerHost` 可信模型不同，须**独立 render worker**。
- 读取缓存必须按整条路由隔离；已在 R2 上线前修为“规范 URL + 阶梯版本 + provider 序列”，旧 URL-only 缓存自然失效、不双读。

### 16.3 施工单元（R1→R5）

**R1（渲染 worker 基础设施）✅ 2026-07-19**

- `WebPageRenderer` port（`webread/ports/webPageRenderer.ts`）供 web domain 调用，App Server composition 显式注入 Desktop Chromium reverse RPC adapter，避免 Web domain 依赖 Electron。
- `WebPageRenderWorker`（`electron-main/web-render/`）：三级超时、取消、5 MiB HTML 上限、任务结束即销毁远程页面；并发默认 1 上限 2、2 分钟 idle 回收、退出等待真实清理。
- Electron 安全 runtime：无 preload、Chromium sandbox、`contextIsolation`、独立 session（`cache:false`）、`devTools:false`；`will-navigate`/`will-redirect`/`setWindowOpenHandler(deny)` 拦截导航与弹窗；权限 request/check 全拒、`will-download` 取消；`onBeforeRequest` 对每个子资源做公网 DNS 校验（防 SSRF）；监听 `render-process-gone`/`unresponsive`。
- bundle guard：渲染实现只进 `main.cjs`，不进 backend bundle。
- 验证：R1 定向 5 文件/13 测试、`test:web` 26 文件/150 测试、业务 E2E 6 文件/62 测试；真实 Electron/Chromium E2E（SPA/重定向/阻断恢复/弹窗/下载/权限/私网/超时）全过；TypeScript 290/290，backend 13.93 MB。
- **审计发现（登记为残留风险，见 16.5）**：子资源校验按 hostname 缓存结果（`validatedHosts`），且渲染连接未做 IP 钉扎，存在理论 DNS rebinding 窗口。

**R2（渲染接入读取阶梯）✅ 完成**

- 生产阶梯已改为 `local_http → local_render → managed`：JS 壳、空正文、三类质量信号、`network_error` 和单跳 `timeout` 会尝试渲染；`captcha/login_required/http_403` 跳过渲染直达托管。`dns_error` 仍保持终态；本地 GET 的 `timeout/network_error/429/5xx` 在阶梯判定前共享一次有界退避重试，挑战页和其他策略/内容错误不重试。整条阶梯的 90 秒总预算超时也不再升级。
- 渲染结果复用 `extractArticle`、质量判定、Evidence 与 observation 隔离；`renderMode:'js'`、`renderAttempted`、`initialFailureKind` 和 provider 名可观测。渲染安全拒绝/取消/HTML 超限保持终态，渲染超时或进程失败才托管兜底一次。
- 整条阶梯统一 90 秒墙钟预算；本地 HTTP/Chromium/托管 Reader 的各段上限不能简单相加突破总预算。
- 缓存身份修复已提前完成：不同渲染层/托管层不串缓存，旧 URL-only 文件自然 miss；文件缓存 schema 同步支持 `js` 与 `renderAttempted`。
- 验收：`test:web` 26 文件/162 测试全过，R2 业务链路覆盖渲染成功、二次质量失败、跳过渲染、终态、禁用渲染、Evidence、缓存隔离与总预算；真实 Electron 安全 E2E 全过。`benchmark:web:read-render-live` 必须在 Electron 中跑真实 Chromium，旧 Node 基准显式关闭渲染。
- 2026-07-19 live 样本：本地两层正文覆盖 7/14（50%），PDF 稳定终态 2/2，渲染尝试 7 次、直接恢复 1 次，延迟 p50/p95 = 2.30s/13.26s；代码结构保真 0/5、表格结构保真 0/1。该结果是单轮真实站点兼容性样本，不宣称统计 SLO。
- 路由结论：**托管 Reader 必须保留**。Ant/政府网等确有正文不足或超时；另有中文长 Wikipedia（14,583 字）与 React（2,428 字）被 `low_text_ratio/table_dominant` 二次 gate 判退，属于后续可单独评审的规则误杀，禁止为凑 95% 在本单元直接放宽。

**R3（读取配置产品化）✅ 2026-07-19**

- 配置合同显式固定 `renderEnabled` 与 `managedReader`（秘塔/Jina/关闭）；两个 Reader 从第一版起独立保存 BYOK，未实现的 cloud 不提前进入类型。当前有效凭证优先级为已保存 Key → 精确 Reader 自己声明的环境变量，Reader 服务定义归 Web Read 所有，不进入 Model Catalog。
- AppData 独立 `config/web_read.json` + `safeStorage` 加密；窄 IPC 只开放 `get/set/testConnection`，Renderer 只见 `hasStoredByokKey/credentialAvailable`。损坏文件显式失败，重新保存可修复。
- 读取开始只捕获一次配置快照，Reader 选路、渲染开关与缓存身份共享；工厂按 Web-owned `serviceId` 精确选择，且只在真正进入托管分支时创建。关闭托管后，本地合格页面仍成功，需要托管时稳定返回 `managed_disabled`。
- 缓存身份升 version 3，包含渲染开关与真实 Reader；开关渲染/换 Reader 自然 miss，只换 Key 保持 hit。
- 网页解析配置与搜索配置共同展示在“网络搜索”Tab：渲染开关、Provider 单选、分槽凭证状态、掩码输入、官方申请链接与连接测试；`none` 隐藏凭证和测试。read gateway/IPC 与搜索 gateway/IPC 仍保持独立合同，各自保存与测试连接。
- 验证：配置/持久化/工厂/阶梯/缓存/IPC/Renderer gateway 与设置编排测试全过；`test:web`、`test:web:e2e`、TypeScript 290/290、前端生产构建、backend/main/preload 构建（见最终收尾记录）通过。无需 Electron 的 Vite fixture 已实测桌面与 436px 窄屏无横向溢出；切换 Jina/none 的状态投影正确。

**R3 后续收口（默认网页解析 + 抽取补强）✅ 2026-07-19**

- 新用户默认从秘塔改为 `none`，仍默认开启隔离浏览器解析；已有 `web_read.json` 完整保留原选择，不做覆盖迁移。设置页只保留“网络搜索”Tab，内部使用“网页解析 / Linnya 默认 / 第三方网页解析”等产品名称；内部 `managedReader` 工程合同不做无收益重命名。
- 修复质量 gate 误判：正文达到 800 字后，`low_text_ratio/table_dominant/list_dominant` 只保留为观测 warning，不再单独否定已经足量的正文。
- Readability 失败或明显遗漏时，改从原始 DOM 的 `article/main/[role=main]` 提取可访问正文；必须在 `Readability.parse()` 修改 DOM 前读取语义候选与页面元数据，并过滤导航、侧栏、页脚、隐藏与脚本节点。省略显式 `<head>` 的合法 HTML 还需直接读取原始 `title` 元素，不能只依赖 linkedom 的 `document.title`。HTTP 与 Chromium 共用同一抽取入口。
- GitHub `blob` 自动转 Raw，转换后的 `raw.githubusercontent.com` 继续执行 URL/DNS 校验与 IP 钉扎；对外保留原始 URL，最终 URL 记录 Raw。PDF 继续保持 `unsupported_mime`；Web source acquisition 不跨域复用知识库 PDF parser，后续若支持应先定义独立的内容提取合同。
- 2026-07-19 Electron live 复测：正文覆盖 **11/14（78.57%）**，PDF 稳定终态 2/2，p50/p95 = 1.59s/5.51s。中文长 Wikipedia、React、Ant、NASA 与省略 `<head>` 的 Node 官方文档均由本机 HTTP 成功；未覆盖项为政府网 DOM 提取超时，以及 httpbin 同一重定向样本的临时 503（中英文各一条）。这是小规模真实站点兼容样本，不宣称统计 SLO。
- 当前输出仍是纯文本，live 的代码块/表格结构保真为 0/5、0/1；正文可用但 fenced code 与 Markdown table 结构会丢失。未来如需精确代码/表格引用，应独立引入 HTML→Markdown 抽取策略，不在纯文本序列化中堆站点补丁。
- Firecrawl `/scrape` 未来可作为用户 BYOK 的增强解析 Provider，与秘塔/Jina 同级；不由 Linnya 提供默认网页读取额度。若 R4 未来重新立项，仍须区分 `/scrape` 的单页解析与 `/crawl` 的多页任务。

**R3 后续收口（容错 HTML 与抽取错误边界）✅ 完成 2026-08-10**

- 真实长任务发现政府网站公共模板同时包含 `head` 后 style、显式 body 与提前关闭 `html`。轻量 DOM 直接解析会产生空 canonical body 和 document 根外正文，使访问屏障、质量统计与 Readability 候选树同时失真。
- extraction feature 复用已有 Cheerio 默认 `parse5`，先按 WHATWG HTML 语义生成唯一 `html/head/body`，再交给 linkedom/Readability；不恢复 jsdom，不写正则或站点特判。脱敏组合 fixture 通过真实 LocalHttpProvider HTTP 链路。
- Readability 抛错但预先取得语义主区域时保留 `semantic_dom` 正文；没有正文时才产生 `extraction_error`。`dom_canonicalization` 阶段可进入 Chromium，`readability` 阶段跳过同抽取器机械重试并直达托管 Reader。
- 失败 tool output 使用稳定错误码文本；成功兜底结果与日志增加 `initialFailureStage`。正文缓存路由升至 version 4，文件缓存直接复用 schemas 的失败枚举，避免重复合同漂移。

**R4（站点按需爬取 `web_crawl`）—— 延后**

- **决策（2026-07-19）**：延后至 bash 工具立项后再评估。理由：agent 的自然工作方式是逐页 `resource_read` 探索而非预先声明爬取范围；bash 工具上线后 agent 可用 `curl`/脚本灵活组合多页抓取，届时再决定是否仍需专用 `web_crawl` 工具。
- 若做 R4，需先评估收紧渲染路径的 DNS rebinding / IP 钉扎（16.5），因为爬取会大规模发起子请求。
- bash 爬取绕过 `urlPolicy`/SSRF 防护/Evidence 集成，bash 工具自身的沙箱设计（网络隔离、文件系统隔离）是独立安全关，需在 bash 立项时拉齐。

**R5（文档与验收收尾）✅ 2026-07-19**

- Web README、计划和工具开发规范已统一为“agent 逐页探索优先、R4 条件触发、不排期”。
- 网络搜索与网页解析已合并到同一“网络搜索”Tab，展示层合并但配置存储、编排与 IPC 边界保持独立。
- bash 安全边界已明确：命令行网络请求不继承 Web 域的 `urlPolicy`/SSRF/Evidence 合同，网络与文件系统沙箱须独立立项。
- 最终验收：`test:web` 30 文件/188 测试、`test:web:e2e` 6 文件/80 测试、TypeScript 290/290、frontend/backend/main/preload 构建与 Web 渲染 bundle 边界守卫通过；Electron live 正文覆盖 11/14、PDF 终态 2/2、p50/p95 1.59s/5.51s。

### 16.4 业务验收（全节）

- JS 重页面本地渲染后抽取质量达标并产出 Evidence；不同 provider/渲染模式缓存不串；真实 Electron 渲染 E2E（SPA/重定向/私网阻断/超时/弹窗/下载拦截）全过。R4 延后，爬取相关验收待 bash 工具后再定。

### 16.5 风险登记

- **DNS rebinding / 无 IP 钉扎**（R1 审计发现）：子资源校验按 hostname 缓存、渲染连接未钉扎已验证 IP，理论上存在“校验时公网、连接时被 rebind 到内网”的窗口。危害受限（渲染窗 sandbox、独立无凭证 session，内网内容只作文本返回），但相比 `localHttp` 的 IP 钉扎，渲染路径 SSRF 防护更弱。**触发**：需要更强内网隔离保证，或渲染路径开放给爬取（R4）大规模使用时评估收紧。
- **代理 fake-IP 与 SSRF 策略冲突（已解决）**：采用方案 A，仅允许“合法域名解析所得”的 `198.18/15`；用户直接输入该网段 IP、私网 IP以及混入私网地址的 DNS 结果仍拒绝。真实 Wikipedia 探针与 Electron live 均已验证 TUN 可正确转发。
- **DNS/代理分段观测尚未实现**：当前只能从 `failureKind`、`initialFailureKind`、`initialFailureStage`、`escalationReason`、`renderAttempted` 以及失败日志中的状态/MIME/最终 URL/重定向数/尝试次数判断阶梯路由，日志不包含逐跳 DNS 解析地址、fake-IP 分类或 DNS/连接分段耗时。排查本机 DNS/代理异常仍需外部探针；若产品要求运行内定位，应单独接入结构化观测，且不记录 URL query/header/body。
- **渲染并发与内存**：靠并发上限 + idle 回收控制。
- **反爬对抗**：可绕过部分 JS 检测，但验证码/行为检测仍会失败，明确失败不硬扛。
- **渲染响应元数据**：R1 port 当前只返回最终 DOM/URL，成功的 `local_render` 结果暂按 `status:200`、`text/html` 记录；不影响质量判定与 Evidence，但不是原站响应状态的权威记录。**触发**：产品需要展示或审计原始 HTTP 状态时扩 port。
- **主进程耦合**：渲染 worker 在主进程，backend 经 port 调用，须防实现泄漏进 backend bundle（bundle guard 已锁）；既有 backend-Electron 耦合另记 G14。

### 16.6 本轮明确不做

- 浏览器动作自动化；引入 Playwright/Puppeteer/Crawl4AI 或 Firecrawl 实现；默认启用爬取；Linnya 提供默认网页读取 API 额度。未来 Firecrawl BYOK 若有真实需求，按独立 Provider 重新立项。
