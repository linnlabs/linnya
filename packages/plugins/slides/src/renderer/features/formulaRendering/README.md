# Formula Rendering

`renderer/features/formulaRendering` 把 RenderModel 中由 MathJax/STIX2 生成的自包含 path SVG 投影映射为 Konva Image。主预览、缩略图和隐藏 raster 读取同一 `canonicalSvg` 与同一资源 registry。

## 边界

- 只消费 `MathFormulaRenderProjection`，不解析 LaTeX、AST 或 OMML。
- block 公式按最终元素 box 与对齐方式放置；inline 公式按 `TextLayoutResult` 中的 atomic slice 放置。
- 缩放只使用 projection 的 `viewBox + contentViewBox + metrics`，禁止复制 backend padding 常量或重新测量。MathJax `viewBox` 允许负坐标，实际放置必须使用 `contentViewBox - viewBox` 的相对偏移。
- 资源缺失时沿现有图片资源错误合同失败，不显示 raw LaTeX fallback。

`functions/formulaKonva.test.ts` 验证 self-contained SVG 与 content-box 对齐；混合断行测试归 [`shared/textLayout`](../../../shared/textLayout/README.md)。
