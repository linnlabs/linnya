# 后台画布出图

`createCanvasHiddenWorkerDefinition` 声明版本化请求、严格响应、取消和 opt-in offscreen 模式。`createCanvasRenderRuntime` 校验请求身份、快照提交序号、格式和物理尺寸，返回 PNG/JPEG 字节；会话文件发布由调用方负责，本 feature 不接触 Conversation 文件内部或 Canvas 数据库。

正式 worker 位于 `renderer/hidden-render-worker`，与交互 surface 共用 `markdown-document-core`、Pixi kernel 和 DOM 光栅器。正文不经过手画文字或第二套 HTML parser。图片以已准入的受管 data URL 随请求提供，缺失时明确失败；文档封面可缺省成身份牌，不递归展开。

单卡测高与最多 500 卡的 `measureBatch` 共用该 worker，但只做 DOM 排版，不启动 GPU。批量请求先安装唯一正文，再集中读取尺寸；同批相同正文复用，跨请求的精确正文/宽度/字体/主题/DPR/界面缩放缓存限制为 512 项和 8MiB。所有 worker 请求串行，待办最多 8 个，取消和失败均收口；批量新卡应调用 measureBatch，不能对几百张卡直接 Promise.all 冲穿队列。

后台窗口的默认 DPR 与主窗口可能不同。preload 只开放受限的目标像素比例调整，实际绘制仍使用请求指定的 physical scale。HTML-in-Canvas 已自动应用 backing/CSS 比例，不能再次 context.scale，否则正文会放大两遍。长卡与高 DPR 宽卡按可见框分成最长边 4096 物理像素的横纵切片，不分配全文纹理。

构建产物为 `dist/render-worker/worker.html`、其资源闭包与 `dist/backend/render-worker-preload.cjs`。从仓库根先构建 schemas，再运行：

```bash
node packages/plugins/canvas/dev/probes/run-worker-smoke.mjs
```

此 gate 真实经过 Host/IPC/preload/offscreen，验证单卡和 300 卡测量、PNG/JPEG、目标 DPR、宽卡切片、取消后继续请求与快照版本。输出仅在 `_dev_data/canvas-worker-smoke/`。跨 DPR 字形 hinting 可有差异，比例 smoke 不等于同 DPR 的像素一致性验收。

Pixi 使用官方 `pixi.js/unsafe-eval` 静态 uniform polyfill 运行于严格 CSP；不放宽 `script-src`。该名字表示兼容禁止 eval 的环境，并不是启用动态 eval。
