# PDF 解析

本模块把 PDF 转成带原始页码的
`ParsedBlock`，并输出页级诊断。它拥有 PDF 文本、布局与逐页视觉解析；知识库负责摄取状态机、持久化、向量化和失败页增量提交。

## 解析链

入口是 [`PdfParser.ts`](./PdfParser.ts)，按成本从低到高选择：

1. `TextExtractionStrategy`：用 PDF.js 提取文本和页码，适合普通数字 PDF。
2. `GeometricAnalysisStrategy`：读取文本坐标，以栏布局和 XY-Cut 修复规则多栏阅读顺序。
3. `VisionRecognitionStrategy`：扫描件或复杂页面进入 OCR。
   - `document_upload` 模型直接接收原始 PDF；
   - 通用视觉模型通过 `PdfRasterAdapter` 把页面渲染成 JPEG，再逐页调用
     `TextGenerationPort`。

视觉能力必须由 composition root 显式注入 `TextGenerationPort` 和
`DocumentOcrPort`。Parser 不读取 Provider SDK、Host
route、全局服务注册表或厂商响应形状，也不在失败后偷偷换模型。

## PDF.js 与栅格化边界

文本、页数、几何坐标和图像渲染统一使用精确版本的 `pdfjs-dist`；Node Canvas 使用
`@napi-rs/canvas`。两者都是 npm 生产依赖，源码开发不下载 Poppler，也不读取 Homebrew、系统
`PATH` 或相邻仓库。

[`pdfJsRuntime.ts`](./adapters/pdfJsRuntime.ts)
负责 PDF.js 及随包 CMap、ICC、标准字体和 WASM 的唯一加载配置。它显式限制 PDF.js
Canvas 探测上限，避免 Node 首次打开文档时通过创建巨型 Canvas 探测环境能力。调用方必须关闭 loading
task。

[`PdfRasterAdapter.ts`](./adapters/PdfRasterAdapter.ts) 遵守以下内存与调度合同：

- 同一 PDF 只打开一次，所有页面复用解析缓存；
- 页面渲染严格串行，任一时刻只存在一个 RGBA Canvas；
- OCR 流水最多保留两个在途页面，不会先把整份 PDF 转成 Base64 数组；
- JPEG 使用异步编码，二进制直接传给推理端口，仅在专用 OCR 合同要求时转 Base64；
- 每页完成后清理 `PDFPageProxy` 和 Canvas，文档完成后销毁 loading task；
- PDF.js 的绘制 continuation 通过 `setImmediate`
  让出事件循环，不创建或占用 Electron `BrowserWindow`。

默认和最大输出长边均为 1536px。若未来提高上限，必须先重新验证扫描件识别质量、RGBA 峰值、Provider 输入限制和长文档基准，不能只改常量。

## 线程与前端响应

知识库的正式全量摄取由 `src/infra/task-queue/workers/ingestion.worker.ts`
在 Worker
Thread 执行。Renderer 只接收进度和结果，不加载 PDF.js、Canvas 或 PDF 字节；本实现也没有隐藏渲染窗口。

失败页续跑目前由 App
Server 编排，不在 Renderer 进程。该路径只打开原始 PDF 一次并逐页处理，PDF.js 的绘制 continuation 会让出 App
Server 事件循环，但大型扫描图解码仍可能产生约 100ms 级别的后端单次延迟。它不会卡住 Renderer 帧；若未来支持大批量失败页续跑，应先把该编排迁入专用 Worker，而不是引入隐藏
`BrowserWindow`。

## 页级诊断

- Parser 可用 `source_info.page_number` 表示原始页码；知识库后处理统一归一化为
  `source_info.page_num`。
- Qdrant payload 的 `page_number` 必须来自归一化后的页码。
- 单页失败返回 `errorKind`、`retryable`、`shouldReduceConcurrency` 和
  `shouldSplitSmaller`。
- Partial 成功保留成功页 blocks；仅全部页面失败才作为整体失败。
- `processPdfPagesWithVisionDiagnostics()`
  只续跑指定失败页，增量提交与回滚由知识库 orchestration 拥有。

## 验证

```bash
pnpm exec vitest run src/features/parsers/pdfParser
pnpm run benchmark:pdf-raster -- --pages 500 --target-pixels 1536
pnpm run benchmark:pdf-raster -- --pages 100 --synthetic-scans --target-pixels 1536
pnpm run build:worker
pnpm run build:backend
```

基准会先把业务 TypeScript 构建成生产式普通 JavaScript，再以纯 Node 进程运行；不要直接用
`tsx`
或 Vitest 的进程 RSS 评价 PDF.js，它们会转换 PDF.js 的大型 worker 模块并显著虚增测量结果。可用
`--input <pdf>` 测真实文件，用 `--trace-memory` 查看关键页 RSS。

2026-09-04 在 Apple Silicon、Node 24.18.0 的参考结果：

- 合成 500 页矢量 PDF、1536px：约 2.6 秒，峰值 RSS 约 175 MiB，事件循环延迟 P99 约 2.7ms；
- 合成 100 页扫描 PDF、24 MiB 内嵌 JPEG：约 12 秒，峰值 RSS 约 269 MiB，第 3 页到第 100 页的 RSS 仅从约 249 MiB 增至 269 MiB；
- Mozilla 14 页复杂样本：约 0.58 秒，峰值 RSS 约 219 MiB、P99 约 26ms。

扫描件的 JPEG 解码会在 Worker 内产生约 120ms 级别的单次事件循环延迟，这也是正式全量摄取必须留在 Worker Thread 的原因；Renderer 进程不加载 PDF.js、Canvas 或 PDF 字节，因此不会占用窗口或阻塞前端帧。机器和 PDF 内容会影响绝对值，长期关注的是页数增加时内存不线性增长、事件循环持续有 tick、Renderer 始终不参与。

依赖与随包许可证通过根目录
`THIRD_PARTY_NOTICES.txt`、生产 lock 和发布法律 evidence 统一管理，不在本 README 复制一份容易漂移的许可证清单。
