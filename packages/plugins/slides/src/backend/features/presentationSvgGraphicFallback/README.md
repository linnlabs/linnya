# Presentation SVG Graphic fallback

该 feature 是 Slides app 对 engine `SvgGraphicFallbackRasterizerPort` 的唯一适配器。它把已经 admission 的 canonical SVG 包装成单节点、自包含、透明背景的 `SlideRasterRequest`，复用现有隔离 hidden worker 生成真实 PNG。

engine 只知道“SVG -> PNG”窄 port，不依赖 Electron、Renderer 或 hidden worker；本 feature 不读取作者路径、数据库或任意外部资源。fallback 保持 SVG viewBox 比例，最长边固定 1920px，同一资产每次 PPTX 编译只栅格一次。

worker failure 必须向上失败，PPTX writer 不允许保留 PptxGenJS 固定占位图，也不允许静默退化为 PNG-only。
