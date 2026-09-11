# Slides Visual Paint 合同

本文是 Slides 背景、形状填充和描边 Paint 的长期 owner 文档。Agent 可读的 deck.js 语法见 [`slides-design` syntax](../resources/skills/slides-design/references/syntax.md#7-shapepaint-与层级)，类型真值见 [`paint.ts`](../src/shared/visual/paint/definitions/paint.ts)，输入归一化真值见 [`normalizePaint.ts`](../src/shared/visual/paint/functions/normalizePaint.ts)。

## 能力矩阵

| 挂载位置 | none | solid | linear | radial |
|---|---:|---:|---:|---:|
| slide background | 是 | 是 | 是 | 是 |
| shape fill / 色块 | 是 | 是 | 是 | 是 |
| shape border / line stroke | 是 | 是 | 是 | 否 |

文字、表格单元格和原生图表系列不属于本合同。stroke 收窄为 linear 是公开能力边界，不能在任一 adapter 中把 radial 静默转成纯色。

## 统一语义

Authoring 线性渐变可用 `direction` 的八个 `to-*` 方向或 `angle`，二选一；admission 立即归一为 canonical angle，持久化与 adapter 不保存第二份方向事实。角度 0° 向右、90° 向下、顺时针，区别于 CSS；非正方形按 OOXML scaled 语义缩放。

- 颜色输入只接受 hex；进入 shared Paint 后统一为 `#RRGGBB`。
- gradient 至少有两个 stop，按 position 非递减排列。position 和 stop opacity 都是 0–1；重复 position 用于硬切色。
- linear angle 以 0° 向右、90° 向下为基准，顺时针增长；admission 将任意有限角度归一到 0–360°。
- radial center/radius 使用元素边界框内的归一化坐标，默认值都是 0.5/0.5。
- shape node opacity 只与 fill Paint 的 opacity 相乘。stroke 和 shape inner text 不借用 fill opacity，避免预览与 PowerPoint 导出不一致。
- `rotateWithShape` 默认 true；adapter 必须显式消费，不能依赖 Konva 或 Office 的隐式默认值。

## 数据流与边界

正式链路只有一份 Paint：

```text
deck.js
  -> Flex admission / normalizePaint
  -> DeckSpec ShapeStyle.paint / background.paint
  -> PresentationRenderModel
  -> Konva preview + thumbnail + hidden raster
  -> PptxPaintPatchPlan
  -> native DrawingML
```

host 工具、IPC、Vue store 和数据库 schema 不拥有 Paint 副本。`deck_source` 仍是唯一编辑事实。
持久化 admission 已负责校验并迁移 DeckSpec；查询和渲染只能消费这份 canonical DeckSpec，禁止再次经过旧工具输入 normalizer，否则正式 `paint` 会被窄工具合同静默裁掉。

旧 `ShapeStyle.fill/gradient`、background `color/gradient` 以及图片 color fallback 只允许在 admission/replay migration 被读取；当前 compiler、mapper 和 renderer 不得继续传播双字段。旧 `ppt_edit_style` 不扩展渐变 schema，收到渐变必须提示用 `edit_file` 修改 deck.js。

## Adapter 约定

### Konva

[`konvaVisualMapping.ts`](../src/renderer/features/konvaPreview/functions/konvaVisualMapping.ts) 是 Paint 到 Konva config 的唯一映射。主预览、缩略图与 hidden raster 共用 builders；禁止新增 CSS、SVG 或 Canvas 2D 的旁路渐变实现。

### PowerPoint 写出

PptxGenJS 继续生成普通对象，[`pptxPaintPatchPlan.ts`](../src/backend/engine/visual/pptxPaintPatchPlan.ts) 保存单次编译的强类型修订计划，随后 [`pptxPaintPostProcessor.ts`](../src/backend/engine/visual/pptxPaintPostProcessor.ts) 写入原生 DrawingML：

| 目标 | DrawingML 位置 |
|---|---|
| background | `p:bg/p:bgPr/a:gradFill` |
| shape fill | `p:spPr/a:gradFill` |
| border / line | `p:spPr/a:ln/a:gradFill` |

linear 使用 `a:lin`。radial 使用圆形 `a:path`，焦点由 `a:fillToRect` 表达，center/radius 的渐变 tile 由 `a:tileRect` 表达。stop alpha 写入颜色节点下的 `a:alpha`。对象名只携带短期 opaque marker；完整 Paint 不得编码进名称，处理结束必须移除 marker。

### PPTX 读取

[`ShapeVisualParser.ts`](../src/backend/engine/parser/xml/ShapeVisualParser.ts) 读取 background 和 `p:sp` shape/line 的 `noFill/solidFill/gradFill`，并反算 linear angle、radial center/radius、stop position 与 alpha。当前已验证的颜色事实是 `srgbClr`；PowerPoint `p:cxnSp` connector fixture、theme `schemeClr`、`sysClr/prstClr` 与完整 tint/shade/luminance transform 仍是 imported 外部 PPTX 的待补保真项，不能用默认白色伪造。

## 修改检查表

修改 Paint 字段或几何语义时必须同时检查：

1. shared definitions 与 normalize 纯函数；
2. Flex admission 和生成的 `layoutPrimitives.d.ts`；
3. DeckSpec / RenderModel codec 与 mapper；
4. Konva 主预览、缩略图、hidden raster 的共享映射；
5. native OOXML 写出与 marker 清理；
6. PPTX parser 与 compile → parse round-trip；
7. Skill syntax、生成的 `layoutPrimitives.d.ts` 和可执行示例；
8. PowerPoint ground-truth 视觉 smoke。

结构测试只能证明 XML 节点位置，不能代替 PowerPoint、LibreOffice 或 Keynote 的实际插值验证。

径向预览通过目标 Canvas 的 sceneFunc 变换表达 `width × radius.x` 与 `height × radius.y`，不能取两轴最大值压成圆。Ellipse 原语的中心坐标必须转换到局部坐标；页面背景与其他 Shape 使用同一 scene renderer。
