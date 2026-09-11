# Konva Builders 子模块

> 长期权威。新增 RenderNode 类型 / 新增视觉字段时**必须**同步本文。
> 跨进程边界见 [`../../../../../../../README.md`](../../../../../../../README.md)；Paint 字段贯通见 [`../../../../../../docs/visual-paint-contract.md`](../../../../../../docs/visual-paint-contract.md)。

## 角色

**主视图与离屏缩略图共享的纯函数 builder 层**：把后端 `RenderNode` 翻译成 Konva 原语 + 配置（`Record<string, unknown>`）。

不持有任何 Vue / Konva 实例，不做布局决策；只做"`RenderNode → Konva 配置`"的纯映射。

> Phase 5：builder 本体已经随 Slides renderer 插件包发布；旧 host `apps/renderer/domains/slides` 门面已删除。图片本地文件读取通过 `@plugin/renderer/imageAssetSource` 消费 host 能力。

> 历史教训：缩略图曾经手写一套 Canvas 2D renderer，与主视图分叉。**禁止再开第二套渲染规则**——加任何视觉效果都改本目录。

## 文件树

```
konva-builders/
├── backgroundBuilder.ts  # slide 背景（Paint / image）
├── textBuilder.ts        # 消费后端行级 text layout；缺 layout 直接报错
├── shapeBuilder.ts       # rect / ellipse / line / polygon / custom path + fill / stroke / shadow / cornerRadius
├── imageBuilder.ts       # fitMode / maskShape / borderRadius / flipH/V / shadow（pt → px）
├── tableBuilder.ts       # cell rect / cell text / cell border
├── chartBuilder.ts       # 已栅格图表资源 → Konva Image 配置
├── groupBuilder.ts       # z-index 排序、扁平化遍历
```

## ⭐ 单位换算唯一约定

| 来源（RenderNode）| 单位 | 转换 | 用例 |
|------|------|------|------|
| `box.{x,y,w,h}` / `cornerRadius` / `borderRadius` | **inches** | `× INCHES_TO_PX (96)` | shape / image / text 几何 |
| `fontSize` | **pt** | `× POINTS_TO_PX (96/72)` | text |
| `stroke.width` / `shadow.{blur,offsetX,offsetY}` | **pt** | `× POINTS_TO_PX` | shape / image |
| `rotation` | **度** | 直接使用 | 全部 |
| `opacity` / `shadow.opacity` | **0–1** | 直接使用 | 全部 |

**禁止**：

- ❌ 把 `cornerRadius` 当 px 用（PptxGenJS `rectRadius` 是 inches，与 DSL 同源）
- ❌ 把 `shadow.blur` 当 px 用（DSL 是 pt，要 `× 96/72`）
- ❌ 写 raw hex / raw shadow / raw radius（必须从 RenderNode 取）
- ❌ 在 builder 内自创布局规则（前端是后端 solver 结果的响应式消费层）

## 模块边界

| 允许 | 禁止 |
|------|------|
| 被 Vue 主视图（`KonvaXxxNode.vue`）+ 离屏栅格（`features/slideRasterization`）共享 | ❌ 持有 Vue / Konva 实例 / DOM ref |
| 实现层 import `@plugin/slides/shared` / 包内 renderer 公开合同 | ❌ import `apps/renderer/domains/slides/*`（旧 host renderer domain 已删除） |
| 纯 builder 实现只依赖包内 `konvaVisualMapping` / `konvaTable` 与 shared `shapeGeometry` 等函数 | ❌ import 后端 `docs/archive/slides-pluginization/legacy-ai-ppt/*`（前后端必须只通过 RenderModel schema 通信） |
| 输出 `Record<string, unknown>`（Konva config）+ 完整 instruction 对象 | ❌ 在 builder 调用 fetch / decode / ECharts（资源生命周期由 `renderImageResources` / `renderChartResources` 负责） |

## 设计契约

### backgroundBuilder

- 页面背景始终覆盖完整逻辑画布，不能带圆角、阴影或其他预览外壳视觉；这保证主预览内容、离屏 PNG 与导出消费同一份矩形页面事实。
- 编辑器里的圆角、阴影和画布外裁剪只属于 `SlideStage` UI 外壳。不得把这些 UI chrome 下沉到共享 builder，否则离屏页面会泄漏透明角或阴影像素。

### shapeBuilder

- **唯一**形状分发入口（`buildShapeRenderInstruction`）：所有 resolved geometry → primitive 的判断都在此，调用方禁止再分支
- 直线只消费正式 `stroke.paint`；旧 line fill 在 admission 迁移，builder 不再猜测或桥接
- `roundRect` 默认 cornerRadius = `short_side × 16667/100000`（OOXML preset 默认 adj），与 PowerPoint 默认效果对齐
- cornerRadius 始终 cap 到 `short_side / 2`，达到上限时 = 完美胶囊

### imageBuilder

- `clipFunc` 实现 `maskShape='circle'`（椭圆 mask，不要求正方形）+ `borderRadius` 圆角矩形
- `flipH/V` 用 `scaleX/Y = -1` + 镜像 `x/y` 偏移，避免 Konva 反转后位置错位
- shadow 单位严格 `pt × POINTS_TO_PX`

### textBuilder

- `node.layout` 必须逐 `RenderTextLine` / `RenderLineSlice` 绘制，`wrap:'none'`、`ellipsis:false`，禁止再让 Konva 自己换行或截断。
- `TextLayoutContract` 是 padding / wrap / autofit / font resolution 的唯一语义来源；builder 只能消费 RenderModel 和行级 IR。
- 缺 `node.layout` 必须失败，不能在 renderer 重建段落 wrap；所有新换行问题都回到 shared `textLayout` 与后端 render-model。
- bullet、`letterSpacing`、混排 run 样式必须从 slice 对应 run 读取；不能再把段落 runs 压成第一个 run 的样式。
- 字体 family、weight、style 必须共同优先读取后端 resolved face 事实；禁止用 `resolvedFontFamily` 配作者请求字重，制造测量与绘制身份分叉。
- 不做 line-spacing 双语义判定（RenderModel mapping 阶段已把它收口到 `RenderParagraph.lineSpacing`）。
- 每个 slice 使用自己的 `textY` 对齐公共 baseline；不能统一使用 line.y，否则混合字号会漂移。
- 普通 slice 不设置 Konva Text `width`：后端 `slice.width` 只负责布局 advance，字形 paint 只能由外层文本框裁剪。仅 justify 为分配词间距保留显式宽度。
- `clip` / `ellipsis` 只创建文本框外边界 clip group；padding 决定布局但不裁掉进入 padding 的字形。真正的省略号已经由 backend 布局生成。

### tableBuilder

- cell rect、padding 和 border 几何可以在 renderer 做纯映射；cell 文字布局不可以。
- 每个 `RenderTableCell` 必须携带 backend 生成的 `textLayout`，并复用 text slice builder。
- 缺 `textLayout` 立即失败，禁止调用 Canvas/Pretext 临时测量或按第一行样式估算。
- table 的主舞台、缩略图和离屏 PNG 必须消费同一个 cell layout 对象。

### chartBuilder

- 只把已经就绪的 `HTMLImageElement` 和 `ChartRenderNode` 映射为 Konva Image / placeholder 配置
- ECharts 离屏渲染、解码、缓存和失败语义统一由 `features/renderChartResources` 负责
- 颜色完全消费 `theme.chart.palette` / `ChartRenderNode.palette`，禁止自创色板

## 加新东西 Checklist

### 加新 RenderNode 类型

新增 RenderNode 类型时同步 shared codec、backend mapper、主预览与离屏 renderer，并补协议 round-trip 测试。

1. 在本目录加 `<type>Builder.ts`（`buildXxxGroupConfig` + `buildXxxNodeConfig` / 等价 instruction）
2. 包内 `features/konvaPreview/index.ts` re-export
3. 主视图：`KonvaXxxNode.vue` + `KonvaNodeRenderer.vue` 分发
4. 离屏栅格：`slideRasterization/functions/createKonvaRasterCanvas.ts` 加分支
5. 测试：`konvaBuilders.test.ts` 加 builder 输出快照

### 加新视觉字段（如 `text.outline`）

1. RenderNode schema 必须先扩（`@plugin/slides/shared` + `types/render`）
2. 后端 RenderModelMapper 必须先填值
3. 本目录对应 builder 消费该字段
4. 不接 RenderModel 改动直接在前端"自创"显示效果 = 单方向漂移，禁止
5. 测试：`konvaBuilders.test.ts` + `render-pptx-alignment.test.ts`

### 调整单位换算

1. 改动必须同步 shared RenderModel/codec、backend mapper、Vue 主预览和离屏栅格
2. 跑 Konva mapping、raster codec、backend mapper 与插件 typecheck 套件
3. 跨端对齐白名单（`render-pptx-alignment.test.ts` 内）若要更新需附理由

## 测试入口

- `packages/plugins/slides/src/renderer/features/konvaPreview/functions/*Builder*.test.ts` 或相关 builder case
- `shapeBuilder.test.ts` 锁定 line 只消费 `stroke.paint`，以及 shape stroke/shadow 的 pt → px 换算
- `packages/plugins/slides/src/renderer/features/konvaPreview/functions/echartsMapper.test.ts`
- `packages/plugins/slides/src/renderer/features/konvaPreview/functions/konvaVisualMapping.test.ts`
- `packages/plugins/slides/src/renderer/features/konvaPreview/functions/shapePathPresets.test.ts`
- 跨端对齐：`packages/plugins/slides/src/backend/__tests__/render-pptx-alignment.test.ts`

径向填充使用共享 sceneFunc，在目标 Canvas 上变换渐变坐标并反向归一原始路径，保持轮廓与阴影，不产生位图或异步资源。Ellipse 的局部坐标以中心为原点，填充与描边渐变都必须减去半边长；其余原语以左上角为原点。
