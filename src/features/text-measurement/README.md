# Text Measurement

完整 Linnya Backend 通过 platform runtime effect 装配 Browser Pretext client/cache 与 HarfBuzz；Desktop Host 通过窄端口提供隐藏浏览器 worker，Backend 不创建或读取 `BrowserWindow`。独立 backend 进程不能直接沿用模块默认的 heuristic：需要通过 plugin SDK 持有 `SystemTextMeasurementRuntime`，让系统字体目录就绪后再初始化 HarfBuzz cluster advance，并在进程结束时 dispose。standalone runtime 不启动另一套隐藏 Pretext 窗口；HarfBuzz 不可用时会保留 `heuristic` provenance，不能伪装成确定性测量。

文本测量是平台排版能力：给定文本、字体、字号和盒宽，返回行数、高度、最大行宽等结果。它不是 Slides 专属能力，因为 conversation 估高、Slides renderer 和主进程测量 worker 都会消费同一套规则。

无 Electron、无 DOM 的 DTO、单位换算、同步 service 与 deterministic heuristic 已归入 `packages/text-measurement-core`。本 feature 负责宿主环境装配与兼容入口；`infrastructure/system` 持有 headless Node/standalone CLI 可复用的 HarfBuzz runtime 和 CJS/ESM loader，不能放回 `electron-main`。可信 compute Worker 直接打包 portable core，不能反向加载 Plugin SDK 或复制一套字符宽度规则。

## 边界

- `definitions/`：平台通用测量 DTO，不依赖 PPT、conversation、Vue、Electron 窗口对象。
- `functions/`：单位换算、字体字符串构造等纯函数。
- `adapters/`：真实浏览器 Pretext adapter 与 heuristic fallback adapter。
- `infrastructure/browser-pretext/`：data-only 协议、Backend 测量 client/cache；不能 import Electron。
- `infrastructure/system/`：headless Node 可复用的系统字体与 HarfBuzz runtime。
- `orchestration/`：`TextMeasureService` 与默认 Backend runtime 装配。

## 归属纪律

- 这里不能 import `src/features/ai-ppt`、`@app/schemas/ai-ppt` 或 renderer domain。
- 依赖 Slides/PPT 类型的输入收集逻辑仍属于 Slides：generated DeckSpec、RenderModel 与 LintInfo 的 measurement input / prewarm 已迁到 `packages/plugins/slides/src/backend/engine/text/`。
- BrowserWindow worker 托管仍归 `src/electron-main/measurement` 和 `HiddenWorkerHost`，其 Electron adapter 位于 `src/electron-main/desktop-capabilities/text-measurement-worker`；Backend 只能接收批量测量端口。
- cache、prewarm、同步读取和 fallback 属于本 feature，不能迁入 Desktop adapter，否则 App Server cutover 会改变热路径与排版语义。
- 系统字体文件、HarfBuzz shaping 与格式桥属于本 feature 的 headless 基础设施。
