# SVG Graphic Rendering

`renderer/features/svgGraphicRendering` 是 admitted SVG Graphic 的 Konva 技术适配层。它把
RenderModel 中的 canonical SVG 编码成自包含 data URI，并计算 `contain` / `stretch` 的统一几何；主预览和
hidden raster 共用这些纯函数。

## 边界

- 只消费 `SvgGraphicRenderNode`，不读取 deck.js source、作者路径、workspace 或数据库；
- 不解析、清洗或放宽 SVG，安全与 canonicalization 只属于 backend `engine/svgGraphic`；
- SVG 复用现有 image resource registry 做浏览器解码，但业务类型仍是 `svgGraphic`，不是 Image；
- 加载失败时由交互预览显示明确占位，严格 raster 路径按既有资源加载失败合同拒绝；
- rotation 与 opacity 在外层 group 应用，fit 只计算 viewBox 在目标 box 内的绘制尺寸。
  rotation 使用 shared/render-geometry 的中心旋转规则，与 PPTX 图片一致；contain 居中的内容与 box 共用中心。
  子图与加载占位继续使用 box 左上角为局部原点，选框与命中由 `renderNodeSelection` 使用同一旋转约定。

## 测试入口

`functions/svgGraphicKonva.test.ts` 验证自包含 data URI 与 contain/stretch。
`backend/engine/svgGraphic/pptx/svgGraphicPptxRoundtrip.test.ts` 使用真实 PPTX 回读和 Konva 变换，
验证无旋转、正负旋转、双向 contain 留白与 stretch 的四角、选框、命中及再次导入的一致性。
