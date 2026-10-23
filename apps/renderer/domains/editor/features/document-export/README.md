# Markdown 文档导出

本 feature 拥有平台 Markdown 的打印内容投影；Workspace 的 import-export 只负责纸张、边距、保存框与交付，不能解释图表规格或依赖图表内部运行时。

领域公开入口 `domains/editor/document-export.ts` 中的 `prepareMarkdownHtmlForPdf` 接收同步固定的 Tiptap HTML 快照，在独立文档中把所有图表 figure 转成自包含 SVG 图片，再返回 HTML。它通过 ChartBlock 的正式 HTML 准入读取规格，通过 chart-reading 的 `renderChartPrintImage` 绘制，不读取或修改当前 NodeView、文档或阅读会话。未挂载和虚拟化离屏的图表也完整参与导出。调用方不能改用 Editor 总入口，以免带入完整 UI 和会话运行时的初始化副作用。

图片包含标题、说明、默认完整数据、图例与量尺脚注，不复制工具栏、tooltip 或阅读筛选。打印采用浅色主题，保留规格选择的色系与显式颜色；SVG 图片在 Chromium PDF 中保持矢量清晰度，不需要在禁止 JavaScript 的打印窗口重新运行 ECharts。图表按序逐张绘制并释放实例，生成失败或规格不合法时中止整次导出并由 Workspace 报错，禁止静默丢图。

分页与纸张宽度仍由 Workspace 的打印 CSS 拥有：图片保持宽高比缩放，图表 figure 避免内部断页。超出单页高度的任意长内容不在此处裁剪或丢弃。

验证入口：`orchestration/prepareMarkdownHtmlForPdf.test.ts`，使用正式 ChartBlock HTML 序列化与真实 ECharts SSR，覆盖八类图表、文本与图例完整性、非法规格和渲染失败。最终 PDF 的清晰度与分页需要真实 Electron 导出后逐页视觉检查。
