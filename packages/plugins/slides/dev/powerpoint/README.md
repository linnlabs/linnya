# PowerPoint 实际排版对照工具

本目录只服务开发验收，不被 `src/`、插件 exports 或生产构建入口引用。所有正文与图表数值均由
`samples.ts` 固定生成，不读取数据库、用户文稿、deck.js、其他 worktree 或网络。

## 完整运行

从仓库根目录使用 Node.js 24 与锁定的 pnpm，在沙箱外、已登录的桌面会话运行：

```bash
pnpm --dir packages/plugins/slides run office:conformance -- all /tmp/linnya-office-review
```

输出目录必须不存在。macOS 需要 Microsoft PowerPoint 已安装、激活且没有阻塞对话框；首次运行可能需要在系统设置允许终端自动控制 PowerPoint。
Windows 使用相同命令，将输出目录替换为本机的新绝对路径，并确保 PowerPoint COM 与 PowerShell 可用。
不要为运行工具全局降低宏安全设置或 PowerShell 执行策略。

命令依次构建并启动本工具自己的独立 Electron，生成样稿与预览，再调用 PowerPoint，最后输出报告。
生成进程使用输出目录内的独立 Electron profile，不连接现有 Desktop。Office adapter 只关闭本次打开的合成文稿，
不调用 PowerPoint Quit，不保存源 PPTX，也不关闭其他文稿。Windows COM 创建的空应用实例可能保持打开，由运行者关闭。

## 分段运行

```bash
pnpm --dir packages/plugins/slides run office:conformance -- generate /tmp/linnya-office-review
pnpm --dir packages/plugins/slides run office:conformance -- export /tmp/linnya-office-review
pnpm --dir packages/plugins/slides run office:conformance -- compare /tmp/linnya-office-review
```

- `generate`：需要 Electron、系统字体与 HarfBuzz，无需 PowerPoint。复用正式 DeckAssembler、RenderModel finalizer 和 Slides raster worker；测量来源不是 HarfBuzz 时明确失败。
- `export`：无需 Electron，读取第一段的 manifest/PPTX。创建全新 `office/`，记录 Office 版本、方法、样稿哈希和失败日志。失败后保留目录，不自动重试；重跑前由开发者检查日志并移走本次 `office/`，避免覆盖证据。
- `compare`：只需要 Node、Sharp、manifest 和固定格式 PNG，无需 Electron/PowerPoint。缺页、尺寸不符、缺少成功回执或哈希不一致均写成 `incomplete`，不会自动缩放图片掩盖错误。

`all` 在 Office 导出失败后仍尝试生成不完整报告；若第一段失败，则尚无合法 manifest，立即停止。
退出码：0 表示图片结构未发现差异、仍待人工审核；2 表示存在差异；1 表示执行失败或材料不完整。

## 样稿和报告

六页覆盖：受限宽度的中英文文字边界、形状内 shrink-text、多列竖排、multiple/exactPt 行距，以及三个系列的
簇状柱图（gap 50 / overlap 0、gap 300 / overlap 50）。图表保留原生 chart，禁止将图片化预览充当 Office 对照。

主要输出：

- `sample.pptx`、`manifest.json`、`render-model.json`：合成样稿、预览断行/缩字与最终布局事实；
- `preview/slide-001.png` 与 `office/slide-001.png`：相同 960×540 画幅；
- `office/export.json`、`office/driver.log`、macOS 的 `office/office.pdf`：真实导出证据；
- `comparison/*.png`、`report.json`、`report.html`：差异图、结构指标、并排图片与人工核对说明。

直接打开 `report.html`，按「预览 / Office / 差异图」比较。不要把生成目录或本机字体缓存提交到仓库。

自动比较使用墨迹行/列投影，报告可见行数/列数、逐行起止、行距及外框之外的墨迹；用专用绘图区底色与三个系列纯色
测量绘图区、每根可见柱的宽度/位置、图例色块和文字边界。阈值固定为 960px 画幅下边缘 3px 与通道差 24，
仅用于容许抗锯齿，不自动对齐，不因失败调宽。

**指标不做 OCR。** 逐行长度是断行变化的图像证据，不能证明每个词都相同；字体替换、墨迹裁剪、同长度的错误断行、
图例标签内容与重叠柱的被遮挡部分仍需人工看图。`review` 明确表示待审核，不是自动通过。
形状过小导致两端都裁剪时，也不能仅凭图片相同认定不存在内容丢失，应结合 manifest 的预览断行与 render-model overflow。
该工具观察现有图表映射的差异，不修复 ECharts 映射或图表布局。

## 导出方式评估与实际验证边界

[Microsoft Slide.Export 文档](https://learn.microsoft.com/en-us/office/vba/api/powerpoint.slide.export)提供逐页文件名与像素尺寸。
Windows adapter 通过 COM 直接调用它，避免 SaveAs 的全稿目录命名规则。
本机 macOS PowerPoint 的 `PowerPoint.sdef` 只公开 `save`、`save as picture`（shape）与 `run VB macro`，
没有 Slide.Export；不假设 VBA 方法能直接作为 AppleScript 命令调用。注入 VBA 会增加宏安装与信任前提，因此未采用。

macOS 实测 AppleScript `open` 返回 -9074，访问容器外路径会等待授权框直到 -1712 超时，所以样稿和 PDF 经 PowerPoint 容器内临时目录中转，用 `open -a` 打开。
macOS adapter 对明确的 presentation 调用原生 PDF SaveAs，再用锁定的 PDF.js / Node CanvasFactory 逐页生成 PNG。
这是 PowerPoint 真实页面经 PDF 的路径，报告中与原生 PNG 明确区分；字体嵌入、PDF.js 栅格化和直接 PNG 可能产生差异。
此路径避开已观察到不稳定的 PNG SaveAs 过滤器，但**尚未证明其真实 Office 稳定性**。
开源 [pptx-exporter](https://github.com/Fikarn/pptx-exporter)采用选中对象并复制剪贴板的方式；它会改变选区、处理透明对象，
不适合作为整页排版对照基准，因此没有引入该实现或依赖。

当前沙箱内已验证：固定图片比较、报告文件流程、样稿真实 PPTX XML、PDF.js -> PNG 像素链、开发工具与插件严格类型和 ESLint。
完整命令的 worker 构建成功，但 Electron 以 SIGABRT 退出；没有产出真实预览/Office 对照图片。
`osacompile` 也出现 `com.apple.hiservices-xpcservice: Connection Invalid` 及 -2741，AppleScript 必须在沙箱外运行。
macOS PDF SaveAs 已在 PowerPoint 16.110.2 实跑；Windows COM adapter 仍须由真实安装环境验证，不能把模拟回执或固定图片测试记成 Office 验收通过。

## 测试

```bash
pnpm --dir packages/plugins/slides run test:office-conformance
pnpm --dir packages/plugins/slides run typecheck:office-conformance
pnpm exec eslint packages/plugins/slides/dev/powerpoint packages/plugins/slides/dev/vitest.office.config.ts packages/plugins/slides/scripts/run-office-conformance.mjs
```

固定图片是确定性的几何墨迹样本，不依赖本机字体和 OCR。测试覆盖额外换行、断行长度、行距、溢出、竖排列数、
绘图区/柱宽/图例漂移、空白页拒绝、缺页、旧导出与不完整报告。实际 PPTX 测试另检查六页与对应 OOXML。
