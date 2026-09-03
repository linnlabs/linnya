# Slides Math Formula Contract

`shared/mathFormula` 定义 Slides 原生数学公式的跨端语义合同。DeckSpec 长期保存受控 LaTeX、显示方式和已解析样式；RenderModel 只携带自包含 SVG、几何度量与身份，不暴露 parser AST。

```text
authoring input
  -> normalizeMathFormulaSource()
  -> durable MathFormulaSource
  -> backend canonical compiler
       -> transient MathML -> MathJax STIX2 path SVG + contentViewBox + metrics
       -> native OMML
```

## 边界

- `MathFormulaSource` 是可持久化事实；内部 AST 只属于 backend 单次编译。
- `isMathFormulaSource()` 是 persistence / Worker 边界对 canonical source 的唯一 admission；各调用方不得复制一套字段猜测。
- `MathFormulaError` 是 text finalizer、公式 compiler 与 Worker 共用的领域错误载体；宽度、行高、语法、资源预算、投影与 PPTX patch 必须保留稳定 `slides.formula.*` code，不能退化为普通 `Error` 后再从 message 猜分类。
- `MathFormulaRenderProjection` 的 `contentViewBox` 是 renderer 缩放公式墨迹的唯一依据，前端不得猜 compiler padding。
- SVG 是自包含路径投影，不依赖 CDN 或本机字体；内部 MathML 与 canonical AST 都不得越过 backend 边界。
- block 公式是独立节点；inline 公式作为不可拆分 atomic box 进入 [`textLayout`](../textLayout/README.md)。
- 只接受当前 profile 的闭集 LaTeX；未知命令、资源超限和投影失败必须明确失败，不得降级为图片、普通文本或 raw LaTeX。
- shared 不解析 LaTeX、不生成 SVG/OMML，也不依赖 Node、DOM、Konva 或 PptxGenJS。

## 测试

- 归一化与 compiler corpus：`backend/engine/mathFormula/compiler/compileMathFormula.test.ts`
- 混合文本布局：`shared/textLayout/__tests__/inlineFormulaLayout.test.ts`
- 公共 deck.js 链路：`backend/codegen/__tests__/FormulaCodegen.integration.test.ts`。该测试必须使用正式的 `createText([...])` 写法，并经过 sandbox、Flex、DeckSpec、RenderModel、Worker materialization codec 与 PPTX，不能直接从 DeckSpec 跳到 compiler。
