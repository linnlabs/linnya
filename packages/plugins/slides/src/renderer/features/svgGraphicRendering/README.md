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

## 测试入口

`functions/svgGraphicKonva.test.ts` 验证自包含 data URI、contain/stretch、rotation、opacity 与占位几何。
