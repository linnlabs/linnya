# Slides Renderer

Slides renderer 是演示文稿前端 contribution，负责文档 surface、预览舞台、缩略图、工具卡片、导出入口、模板 UI、前端状态和 renderer 侧 IPC 调用。

renderer 是后端 `PresentationRenderModel`、`DeckPreview` 和 shared 合同的消费层，不是第二套 PPT 布局求解器。视觉或布局不一致时，优先回查 shared 合同、后端 render-model mapper、compiler 或 engine solver，再修改 renderer 映射。

历史版本通过 document type 的 `historyPreviewComponent` 接入 Core 统一面板，详见
[presentationHistory](../features/presentationHistory/README.md)。历史预览独立于当前文稿 store，
只保留单个版本和一张选中页 bitmap；不存储历史截图，不触发当前页面刷新。

## 文档树

```text
src/renderer/
├── index.ts                         # 窄 contribution、CSS、ports 与异步 surface 装配入口
├── docs/                            # renderer 维护说明
├── icon/                            # Slides 文档类型图标
├── page/                            # SlidesPage / SlidesView 页面容器
├── ports/                           # renderer 对 host 能力的窄 port
├── features/
│   ├── documentReference/           # 文档引用与展示用纯规则
│   ├── documentRuntime/             # surface 挂载后的 deck 加载、定位和生命周期编排
│   ├── elementAiEdit/               # source-backed 元素 AI 编辑编排
│   ├── presentationExport/          # PPTX/图片菜单、独立弹窗与导出交互编排；见 feature README
│   ├── konvaPreview/                # Konva 配置与 ECharts option 纯映射
│   ├── renderImageResources/        # 图片解析、解码去重与 LRU
│   ├── renderChartResources/        # 图表 runtime、栅格化去重与 LRU
│   ├── svgGraphicRendering/          # admitted SVG data URI、fit 与 Konva 配置
│   ├── renderVisualResources/       # 页面 + 图片 + 图表原子提交与相邻页预热
│   ├── pageContext/                 # conversation page context 纯规则
│   ├── previewRenderState/          # SlideStage 渲染分支规则
│   ├── slideRasterization/          # 同源离屏 canvas、ImageBitmap 与 PNG bytes
│   ├── sourceSelection/             # 源码元素点选、框选和 fence 数据准备
├── services/                        # slidesApi 与 mapper 等 renderer 技术入口
├── shared/                          # renderer 内稳定复用的纯规则
├── store/                           # deck、render model、thumbnail、session、UI 状态
├── styles/                          # renderer 样式入口
├── tool-cards/                      # conversation tool card UI
├── types/                           # renderer 内部类型
└── ui/                              # deck、preview、shared、shell、templates 组件
```

## 架构与数据流

主预览链路：

```text
SlidesPage / SlidesView
  -> documentRuntime 加载当前 documentId
  -> slidesStore.loadDeck(documentId)
  -> slidesApi.getDocumentBuildState(documentId)
       -> ready：并行进入 DeckPreview / RenderModel 主链
       -> draft：展示“PPT 编译失败”，不请求 preview/render-model
  -> SlideStage / DeckOutline / build status 消费 store selector
```

当前打开的 Slides 收到 `workspace.document.updated(version)` 后，复用同一条读取链路刷新当前
deck。首次打开或 `draft → ready` 才允许清空并首次加载 RenderModel；`ready → ready` 必须保留
当前页和旧 RenderModel，待新版本的页面视觉资源准备完成后原子替换，不能让正常 AI 修改表现成
整块画布重新加载。`ready → draft` 仍应清除旧 preview/RenderModel 并展示真实编译失败，禁止用旧
物化掩盖当前源码状态。

离屏栅格链路：

```text
SlideRasterRequest
  -> renderVisualResources 并行准备图片/SVG 与图表
  -> image/chart 注册表复用已解码资源
  -> konvaPreview builders 构造同源节点
  -> canvas
       -> thumbnail ImageBitmap
       -> hidden worker PNG bytes
```

缩略图 store 只选择 thumbnail profile 和管理 `ImageBitmap` 生命周期。页面比例、物理像素尺寸、节点分发和 PNG 编码不属于 store。
缩略图本体与虚拟列表行高必须共同从当前文稿 `slideSize` 派生；固定 16:9 高度只能作为尚未取得
RenderModel 时的默认值，不能成为 preset 或自定义画布的第二套几何事实。

主舞台切页链路：

```text
currentSlideRender
  -> renderVisualResources 并行准备目标页图片与图表
  -> 等待期间保留上一张完整画布
  -> { slideRender, imageResourceMap, chartResourceMap } 原子提交
  -> Konva 同一批绘制背景、图片/SVG 与图表
```

文稿成功编译后会自动选中第一页，不存在等待用户“选择一个页面”的正常状态。首次图片、公式或图表资源
尚未形成完整视觉帧时，舞台只保持自然加载底色；切页和热更新继续保留上一份完整视觉帧。RenderModel
请求或视觉资源编排真正失败时必须展示渲染错误，不能伪装成未选页空态；只有零页文稿可以显示“暂无页面”。
文稿身份切换必须撤销上一份 RenderModel 请求与错误状态，并立即卸载旧舞台与旧缩略图 DOM；禁止用
离场动画延长旧状态页或已销毁滚动实例的可见生命周期。OverlayScrollbars 使用自定义 viewport 时，
官方初始化标记必须落在真实 overflow viewport，而不是不滚动的外层 host。

解码后的 `HTMLImageElement` 属于 renderer 技术资源，不能进入 Pinia store。主舞台和 renderer 内缩略图共用
有界注册表；详细合同见 [`../features/renderVisualResources/README.md`](../features/renderVisualResources/README.md)、
[`../features/renderImageResources/README.md`](../features/renderImageResources/README.md) 与
[`../features/renderChartResources/README.md`](../features/renderChartResources/README.md)。

source-backed 元素编辑链路：

```text
SlideStage sourceSelection
  -> SlidesView sourceEditSubmit
  -> elementAiEdit 读取 source slices
  -> @plugin/renderer/aiInvocationPort 注入 selected-slides-element fence
  -> conversation 使用 read_file / edit_file / write_file 修改 deck.js source
```

导出链路只有 Host 文档“更多”菜单一个真实入口，当前开放两个选项并分别打开独立弹窗：

```text
导出为 PPTX / 导出为图片
  -> presentationExport store 打开对应独立弹窗
  -> @plugin/renderer/exportArtifact 请求系统保存目标
  -> 图片导出订阅本次 exportId 的页级 plugin push
  -> slidesApi.exportPresentation(严格格式联合 + opaque target token)
  -> backend 生成并由 Host 原子发布
```

renderer 不接收 PPTX 或 ZIP bytes，也不读取保存路径。菜单顺序、默认原生图表和默认 1920
图片宽度由 `presentationExport` 共享规则拥有；保存框取消时不调用 backend。栅格 PDF 因不具备可选择、搜索和复制的文字对象而不挂载产品入口；语义/矢量 PDF 仍在独立调研中。

图片弹窗在执行期间显示真实的 `已完成页数 / 总页数`，进度只接纳匹配本次随机 `exportId` 的事件，并在 Promise 收口时解除监听。进度属于 feature store 的瞬时 UI 状态，不进入全局任务、Conversation 或数据库。

产品设置、格式各自的验收方式和 30 页 4K 基线见 [`../features/presentationExport/README.md`](../features/presentationExport/README.md)。图片 ZIP 只检查图片 artifact，不使用 PowerPoint；PowerPoint 只用于 PPTX 真实验收。

## 边界与依赖

- renderer 只能通过 `@plugin/renderer/*` 窄门面消费 host 前端能力。
- renderer 只能通过 `plugin:invoke('slides', channel, payload)` 调用 Slides backend，不能恢复私有 HTTP 入口。
- renderer 不能 import `src/backend/**`，也不能依赖 backend-only export。
- renderer 浏览器运行时代码禁止从 `@plugin/slides/shared` 根桶导入值；根桶同时导出 backend-heavy 能力。
  必须按 `@plugin/slides/shared/<semantic-feature>` 进入 browser-safe 语义子入口。纯 `import type` 不进入产物。
- Vue 组件只负责展示、交互和状态连接。布局规则、映射规则、选择规则必须放到 feature 的 `functions/` 或 `orchestration/`。
- `TextRenderNode.layout` 是文本预览主链；存在 layout 时只能逐行绘制，不能让 Konva 或 renderer 重新 wrap。
- 缺失 render-model 字段时，不要在 renderer 猜默认值；应回查 shared schema、后端 mapper 或 compiler。
- unresolved draft 是 `SlidesDocumentBuildState` 的正式状态，不是 Vue 组件解析 raw error
  string 得出的异常。draft 时禁止显示空白 shell、旧 preview 或旧 RenderModel。

## 后端 IPC 通道

| 通道 | 用途 |
|---|---|
| `slides:preview` | 获取 `DeckPreview` |
| `slides:build-state` | 查询源码是 `ready` 还是 unresolved `draft` |
| `slides:render-model` | 获取 `PresentationRenderModel` |
| `slides:inspect` | 获取 `PresentationInfo` |
| `slides:source-slices` | 获取源码切片 |
| `slides:export` | 生成 PPTX、图片 ZIP 或 PDF，并提交到 Host 一次性保存目标；不返回 artifact bytes |
| `slides:templates-list` | 列出模板 |
| `slides:template-import` | 上传 PPTX 作为模板来源 |

文稿创建与编辑统一走 deck.js 的 `write_file / edit_file` 工具链，不提供 renderer 私有的 generate/patch IPC。当前也没有直接 PPTX 文档导入到 editable deck 的 renderer 通道；接入前必须补 imported deck 到 Konva render-model 的保真验收。

## 开发规范

- 新增前端能力按 `features/<feature>` 组织；纯规则进 `functions/`，多步骤交互进 `orchestration/`。
- Slides 工具卡的标题、按钮、状态、placeholder、校验和无障碍文案统一归
  `tool-cards/definitions/slidesToolCardMessageCatalog.ts`，Vue 通过当前 feature 的 localization hook
  解析；`zh-CN` 与 `en-US` key 必须成对完整，禁止把固定中文重新写回组件。
- 新增 store 状态前先判断是否能从已有 deck/render/session 状态派生；避免重复存储造成不同步。
- 新增 RenderNode 或视觉字段时，必须先扩 shared render schema 和后端 mapper，再接 `konvaPreview` builder。
- 背景、形状填充与描边统一消费 [`../../../docs/visual-paint-contract.md`](../../../docs/visual-paint-contract.md) 的 Paint；主预览、缩略图和 hidden raster 禁止分叉渐变规则。
- 单位换算遵循 shared/render-model 合同：box 为 inches、fontSize/stroke/shadow 为 pt、rotation 为 degree、opacity 为 0-1。
- 图片和图表节点禁止自行异步加载。页面资源必须先经 `renderVisualResources` 准备，再把完整视觉帧提交给 Konva。
- SVG Graphic 只能消费 RenderModel 已携带的 canonical SVG，并通过
  `svgGraphicRendering` 生成自包含 data URI；renderer 不读取作者路径、不做 XML 清洗，也不允许
  `innerHTML` / `v-html` 注入。
- 图表颜色只消费 `theme.chart.palette` 或 `ChartRenderNode.palette`；缺失 palette 应回查后端合同。
- 画布内容可以忠实使用 RenderModel 里的颜色和视觉字段；应用 UI 样式使用语义 token，避免散落 raw hex。

## 加载与构建边界

- `src/renderer/index.ts` 是 contribution 装配入口，不是 renderer 内部 API 总桶。只导出 contribution、稳定
  tool card 配置和 port 注册；页面、store、services、feature、Vue 组件必须从包内语义路径消费。
- `SlidesPage` 使用异步 surface，只有用户打开 Slides 文档才加载 Konva、ECharts 和文稿交互代码。
- ECharts core、图表家族和 zrender 按稳定运行时边界分块；离屏栅格只从 Konva 深入口装配实际使用的原语。
- renderer 与 raster worker 每个 JavaScript chunk 必须不超过 Vite 默认 500 kB，并且模块图不得包含
  `typescript`。`scripts/build/browserBundleGuard.mjs` 会在生产构建中直接失败，禁止提高 warning 阈值消音。

## 测试入口

- renderer 规则测试：`packages/plugins/slides/src/renderer/**/*.test.ts`
- 插件类型检查：`pnpm --dir packages/plugins/slides run typecheck`
- Slides 插件全量测试：`pnpm run test:plugin:slides`
- host renderer import 边界：`pnpm exec vitest run apps/renderer/app/plugins/loader/rendererHostExternalBoundary.test.ts`
- renderer 生产构建门禁：`pnpm --filter @plugin/slides build:renderer`
- raster worker 生产构建门禁：`pnpm --filter @plugin/slides build:raster-worker`

保真回归使用 `smoke:raster-worker`：真实 Electron 像素覆盖 8 个线性渐变角度与 2:1 椭圆径向渐变。主预览和离屏渲染共用形状 scene renderer；命中画布单独写 Konva identity 色，不能复用视觉渐变。图表图例色、绘图区色和线宽从 RenderModel 读取。

切页保真需同时验证资源原子提交与持久 Konva 节点属性同步。主预览所有绑定使用严格 config；`smoke:preview-transitions` 覆盖真实 Vue 更新后的像素，不可只用新建 stage 的离屏截图代替。详见 [Konva Preview](../features/konvaPreview/README.md#持久画布的属性同步)。
