# Slides Engine Text

`backend/engine/text` 是 shared 文本布局规则的 backend 接入层。它把 generated/imported RenderModel 转成统一输入，预热真实字体字宽，执行一次 finalization，并把最终行级 IR 写回文本节点和表格单元格。

布局语义的权威在 [`../../../shared/textLayout/README.md`](../../../shared/textLayout/README.md)；本目录不得维护第二套默认行距、断行、autofit 或 overflow 规则。

## 文档树

```text
text/
├── generatedTextRenderInput.ts       # DeckSpec text/shape -> RenderParagraph
├── renderModelTextLayout.ts          # cluster 预热与全 RenderModel finalization
├── textLayoutPptxOptions.ts          # 布局合同 -> PPTX textbox options
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

`applyTextLayoutToRenderModel()` 是 backend 唯一文本 finalizer。mapper 禁止提前调用另一套 normalize/layout；renderer、lint 和 table builder 禁止补算。

## Compiler 边界

`textLayoutPptxOptions.ts` 只映射文本框层的 padding、wrap、autofit、vertical align 与 overflow。行距属于 paragraph：

- generated Text 的 `wrap` 来自 DeckSpec：RenderModel finalization 与 PPTX compiler 必须消费同一值；不得按文字内容或盒宽再次猜测。`none` 在预览中只保留显式换行，在 PPTX 中写为 `bodyPr wrap="none"`；
- `multiple` 精确输出 OOXML `spcPct`；
- `exactPt` 精确输出 OOXML `spcPts`；
- run mapper 不输出行距、对齐、段前后或缩进；
- PptxGenJS rich-text 路径只在段落首 run 承载 paragraph 行距，避免库把同一段落属性复制到每个 run。

## 不变量

- generated 未声明行距为 1.0；不能从字体 metrics 推导默认倍数。
- prewarm 与同步 measure 必须使用相同 clusters、run style 和字号档位。
- 字体解析写入的 `resolvedFontWeight/resolvedFontStyle` 是实际 face 事实；prewarm、HarfBuzz、行 metrics 与 renderer 都必须优先消费它们，不能继续拿作者请求样式测量另一张 face。
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
