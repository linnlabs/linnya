# Slides Plugin

Slides 是 Linnya 的官方演示文稿 runtime 插件包，负责演示文稿的共享合同、后端生成与编辑能力、前端预览与交互界面，以及随插件分发的模型技能资源。

本包只实现 Slides 业务能力。插件安装、启停、宿主工作区、全局工具运行时、通用 sandbox
runner、字体/文本测量平台能力由 host 平台提供，Slides 通过窄门面消费这些能力。

Renderer 基础 UI 直接依赖 `@linnya/renderer-ui`：`peerDependencies` 与
`plugin.json.compat.rendererUi` 使用同一 range，开发依赖使用 `workspace:*`。Slides 不装载 package CSS；renderer
artifact 把公开入口映射为 Host external，兼容的 package patch/minor 不要求重建 Slides。

## Slides 的实现原理

Linnya Slides 先把 PPT 抽象成一门专用的场景图 DSL，再用 JavaScript 作为这门语言的源码载体。`deck.js` 描述页面中有什么、元素如何组织、怎样布局以及采用什么样式；它不是在直接调用 PptxGenJS，也不是 HTML、CSS 或 PowerPoint XML。

系统执行 `deck.js`，把描述还原为 PPT 场景树，完成布局计算和内容校验后，编译成统一的文稿中间表示 `DeckSpec`。前端预览和 PPTX 生成都是这份文稿事实的下游适配：前端把它映射成可交互画面，导出端把它映射成 PowerPoint 对象，并由 PptxGenJS 生成文件。两条路径不再各自理解一次 Agent 的源码，因此可以在保留可编辑对象的同时，让预览和导出尽量一致。

```text
自然语言 -> deck.js（PPT DSL）-> 场景树与布局 -> DeckSpec
                                             ├─> 前端预览
                                             └─> PptxGenJS -> PPTX
```

实现细节分别由对应模块维护：

- DSL 源码、编译与编辑：[backend/codegen](./src/backend/codegen/README.md)
- DSL 的隔离执行与类型检查：[backend/sandbox](./src/backend/sandbox/README.md)
- 质量问题公共合同：[backend/engine/quality/definitions](./src/backend/engine/quality/definitions/README.md)
- Agent 结构检查与诊断投影：[backend/features/presentationInspection](./src/backend/features/presentationInspection/README.md)
- CLI 机器报告与真实截图：[backend/features/presentationCli](./src/backend/features/presentationCli/README.md)
- 版本历史、源码压缩与图片生命周期：[backend/features/presentationSourceHistory](./src/backend/features/presentationSourceHistory/README.md)
- 前端预览与栅格渲染：[renderer](./src/renderer/docs/README.md)
- PPTX 编译、解析与质量检查：[backend/engine](./src/backend/engine/README.md)

## Agent 工作流

Agent 根据用户要求创建或修改 `deck.js`。每次写入后，系统都会重新检查并编译整份文稿；编译成功才更新当前文稿，失败的源码则保留为可继续修复的草稿，不会覆盖上一份可用结果。

Agent 可以读取源码和页面结构，也可以通过诊断与截图观察真实效果，再继续修改同一份源码。这样形成“生成—编译—预览—检查—修改”的闭环，而不是一次性生成一个无法维护的 PPT 文件。数据库保存当前源码、编译结果和修订历史，前端只负责投影当前状态。

像素检查使用 [Slides CLI](./src/backend/features/presentationCli/README.md) 返回的 JPEG locator。CLI 工作图按文稿与源码版本管理，只保留最新成功版本；Agent 通过 `read_file` 真正看过的图片会由 Conversation 资产链按原字节接管，因此清理旧工作图不会改写历史。

## 导出能力

- [Slides 导出 UI 合同](./src/renderer/features/presentationExport/README.md)：文档菜单当前提供 PPTX 和逐页 PNG；PPTX 可选择把图表转成透明背景图片，以保持与 Linnya 预览的一致性。
- PDF：栅格 PDF 产品入口已经关闭；正式语义/矢量 PDF 是否实施，取决于文字、矢量保真和维护成本的 ROI 验证。

## 文档树

```text
packages/plugins/slides/
├── package.json                 # 插件包元信息、exports、构建和本地脚本
├── vite.raster-worker.config.mts # 隔离栅格 worker 浏览器构建
├── src/
│   ├── shared/                  # backend / renderer 共用 DTO、schema、常量和纯函数
│   │   ├── deckSpec/            # DeckSpec、SlideSpec、PatchSpec、尺寸、asset ref
│   │   ├── documentSource/      # presentation 来源、source span、slide marker 纯索引
│   │   ├── renderModel/         # PresentationRenderModel、RenderNode 遍历、editable target
│   │   ├── render-geometry/     # 渲染几何与命中测试共享规则
│   │   ├── shapeGeometry/       # preset、参数化形状、polygon、typed path 权威合同
│   │   ├── svgGraphic/          # SVG Graphic 来源、owned ref、admission DTO 与错误码
│   │   ├── mathFormula/         # 原生公式 source、SVG metrics 与稳定错误码
│   │   ├── brushArtwork/        # Brush authoring、像素预算与 Worker DTO
│   │   ├── slideRasterization/  # renderer / worker 共用的 raster request/profile/result
│   │   ├── textLayout/          # 文本布局合同、断行、行布局与 autofit 纯规则
│   │   └── visual/              # Paint/渐变、颜色合同、theme、chart palette、design token
│   ├── backend/                 # 后端 contribution、coordinator、engine、tools、sandbox、persistence
│   └── renderer/                # 前端 contribution、页面、store、services、Konva 预览、tool cards
├── resources/
│   └── skills/                  # 随插件分发的 Slides 模型技能资源
├── dev/
│   └── tools/                   # 本地开发辅助脚本，不进入生产运行路径
├── docs/                        # 插件包内补充文档
└── host-types/                  # 插件构建需要的 host 类型补充
```

生成产物目录 `dist/` 和安装依赖目录 `node_modules/`
不属于源码维护面。栅格 worker 制品固定为
`dist/raster-worker/worker.html`、`dist/raster-worker/assets/*` 和
`dist/backend/raster-worker-preload.cjs`；插件打包与 `extraResources`
校验必须同时覆盖这三类文件。

Backend 的 deck.js AST/typecheck 使用插件自带的最小 TypeScript
runtime：compiler 位于 `dist/backend/node_modules/typescript`，标准库只包含
`lib.es2020.d.ts` 的传递引用闭包。它在第一次源码检查或插桩时加载，不属于 backend
contribution 注册成本。`build:backend` 同时执行 4 MiB 入口预算、14 MiB
backend 总预算、依赖图、懒加载和真实 compiler
smoke；metafile 只用于构建验证，不进入 artifact。

栅格 worker 不搜索全局候选目录。开发态 inline
backend 只绑定当前 workspace 的 Slides package root；磁盘 backend 和 standalone
CLI 只绑定自身插件 artifact
root。同一次 definition 的 backend、preload、HTML 与 browser
assets 必须来自同一根，缺失时失败，不能回退到旧 `extraResources`、active
plugin 或已打包 App 副本。

## 公开入口

`package.json` 的 `exports` 是跨包协作边界：

| 入口                                  | 使用方                            | 作用                                                                      |
| ------------------------------------- | --------------------------------- | ------------------------------------------------------------------------- |
| `@plugin/slides/shared`               | backend、测试、type-only consumer | Slides 共享合同总入口；browser runtime 不从此导入值                       |
| `@plugin/slides/shared/*`             | renderer、worker、窄语义 consumer | browser-safe 的 renderModel、shapeGeometry、slideRasterization 等语义入口 |
| `@plugin/slides/backend`              | 插件运行时                        | backend contribution 装配入口                                             |
| `@plugin/slides/backend-coordinator`  | backend 装配/测试                 | `PptCoordinator` 与其工厂、类型                                           |
| `@plugin/slides/backend-engine-core`  | coordinator、engine 测试          | PPTX 编译、解析、模板、query 与 engine adapter 窄入口                     |
| `@plugin/slides/backend-codegen`      | backend tools、coordinator、测试  | deck.js source 读写、compose/flex 编译、source 结构化能力                 |
| `@plugin/slides/backend-cli-contract` | 仓库级 Skill guard                | 无 Electron 副作用的 Slides CLI 参数解析合同                              |
| `@plugin/slides/backend-sandbox`      | sandbox runtime、codegen          | `ppt_compose` profile、代码插桩、类型检查能力                             |
| `@plugin/slides/backend-ipc`          | backend 插件运行时                | IPC 合同与 handler 注册                                                   |
| `@plugin/slides/backend-tools`        | tool manifest、coordinator、测试  | Slides 工具、inspect feedback、edit runtime 内部能力                      |
| `@plugin/slides/backend-tool-classes` | 工具注册                          | Slides 工具类集合                                                         |
| `@plugin/slides/renderer`             | renderer 插件运行时               | 窄前端 contribution 装配入口；不是 store/service/feature 总桶             |

新增跨目录复用能力时，优先判断是否已经有合适入口。确实需要新增入口时，必须保持窄小、稳定，并说明使用方。

## 架构边界

- `src/shared/`
  只能包含可同时运行在 backend 和 renderer 的纯 TypeScript 能力，不能依赖 Node、DOM、Vue、Pinia、数据库、workspace
  service 或插件运行时。
- `src/backend/` 只能通过 `@plugin/backend/*`
  平台门面消费 host 能力，例如 workspace、plugin runtime、asset resolution、text
  measurement、font resolution、sandbox runtime。
- `src/renderer/` 只能通过 `@plugin/renderer/*`
  平台门面消费 host 前端能力，不能 deep import host
  renderer 的内部 domain、store 或组件。
- renderer / hidden worker 的运行时值必须从
  `@plugin/slides/shared/<semantic-feature>`
  导入；禁止从 shared 根桶进入模块图。生产构建会同时检查 TypeScript 编译器泄漏与单 chunk
  500 kB 预算。
- backend 和 renderer 之间只通过 shared 合同、IPC 合同和插件 runtime 协作，禁止互相直接 import 内部实现。
- hidden worker 是受 host 生命周期管理的官方 renderer
  adapter。它只接收经过 shared
  codec 校验的自包含请求，preload 不提供文件系统能力；backend 负责在调用前授权并物化图片资源。render 取消按 requestId 传播到 worker 和逐页截图，使当前消费者立即失去等待/提交资格；注册表内可共享的图片解码或图表栅格可以继续服务其他消费者。取消后删除 staging，不发布页面图片或成功 report。
- Slides live 图片来源只接受 data URI、绝对本地路径、`conversation:` locator 或明确
  `file:` locator。AI 新下载或转换生成的图片默认通过 Shell 的默认 cwd，以相对 OS 路径写入
  conversation 工作目录，再用 `conversation:` locator 引用。用户指定其他落点，或当前任务已有
  对应写权限时，也可以使用真实绝对路径；显式 cwd 和 `requires_write_access` 本身不授予额外权限。
  `external_url` 仅保留为兼容输入识别，运行时会明确拒绝，不会暗中下载。Markdown 的 `doc-image`
  locator 是源文档私有身份，不属于 Slides 图片合同；跨文档复用必须先经过未来正式 workflow，不能由插件按 asset
  id 直查 host 本地路径。裸相对路径按 conversation 工作目录解析。
- `resources/skills/` 是模型可读取资源，不承载生产 TypeScript 逻辑。
- `dev/tools/` 允许使用本地开发需要的 host DB/workspace 能力，但不能被 `src/`
  生产代码 import。

## 文稿持久化边界

- `deck_source`
  是唯一编辑事实。所有正式创建、编辑与恢复入口都必须先得到可编译源码，再通过同一 codegen
  commit 编排落库。
- `presentation_documents` 每个文稿只保存当前
  `deck_source + DeckSpec + PPTX`，PPTX 只保存一份；preview、inspect、screenshot 以及未向 Agent/CLI 暴露的内部 PPTX 读取都使用这行 current materialization。
- `presentation_revisions` 只保存 source
  checkpoint/patch、hash 和审计 metadata。每 25 个 revision、累计 patch 达到完整源码大小或单 patch 不小于完整源码时写 checkpoint。
- 恢复历史 revision 时先重建源码并校验 hash，再重新编译，并把恢复结果作为新的
  `origin=restore` revision 提交；历史 revision 不保存 DeckSpec/PPTX。
- `presentation_drafts` 绑定 `base_revision_id + base_revision`。绑定当前 revision 的 unresolved draft
  是 `read_file/edit_file/grep` 的 current VFS 源码事实；VFS 默认读取必须原样返回它，不能先要求源码通过语法、结构或编译检查。stale draft 不得成为 current VFS 来源，只有成功编译和提交才会删除 draft。
- `presentation_templates.source_pptx_buffer`
  是模板原始资产，语义独立；它不是文稿 PPTX 的第二份副本。
- `presentation_image_bindings` 保存源码图片身份首次接管后的 asset ID。源路径只保留来源身份语义，不是 live link；文档对实际字节的 durable ownership 由 Host `document_asset_links` 表达，Slides 不直接读写 asset ledger。
- `presentation_svg_graphic_bindings` 由 `presentationSvgGraphicOwnership`
  feature 保存 SVG Graphic 源身份首次接管后的 canonical hash、尺寸事实与 asset ID。DeckSpec
  后续只保存 owned ref；原始 SVG 与路径不进入 canonical 文稿结构。实际字节与文档 ownership 仍由 Host
  `documentSvgAsset` 窄端口管理。

## 栅格化、截图与 CLI

Slides 的页面尺寸是文稿级物理事实。`DeckSpec.layout` 支持三个 preset 和 1–56 英寸的自定义宽高，Direct/Flex、持久化、RenderModel、预览、PPTX reader/writer 与 inspect 共用同一个 canonical resolver。图片导出另受单次像素预算约束；“PowerPoint 可用的画布尺寸”不等于“任意分辨率的图片请求都可执行”。authoring 规则见 [codegen](./src/backend/codegen/README.md)，渲染与导出边界见 [slideRasterization](./src/shared/slideRasterization/README.md)。

栅格化、截图与 CLI 的稳定设计分别由现有 feature 文档承接。插件 CLI 的跨模块所有权与宿主边界遵循
[插件 CLI 与宿主受控执行](../../../docs/plugins/guides/21-plugin-cli.md)，本文件只保留 Slides 领域说明：

| 模块                    | 所有权                                                                  | 文档                                                                                |
| ----------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| shared raster contract  | 单页请求、profile、codec、稳定错误；纯 TypeScript                       | [shared/slideRasterization](./src/shared/slideRasterization/README.md)              |
| renderer raster adapter | Konva/ECharts/image preload 与 PNG 输出；缩略图和 worker 共用           | [renderer slideRasterization](./src/renderer/features/slideRasterization/README.md) |
| SVG fallback adapter     | canonical SVG 的透明 PNG 物化；复用 worker，不让 engine 依赖 renderer | [presentationSvgGraphicFallback](./src/backend/features/presentationSvgGraphicFallback/README.md) |
| Brush artwork generator | 声明式 layers/marks 驱动的不透明图片生成；复用既有 Image ownership，不新增 RenderNode | [presentationBrushArtworkGeneration](./src/backend/features/presentationBrushArtworkGeneration/README.md) |
| page raster feature     | 资源物化、worker 调用、PNG 尺寸与完整性复核                             | [presentationPageRasterization](./src/backend/features/presentationPageRasterization/README.md) |
| screenshot feature      | 页选择、PNG/JPEG 输出适配、版本工作集与原子发布                         | [presentationScreenshot](./src/backend/features/presentationScreenshot/README.md)   |
| export backend feature  | PPTX、图片 ZIP、内部 PDF 基线与图表透明图片化的统一编排                 | [presentationExport](./src/backend/features/presentationExport/README.md)           |
| Slides Plugin CLI       | Agent bridge 与人/CI standalone adapter 共用 parser、领域 orchestration | [presentationCli](./src/backend/features/presentationCli/README.md)                 |

Slides 不拥有通用进程执行、asset ledger、claim、conversation
link 或 provider 转换。Agent 使用既有 `shell` 调用 `linnya-slides`
薄 client；client 通过父 execution 的 bridge 复用主进程 SQLite、共享 coordinator 和 raster
worker，不启动第二个 Electron。人、开发脚本和 CI 使用 manifest `entry.command`
指向的 standalone command
mode。两种宿主 adapter 复用同一 parser/orchestration，Linnya
host 不复制 presentation 字段。

## 开发规范

- 新增业务合同先落到 `src/shared/` 对应 feature 的 `definitions/`
  或纯规则目录，再接 backend mapper/compiler 和 renderer consumer。
- deck.js 的公开 authoring 类型由 `src/shared/flexComposeContract.ts` 统一拥有；工厂 config 只暴露预览、PPTX 和诊断链共同理解的稳定字段。DirectCompose 的 raw renderer options 与 source tracking 元数据不得进入 Agent d.ts 或 skill 示例。
- 背景、形状填充和描边必须使用
  [`docs/visual-paint-contract.md`](./docs/visual-paint-contract.md)
  的统一 Paint；禁止在 compiler、renderer 或导出层新增局部 gradient 结构。
- 形状轮廓必须使用
  [`shared/shapeGeometry`](./src/shared/shapeGeometry/README.md) 的单一
  `geometry` 合同；preset 展开和参数化点位只在 shared
  resolver 计算，PPTX/Konva 只做技术适配，禁止恢复 `shapeType`、裸 SVG `d`
  或未知形状回退矩形。
- SVG Graphic 必须使用独立的 `createSvgGraphic()` 与
  [`shared/svgGraphic`](./src/shared/svgGraphic/README.md) 合同。Agent SVG 先经 backend
  唯一 admission 和文稿 ownership，再进入 RenderModel、Konva/hidden raster 与 PPTX；Image、Shape
  和 renderer 都不得接受旁路 raw SVG。公开子集不含文字，diagram 标签继续使用原生 Text。
- SVG Graphic 导出必须通过真实 PNG fallback 与 SVG 双媒体 package 门禁；外部 PPTX 回读只把通过同一 admission 的 SVG 恢复为 SvgGraphic，超出子集时保留 raster fallback 并报告 fidelity warning。
- 原生公式必须使用独立 `createFormula()` 或 Text 中明确的 formula run。受控 LaTeX 只解析一次，backend [`mathFormula`](./src/backend/engine/mathFormula/README.md) 从同一 canonical IR 生成 MathML/MathJax STIX2 path SVG 和 PowerPoint OMML；inline 公式继续进入 shared text finalizer，禁止用图片、SVG Graphic 或独立 shape 冒充。
- Brush 视觉资产使用 `createBrushArtwork()` 的受控声明式 layers/marks；deck.js 可用普通循环组合几何，Worker 不执行作者 JavaScript。元素最终盒决定像素尺寸，隔离 Worker 生成后沿现有 Image ownership 接管一次，前端和 PPTX 只读取同一 PNG。当前上游不支持透明通道，因此要求显式纯色背景，不得把 Brush 当透明贴图叠在照片、渐变或纹理上。
- 新增 backend 用例优先放在 `src/backend/coordinator` 或具体 engine/tool
  feature；不要把流程塞进工具类或 repository。
- TypeScript compiler 是 `backend/capabilities/typescriptRuntime`
  的域内技术能力；codegen/sandbox 禁止恢复静态值导入，也禁止从宿主
  `node_modules` 兜底。
- 新增 renderer 能力按 `src/renderer/features/<feature>`
  归类，Vue 组件保持薄，规则和编排下沉到 `.ts` 文件。
- renderer
  contribution 入口保持窄小，重型 surface 必须异步加载。页面、store、services、feature 和 Vue 组件不从
  `@plugin/slides/renderer` 总桶互相调用。
- 文本布局字段必须走 `src/shared/textLayout`
  合同。padding、wrap、autoFit、line-break
  policy、字体解析策略不能在 compiler、mapper、prewarm、renderer 各写一套。
- PPTX 读写单位统一为 shared / engine 合同里的 inches、pt、degree、0-1
  opacity；不要把 OOXML EMU 或 60000-based angle 暴露给上层。
- `ThemeSpec.fonts.major/minor` 当前是单字体声明。生成 PPTX 时必须由 `engine/pptx`
  统一写入 theme 的 `latin/ea/cs/Hans` 槽位，不能只依赖 PptxGenJS 的 Latin 输出，也不能在
  structured/freeform compiler 各自修补。
- 直接 PPTX 文档导入目前没有对外 IPC 入口；`slides:template-import`
  只服务模板上传。重新接入文档导入前，需要先补 imported deck 到 Konva
  render-model 的保真验收。

## 测试入口

- 插件类型检查：`pnpm --dir packages/plugins/slides run typecheck`
- Slides 插件测试：`pnpm run test:plugin:slides`
- 本地验收 harness：`pnpm --dir packages/plugins/slides run harness`
- 构建：`pnpm --dir packages/plugins/slides run build`
- backend 构建边界：`pnpm --dir packages/plugins/slides run build:backend`（入口/总量预算、TypeScript 依赖图、45-file 当前闭包和懒加载 smoke）
- renderer 构建边界：`pnpm --filter @plugin/slides build:renderer`（每个 JS
  chunk ≤ 500 kB，禁止 TypeScript）
- 栅格 worker 单独构建：`pnpm --dir packages/plugins/slides run build:raster-worker`
- 真实 Electron 栅格 smoke：`pnpm --dir packages/plugins/slides run smoke:raster-worker`（包含真实 deck.js
  → RenderModel → 960×540 PNG、系统 Latin / East
  Asian 候选查询、主题字体继承、可见文本像素检查、1920px 透明 SVG Graphic fallback，以及 2× 透明 ECharts 图表）
- 真实 Chromium PDF smoke：`pnpm --dir packages/plugins/slides run smoke:pdf-export`（验证两页栅格 PDF、PDF 签名、页数和 16:9 物理页面尺寸）
- SVG Phase 0 原型严格类型检查：`pnpm --dir packages/plugins/slides run typecheck:svg-phase0`
- SVG Phase 0 admission / Chromium / Sharp / PPTX 验证：`pnpm --dir packages/plugins/slides run validate:svg-phase0`；附加真实样本统计时传 `--corpus <svg-directory>`。该入口保留为兼容性研究基线，不代替正式生产测试。
- SVG Graphic 正式 admission 回归：`pnpm exec vitest run packages/plugins/slides/src/backend/engine/svgGraphic/admission/admitSvgGraphic.test.ts`；验证无文本 canonical write 子集、hash、引用与资源预算。
- SVG Graphic 来源接管回归：`pnpm exec vitest run packages/plugins/slides/src/backend/features/presentationSvgGraphicOwnership/orchestration/createPresentationSvgGraphicOwner.test.ts`；验证 inline/local/conversation 来源、first-write-wins 和稳定失败分类。
- SVG Graphic 公开语法与纵向链路：`pnpm exec vitest run packages/plugins/slides/src/backend/codegen/__tests__/SvgGraphicCodegen.integration.test.ts packages/plugins/slides/src/backend/__tests__/create-ppt-coordinator.integration.test.ts packages/plugins/slides/src/backend/engine/DeckAssembler.test.ts packages/plugins/slides/src/renderer/features/svgGraphicRendering/functions/svgGraphicKonva.test.ts`。
- SVG Graphic 双媒体与回读：`pnpm exec vitest run packages/plugins/slides/src/backend/engine/svgGraphic/pptx/svgGraphicPptxRoundtrip.test.ts packages/plugins/slides/src/backend/features/presentationSvgGraphicFallback/**/*.test.ts`。
- 原生公式 compiler、同段 OMML 与布局：`pnpm --dir packages/plugins/slides exec vitest run src/backend/engine/mathFormula src/shared/textLayout/__tests__/inlineFormulaLayout.test.ts src/backend/codegen/__tests__/FormulaCodegen.integration.test.ts src/renderer/features/formulaRendering`；真实 Office gate 使用 `dev/tools/mathFormulaPowerPointSmoke.ts` 生成 PPTX 后在 PowerPoint 打开、编辑、保存并重新解包。
- Brush 合同与 ownership：`pnpm --dir packages/plugins/slides exec vitest run src/shared/brushArtwork src/backend/engine/brushArtwork src/backend/features/presentationImageOwnership/orchestration/createPresentationImageSourceResolver.test.ts`；真实 hidden Worker 门禁使用 `pnpm --dir packages/plugins/slides smoke:brush-worker`，验证 A → B → A 确定性、尺寸和全不透明像素。
- 完整 Slides artifact / zip /
  extraResources 校验：`pnpm run smoke:plugin:slides:artifact`

## 已知限制

- **图表无法跨渲染器完全保真。** Linnya 前端使用 ECharts，PowerPoint 使用自己的图表渲染器，两者的字体、间距和标签布局无法保证完全一致。因此，[Slides 导出 UI 合同](./src/renderer/features/presentationExport/README.md)提供“将图表转换为图片”设置。该设置默认关闭：需要视觉一致时主动开启，需要继续编辑图表时保留默认的 PowerPoint 原生图表。
- **Brush 视觉资产暂不支持透明底。** 当前 pinned p5.brush standalone 合成器会把最终画布写成不透明。首版只支持显式纯色背景的整区资产；需要透出下层内容时改用 Shape 或受控 SVG。后续若上游提供稳定 alpha 合同，可在不改写现有不透明 intent 的前提下扩展。
- **PDF 导出暂不开放。** 已实现的栅格 PDF 不含可选择、搜索和复制的文字对象，因此不再挂载产品入口。真正的语义/矢量 PDF 仍需完成独立的可行性与 ROI 验证。
- **前端暂不支持人工编辑。** 当前只能通过 Agent 修改文稿源码，不能直接在预览画布中拖动元素或编辑内容；前端人工编辑能力已经加入后续排期。
