# Presentation Brush Artwork Generation

该 feature 把 engine 的 `BrushArtworkGeneratorPort` 接到 Slides 专用隐藏 Renderer。Backend 只声明严格
worker codec、超时/取消和运行路径，不接触 WebGL；Renderer 内每个任务再创建一次 job-scoped Worker。

该 feature 不保存图片、binding 或 cache。成功 PNG 立即回到 `presentationImageOwnership`，由既有 Host
document image asset workflow 接管。当前只支持显式纯色背景的不透明 PNG。
