# Presentation Export

本 feature 统一编排 Slides 的 PPTX、逐页 PNG ZIP 和既有栅格 PDF backend 能力。当前产品菜单只开放 PPTX 与图片；栅格 PDF 因不含真实文字对象而仅保留为内部技术基线。该 feature 只消费 shared 的严格格式联合和 Host 窄端口，不读取保存路径、不返回 artifact bytes、不修改 deck.js、DeckSpec、revision 或当前 PPTX。

## 流程

```text
renderer 选择格式并取得 Host target token
  -> slides:export
  -> PresentationExportRuntime
       ├─ PPTX native：提交当前物化 PPTX
       ├─ PPTX chart image：透明单 Chart 栅格 -> 临时 DeckSpec -> engine assemble
       ├─ images：同源页面 PNG -> 页级 plugin push -> JSZip STORE
       └─ PDF：同源 1920px 页面 PNG -> Host Chromium PDF runtime
  -> Host 原子提交 artifact
```

图片与 PDF 必须通过 `presentationPageRasterization`，不能截取 DOM 或自己映射 RenderNode。PNG 已压缩，ZIP 使用 `STORE`，避免无意义重复压缩。PPTX 图表图片化默认关闭；开启后只替换 generated structured Chart，其他元素仍保持原生可编辑。

图片请求携带 renderer 生成的 `exportId`。backend 只用它关联本次瞬时进度，不把导出注册成后台任务，也不写数据库。进度从 `0 / 总页数` 开始，每页完成验证后递增；renderer 在导出 Promise 收口时解除该次订阅。现有 `TaskState` 属于 Agent 工作计划，`WorkerThreadQueue` 属于 Node Worker 调度，都不是此同步 Chromium 导出流程的 owner。

保存框、真实路径、覆盖确认、target 有效期和原子写入归 Host `exportArtifact`；PDF 的隐藏窗口与 Chromium 参数归 Host `pdfDocumentRuntime`。

## 测试

- 格式编排、ZIP/PDF 与图表替换：`orchestration/PresentationExportRuntime.test.ts`
- IPC parser 与无 bytes 响应：`../../ipc/slidesIpcHandlers.test.ts`
- Renderer 菜单、默认值和取消：`../../../renderer/features/presentationExport/**/*.test.ts`
- 真实透明 ECharts：`pnpm --dir packages/plugins/slides run smoke:raster-worker`
- 真实 Chromium PDF：`pnpm --dir packages/plugins/slides run smoke:pdf-export`

## 真实验收

- 代表性 PPTX 已在 Microsoft PowerPoint 中打开验证；PowerPoint 验收只针对 PPTX 的无修复提示、原生图表可编辑性和图表图片化透明背景，不适用于图片 ZIP。
- 30 页 4K 图片导出已完成真实运行与人工验收。约 102 秒观测窗口内，全进程 working set 峰值相对基线增加约 529 MB；该结果已接受为当前串行页面栅格链的合理基线。
- 图片 ZIP 的验收对象是页数、顺序、分辨率、背景/透明度与末页完整性。页级进度属于产品合同；当前不以并行 worker pool、分块 writer 或另一套 renderer 继续优化。
