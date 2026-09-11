# Konva Preview

`renderer/features/konvaPreview` 是 Slides 前端预览的渲染规则 feature，负责把后端 `PresentationRenderModel` 中的节点映射为 Konva 配置、ECharts option 和 stage 编排能力。

本 feature 不求解布局、不解析 PPTX、不访问 backend。它只消费 shared render contract、renderer store 传入的数据和 host renderer 平台能力。

## 文档树

```text
konvaPreview/
├── index.ts                         # feature 对外导出入口
├── README.md                        # 本说明
├── functions/
│   ├── builders/                    # RenderNode -> Konva config 的纯 builder 层
│   │   ├── README.md                # builder 子模块规则
│   │   ├── backgroundBuilder.ts     # slide 背景 rect / image 配置
│   │   ├── chartBuilder.ts          # ECharts 离屏渲染结果 -> Konva Image
│   │   ├── groupBuilder.ts          # group 展开、z-index 排序、子节点配置
│   │   ├── imageBuilder.ts          # image fit、mask、border、shadow 配置
│   │   ├── shapeBuilder.ts          # shape primitive、fill、stroke、shadow、innerText
│   │   ├── tableBuilder.ts          # table cell、border、cell text 配置
│   │   └── textBuilder.ts           # 行级 text layout -> Konva text slices
│   ├── echartsMapper.ts             # ChartRenderNode -> ECharts option
│   ├── konvaChart.ts                # 图表几何、坐标、palette 和数据标签规则
│   ├── konvaRasterScale.ts          # 离屏/高 DPI raster scale 规则
│   ├── konvaSupport.ts              # RenderNode / chart 类型支持判定
│   ├── konvaTable.ts                # table 几何与 border segment 纯规则
│   ├── konvaText.ts                 # renderer 字体族解析规则
│   ├── konvaVisualMapping.ts        # fill、image fit、point 等视觉映射
│   └── shapePathPresets.ts          # custom path / preset shape 点位生成
└── orchestration/
    ├── useKonvaRasterScale.ts       # raster scale 生命周期和响应式控制
    └── useKonvaStage.ts             # stage fit、尺寸、引用生命周期
```

## 架构与数据流

```text
PresentationRenderModel
  -> renderVisualResources 原子提交 slide + 已解码图片 + 已栅格图表
  -> SlideStage / Konva node Vue components
  -> konvaPreview builders
  -> Konva config
```

主视图和离屏栅格应复用同一组 builder 纯规则。离屏 canvas、ImageBitmap 与 PNG bytes 的组装入口位于 [`slideRasterization`](../slideRasterization/README.md)。新增视觉字段时，先让后端 render-model mapper 输出字段，再由 builder 消费。
图片与 SVG 浏览器解码资源由 [`renderImageResources`](../renderImageResources/README.md) 负责，SVG
data URI 和 fit 规则由 [`svgGraphicRendering`](../svgGraphicRendering/README.md) 负责，图表栅格资源由
[`renderChartResources`](../renderChartResources/README.md) 负责，页面原子提交由
[`renderVisualResources`](../renderVisualResources/README.md) 负责。Konva 组件只消费已解码资源。
原生数学公式的 block/inline SVG 放置由 [`formulaRendering`](../formulaRendering/README.md) 负责；Konva 不解析 LaTeX 或 OMML。

## 边界与依赖

- 允许依赖 `@plugin/slides/shared/<semantic-feature>` 的 browser-safe render contract、单位常量和纯规则；
  renderer 运行时禁止从 shared 根桶导入值。
- 允许依赖 renderer 内部纯规则和 `@plugin/renderer/*` 窄门面。
- 字体 fallback 候选栈必须复用 browser-safe 的 `@linnya/renderer-ui/font-stack` 纯叶子入口；主视图与 hidden worker 直接 bundle 同一实现，不得各自复制 Office/CJK 字体表。宿主字体可用性探测只能在同一候选栈之上选择实际 primary。
- 禁止 import `src/backend/**`、engine、PptxReader、compiler 或 repository。
- 禁止在 builder 中持有 Vue 组件实例、Konva stage ref、DOM ref 或异步 IO。
- 禁止在 renderer 重新 wrap 文本；`TextRenderNode.layout` 已存在时必须逐行消费。
- 禁止在 renderer 测量 table cell；每个 cell 必须消费 backend finalization 写入的 `textLayout`。

## 文本渲染边界

```text
finalized RenderModel
  -> textBuilder / tableBuilder
  -> 每个 RenderLineSlice 映射一个 Konva Text
  -> 同一组 builder 同时服务主视图和离屏 raster
```

- slice 的 `x`、`textY` 是最终放置位置，`width` 是后端排版 advance，不是字形 paint clip。普通行不向 Konva Text 传 width；Konva `wrap` 和 `ellipsis` 一律关闭，最终只由外层文本框裁剪。
- `clip` / `ellipsis` 在文本框外边界裁剪；padding 只参与 shared 布局，不能成为字形裁剪边界。ellipsis 字符已经由 shared 布局写入 slices。
- 普通文本缺 `node.layout`、table cell 缺 `cell.textLayout` 都是生产合同错误，必须抛错，不能前端 fallback。
- shape inner text 也消费 finalized layout，避免 shape 与独立文本框采用不同 autofit。
- 每个 run 的 `resolvedFontFamily + resolvedFontWeight + resolvedFontStyle` 共同表示后端命中的实际 face；Konva 必须优先使用整组事实，不能把 resolved family 和作者请求的 bold/italic 重新拼成另一张字体。

## 开发规范

- 新 RenderNode 类型：先扩 shared schema 和后端 render-model mapper，再新增 builder，并接主视图与离屏缩略图。
- 新视觉字段：RenderModel 是唯一输入来源，不能在前端凭元素类型自创样式。
- 单位换算：box/cornerRadius/borderRadius 为 inches，fontSize/stroke/shadow 为 pt，rotation 为 degree，opacity 为 0-1。
- 图例颜色、绘图区背景和折线 pt 宽度消费 RenderModel 的显式样式；笛卡尔图的背景仅作用于 grid。饼图为四侧图例预留通道，并允许数据标签换行，不使用默认 truncate。
- 图表统一走 ECharts option 到 raster image 的路径；palette 缺失时回查后端合同。
- 图片节点禁止创建 `Image`、读取本地文件或监听 source；只允许消费 `renderImageResources` 已准备好的资源。
- SVG Graphic 节点只消费 admitted RenderModel 与已解码资源；不得在 Konva 组件中解析 XML、读取作者路径或复制 fit 规则。
- 图表节点禁止创建 ECharts 实例或监听 node 发起渲染；只允许消费 `renderChartResources` 已准备好的资源。
- 纯规则放 `functions/`；涉及 Vue 生命周期或响应式资源协作才放 `orchestration/`。

## 测试入口

- builder 与映射规则：`packages/plugins/slides/src/renderer/features/konvaPreview/functions/**/*.test.ts`
- 文本/table fail-closed：`packages/plugins/slides/src/renderer/features/konvaPreview/functions/builders/__tests__/{textBuilder,tableBuilder}.test.ts`
- stage/raster 编排：`packages/plugins/slides/src/renderer/features/konvaPreview/orchestration/**/*.test.ts`
- 插件全量：`pnpm run test:plugin:slides`

## 持久画布的属性同步

Slides 的 RenderModel/config 是 Konva 属性的唯一事实。所有主预览 `v-*` 节点和动态 shape primitive
必须启用 `__useStrictMode`（模板写作 `:__use-strict-mode="true"`），包括背景、内容、图片、文字、表格
与 overlay。没有绕过 config 的拖拽写入；未来交互也必须先更新正式状态，再由 config 投影。

`vue-konva@3.4.0` 的非严格模式仅比较当前 props 与内部历史 props。它用 Object.assign 累积历史值，
移除属性时会删除 Konva 属性，却不删除历史缓存项。纯色 A → 渐变 → 同色 A 的切换中，fill 被删除后
可能被误判为“没有变化”，留下透明背景；其他可选属性也有相同风险。严格模式同时比对实际 Konva
属性，确保重新出现的同值属性恢复到当前 config。不能靠 page key 重建整个舞台、延时重绘或补白底
处理此问题，否则同页编辑和其他节点的配置漂移仍会存在。

`smoke:preview-transitions` 在真实 Electron 内挂载生产 Vue 组件与当前宿主依赖的 vue-konva，复用同一
节点连续切换，并将每帧像素与新建节点的独立渲染比较。覆盖纯色、线性、径向、无填充及恢复原值，
测试背景与 shape 两条链。可附加一个 Paint JSON 数组路径重放具体文稿的背景序列；测试不写数据库。
普通 raster smoke 每页都新建 stage，不能替代这项持久实例验收。
