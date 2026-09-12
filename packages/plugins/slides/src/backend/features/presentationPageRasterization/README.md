# Presentation Page Rasterization

本 feature 是 Slides backend 内唯一的“冻结 RenderModel 页面 → 已验证 PNG”能力。它负责授权资源物化、hidden worker 调用、PNG 解码、尺寸与 hash 复核；不负责查询数据库、选择产品格式、写文件、ZIP、PDF 或截图批次发布。

`presentationScreenshot` 和 `presentationExport` 都只能通过本 feature 的公开入口取得页面 PNG。这样 CLI 截图、图片导出和 PDF 共用同一套 Konva、ECharts、SVG Graphic、图片与 Paint 渲染规则。

输入必须包含同一次版本快照的 RenderModel、可选 PPTX package bytes、明确页码和 raster profile。输出顺序与请求页码一致。任一页失败时整批失败，不返回可发布的成功子集。

调用方可以通过 `onPageCompleted` 观察已经完成 PNG 解码、尺寸和 hash 复核的页数。回调严格在每页验证成功后按请求顺序触发，只报告 `completedPages / totalPages`，不拥有 renderer、IPC、产品任务或持久化语义。

图表图片化也复用此能力：调用方构造只含一个 Chart 的透明临时页面，本 feature 不理解 PPTX 图表替换规则。

Host 发送前的 `SlideRasterRequestError` 属于确定性的 `invalid_request`，必须映射为页级同类
错误并携带原页码与 codec 生成的安全字段路径。不能因 worker 尚未返回 `SlideRasterResult`
就把 admission 拒绝统一当作 `render_failed`。未知异常内容不得作为对外诊断；截图和导出
继续使用稳定 code。任一页被拒绝都禁止发布已经完成的页面子集。

当前运行时保持逐页串行。真实 30 页 4K 图片导出的观测窗口约 102 秒，全进程 working set 峰值相对基线增加约 529 MB，已经作为可接受基线完成验收。后续只有新的真实样本证明墙钟或内存不可接受时，才重新评估有界并行；不能预先建设全页 `Promise.all`、第二套 worker pool 或任意页数限制。

## 测试

- 资源物化：`orchestration/materializePresentationPage.test.ts`
- 页级进度：`orchestration/PresentationPageRasterizationRuntime.test.ts`
- screenshot 整批复用：`../presentationScreenshot/orchestration/PresentationScreenshotRuntime.test.ts`
- 真实 worker：`pnpm --dir packages/plugins/slides run smoke:raster-worker`
