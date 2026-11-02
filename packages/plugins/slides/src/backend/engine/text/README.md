# Slides Engine Text

`backend/engine/text` 是 shared 文本布局规则的 backend 接入层。它把 generated/imported RenderModel 转成统一输入，预热真实字体字宽，执行一次 finalization，并把最终行级 IR 写回文本节点和表格单元格。

布局语义的权威在 [`../../../shared/textLayout/README.md`](../../../shared/textLayout/README.md)；本目录不得维护第二套默认行距、断行、autofit 或 overflow 规则。

## 文档树

```text
text/
├── generatedTextRenderInput.ts       # DeckSpec text/shape -> RenderParagraph
├── renderModelTextLayout.ts          # cluster 预热与全 RenderModel finalization
├── textLayoutPptxOptions.ts          # 布局合同 -> PPTX textbox options
├── prepareShapeTextAutofit.ts       # Host 同源形状缩字结果准备
├── shapeTextAutofitPptx.ts          # 形状缩字同源布局与 OOXML 物化计划
└── __tests__/                        # 字体、finalization、PPTX 映射测试
```

历史的 `generatedTextMeasurementInput`、`generatedDeckMeasurementPrewarm` 和 `renderModelMeasurementPrewarm` 已删除。它们会压平段落或把首个 run 的行高当成整个文本框事实，与最终布局产生双权威。

## 唯一流程

```text
DeckSpec / CanonicalDeck
  -> RenderModel mapper（只映射语义，不提前布局）
  -> collectClusterAdvanceRequestsForRenderModel()
       -> 普通 text
       -> shape inner text
       -> 每个 table cell
       -> shrink-text 全部字号档位与 ellipsis
  -> text measurement prewarm
  -> applyTextLayoutToRenderModel()
       -> 普通 text.layout
       -> shape innerText.layout / resize-shape 外框
       -> table cell.textLayout
  -> finalized PresentationRenderModel
  -> Konva / raster / lint 共同消费
```

`applyTextLayoutToRenderModel()` 是 backend 唯一文本 finalizer。mapper 禁止提前调用另一套 normalize/layout；lint 和 table builder 禁止补算。Renderer 普通展示直接消费最终 IR；可编辑 Text 的字号和 Shape 缩放预览使用同源 shared 排版器和本层准备的测量事实。

具有 set_text_style 的 Text 和具有 set_visual_size 的 Shape innerText 都在 finalization 得到 preparedTextLayout。它保留 plain-textbox／shape-inner-text profile 与 autofit 之前的 inputBox。HarfBuzz 未缩放字形序列和字体 em 指标可跨字号复用；不提供此能力的测量来源仅记录实际测量值。生成 Shape 的 shapeTextSizing 区分显式字号与尺寸驱动的默认值，规则继续统一在 shared/textLayout。Renderer 的 editingPreview 一次发布样式、换行、autofit、padding 和外框。带 layoutReplay 的页面还为所有普通 Text 与 Shape innerText 准备同源测量事实，包括无 editKey 的兄弟，供 flow 宽度预览连同父级布局一起重排；不完整的测量不能产生局部更新。只读 standalone CLI 显式传入 prepareEditingMeasurements=false，不承担交互预热或快照成本。

## Compiler 边界

`textLayoutPptxOptions.ts` 只映射文本框层的 padding、wrap、autofit、vertical align 与 overflow。行距属于 paragraph：

- generated Text 的 `wrap` 来自 DeckSpec：RenderModel finalization 与 PPTX compiler 必须消费同一值；不得按文字内容或盒宽再次猜测。`none` 在预览中只保留显式换行，在 PPTX 中写为 `bodyPr wrap="none"`；
- `multiple` 精确输出 OOXML `spcPct`；
- `exactPt` 精确输出 OOXML `spcPts`；
- run mapper 不输出行距、对齐、段前后或缩进；
- PptxGenJS rich-text 路径只在段落首 run 承载 paragraph 行距，避免库把同一段落属性复制到每个 run。

freeform 形状内文字的 `prepareShapeTextAutofit` 复用正式 mapper、字体预热和 finalizer，按页与深度优先绘制顺序输出 `fontScale` / `lineSpacingReduction`。Host 在 `preparePresentationMaterialization` 中准备这些标量，经严格、版本化的 Worker DTO 传输；不能在 Worker 重新测量。`shapeTextAutofitPptx` 只收集对象 marker，并在 sanitizer 的 Paint 处理前按 100000 单位写入 `normAutofit`。默认 1 / 0 不写属性。计划只存在于单次导出，不改 deck.js 或持久化 DeckSpec。显式 in-process 的 `DeckAssembler` / `FreeformCompiler` 也使用相同准备函数；Worker 使用 `PreparedDeckAssembler` / `FreeformPptxCompiler`。真实包与禁止 Worker 重测的断言见 `backend/__tests__/shape-text-autofit-pptx.test.ts`。

## 不变量

- generated 未声明行距为 1.0；不能从字体 metrics 推导默认倍数。
- prewarm 与同步 measure 必须使用相同 clusters、run style 和字号档位。
- 字体解析写入的 `resolvedFontWeight/resolvedFontStyle` 是底层字面的二档样式事实；prewarm、HarfBuzz 与行 metrics 使用它们，不能拿另一张 face 测量。绘制保留作者请求的 bold/italic：缺少对应字面时允许浏览器合成强调，不能因为 resolved 为 normal 而静默取消作者样式。平台将 Semibold 归入 bold 二档，确保 PingFang 粗体测量与浏览器的实际字面匹配；合成效果的字形绘制边界与排版 advance 仍分开。
- `RunAdvanceProvider` 的长度不匹配立即失败，不做启发式补齐。
- shape inner text 与导出一致使用 shrink-text；resize-shape 只在 finalization 后修改外框。
- table cell 缺 `textLayout` 是生产合同错误，renderer 必须 fail closed。
- lint 优先消费 final `textLayout.overflow`，不重新估算 generated 文本。

## 测试入口

- finalization 与 table/shape：`src/backend/engine/text/__tests__/renderModelTextLayout.test.ts`
- 字体解析和 cluster 预热：`src/backend/engine/text/__tests__/font-resolution-integration.test.ts`
- PPTX textbox options：`src/backend/engine/text/__tests__/textLayoutPptxOptions.test.ts`
- OOXML paragraph 行距：`src/backend/__tests__/{structured-compiler,freeform-compiler}.test.ts`
- 前端/PPTX 几何对齐：`src/backend/__tests__/render-pptx-alignment.test.ts`

`materializeIntrinsicTextBoxes` 在 codegen 落库与 PPTX 物化前处理无横向约束的绝对定位 Text：复用本模块的字体解析、预热与最终布局，保留左右/底部锚点并按 EMU 向上量化外框宽度。Yoga 的临时启发式盒不能成为自动宽度的持久化事实。来源记录在 generated constraint evidence 的 `intrinsicTextAdvanceSource`；系统测量不可用时仍如实标记 heuristic。
