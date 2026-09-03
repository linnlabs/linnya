# 24 · Agent 多模态 Phase 6 实施 Runbook

> **状态**：已完成并通过深度审计复验。P6.0-P6.9、生产 Agent 装配、插件发布升级、项目会话 durable 重读、asset GC、截图失败语义、工具失败清理和产品级 Electron 验收均已闭环。本文是 [`18-multimodal-context-lifecycle-proposal.md`](./18-multimodal-context-lifecycle-proposal.md) Phase 6 的临时实施档案；Phase 5 已于 [`23-multimodal-phase-5-implementation-runbook.md`](./23-multimodal-phase-5-implementation-runbook.md) 完成并复验。本文不是长期协议真源，稳定合同已经迁回 Slides、asset、工具和 CLI 的正式 README。

> **目标**：让 Slides 的同一份 `PresentationRenderModel` 能在 Renderer 预览、hidden worker 截图和命令行验收中得到同源栅格化结果；CLI 只生产可供人、CI 和 Shell 调用的 PNG/manifest，Agent 通过 conversation-file `resource_read` 复用 Phase 5 工具附件链读取截图，不新增 PPT 专用“AI 看图”旁路。

> **迁移后更正（2026-08-12）**：本文早期章节记录过 registered `command`、旧 Shell launcher 和 Hosted Command 方案，属于历史实施证据。当前 Agent 产品链是 `shell` → `linnya-slides` 薄 native client → 父 execution 的当前 App bridge → conversation-file `read_file`；不启动第二个 Electron，也不增加插件专属 Agent 工具。`plugin.json.entry.command` 的 standalone CLI 只服务人、开发脚本和 CI。稳定规范以 [`docs/plugins/guides/21-plugin-cli.md`](../../../../docs/plugins/guides/21-plugin-cli.md) 及 Commands README 为准。下文 P6.6-P6.8 只保留迁移审计证据。

> **本文生命周期**：18-24 号多模态文档都属于阶段材料。稳定 README 不得反向链接本文；本文完成后可以随其他 Phase 文档统一清理。

---

## 0. 结论先行

Phase 5 已无剩余功能批次。Phase 6 从 Slides 截图生产开始，但不能把“截图文件”“asset 身份”和“资源库成员”混为一谈。实施必须遵守以下结论：

1. Slides 只有一套视觉真源：backend 生成 `PresentationRenderModel`，Konva/ECharts 消费该模型。hidden worker 与当前缩略图必须复用同一套渲染函数，禁止重写第二套节点映射、文本布局或图表规则。
2. CLI 是只读 presentation 查询客户端和普通文件生产者，不是 Linnya asset/event ledger 写入者。它以只读连接查询 Slides，输出 PNG 和结构化 manifest，不迁移数据库，不写 `assets`、`conversation_event_asset_links` 或 `project_asset_links`，也不返回 provider content parts。
3. 用户显式指定 CLI 输出目录时，PNG/manifest 是用户拥有的普通文件。仅运行 CLI 不创建 asset，不进入资源库，也不产生会话引用。
4. Agent 通过未来的通用命令工具调用 CLI 时，host 只登记 manifest 中被工具明确选择给模型的图片。登记时必须重新读取和真实解码文件，不信任 manifest 自报的 MIME、尺寸、长度或 hash。
5. 工具派生截图属于当前 conversation/tool event，不是项目资源。它写 `assets` 和 `conversation_event_asset_links`，不自动写 `project_asset_links`，因此不会污染资源库侧栏。
6. 只有用户显式执行“加入资源库”时，既有 asset 才增加 `project_asset_links`。ownership 是独立关系，不能通过隐藏 role、URI 前缀或前端过滤伪装。
7. 新生成图片在 tool event 落库前尚无历史 link。Phase 6 必须增加 tool-call-bound 的短生命周期登记凭据，允许 ToolNode resolver 验证“这正是本次工具刚登记的 asset”；不能放宽成“同一数据库里任意无归属 asset 都可读”。
8. asset 身份登记、event link 和文件发布的崩溃语义必须明确。允许先发布受管内容和登记 ledger、后写 event；中间崩溃形成的未引用 asset 由有时间屏障的 GC 回收，不能为了追求跨文件系统原子性把绝对路径写入 durable event。
9. Phase 6 不新增 `ppt_screenshot`、`ppt_vision_check` 等 AI 专用工具。Slides standalone CLI 与 Agent bridge 共用 `render`、`inspect` 领域参数；Agent 通过通用 `shell` 调用 `linnya-slides`，再用 `read_file` 读取 conversation 产物。
10. 仓库当前没有生产 Bash 工具。Slides JavaScript sandbox 只执行 deck.js，不能冒充 OS 命令工具。P6.6 必须先建立通用进程执行与 artifact 协议，或明确把 Agent 调用门禁留为未完成；不能偷偷从 Slides 插件直接 `spawn` 任意命令。
11. hidden worker 是 Electron DOM/Konva/ECharts 渲染 adapter，不拥有 presentation 查询、输出目录、asset 登记或业务重试。backend orchestration 决定渲染哪些页、写哪些文件和如何生成 manifest。
12. CLI 的稳定输出以 manifest 为机器合同，stdout 只用于人类进度和最终位置。Agent/CI 不解析自然语言日志猜截图路径。
13. manifest 中的路径必须相对 manifest 所在输出根；禁止把开发机绝对路径写入可持久化 manifest。host 解析时同时校验 lexical path、realpath、普通文件和输出根边界。
14. 截图失败整批 fail closed：任一请求页渲染失败时命令非零退出，manifest 标记失败且不宣称完整成功；Agent 不把成功页的子集静默送给模型。
15. 人/CI CLI 与应用内 Agent 路径共用渲染核心，但运行宿主不同。首版 CLI 可以由 Electron main 启动 hidden worker；不能假装纯 Node 进程具备 DOM、Canvas、字体和 ECharts 环境。

---

## 1. 本轮边界

### 1.1 必须交付

| 能力 | Phase 6 交付 |
| --- | --- |
| Slides raster 合同 | 页选择、输出尺寸、像素比、格式、结果与稳定错误定义 |
| 同源 renderer | 当前缩略图与 worker 共用 Konva 节点构建、图片预载、图表渲染和导出规则 |
| hidden worker | 插件 contribution 注册、严格 request/response codec、ready/timeout/dispose |
| screenshot orchestration | 查询 render model、选择页面、调用 worker、原子写文件、生成 manifest |
| CLI | `render`、`inspect`；可供人和 CI 调用，稳定 exit code 和 JSON manifest |
| generated image ingress | host 真实解码、内容寻址发布、ledger 登记，不自动创建项目归属 |
| tool artifact claim | 只在本次 tool call 中授权新 asset，event 成功后由 durable link 接管 |
| Agent 接入 | 通用受限 command/Bash 工具读取 manifest 并声明选中的 tool model input |
| persistence | tool event 建立 conversation link，刷新/回放后仍能重新物化同一截图 |
| GC | 未引用登记、tool event 删除和共享内容对象的回收纪律 |
| 验收 | 真实 Slides → PNG/manifest → tool event → `resource_read`/context → provider body |

### 1.2 明确不做

- 不新增 PPT 专用 AI 看图工具，不让 Slides 插件绕过 ToolNode 直接调用模型。
- 不让 CLI、第三方插件或工具 JSON 直接构造可信 `RuntimeResourceRef`。
- 不把 CLI 输出目录自动扫描成项目资源库，不按文件扩展名猜 MIME。
- 不把绝对路径、base64、data URL、provider file ID 或图片字节写入 RuntimeEvent、manifest 的稳定身份或审计日志。
- 不把截图结果伪装成 user image；工具截图继续使用 `tool_result_image` placement。
- 不在 worker 内读取 workspace SQLite、解析 presentation ID 或写 `assets`。
- 不重写 PPTX 到图片的第二套排版器，不引入 LibreOffice/Playwright 作为 generated deck 主路径。
- 不为视觉像素、CSS、README 文本或字段数量写脆弱快照测试。
- 不在本阶段实现远程渲染、provider file cache、OCR fallback、GIF/SVG 或多模态摘要。
- 不顺手把整个历史 `pathManager`、所有 workspace assets 或所有工具执行器迁进新目录；只收口本阶段真实触达的生成图片登记能力。

### 1.3 Phase 1-5 复用边界

| 已有能力 | Phase 6 使用方式 | 禁止事项 |
| --- | --- | --- |
| `RuntimeResourceRef` | tool event 与后续 context 的 durable 图片身份 | CLI/插件自行拼装 |
| Tool `modelInput.attachments` | 只声明 host 可解析的有序选择 | 使用 `media.path` 代替 |
| active model gate | ToolNode 执行前校验真实成功模型 | 从模型名猜视觉能力 |
| EventStore event links | 新截图绑定 immutable tool event | 自动写 project link |
| verified image loader | preview、resource_read、LLM materializer 重验同一受管副本 | 只信 ledger 或后缀 |
| Phase 3 converter | Responses/Anthropic 把 tool attachment 转成原生 blocks | Slides 生成 provider payload |
| AppData 内容寻址副本 | 保证源文件删除后仍可回放 | durable event 保存源路径 |
| hidden worker host | 提供隔离 BrowserWindow 生命周期和超时恢复 | 承载 Slides 业务规则 |

---

## 2. 已核实的真实链路

### 2.1 Slides backend 已有完整视觉输入

`PptCoordinator.getRenderModel()` 经 `PresentationQueryRuntime` 调用 engine，能够为 generated/imported presentation 生成完整 `PresentationRenderModel`。generated deck 在 mapper 前解析 image sources、规范化结构页并预热文本测量；imported deck 从 PPTX canonical model 映射。截图不应重新读取 deck.js 或 PPTX 猜布局。

当前 query runtime 还会拒绝带未解决 codegen draft 的 compiled checkpoint，避免截图看见旧版本。这条门禁必须被 CLI 和应用内截图共同复用。

### 2.2 当前栅格化只存在于 Renderer 缩略图

`offscreenKonvaRenderer.ts` 当前完成：

- 按 slide size 和目标宽度计算 canvas；
- 预载背景和节点图片；
- 用 ECharts 生成图表图片；
- 按 z-index 构造 Konva background、text、shape、image、table、chart 和 group；
- 通过 `stage.toCanvas()` 返回 `ImageBitmap`。

它直接依赖 DOM、Konva、ECharts 和 Renderer feature，返回值只适合前端内存缩略图。正确演进是提取“构造 canvas/导出 bytes”的 renderer-side raster feature，让缩略图和 hidden worker 都调用它；不是把整份文件复制进 backend。

### 2.3 Slides hidden worker 已接入平台

host 的 `HiddenWorkerHost` 提供隐藏 BrowserWindow、ready/request/response channel、请求关联、超时、连续超时重建、idle dispose 和测试注入。Slides backend contribution 已声明 `slides-raster`，registry 按插件启停注册和释放；request/response/ready 都由 shared codec 从动态 registry 的 `unknown` 边界恢复领域类型。

worker HTML、CSP、preload、renderer entry、Vite 浏览器 bundle、tsup preload 与 plugin artifact 已形成完整构建链。worker preload 不暴露文件系统能力，只接受已经物化成 data URI 的自包含图片。开发 `dist` 和 `extraResources` 安装布局均已通过真实 Electron ready + PNG render；P6.4 已在调用前查询同一版本 presentation snapshot，并把合法本地、data URI 或 PPTX embedded 图片物化成自包含输入。

### 2.4 现有生成图片登记不满足本阶段合同

`registerGeneratedImagesAsProjectAssets()` 位于 workspace VFS orchestration，并被 `text_to_image` 直接调用。它存在以下真实问题：

1. 把“图片身份登记”和“加入项目资源库”绑成一个动作。
2. 按文件名扩展猜 MIME，不做真实解码。
3. 不写真实 `width_px` / `height_px`。
4. 使用 `file://` 绝对路径作为 URI。
5. 工具 observation 与 Slides skill 仍把绝对 `image_path` 当协作合同。
6. 直接写 SQL，没有表达本次 tool call 的短生命周期所有权。

Phase 6 不能复用这段函数给截图开旁路。P6.1 应建立 asset domain 的窄“登记已生成本地图片”能力；`text_to_image` 后续也迁到该入口，再由显式 workflow 决定是否加入资源库。

### 2.5 Phase 5 resolver 只接受已有归属 asset

当前 `createWorkspaceToolModelInputResolver()` 对 project conversation 只授权 `project_asset_links`，对无 project conversation 只授权已有 `conversation_event_asset_links`。这对 `resource_read(asset://...)` 和历史 asset 是正确的，但不能授权“本次工具刚生成、event 尚未落库”的图片。

Phase 6 需要的不是放宽 SQL，而是增加一次性 claim：

- claim 由 host asset ingress 在本次 tool call 中签发；
- claim 绑定 conversation、tool call、asset ID、顺序和有效期；
- ToolNode 后处理只在完全匹配的执行上下文消费；
- event 持久化成功后，durable `conversation_event_asset_links` 成为后续授权真源；
- 进程崩溃时 claim 自然消失，未引用 asset 进入 GC。

claim 不落 RuntimeEvent，不传 Renderer，不作为跨重启恢复机制。

### 2.6 仓库没有生产 Bash 工具

当前 Slides sandbox 只为 deck.js 提供受限 JavaScript runtime；它不是 shell，也不能访问任意 CLI。仓库的 CLI 多为维护、benchmark 或开发脚本，linnkit CLI 也不是通用 workspace process executor。

因此“命令行可供 Agent 调用”需要一个真实的通用执行边界：命令策略、cwd、环境变量、超时、输出上限、取消、权限和 artifact manifest 都属于 command domain。把 `child_process.spawn()` 写进 Slides tool 会让插件获得不受控的宿主执行能力，也无法被未来其他文件工具复用。

### 2.7 同类产品对本阶段的印证

- Claude Code 把 Bash/Read 作为通用工具权限，而不是给每种产物创建专用视觉工具；CLI 也用稳定 JSON/stream JSON 支持自动化。
- OpenClaw 要求工具通过结构化 `media` / `path` / `filePath` 明确声明出站附件，并对允许读取的本地根做限制；它不会从任意 stdout 文本猜附件。
- 本机 openclacky 也把 shell 作为通用工具，图片文件进入模型前再由 file processor 读取和转码；路径不是 provider durable 身份。
- WorkBuddy 的 artifact/media index 与 sidecar 数据表明“进程产物文件”和“会话可回放媒体记录”是两层事实，host 负责建立关联。

这些产品实现细节不同，但共同结论一致：命令负责产生文件，结构化工具合同负责选择文件，host 负责权限与模型输入转换。

---

## 3. 权威合同与所有权

### 3.1 三类输出不能混用

| 产物 | 物理位置 | durable asset | conversation link | project link |
| --- | --- | ---: | ---: | ---: |
| 人/CI 显式 CLI 输出 | 用户指定 output root | 否 | 否 | 否 |
| Agent 选择给模型的截图 | 复制到 AppData 受管内容存储 | 是 | tool event 成功后写 | 否 |
| 用户显式加入资源库 | 资源库 workflow 决定 | 是/复用既有 | 可已有 | 明确写 |

这里的“复制”是 Agent 工具选择动作的语义，不是 CLI 的默认行为。CLI 输出文件仍可被用户删除；会话回放读取的是 host 已登记的受管副本。

### 3.2 CLI manifest

manifest 至少表达：

- schema version；
- presentation ID、version ID/version number 与 source kind；
- slide size；
- render profile ID、像素宽高和格式；
- 请求的 slide ordinals 与每页结果；
- 每个成功文件相对 output root 的路径、字节数、SHA-256、解码尺寸；
- 结构诊断摘要和稳定 issue code；
- 整体状态、开始/结束时间和 CLI 版本。

manifest 是 CLI 输出事实，不是 asset ledger。host ingest 必须重新计算全部图片事实。manifest 不保存 AppData path、asset ID、conversation ID、provider payload 或模型能力。

### 3.3 Raster request/response

shared 合同只表达 renderer 能力：

- request：request ID、render model 的单页数据、slide size、目标像素宽度/高度、pixel ratio、输出格式与质量；
- response：request ID、成功 PNG/WebP bytes 或稳定错误；
- 不包含 presentation repository、workspace DB、asset ID、文件路径或输出目录。

首版建议只开放 PNG。现有输入图片可为 JPEG/PNG/WebP，但截图输出固定 PNG 能减少颜色、透明度与 manifest 差异。WebP 优化应在有真实空间需求后作为显式 profile 增加，不能静默改变验收像素。

### 3.4 生成图片登记与 claim

asset domain 的公共入口接收“本地候选文件 + 受信调用上下文”，完成：

1. 读取同一份 bytes；
2. 真实解码并校验允许格式、尺寸与上限；
3. 计算长度和 SHA-256；
4. 发布到 AppData 内容寻址存储；
5. 登记或复用 `assets` ledger；
6. 返回 durable asset identity；
7. 可选签发绑定 tool call 的内存 claim。

该入口不写 project link。conversation/tool workflow 也不能通过一个 `registerAsProjectAsset=true` 布尔参数偷混两种业务动作；显式资源库加入应调用另一个 orchestration。

claim selection 应使用独立 URI scheme，例如 `artifact://tool-results/<claim-id>`。它只用于本次 ToolNode 后处理；落库 event 中仍是普通 `RuntimeResourceRef`/asset ID。`asset://assets/<asset-id>` 继续表示已有 durable asset，二者不能互相 fallback。

### 3.5 CLI 与 Agent 的组合

```text
Slides CLI
  -> query PresentationRenderModel
  -> hidden worker raster
  -> atomic PNG writes
  -> manifest.json

human / CI
  -> consume files + manifest

generic command tool
  -> execute CLI under policy
  -> parse declared manifest
  -> select requested image entries
  -> host generated-image ingress
  -> tool-call-bound claims
  -> StructuredToolResult.modelInput
  -> ToolNode resolver
  -> tool_output event + conversation_event_asset_links
  -> Context Manager / materializer / provider
```

CLI 不知道自己是否由 Agent 调用。command tool 也不解析 Slides 私有 stdout；它只处理通用 artifact manifest envelope，Slides manifest 作为 payload 可附加领域诊断。

### 3.6 崩溃、删除与回放

- PNG 已写、manifest 未提交：CLI 以非零退出，临时文件由下一次同 output root 清理或显式 `--overwrite` 策略处理。
- manifest 完成、人/CI 退出：文件完全由用户管理，不产生数据库垃圾。
- host 已发布受管副本、tool event 未落库：ToolNode 在本次调用结束时显式释放未消费 claim；进程崩溃时内存 claim 自然消失，未引用 asset/file 由时间屏障 GC 回收。
- tool event 已落库：event link 是后续 `resource_read`、回放和 materializer 的授权依据。
- 用户删除 CLI 原始输出：不影响已登记的会话副本。
- 用户手动删除 AppData 受管副本：event 仍可回放引用，但 preview/模型读取明确报告内容损坏，不回退 CLI 路径。
- truncate/delete conversation：删除 event links；只有没有 conversation/project/document 引用时才回收 asset 与内容对象。

---

## 4. 全链路顺序

### 4.1 人与 CI

1. CLI 解析 presentation、output root、页范围和 render profile。
2. backend query runtime 取得没有 unresolved draft 的 `PresentationRenderModel`。
3. orchestration 校验页范围并为每页构造 raster request。
4. hidden worker 预载图片和图表，使用同源 renderer 输出 PNG bytes。
5. backend 复核 PNG 解码事实并用临时文件 + rename 原子发布。
6. 所有页面成功后写最终 manifest；失败则写 failure manifest 并返回非零 exit code。
7. CI 按 manifest 的稳定 code、page count、尺寸和诊断阈值判断，不解析日志。

### 4.2 Agent

1. active model 与 command tool requirement 通过 Phase 5 prepare/fallback 门禁。
2. 通用 command tool 在批准的 cwd、env、timeout 与输出上限内运行 CLI。
3. command tool 读取 CLI 声明的 artifact manifest，不扫描整个文件系统。
4. host ingress 对选中图片重新读、解码、hash 并复制到受管内容存储。
5. ingress 登记 asset 并签发绑定 conversation/tool call 的 claim。
6. structured result 只放 observation、UI media 与 claim selections；不放 bytes 或 ledger 事实。
7. ToolNode 用真实成功模型再校验 `tool_result_image`，resolver 消费 claim 并产生 durable refs。
8. tool event 和 links 通过 EventStore 落库；当前 working history 立即携带 attachments。
9. 下一轮 Context Manager 预算和 materializer 重新读取受管副本。
10. provider converter 生成原生 tool-result image blocks；回放使用同一 event link。

---

## 5. 分批实施计划

### P6.0 · 基线、否定门禁与真实 fixture（已完成）

**交付物**：

- 锁定 Phase 5 承重回归、Slides render-model 和 offscreen renderer 基线。
- 准备一份至少包含文本、shape、表格、图表、嵌套 group、背景图和透明图片的 generated deck fixture。
- 记录 imported deck 当前保真边界；不把未支持的导入差异误判为 screenshot regression。
- 增加静态门禁：无 `ppt_*vision*` 专用工具、CLI 不 import DB、worker 不 import backend repository。

**门禁**：fixture 在现有 Renderer 可见；Phase 5 tool image fixture继续通过；没有先写截图旁路。

**实施证据**：`c64033667` 完成全链路调研和基线复验。共复跑 10 个承重测试文件、40 项，覆盖 Slides offscreen renderer、thumbnail、text layout、Phase 5 tool image agent loop、Flow 图片附件、workspace tool resolver、`resource_read` 与 Responses/Anthropic tool image converter。

### P6.1 · 通用生成图片 asset 登记（已完成）

**交付物**：

- 在 asset domain 下新增“登记已生成本地图片”feature，拆分 definitions/functions/orchestration/persistence port。
- 复用真实图片 inspection 和内容寻址发布，记录 MIME、长度、尺寸和 SHA-256。
- 身份登记与 project/conversation ownership 分离。
- 迁移 `text_to_image` 到新入口，删除 `registerGeneratedImagesAsProjectAssets()` 的重复解码/SQL逻辑；是否加入项目资源库由现有产品语义显式编排。
- `text_to_image` 继续把生成文件写入 Workspace `GeneratedImages`，但改由 asset domain 依据真实字节登记身份，再由 workspace workflow 显式建立项目归属。
- URI、MIME、尺寸和 hash 已不再依赖后缀或绝对路径；observation 中的生成文件绝对路径暂时保留，因为 Slides `deck.js` 的 `createImage(src)` 仍依赖真实路径，待 P6.6 提供替代读取链后收口。

**门禁**：同字节幂等复用、伪后缀拒绝、尺寸入账、无自动 project link、事务失败与孤儿回收有业务测试。

**实施证据**：`681a88d05` 新增 `src/domains/assets/features/local-image-registration/`，并把 workspace 项目归属拆到 `generated-image-import` workflow。删除旧 VFS 登记器及伪图片测试；4 个测试文件、12 项通过，backend production build 通过，TypeScript 基线未增加。

### P6.2 · Slides raster 合同与同源 renderer（已完成）

**交付物**：

- 在 Slides shared 定义 raster request/result/profile/error。
- 把 `offscreenKonvaRenderer` 拆到 renderer `features/slide-rasterization`，提取 canvas/bytes 主函数。
- thumbnail store 只做尺寸选择和状态连接，不拥有节点构建。
- worker entry 与缩略图复用同一 raster core。

**门禁**：同一 slide/profile 的缩略图 canvas 与 worker PNG 在可解释容差内一致；测试锁业务节点、透明背景和失败语义，不锁 UI padding。

**实施证据**：`6dc0694a2` 在 `src/shared/slideRasterization/` 建立纯 request/profile/result/error 合同和唯一尺寸取整规则，在 Renderer 建立 `features/slideRasterization/` 单一离屏核心。thumbnail store 只构造 profile 并管理 `ImageBitmap`；canvas、ImageBitmap 和 worker-ready PNG bytes 共用图片/图表预载、Konva stage 和既有 `konvaPreview` builders。旧 `services/offscreenKonvaRenderer` 已删除，图表像素倍率改由 request profile 显式传入。4 个定向测试文件、20 项通过，Slides `tsc + vue-tsc` 与 renderer/backend production build 通过。P6.3 只需给现有 PNG 入口增加严格 worker codec 与宿主生命周期，不再实现视觉规则。

### P6.3 · Slides hidden worker（已完成）

**交付物**：

- 严格 request/response/ready codec，不用 `any` 或宽断言绕过。
- worker HTML、preload、renderer entry 和 CSP。
- backend plugin contribution 声明 hidden worker；启停同步、timeout、crash恢复和 dispose。
- Vite/tsup/plugin artifact 打包包含 worker 文件，dev/prod 路径同源解析。

**门禁**：源码开发、插件构建产物和安装 artifact 三种路径均能 ready + render；插件禁用后 worker 不可调用。

**实施证据**：`e4d444664` 建立 versioned request/response/ready codec、自包含图片门禁、sandboxed worker HTML/preload/entry、backend definition 与 dev/prod/installed 路径解析，并把 worker 注册到 Slides backend contribution。宿主集成测试使用真实 `HiddenWorkerHost` 验证注册调用、畸形响应 fail closed、插件禁用 dispose 和 HTML load 失败；后者同时修复了 host 中 load 先失败时 ready Promise 二次拒绝的生命周期问题。`c73be7143` 让真实 Electron smoke 可对任意插件安装根执行。8 个聚焦测试文件共 19 项通过，Slides 与 plugin-host-contract typecheck、TypeScript 289 基线、完整 plugin build、artifact packaging/extraResources verify 全部通过；开发 `dist` 和 `extraResources/plugins/slides` 均真实返回 2×2、90 bytes 的合法 PNG。worker bundle 当前约 768 KB，属于 Konva/ECharts 首版运行成本，不阻塞 P6.4。

### P6.4 · Screenshot orchestration 与 manifest（已完成）

**交付物**：

- backend screenshot feature 负责 query、页选择、worker invocation、PNG复核、原子写入和 manifest。
- `render` 支持单页、页范围和全稿；输出命名稳定且避免 title/path 注入。
- `inspect` 复用既有 Slides quality/geometry 事实，输出标准 finding，不另写视觉规则或复制 source 结构。
- 整批失败与 overwrite 行为明确。

**门禁**：manifest 与实际文件数量/hash/尺寸一致；任一页失败不生成 success manifest。

**实施证据**：`b45df0c2b` 定义 screenshot 页选择、profile、manifest 与稳定错误合同；`753d84f20` 完成 data URI、绝对本地文件和 PPTX embedded part 的受控物化，并在同一 bytes 上做真实解码、长度、尺寸和 hash 复核；`cce2c55be` 建立同一版本 snapshot 查询、逐页 worker 调用、staging、PNG 发布与 manifest-last 整批提交；`ecc860659` 用真实 Electron 串通 worker 与 screenshot runtime，并验证构建 artifact/安装布局可执行。`20db24fa7` 再把 `ppt_inspect` 原有的页选择、source location 与 quality/geometry feedback 编排收进共享 `presentationInspection` feature，供 P6.5 CLI 直接复用；同时修正工具曾把数字版次当 `versionId` 的身份错误，并删除旧两段式工具 port 与无调用方筛选函数。截图、inspection、工具和 coordinator 5 个聚焦测试文件共 77 项通过，跨 host 文件工具合同 24 项通过；Slides typecheck、TypeScript 289 基线与完整 plugin build 均通过。稳定合同已写入 `features/presentationScreenshot`、`features/presentationInspection`、backend 和 coordinator README，未反向链接本文。

### P6.5 · 人/CI CLI（已完成）

**交付物**：

- 增加稳定 CLI 入口和 package script，参数解析与 orchestration 分离。
- Electron main 启动 hidden worker 的首版宿主，明确 headless Linux 对 display/xvfb 的运行要求。
- stdout/stderr、JSON manifest、exit code 和 `--help` 合同。
- CI 示例只消费 manifest，不依赖应用 UI 或 workspace DB 私有结构。

**门禁**：真实 fixture 从命令行生成所有 PNG；成功、参数错误、presentation不存在、worker失败有稳定 exit code。

**实施证据**：`52c09408f` 新增 domain-first 的 `presentationCli` feature，参数解析、inspection report、命令编排和 Electron main 分层；`render` 以 manifest 为机器真源，`inspect` stdout 为单个 JSON，运行日志统一进入 stderr。CLI 只以 `readonly + fileMustExist` 打开 workspace SQLite，不迁移、不写表；render 才注册 hidden worker，help 和参数错误不会加载 Slides 查询引擎。exit 0/2/3/4/5/6/10 分别覆盖成功、参数、presentation、渲染、输出、display 和未分类启动失败，领域 4 个测试文件 13 项通过。真实 workspace presentation 已生成 640×360、4850 bytes PNG，manifest 的版本身份、producer、尺寸、字节数与 SHA-256 均和磁盘文件一致；inspect stdout 可被 `jq` 直接解析，FeatureFlags 日志全部在 stderr。Slides 与 plugin-host-contract typecheck、TypeScript 289 基线、完整 plugin build、zip/SHA512/extraResources verify 均通过；`extraResources/plugins/slides` 中的 CLI entry 已真实通过 help 和 320×180 render。稳定合同已写入 `features/presentationCli/README.md` 与 Slides backend README，未反向链接本文。CLI bundle 当前约 14.9 MB，复用的是既有查询、诊断和 host SDK，不是第二套 renderer；发布产品 launcher 和 bundle 体积仍列为后续风险。

**审计修复**：风险 32 已关闭。数据库只读连接与 pragma 初始化由 CLI infrastructure 边界归一化，失败稳定使用 `slides.cli.database_unavailable` 和 exit 3，且不回显数据库路径；截图 output infrastructure 对目录创建、既有文件检查/清理、staging、写入、发布和清理失败统一保留 `slides.screenshot.output_write_failed` 和 exit 5。presentation 查询的未知失败仍只在 orchestration 映射为 `slides.cli.presentation_unavailable`，三类失败不再互相冒充。

### P6.6 · 通用 command 与 artifact 接入边界（已完成）

**交付物**：

- 建立 command domain 的窄 port：argv（不拼 shell 字符串）、cwd、env allowlist、timeout、cancel和输出上限。
- 定义通用 artifact manifest envelope；命令工具只读取显式 manifest path。
- 不把 Slides CLI 私有字段写进 linnkit；command domain 只返回通用 envelope 候选，选中图片的 asset ingress 与 claim 编排归 P6.7。
- linnkit 支持按规范化后的真实调用参数动态解析 model input requirement：纯文本命令不要求视觉，显式选择图片 artifact 时在工具执行前要求 `tool_result_image`，prepare与active model门禁沿用Phase 5。

**门禁**：命令注入、越界 cwd、符号链接逃逸、超时和超量输出明确失败；纯文本命令不产生图片 requirement。

**实施证据**：`a9a1e9909` 在 linnkit ToolNode 增加调用级 `resolveModelInputRequirement(args)`，动态 requirement 在参数规范化后、工具执行前校验，静态 requirement 继续只负责 prepare 阶段路由过滤。`8c52035f1` 新建独立 commands domain，以 host registry 短 ID 解析 executable，固定 `shell:false`，并约束 argv、真实 cwd 根、环境变量、timeout、cancel 和 stdout/stderr 上限；同批定义 strict、versioned artifact envelope，拒绝绝对路径、`..`、反斜杠、未知 ledger 字段和符号链接逃逸。`b8852ff70` 让插件仅在 host 设置 `LINNYA_COMMAND_ARTIFACT_MANIFEST` 时发布通用 envelope，普通人/CI CLI 合同保持不变。`4d0720ee8` 增加 Linnya 主进程受控 command mode 与不可被调用方覆盖的 descriptor `argvPrefix`；开发版固定定位仓库插件产物，发布版固定定位 `resources/plugins`，未知 command ID 稳定 exit 2，命中后不加载普通应用生命周期。command domain 13 项测试、linnkit 动态 requirement 4 个文件 29 项测试、TypeScript 289 基线与主进程构建均通过；真实 Electron marker 已完成 help、未知 ID 和 320×180 Slides render，通用 envelope 与 PNG hash/尺寸一致，且放到 execution root 外的 manifest 被正确拒绝。

### P6.7 · Claim、event ownership 与 GC（已完成）

**交付物**：

- tool-call-bound claim registry与 `artifact://tool-results/<claim-id>` parser。
- resolver 同时支持既有 asset URI 与当前工具 claim，但两条授权规则严格分离。
- EventStore 成功后 durable link 接管；失败/崩溃留下的无引用内容由时间屏障 GC 回收。
- truncate/delete/shared content对象回归；项目会话不自动创建project link。

**门禁**：跨 conversation、跨 tool call、重放旧 claim、重启后 claim 全部失败；event replay用 asset link 成功。

**实施证据**：`0769c1fd4` 把 AppData 内容寻址发布提升为 asset domain 的 `managed-image-storage`，保留既有 `ConversationAttachments/v1` 物理布局但删除 conversation 内的重复规则；发布改用不覆盖 hard link，并在并发命中时重验既有 hash，修掉 POSIX `rename` 会覆盖损坏目标的旧隐患。同批 `managed-image-ingress` 从命令源文件重新读取、真实解码、复制后登记 `/Resources/Attachments/...` asset，不写项目归属。`66daa451d` 增加进程内、短 TTL、一次性 tool-result claim，并让 resolver 对 `asset://` durable link 与 `artifact://` current claim 严格分流；claim 绑定 conversation/tool call/selection，跨作用域、过期、重复消费和重启均失败。`eb2cbf409` 在 Linnya host 增加 command-image artifact ingestion workflow，按显式 artifact ID 选择、全部复制登记成功后整批签 claim，只返回 `id/uri/label`；集成测试已串通 claim → resolver → tool event → EventStore link，并验证删除 CLI execution root 后仍能读取和回放、项目会话不产生 project link。`520aa1ffa` 给未引用 asset ledger GC 补上与文件 GC 相同的进程启动时间屏障，关闭“启动维护撞上 ingress → event transaction 窗口”的竞态。最终 7 个承重测试文件 33 项通过，覆盖受管发布、claim、resolver、EventStore 原子回滚/重放和 GC；TypeScript 基线保持 289。稳定合同已写入 asset 与 command host README，未反向链接本文。

**审计更正**：进程启动时间屏障只排除了“新建 asset 被候选查询选中”，没有排除“旧 orphan 的 canonical 内容路径被新进程同内容 ingress 重新占用”。GC 删除旧 ledger 行后、删除文件前存在多个 `await`，此窗口内新 asset 可复用同一路径，随后仍被旧 GC 快照 unlink。项目会话的 durable 重读也未成立：当前 resolver 在会话带 `project_id` 时只查 `project_asset_links`，不会接受本会话自己的 `conversation_event_asset_links`。

### P6.8 · 真实 Slides 到 provider 验收（已完成）

**交付物**：

- generated Slides → CLI PNG/manifest → command tool → asset/claim → tool event → Context Manager → Responses/Anthropic body。
- 刷新SQLite后用 `resource_read(asset://...)` 再读同一截图。
- active model不兼容、图片损坏、删除原CLI输出、fallback与retry业务场景。
- 日志/audit/provider body泄漏扫描。

**门禁**：模型真实收到截图bytes；durable面没有bytes/path/claim；删除CLI输出不影响回放；不兼容模型在执行前失败。

**历史实施证据**：早期版本曾用结构化 `command` 工具验证 CLI artifact/claim 链；该入口已在迁移完成后删除。当前稳定真源是插件 CLI guide、Shell/resource 文档和通用 conversation-file GraphLoop 测试，不再维护旧 command 协议。

**审计更正**：`CommandTool` 只进入了 host 的全局工具全集，没有进入当时 SlidesAgent 或现已退役的 Slides Editor `availableTools`。linnkit 每次 LLM 调用又严格按该白名单取 schema，因此生产模型看不到 `command`；现有 GraphLoop 测试手工传入 `new CommandTool()` 和 stub runtime，绕过了真实 AgentDefinition、插件启停与 route assembly。所谓“刷新后 durable link”也没有覆盖项目会话通过 `resource_read(asset://...)` 的第二次读取。

真实 Electron 产品装配 smoke 应从生产 Slides AgentDefinition 的 `shell` 工具开始，经 `linnya-slides` native client、父 execution bridge 与 hidden worker 生成 PNG，再用 conversation-file `read_file` 和 materializer 把同一 bytes 送入 provider。standalone CLI 的 packaged smoke 单独覆盖人、开发脚本和 CI 入口；不为 Slides 保留专用 Agent 工具。

### P6.9 · 稳定文档迁移与临时材料归档（已完成）

**交付物**：

- Slides README记录raster/worker/CLI真源和命令用法。
- asset正式README记录identity、ownership、generated ingress、claim和GC。
- Shell、Plugin CLI 和 artifact README 记录安全边界与产物合同。
- 更新会话附件总领文档中“用户导入”与“工具派生”的共同/不同生命周期。
- 18-24号只保留实施证据，稳定README不链接它们。

**门禁**：删除所有Phase文档后，开发者仍能从稳定README完成provider、工具、Slides CLI和asset接入。

**实施证据**：`847e46646` 将受管图片 GC 迁入 asset domain 的 `managed-image-maintenance`，conversation 只保留旧数据迁移；5 个维护测试文件 16 项与主进程构建通过。`235a1bb4e` 在 commands domain 增加作用域受限的 host external resolver，只允许已登记 CLI 目录请求固定运行时，并删除 Slides 自行猜测 host 路径的临时方案；3 项安全边界测试、Slides typecheck、开发 Electron marker render 均通过。最终真实 macOS 目录包完成 ad-hoc smoke：未知 ID exit 2、`slides --help` exit 0、真实 workspace presentation render exit 0，PNG 为 `320×180`、1430 bytes，manifest 与磁盘 SHA-256 完全一致。深度审计后又把官方插件生产 `dist` 目录收进 release target 单一清单，zip、checksum、extraResources 共同按白名单生成和反向校验；保留本地 `dist/dev/raster-worker-smoke.cjs` 的情况下，Slides `1.1.0` 与另外三种插件结构均重新打包验证通过，旧 `1.0.3` 本地产物已清除。稳定 README 已承接 asset 身份/维护、command 安全边界、host artifact 编排和 Slides CLI 构建验收合同，且没有反向链接 18-24 号临时文档。

**最终审计闭环**：风险 24-40 已按产品可达性、active plugin CLI、durable ownership、启动 GC、raster fail-closed、完整 codec、共享字体规则、CLI 错误分类、artifact 白名单、工具协议配对、批次原子登记、真实产品 smoke、claim/process 生命周期、资源预算和 observation 脱敏逐项关闭。后续迁移删除了 Slides 专属 Agent command、旧 Hosted Command 和会启动 Electron 的 launcher，统一改为生产 AgentDefinition → `shell` → `linnya-slides` thin client → 当前 App bridge/hidden worker → conversation-file `read_file` → provider；主进程只持有通用 Plugin CLI 合同，不解析 Slides 参数。

---

## 6. 业务测试矩阵

| 场景 | 必须证明 |
| --- | --- |
| generated全要素deck | Renderer与worker消费同一render model和raster core |
| 单页/范围/全稿 | 页序、文件名和manifest顺序稳定 |
| 透明背景/图片/图表 | PNG解码尺寸正确，不出现空白canvas |
| unresolved deck.js draft | CLI拒绝旧compiled checkpoint |
| worker timeout/crash | 本次失败、host可重建、无假success manifest |
| 人/CI CLI | 不写assets/project/event表 |
| Agent选中截图 | 只登记选中项并绑定当前tool event |
| project conversation | 截图不产生project link，不进入资源库 |
| claim越权/重放 | 跨run、跨call、跨conversation、重启后均失败 |
| event事务失败 | 无半条event/link；孤儿asset按时间屏障回收 |
| 删除CLI原文件 | 已登记会话截图仍可preview/materialize |
| 删除受管副本 | 明确integrity error，不回退源路径 |
| `resource_read`重读 | event link授权，进入同一tool image链 |
| 不兼容active model | command/tool执行前或附件后处理阶段明确拒绝，不进provider |
| Responses/Anthropic | 原生tool-result image blocks顺序与call ID正确 |
| 日志与审计 | 无图片bytes、base64、绝对路径、claim或hash泄漏 |

不为 CSS、README、CLI帮助文本逐字或大面积图片snapshot写测试。视觉回归以少量语义fixture、canvas非空像素、关键节点存在和端到端真实输出为主。

---

## 7. 验收与静态审计

每个批次至少执行：

1. 触达包的typecheck和业务测试。
2. Slides plugin build与artifact verify。
3. Phase 5真实tool image回归。
4. `rg`确认没有新增PPT专用AI视觉工具、durable path/base64、按扩展名猜MIME或生产`any`。
5. 检查worker、CLI和asset domain的依赖方向。

最终必须人工执行一次真实命令行验收，并在 Electron 开发应用内让Agent读取该截图。只有CLI生成文件不算完成；只有应用UI能截图也不算完成。

---

## 8. 风险台账

| 编号 | 风险 | 处理阶段 | 状态 |
| --- | --- | --- | --- |
| 1 | offscreen renderer复制后产生两套视觉规则 | P6.2 | 已关闭：thumbnail/worker-ready PNG 共用单一 feature |
| 2 | worker源码可用但插件artifact漏HTML/preload/chunk | P6.3 | 已关闭：zip、checksum、extraResources 与真实安装路径 smoke 全覆盖 |
| 3 | CLI被误当纯Node，CI无DOM/Canvas/字体 | P6.3-P6.5 | 已关闭：CLI由Electron main启动hidden worker；Linux无display稳定返回exit 6并明确要求Xvfb/WAYLAND_DISPLAY |
| 4 | screenshot自动加入project link污染资源库 | P6.1/P6.7 | 已关闭：tool asset只写全局账本，EventStore建立conversation link，集成测试确认project link为0 |
| 5 | 新asset在event前无归属，resolver被错误放宽 | P6.7 | 已关闭：只通过绑定conversation/tool call/selection的一次性claim授权，durable asset规则未放宽 |
| 6 | CLI manifest自报事实被host信任 | P6.4/P6.7 | 已关闭：host只信artifact选择与受控相对路径；MIME、长度、尺寸、hash均从复制前真实bytes独立解码计算 |
| 7 | stdout自然语言被解析成artifact路径 | P6.5/P6.6 | 已关闭：render机器真源固定为manifest，inspect stdout为正式JSON；command host只消费显式strict artifact envelope |
| 8 | tool执行失败留下asset/file孤儿 | P6.7 | **已关闭**：孤儿允许短暂存在并由下次启动维护回收；维护在所有 ingress 开放前同步完成，物理删除前再复核当前账本是否占用 canonical path，见风险 28 |
| 9 | tool result图片被伪装为user image扩大route支持 | P6.6/P6.8 | 已关闭：动态 requirement 在执行前校验图片输入能力；真实GraphLoop锁定Responses的`function_call_output + input_image`与Anthropic的`tool_result + image`，未伪装为user message |
| 10 | `text_to_image`旧登记函数按后缀猜MIME且泄漏路径 | P6.1/P6.6 | 部分关闭：MIME、尺寸与 URI 已修；observation 路径待替代链 |
| 11 | hidden worker contract用unknown registry造成类型真源漂移 | P6.3 | **已关闭**：envelope、结果和完整 render-model 嵌套 payload 都在 unknown 边界逐层校验；见风险 30 |
| 12 | imported deck与generated deck本来就有视觉差异，被截图测试误判 | P6.0 | 已建立分层基线；后续 fixture 分开验收 |
| 13 | command domain范围膨胀成无权限任意shell | P6.6 | 已关闭：只接受host registry短ID、固定executable/argv前缀、`shell:false`和受限cwd/env；尚无审批系统前不暴露任意Bash |
| 14 | AppData物理目录仍叫ConversationAttachments，工具派生物语义变宽 | P6.1/P6.9 | 已关闭改名决策：作为兼容物理布局保留，业务所有权已迁入asset domain；无迁移合同不改目录 |
| 15 | `pathManager`同时承担AppData与Workspace业务命名，继续成为上帝模块 | P6.1 | 存量债；只通过窄port消费 |
| 16 | 开发/extraResources中的CLI entry可运行，但发布后的Linnya可执行文件尚无外部launcher合同 | P6.6/P6.9 | 已关闭：真实packaged可执行文件的未知ID、help与320×180 render均通过；host external固定白名单解析app runtime |
| 17 | CLI bundle包含完整Slides查询/诊断与host SDK，当前约14.9 MB | P6.5/P6.9 | 已知体积债：本阶段保留单一业务真源；未来只能通过可测量的shared chunk/host contract优化，不能复制引擎换体积 |
| 18 | packaged CLI 的 Yoga ESM 加载合同有洞：host 白名单只有 `yoga-layout`，loader 实际 `require.resolve('yoga-layout/load')` 且只钩 `Module._load`、不钩 `require.resolve`；CLI 也未随包分发 `yoga-layout` | P6.9 后 | **已关闭**：host resolver 同时接管 CLI 目录内固定白名单的加载与 `_resolveFilename`，并精确加入 `yoga-layout/load`；5 项边界测试锁定子路径只从host解析且不向目录外开放。真实packaged command-mode探针已从`app.asar` runtime加载Yoga ESM并计算`320×180`节点，恢复正式CLI后render仍exit 0 |
| 19 | `tool_output.output.result.modelInput` 可能残留 `artifact://` claim URI | P6.7/P6.8 | **归档审计（低）**：durable `attachments`、event asset links 与 provider body 已只用 asset/resource ID；若要求 event payload 字面零 claim，需在 persist 前剥离 `modelInput` |
| 20 | `CommandTool` 嵌套 `arguments` 未设 `additionalProperties: false` | P6.6 | **归档审计（低）**：未知键仍被 Slides argv 解析层拒绝，运行时边界成立，失败点偏后 |
| 21 | exit code 6/10 有实现、无领域单测 | P6.5 | **归档审计（低）**：display 不可用与未分类启动失败仅由 `electronMain` 覆盖 |
| 22 | `text_to_image` observation 仍含绝对路径 | P6.1/P6.6 | 与风险 10 同条；仍为部分关闭，待替代读取链 |
| 23 | CLI 对旧 generated deck 恢复 source span 时没有注册 `ppt_compose` sandbox profile | P6.5 | **归档后验证新发现（低）**：`PresentationQueryRuntime` 捕获失败并回退已编译 `deck_spec_json`，截图像素不受影响；部分旧 deck 的 inspect 可能缺源码定位并产生告警。后续应明确 CLI 是否需要源码定位，再选择注入只读 sandbox 编译能力或显式禁用恢复，不能静默加全局 profile |
| 24 | 生产 Slides Agent 没有暴露 `command` 工具 | P6.8 审计 | **已关闭**：专用 `command` 已退役；Slides Agent 通过通用 `shell` 调用 `linnya-slides`，Slides Editor 已退役，插件启用集成测试验证真实 AgentDefinition 与工具白名单 |
| 25 | Phase 6 改变 Slides artifact 和 host contract，却沿用已发布的插件 `1.0.3` / `minApp 0.0.36` | 发布审计 | **已关闭**：Slides 插件升级为 `1.1.0`，最低宿主提升至首次完整提供 hidden-worker/command host 合同的 `0.0.38`，release note 与 manifest 版本一致 |
| 26 | packaged command mode 固定读取随应用发布的 `Resources/plugins/slides`，不读取当前 active 插件版本，也不服从插件启停 | 插件/host 审计 | **已关闭**：manifest 新增 `entry.command`；packaged descriptor 固定插件安装根，command mode 每次按 `active.json` 解析当前版本 entry，插件停用后 registry 不再暴露 descriptor。测试覆盖 active 从旧版切新版和 entry 缺失 |
| 27 | 项目会话不能通过本会话 event link 重读工具图片 | P6.7-P6.8 审计 | **已关闭**：durable asset 授权改为当前 project link 或当前 conversation event link；项目上下文仍严格匹配，同项目其他会话不能读取 conversation-only asset，也不会补写 project link |
| 28 | 启动后异步 asset GC 可删除刚被重新登记的同内容图片 | P6.7 审计 | **已关闭**：受管图片迁移与 GC 从延迟维护拆出，在数据库初始化后、插件和路由装配前同步等待完成；删除物理文件前再次查询当前 `local_path` 是否有 ledger owner。resolver/GC/command artifact 生命周期 3 个业务测试文件 12 项通过 |
| 29 | raster worker 图片解码失败会画 placeholder 并发布 success manifest | P6.2-P6.4 审计 | **已关闭**：图片预加载增加显式 omit/reject 策略；普通 UI 保留 placeholder，raster worker 任一资源解码失败稳定返回 `slides.raster.resource_load_failed` 且不创建 stage/manifest。诊断摘要已删除 data URI 与路径 preview，只保留类别和长度 |
| 30 | Slides worker codec 只恢复 render-model 外壳 | P6.3 审计 | **已关闭**：独立 RenderModel codec 严格校验背景、通用节点字段、text runs/layout、table cells、chart series/axes 和递归 group；复杂合法 payload 往返，四类嵌套畸形 payload 均在 worker request 边界拒绝 |
| 31 | hidden worker 为字体解析复制了一套插件私有规则 | P6.2 审计 | **已关闭**：Office/CJK/Latin 候选栈与 CSS quoting 由 `@linnya/renderer-ui/font-stack` 纯叶子入口唯一实现；宿主字体探测、Slides 主 Renderer 和 hidden worker 共用该规则，插件私有 fallback 表已删除。早期独立 `renderer-platform` 薄包已在 consumer 审计后并回 Renderer UI，不再形成无独立生命周期的 package |
| 32 | CLI 启动/输出错误没有稳定落到文档声明的 exit code | P6.5 审计 | **已关闭**：数据库启动失败由只读 DB infrastructure 映射为 `slides.cli.database_unavailable`/exit 3；输出目录创建、检查、清理、staging、写入和发布失败由 screenshot output infrastructure 映射为 `slides.screenshot.output_write_failed`/exit 5；两侧均不回显底层路径 |
| 33 | 插件 artifact 会夹带打包前残留的 `dist/dev/**` | 发布审计 | **已关闭**：官方插件生产 `dist` 目录由 release target 显式登记，未登记插件只从 manifest entry 父目录推导；zip、`SHA512SUMS`、`extraResources` 共用白名单并拒绝额外文件。本地保留 `dist/dev` 的真实反例下 Slides `1.1.0` 与另外三种插件结构均验证通过，打包同时清理旧版本本地产物 |
| 34 | 动态 `resolveModelInputRequirement` 抛错会绕过 ToolNode 配对错误协议 | linnkit 审计 | **已关闭**：execution setup 在规范化参数后隔离 resolver 异常，输出稳定 `tool.model_input.requirement_resolution_failed`，按 capability deny 生成配对 error `tool_output` 与 `tool.deny`，不泄漏宿主异常原文、不累计 protocol fuse，并继续 drain 同批 sibling calls；批次级测试已覆盖一拒绝一成功 |
| 35 | “通用” CommandTool 与 command mode 实际硬编码 Slides | command 审计 | **已关闭**：通用 `CommandTool` schema 只保留 opaque command ID、命令自有 arguments 和 artifact selection，不再复制 Slides 字段；Slides agent prompt 明确 arguments 嵌套合同，`createSlidesAgentCommandRuntime`、专属 parser/argv builder 与 Electron catalog 留在 Linnya app-host。第二个真实产品 CLI 出现时再评估 catalog-driven 模型说明；未来 Bash 必须使用独立工具、权限/审批/cwd/env/输出/审计合同，只复用底层 process primitive，不注册为 `command_id="bash"` |
| 36 | 多张生成图片加入项目资源库不是批次原子操作 | 跨阶段审计 | **已关闭**：local-image-registration 将文件读取、真实解码和内容事实准备拆到事务外；generated-image-import 先准备完整批次，再用单一短事务写全部 ledger/link，并只在提交后发布一次 mutation。业务测试分别覆盖第二张解码失败零写入，以及第二条 project link 失败时整批 asset/link 回滚且零事件 |
| 37 | 没有一条测试从真实 Slides AgentDefinition 串到真实 CLI、event、重启后 resource_read 和 provider | P6.8 审计 | **已关闭**：新增自包含 Electron 产品装配 smoke，从 enabled Slides AgentDefinition 与模型可见 command schema 出发，真实执行 CLI/hidden worker，提交 tool event 后关闭并重开 SQLite，再经真实 `resource_read`、resolver、materializer 和 Responses converter 核对 provider 收到同一 PNG bytes；同时验证 command run 清理、零 project link 与 path/hash/durable 字段不出 provider |
| 38 | 未消费 claim 只在再次消费同一 claim 时清理；command timeout 只 kill 直接子进程 | 运行维护审计 | **已关闭**：`e3d9b4e52` 为通用 model-input resolver 增加 tool-call completion 合同，ToolNode 从工具执行开始用 `finally` 覆盖结构校验、resolver、成功与异常出口；host 按 conversation/tool call 释放未消费 claim，sibling 不受影响且不依赖 timer。command process 在 POSIX 独立进程组、Windows 使用 `taskkill /T /F`，timeout/cancel/output failure 统一终止进程树；真实 Node 父子进程测试与 claim/ToolNode/host resolver 业务测试共 27 项通过，linnkit/main build 及 TS 289 基线通过 |
| 39 | Agent schema 允许的 `width × pixel_ratio` 组合可超过 screenshot 40M 像素上限；ingress 又在字节上限前整文件读取 | 参数/资源审计 | **已关闭**：`4106f709e` 把 4000 万输出像素预算提升到 Slides shared raster public contract；Agent host 与直接 CLI 在执行前用正方形包络稳定拒绝超限 width/pixel-ratio，runtime 加载真实页面比例后继续按实际宽高精确复核。managed-image-ingress 新增显式字节预算，在 `lstat` 后、`readFile` 前拒绝超大来源；生产装配复用会话 ingress 命名策略。定向 7 个测试文件 22 项、Slides 全量 build、main build 与 TS 289 基线通过 |
| 40 | `resource_read` 图片 observation 把 durable asset ID 作为文本送入 provider | 风险 37 实施发现 | **已关闭**：asset URI 只保留在 host 结构化 `data/modelInput` selection，模型 observation 只说明图片已附加；资源工具测试与真实产品装配 smoke 均锁定 provider 文本不含 asset ID，本地路径和 hash 仍由 converter 门禁拒绝 |
| 41 | 通用插件 artifact verifier 按 Slides ID 硬编码 worker、CLI loader 与 stdlib 路径 | 插件发布审计 | **已关闭**：Slides 专属文件、目录、浏览器 runtime 与最小文件组移入官方 release target 的声明式 `artifactVerification`；通用 verifier 只解释声明，并统一验证 zip、SHA512SUMS、extraResources 和浏览器产物。`entry.command` 本身继续由 manifest 通用入口校验，不再重复写死 CLI 文件名 |
| 42 | Slides raster worker 的开发 watcher 把参数转发成 `vite build -- --watch`，单次构建后退出并触发 `concurrently --kill-others` 关闭整个 Electron 开发环境 | 前端人工验收 | **已关闭**：插件脚本直接执行 `vite build --config vite.raster-worker.config.mts --watch`，不再经过嵌套 pnpm 参数转发；单独 watcher 已验证持续存活，完整 `dev:electron` 必须继续作为人工验收前置门禁 |

以下为 2026-07-24 Phase 6 深度独立审计及修复复验结论。三路审计分别覆盖 Slides artifact/renderer/CLI、host/commands/assets/persistence、linnkit runtime/context/tool/provider；主线程另按正式开发规范交叉复核真实 Agent 装配、插件启停升级和跨域时序。

- **最终结论：通过**。首次审计、规范复核及前端启动验收发现的风险 24-42 已全部关闭，生产 Agent、active plugin command、项目会话重读、启动 GC、工具失败生命周期和 provider 请求形成同一条可执行产品链。
- **承重合同**：人/CI CLI 只读数据库；renderer/worker 共用 raster core；command process 固定 `shell:false`、cwd/env/timeout/output 边界；manifest 相对路径且由 host 独立重算；claim 绑定 conversation/tool call/selection；EventStore 原子写 event/link/projection；截图不写 project link；Responses/Anthropic 使用原生 tool-result image；linnkit 不反向依赖 host/Slides。
- **测试结论**：局部领域测试之外，产品级 Electron smoke 已从真实 AgentDefinition 和 active plugin entry 出发，覆盖 CLI/hidden worker、claim、event、SQLite 重启、二次 `resource_read` 与 provider bytes；GC/ingress 竞态、未消费 claim、进程树终止和资源预算另有业务测试锁定。
- **非阻断债**：风险 17、19-23 继续按表内边界保留；`text_to_image` observation 的绝对路径是现有 Slides `deck.js` 图片来源合同，不在缺少稳定替代引用时强删。未来 Bash/通用文件读取必须建立独立权限与路径合同，不能把当前受控 `command` 扩成任意 shell。
- **文档边界**：稳定 README 已承接插件 command contribution、失败策略、durable ownership、GC 和资源预算合同，且不反向链接本临时 runbook；18-24 号只保留阶段证据，后续可统一删除。

### 8.1 审计修复顺序

1. **先恢复真实可达性与发布身份**：风险 24、25、26。否则后续 provider 验收仍是在测试 harness 内自证，用户和已安装插件拿不到能力。
2. **再修 durable ownership 与回收时序**：风险 27、28。项目会话授权应是“同项目资源或本会话历史 event link”，同时继续拒绝跨会话 conversation-only asset；GC 必须与 ingress 生命周期互斥，不能只加更多时间判断。
3. **收紧截图真实性**：风险 29、30、31。worker/CLI 对资源加载失败必须整批失败，缩略图才允许 placeholder；完整 codec 与字体平台真源要在同一批收口。
4. **补产品级验收**：风险 37。测试从真实 Slides AgentDefinition 出发，验证工具 schema 可见、插件 enabled/active 版本一致、真实 CLI 产出、event 落库、重启后二次 `resource_read`、provider 收到 bytes；局部错误场景继续留在各 domain 测试。
5. **最后收口错误分类和维护债**：风险 32-42。Bash 不属于 Phase 6 修复范围，不把它塞进现有 Slides 参数 schema。

---

## 9. Phase 6 完成条件

只有同时满足以下条件，Phase 6 才能标记完成：

- 人/CI可用CLI稳定生成PNG和manifest；
- current Renderer与hidden worker共用同一raster core；
- Agent 通过通用 `shell` 调用 `linnya-slides`，并用 conversation-file `read_file` 读取截图，没有 PPT 专用模型旁路；
- 新截图只获得conversation/tool-event ownership，不自动进入项目资源库；
- SQLite刷新和历史回放后仍能通过asset link读取；
- 删除CLI原文件不影响受管副本，删除受管副本得到明确损坏错误；
- active model/fallback/provider能力门禁仍然成立；
- 稳定README已承接全部长期合同，Phase临时文档可以删除。

---

## 10. 调研结论

本阶段不是“给 Slides 加一个截图按钮”。它新增的是一条可复用的文件生产与模型读取链：领域CLI生产普通文件，host选择并登记受管asset，ToolNode绑定durable event，Phase 1-5负责上下文、能力、回放和provider转换。

最容易犯的两个错误是：为了让Agent马上看图而新增PPT专用工具，或为了复用已有resolver而把所有截图自动加入项目资源库。前者制造第二条模型上下文通道，后者把内部推理产物伪装成用户资源。P6.1-P6.8的批次顺序就是为了先建立正确所有权，再接入CLI和Agent。
