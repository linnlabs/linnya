# Slide Rasterization

本 feature 是 Slides Renderer 的单一离屏栅格入口。它消费 shared `SlideRasterRequest`，复用 `konvaPreview`
builders 与 `renderVisualResources` 已解码的图片/图表，输出 canvas、ImageBitmap 或 PNG bytes。

`functions/createKonvaRasterCanvas.ts` 只组装 Konva 实例，所有视觉字段仍由 `konvaPreview` builders 翻译。`orchestration/renderSlideRaster.ts` 只编排资源预载、canvas 构建和格式导出。缩略图 store、hidden worker 与后续 CLI adapter 都必须从本 feature 进入，禁止复制节点 switch 或尺寸计算。

renderer 内 thumbnail raster 与主舞台共用图片、图表注册表，避免重复 decode / ECharts 栅格化；hidden worker
运行在隔离上下文，使用同一 feature 代码但持有自己的注册表实例。raster 使用严格失败模式，图片或图表任一
资源失败都不能静默输出残缺 PNG。

离屏 Konva 只能从 `functions/konvaRasterPrimitives.ts` 装配 Stage、Layer、Group 和实际使用的 shapes；禁止恢复
`import Konva from 'konva'` 根入口，否则会把未使用的 shapes、filters 与 Transformer 带入 worker。

`worker/workerEntry.ts` 是同一 raster core 的隔离宿主入口。它先用当前 Paint 真实完成 linear gradient slide 的 Konva 渲染和 PNG 编码，再发送 ready；每次请求先由 `assertSelfContainedRasterRequest()` 拒绝未物化图片，再调用 `renderSlideRasterToPng()`。worker HTML 使用 `default-src 'none'` CSP，preload 只暴露协议 bridge，不暴露 Node 或文件系统能力。

取消由 renderer 按 requestId 持有 `AbortController`，preload 只转发稳定字符串并抑制已取消请求的结果。禁止把 `AbortSignal`、DOM 对象或其他原生实例穿过 `contextBridge`；它们不属于 shared wire contract。

presentation 查询、页选择、资源授权与物化、输出路径、manifest、asset 登记和 provider 转换不属于本 feature。request/response/ready codec 位于 shared raster 合同，backend definition 和 worker preload 必须共同使用它，不能各自解释消息结构。
