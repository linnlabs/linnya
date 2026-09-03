# PPTX Shape Geometry Adapter

本目录是 shared `ShapeGeometry` 到 PptxGenJS / DrawingML 的 backend adapter，不拥有第二套形状语法。

## 职责

- `shapeNameRegistry.ts`：严格的 `PresetShapeName → PptxGenJS.SHAPE_NAME` lowering。
- `pptxShapeGeometryAdapter.ts`：把 resolved path 转成 PptxGenJS `custGeom + points`，并保证带文字的自定义形状仍是单个 `<p:sp>`。
- parser 回读不在本目录，位于 `parser/xml/ShapeVisualParser.ts`。

## 约束

- 禁止接收任意字符串、维护 alias 或把未知名称降级成 rect。
- 禁止把 PptxGenJS `ShapeProps.points` 泄漏到 shared、DeckSpec 或 RenderModel。
- preset 必须精确映射；参数化/polygon/path 必须输出 `a:custGeom`，不得图片化。
- PptxGenJS 4.0.1 runtime 支持 `custGeom`，但 `SHAPE_NAME` 声明遗漏该字面量。反射调用只能封装在 adapter 的窄函数中，并由真实 OOXML artifact test 验证；禁止在调用方扩散断言。
- Geometry 与 Paint 正交；compiler 负责组合 position、geometry、Paint、文字与 transform。

## 测试

- 领域几何：`shared/shapeGeometry/functions/shapeGeometry.test.ts`
- OOXML 制品：`pptxShapeGeometryAdapter.test.ts`
- 回读：`parser/xml/ShapeVisualParser.test.ts`
- 业务 E2E：`pnpm --dir packages/plugins/slides run smoke:raster-worker`
