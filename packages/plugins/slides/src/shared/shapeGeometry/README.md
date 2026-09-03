# Shape Geometry

`shared/shapeGeometry` 是 Slides 形状轮廓的跨 backend / renderer 权威合同。它只负责 preset、参数化几何、polygon、typed path 的定义、校验、归一化和 local-space 纯计算。

## 边界

- 允许：纯 TypeScript 类型、有限数校验、preset 展开、path 序列化和 local bounds 规则。
- 禁止：Paint、文字排版、slide 绝对位置、Konva、PptxGenJS、OOXML DOM、Vue、Node IO。
- deck.js/DeckSpec 使用 `ShapeGeometrySpec`；compiler、RenderModel 和 renderer 使用 `ResolvedShapeGeometry`。
- 未提供 geometry 时默认 rect；显式未知 preset 或非法 geometry 必须失败，禁止回退 rect。
- polygon 最多 256 点，typed path 最多 512 commands；超过上限在 admission 失败，禁止截断。
- backend PPTX lowering 位于 `backend/engine/shape`；Konva adapter 位于 `renderer/features/konvaPreview`；OOXML 回读位于 `backend/engine/parser/xml`。

## 扩展规则

新增 geometry 或 preset 时，必须同时更新 definition、resolver、RenderModel codec、PPTX adapter、parser、Konva builder、skill 和业务端到端验收。禁止只在 renderer 新增点位。
