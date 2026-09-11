# Slides CLI

跨插件的 CLI 所有权、active artifact、宿主执行、启停和验收规范见 [插件 CLI 与宿主受控执行](../../../../../../../docs/plugins/guides/21-plugin-cli.md)。本文件只描述 Slides 自己的 parser、领域操作、JSON 报告和截图产物。

`presentationCli` 是 Slides CLI 领域 feature。它提供 `render`、`inspect` 和 `fonts` 子命令。

## 与 Linnya CLI 的区别

| 入口 | 调用方 | 作用域与能力 |
| --- | --- | --- |
| `linnya tools ...` | 外部 Agent、脚本、人 | 连接正在运行的 Linnya，在 Conversation/项目作用域内调用五个 Workspace 工具；可用 `write_file/edit_file` 修改 `.slides` 源码 |
| `linnya-slides ...` | Linnya Agent 的受管 Shell | 使用本次 Shell execution 的临时 bridge，复用当前 App 的数据库、Coordinator、权限和 raster worker |
| Standalone Slides CLI | 外部 Agent、人、CI | 独立 Electron command，直接读取指定 Workspace 数据库；只提供 `render/inspect/fonts`，不修改文稿 |

三者不是别名。尤其不能从普通终端直接拿 `linnya-slides` facade 连接当前 App：它只在 Linnya 启动的父 Shell 内拥有短期有效的 endpoint/token。外部进程使用 Standalone 模式；需要通过当前 App 修改文稿时使用 [Linnya Conversation CLI](../../../../../../../apps/linnya-cli/README.md)。

CLI 是独立 Electron main process，不经过完整应用的 platform runtime effects。除轻量 `help` 与 `fonts` 查询外，进入 presentation 命令前必须显式初始化同一份系统字体解析目录与 system text measurement runtime，并等待完成；否则 RenderModel 会把字体记为 `not-ready`、cluster advance 退回 heuristic，CLI 截图与主应用可能产生不同断行或字形边界。构建制品因此必须同时携带 Yoga 与 HarfBuzz 两个窄 CJS runtime loader。
前两者共用 parser、领域 orchestration、presentation inspection 和 hidden raster worker，不拥有第二套 PPT
渲染或诊断规则；standalone adapter 只装配 current document 只读投影与 generated render-model builder，禁止
引入 PptCoordinator、codegen、assembler 或 mutation compiler。`fonts` 只消费平台字体查询合同，不依赖
presentation、workspace DB 或 PptCoordinator。
人/CI 的 standalone command mode 与 Agent 的当前 App bridge 是两个宿主 adapter。

仓库入口是根目录脚本 `pnpm slides:cli -- <command> ...`。CLI bundle 位于 Slides artifact 的 `dist/cli/slides-cli.cjs`，必须由 Electron main 运行；纯 Node 不具备 Konva、Canvas、字体和 ECharts 所需的 renderer 环境。

通用 Plugin CLI command mode 按插件 ID 和 active artifact 解析独立入口。开发布局从主进程 bundle 定位
仓库内插件产物；发布布局从用户数据目录的 `active.json` 读取当前启用版本，再解析 manifest 的
`entry.command`。调用方不能提供或改写 CLI entry。

Agent 使用 Shell 调用 PATH 中的 `linnya-slides` 薄 client。client 作为父 Shell 的普通子进程，通过
execution-scoped bridge 寻址 enabled `pluginCli` contribution。`slidesPluginCli.prepare` 只解析 opaque argv
并声明 access plan；权限通过后，execute 从窄 host context 取得当前 workspace DB，复用主 App 的
`getSharedPptCoordinator(db)` 和 `slides-raster` hidden worker。render 输出目录固定为当前 conversation 的
`slides-renders/presentation-<id-hash>/` 当前版本工作集，禁止 `--output`、`--overwrite` 和 `--database`。工作集再按版本与 raster profile 隔离；新版本成功后淘汰旧版本，已经被 `read_file` 接管的历史图片不受影响。该链会启动极小原生 client，但不启动
第二个 Electron，也不使用 `LINNYA_PLUGIN_RUNTIME_DATABASE_PATH`。

独立 CLI 仍可由 `pnpm slides:cli`、CI 或 packaged command mode 启动。它必须显式传 `--output`，可以用
显式 `--database` 或 host CLI 环境，并以自己的只读数据库 adapter 创建 execution runtime。该 runtime 从
`presentation_documents`、当前 revision 对应 draft 和 workspace project 形成同一次查询快照，复用生产
render-model、inspection、quality 与 screenshot 编排。它不为缺失的元素级 source span 启动 sandbox/codegen；
此时只关闭源码点选编辑能力，页级 `deck.js` 定位仍由轻量 JS AST 索引产生。

standalone CLI 注册 `slides-raster` 时必须相对自身 `dist/cli/slides-cli.cjs` 计算 Slides artifact root，再从同一根加载 `dist/backend/raster-worker-preload.cjs` 与 `dist/raster-worker/worker.html`。禁止读取 cwd、用户 active root 或 `extraResources` 作为候选；Agent bridge 继续复用当前 App 已注册的 worker，不新增第二套定位规则。

CLI 的生产值依赖必须从所属 shared 模块的窄入口导入，不能从 `@plugin/slides/shared` 总 barrel 取值；类型导入不受此限制。否则新增与 inspect/render 无关的 authoring runtime 时，会被总 barrel 意外带入 standalone bundle，破坏 CLI 只读边界和体积门禁。

CLI 将 `sharp`、`better-sqlite3`、Yoga、HarfBuzz、jieba 和 PDF.js 等重型运行时保留为 external。它们的加载与 ESM 子路径定位都由 Linnya command host 按固定白名单从主应用运行时解析，插件不自行查找 `app.asar`、unpacked 目录或 `node_modules`。MathJax/STIX2 属于 Slides 自有公式能力，不依赖 Host：backend、build Worker 与 CLI 只分发一份 `slides-mathjax-runtime`，CLI 通过同 artifact 内的固定 bridge 使用它，禁止再次内联或复制字形表。新增依赖必须先进入 host 的明确发布与安全边界，不能在 CLI 内增加逐包路径 fallback。

## 命令

- standalone `render` 必须提供 presentation ID 和输出目录，可选单页、范围、宽度、像素比与 overwrite；Agent bridge 由 Host 管理输出。宽度与像素比在参数解析阶段先按统一 4000 万像素预算的正方形包络校验，读取真实文稿比例后 screenshot runtime 再按实际输出宽高精确复核。成功后把共享 renderer 已完成背景合成的不透明页面编码为 quality 90、4:4:4 JPEG 检查图，并输出单行 render report。无损 PNG 属于 screenshot/raster 领域入口，不由 review CLI 生产。
- `inspect` 输出紧凑的 `buildStatus + findingSummary + rootGroups + findings` JSON；不复制 `read_file` 已能提供的页面结构，也不输出完整 scene graph、文本布局归因或背景图片 source。每条 finding 保留置信度、设计意图上下文、节点、源码位置、空间关系、建议和统一派生的 P0/P1/P2；`--heuristics` 可附加 Tier-2 低置信提示。需要比较已知源码对象时，可重复传入至多四个 `--source-range start:end`，报告只附加匹配节点及每页、每对范围最近节点的横纵 `gap/overlap`，不生成距离矩阵。
- `fonts check --family <name>` 做不受候选分页影响的精确字体族检查。结果保留请求名称，并在命中时返回规范 family、脚本候选、regular/bold/italic 与 monospace。
- `fonts list --script <latin|eastAsian|complex>` 按脚本发现候选，默认 30 项、最多 100 项，以 `--offset` 继续分页。结果稳定排序、按 family 去重，并过滤点号前缀的系统内部 UI 字体。
- `fonts` 输出不包含字体文件路径、PostScript name、face index、缓存位置或替代算法；OS/2 脚本元数据只代表候选，不代表完整覆盖某个自然语言。
- standalone CLI 的 `--database` 可显式指定 workspace SQLite；省略时使用 CLI host 注入路径。它始终以只读连接打开数据库，不执行迁移或表写入。Agent bridge 明确拒绝该参数。

完整参数以 `pnpm slides:cli -- --help` 为准。

## 自动化合同

- `render` stdout 是单行 `linnya.slides.render-report` JSON。报告只含 schema/CLI 版本、presentation 的 `id/versionId/versionNumber`，以及每页的 `slideNumber + locator`；Agent bridge 返回 `conversation:`，standalone CLI 返回 `file:`。
- Agent 调用是否成功看 Shell 的真实 `data.terminal.process_exit.exit_code`；只有 exit code 0 的完整 stdout 才是可消费报告，长任务可用父 Shell 返回的 process handle 跟进。
- Agent 直接把 `slides[].locator` 交给 `read_file(locator=...)`，不要自行拼接路径。
- `inspect` 的 stdout 是单行紧凑 JSON 文档；运行日志全部写 stderr。
- standalone Electron command 必须等待 stdout/stderr 写入完成后退出，保证大型 inspection 报告仍是完整 JSON；调用方不需要按行拼接残缺片段。
- inspection report schema v7 与 `ppt_inspect` 共享 finding、源码定位、可选 focus 和 projection 契约；CLI 1.7.0 保留完整 evidence/source/remediation，并序列化同源 priority、summary 与 root group finding IDs；Agent observation 只做低 token 文本投影，二者都不得自行重算分级、根因或几何关系。
- 图表身份与标签容量也只通过标准 `chart_identity_missing / chart_label_capacity_exceeded` finding 出现；CLI 不另建图表诊断字段，Agent 与 CLI 在同一版本和页选择下必须得到相同 code、evidence 与 P1 派生结果。
- 表格单元格末行孤字只通过标准 `text_single_glyph_last_line` finding 出现，evidence 用从 0 开始的 `tableCell.rowIndex/columnIndex` 对应 `rows[row][column]`；CLI 不展开整个表格或复制单元格全文。
- 同一 App 中的 CLI bridge 与 `ppt_inspect` 必须调用同一个 `PptCoordinator.inspectPresentation`；standalone CLI 通过同一个 `PresentationInspectionRuntime` 生成事实。输出形态可以分别面向机器与 Agent，但同一版本、页选择、focus 和 heuristics 参数下的 finding 与 focus 事实必须一致。
- `fonts check/list` 的 stdout 也是单个带 `kind/schemaVersion/cliVersion` 的 JSON 文档；扫描未启动或失败时返回 `slides.cli.font_catalog_unavailable`，不能输出假空名单。
- render report 与 inspection report 都不保存数据库路径、output root、图片 source、data URI、图片 bytes、asset ID、字体文件路径或 conversation ID。render report 不含 `deck.js` 源码或 inspection finding；inspection report 保留文稿身份、页选择、buildStatus 与标准 finding/projection。字体替换通过 `font_family_substituted` finding 明确表达。
- CLI 只生产普通 JPEG 检查图，不写 `assets`、`project_asset_links` 或 `conversation_event_asset_links`。调用方只消费成功 stdout 已给出的 locator，图片使用 `read_file(locator=...)`；reader 按真实内容识别媒体类型，图片不传 inode 或字符窗口。`read_file` 选中的 JPEG 会按原字节进入受管附件、模型输入和 Conversation 历史。
- current draft 存在时，inspect/render 继续严格拒绝旧 compiled checkpoint，并返回 `slides.cli.unresolved_draft`（exit 3）。stderr 同时携带 draft 的稳定 `build_failure_code` 和 `read_file` → `edit_file/write_file` 恢复动作；旧短 error kind 只在只读 adapter 中映射，不能继续写入。

## Exit Code

| code | 含义 |
| ---: | --- |
| 0 | 成功或 help |
| 2 | 参数错误 |
| 3 | workspace 数据库不可读，或 presentation 不存在、draft 未解决、查询不可用 |
| 4 | 栅格化、资源加载或 PNG 复核失败 |
| 5 | 输出冲突或写入失败 |
| 6 | Electron/display 或系统字体目录运行环境不可用 |
| 10 | 未分类的 CLI 启动错误 |

stderr 的稳定错误前缀来自 `slides.cli.*` 或 `slides.screenshot.*` code；数据库启动失败使用 `slides.cli.database_unavailable`，unresolved draft 使用 `slides.cli.unresolved_draft`，输出目录创建、检查、清理和写入失败均使用 `slides.screenshot.output_write_failed`。底层 SQLite path、文件系统 path、stack 和 worker payload 不回显。
无法识别的内部 inspection/quality 合同故障使用 `slides.cli.internal_error` 与 exit code 10；不得伪装成 presentation 不存在或查询不可用。

## Headless Linux

Linux 下 Electron CLI 的 presentation 命令需要 `DISPLAY` 或 `WAYLAND_DISPLAY`，包括 inspect。CI 应在 Xvfb 中启动这些命令；CLI 不会静默切换到 Node ABI 不同或与应用渲染行为不同的纯 Node、SVG、LibreOffice 路径。`fonts check/list` 不启动 renderer、数据库或 hidden worker，因此不要求 display。

## 构建与验证

- `build:cli` 构建 Electron entry，并把 Yoga、HarfBuzz loader 与指向 backend 单一 MathJax runtime 的窄 bridge 放到同一 `dist/cli`。构建同时读取 esbuild
  metafile：raw entry 不得超过 4 MiB、不得内联 MathJax，且依赖图不得出现 TypeScript compiler、PPT 作者/变更链、完整
  workspace runtime、完整 Slides coordinator/codegen 或其他内置插件源码。entry 只启用 syntax-only 压缩，保留函数名和可诊断结构；metafile 只用于构建门禁，不进入 artifact。
- `pnpm run dev:electron` 会在启动 Electron 前通过根脚本 `build:slides-cli` 重建该 bundle；修改
  CLI 或其 host runtime 后应重启开发会话，让命令入口与当前源码、数据库 schema 保持同一版本。
- Slides 完整 `build`、plugin zip、SHA512 和 `extraResources` 验证都包含 CLI entry、Yoga 与 HarfBuzz loader。
- 领域测试覆盖参数冲突、exit code、render report 消费边界、JSON 报告、图片 source 脱敏、current draft 拒绝、
  current document hash 一致性与 standalone 页级源码位置。
- Agent 集成 smoke 使用自包含 presentation 验证真实 AgentDefinition → `shell` → `linnya-slides` thin client → 当前 App bridge → 共享 coordinator/worker → `conversation:` 截图 locator → `read_file` 模型输入。
- standalone CLI smoke 另行验证 Electron command mode、只读 DB adapter、packaged external 与 `file:` locator；不能用它替代父 Shell 权限、bridge token 生命周期和 draining 验收。
- 真实验收需要以实际 workspace presentation 分别执行 inspect 和 render，并确认成功报告版本正确、每个 locator 可读取且页码与 JPEG 一一对应；同一文稿保存新版本后再 render，应只剩最新成功版本工作集。
- 发布验收还必须使用真实 packaged Linnya 可执行文件覆盖未知 command ID、`slides --help` 和 render。只运行仓库 CLI 或 `extraResources` entry 不能证明 app bundle 的原生依赖、worker 与模块解析布局正确。
- `scripts/e2e/commands/fixtures/slides-yoga-runtime-probe.cjs` 只用于生成后的测试 app：临时替换已登记 CLI entry，验证 command mode 能从 packaged host 定位 `yoga-layout/load`、加载 ESM 并实际计算布局。探针不能进入正式插件 artifact，验收后必须恢复真实 CLI 再跑 render。

开发启动器 `pnpm --silent slides:cli -- ...` 按源码、构建配置、lockfile、Node/平台身份与构建产物内容校验缓存；连续调用且输入和产物未变化时不重建。成功构建日志不进入 JSON 输出，失败时日志写 stderr。缓存仅属于开发态启动器，正式 standalone entry 不执行源码构建。
