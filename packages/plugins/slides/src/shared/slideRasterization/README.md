# Slides 栅格化合同

本模块是 backend、Renderer 与 hidden worker 共同理解的纯合同层。它定义单页栅格请求、输出 profile、PNG bytes 结果和稳定错误，不执行 DOM、Konva、文件、数据库或 IPC 操作。

`SlideRasterRequest` 只携带单页 `SlideRenderModel` 和页面尺寸。presentation 查询、页选择、输出目录、批次发布与 asset 登记都属于调用方编排，不能进入 worker 合同。

首版固定输出 PNG。viewport 表达布局尺寸，`pixelRatio` 表达栅格倍率，最终物理尺寸只能通过 `resolveSlideRasterPixelSize()` 计算。按宽度适配页面时必须使用 `createAspectRatioSlideRasterProfile()`，避免缩略图、worker 和 CLI 出现不同的高度取整规则。预览与导出共用 `SLIDES_RASTER_LOGICAL_DPI=96`；高分辨率导出保持 96 DPI 逻辑 viewport，并通过 `pixelRatio` 同时提高 Konva 和 ECharts 的物理清晰度。

文稿物理尺寸合法性与单次 raster request 可执行性是两个合同。1–56 英寸的自定义画布可以保存、预览并导出 PPTX；某次图片请求仍必须同时满足 viewport、pixelRatio、长宽比和总像素预算。超预算由调用 feature 返回专门的
`slides.page-raster.pixel_budget_exceeded` 或 `slides.screenshot.pixel_budget_exceeded`，不能把合法文稿误报为 layout 非法，也不能静默降低用户指定的分辨率。

稳定失败只暴露错误码和可展示消息，不携带 stack、本机路径、render model 或图片字节。

## Hidden worker 协议

`slideRasterWorkerProtocol.ts` 定义 worker id、协议版本、IPC channel 和 envelope；`slideRasterWorkerCodec.ts` 是动态 plugin registry 的 `unknown` 边界。request、response 和 ready payload 都必须经过 codec 恢复领域类型，禁止在 definition、preload 或调用方用泛型断言跳过校验。worker codec 复用 `renderModel/renderModelCodec.ts` 逐层校验背景、节点基类、文本 run/layout、表格 cell、图表 series/axes 和递归 group；不能只检查顶层数组后把未知 payload 当成 RenderModel。

当前协议版本是 v3：在统一 Paint wire contract 上增加 `transparentBackground`，让原子 SVG fallback 复用同一 renderer 时保留 alpha。破坏性修改必须直接升级协议并让旧 worker 在 ready 阶段失败；开发期不保留双 codec，也不把旧 `color/gradient` 转回当前 Paint。取消边界只传经过 codec 校验的 `requestId`：`AbortController` 属于 renderer 隔离世界，不能作为 `contextBridge` 参数跨进程/上下文传播。

worker request 必须自包含。图片资源只能是已经物化的 `data:image/jpeg|png|webp;base64,...`，不能携带本机路径、相对 embedded path 或 HTTP URL。读取已授权文件、验证图片和转换 data URI 属于 backend 调用编排，不属于 shared 合同，也不能通过扩大 preload 权限完成。

本地 request admission 使用具名 `SlideRasterRequestError`，携带稳定
`slides.raster.invalid_request` 和由 codec 生成的安全字段路径。路径只使用已知合同名称与数组
索引，不回显未知 key、元素文字、图表数值或资源来源。page raster 与 screenshot 必须保留
这类确定性拒绝和原页码，不能包装成普通 `render_failed`；未知执行异常仍不透传原始 message。
图表字段的严格闭合校验与 generated mapper 必须共同验证，单独手写简化 RenderModel 的
worker smoke 不能代替真实作者输入链路。
