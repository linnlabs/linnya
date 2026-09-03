# Presentation Export UI

`presentationExport` 是 Slides Renderer 内“从文档菜单交付文件”的前端 feature，只负责菜单、独立弹窗、瞬时进度和 Host/Backend 端口编排，不生成 PPTX、PNG 或 ZIP。

## 产品合同

文档“更多”菜单当前按顺序提供两个选项：

1. **导出为 PPTX**：打开独立 PPTX 弹窗。唯一设置是“将图表转换为图片”，默认关闭；关闭时保留 PowerPoint 原生可编辑图表，开启时优先保持 Linnya 预览的图表视觉。
2. **导出为图片**：打开独立图片弹窗。唯一设置是分辨率，提供 1280、1920 和 3840 像素三档，默认 1920；结果是按页编号的 PNG ZIP。

栅格 PDF 不进入菜单。它把整页变成图片，文字不可选择、搜索或复制；只有独立的语义/矢量 PDF 方案通过 ROI 和验收后，PDF 产品入口才可能恢复。

图片导出必须显示真实页级进度。backend 每完成一页的渲染、PNG 解码、尺寸和 hash 复核，才递增一次 `已完成页数 / 总页数`；全部页面完成后进入保存阶段。进度只属于当前 `exportId` 和当前弹窗，不进入 Conversation、TaskState 或数据库。

## 编排与状态边界

```text
document menu
  -> presentationExport store 打开对应弹窗
  -> workflow 请求 Host 一次性保存 target
  -> slidesApi.exportPresentation(format + options + target)
  -> backend 生成 artifact
  -> Host 原子发布
```

- Vue 组件只负责展示和交互；默认值、格式映射和流程分支分别归 `functions/` 与 `orchestration/`。
- store 只持有弹窗、提交中、错误和当前图片进度等 feature 状态。
- 用户取消保存框时不调用 backend。
- renderer 不读取真实保存路径，也不接收完整 PPTX/ZIP bytes。
- PPTX 与图片消费同一次 current-version snapshot；unresolved draft 不得静默导出旧 compiled revision。
- 导出不修改 `deck.js`、DeckSpec、presentation revision 或数据库。

## 验收方式

两种格式必须分开验收：

- **PPTX**：用 Microsoft PowerPoint 打开，检查无修复提示；默认模式下图表仍可编辑；图表图片化模式检查透明背景与 Linnya 预览接近。
- **图片 ZIP**：解压后检查页数、页序、像素尺寸、透明/背景、最后一页和文件完整性。图片导出不需要 PowerPoint。

真实 30 页 4K 图片导出已经完成验收。对应全进程内存观测约 102 秒，进程组 working set 从约 1020 MB 上升到约 1550 MB，峰值增量约 529 MB，结束前已回收约 142 MB。该结果已被接受为当前串行 hidden-worker 实现的合理基线；页级进度继续保留，目前不为此建设并行 worker pool 或分块 writer。

## 测试

- 菜单 contribution：`contribution.test.ts`
- 默认值与选项：`functions/presentationExportOptions.ts`
- 保存授权、提交和取消：`orchestration/presentationExportWorkflow.test.ts`
- 弹窗与进度状态：`store/presentationExportStore.test.ts`
- backend 格式编排与真实 worker：[`../../../backend/features/presentationExport/README.md`](../../../backend/features/presentationExport/README.md)
