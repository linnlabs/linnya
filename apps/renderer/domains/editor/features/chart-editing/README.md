# chart-editing：图表源码编辑与示例

图表块 v1 的完整编辑入口：一个模态面板，左侧严格 JSON 源码与即时诊断，右侧实时预览；保存按钮只在规格合法时可用，一次确认 = 一个事务 = 一步撤销。
网格编辑、样式面板与表格 ⇄ 图表属于后续增强，不在这里预埋。

## 公开入口

[`index.ts`](./index.ts)：`ChartEditModal`（面板）、`useChartEditingStore`（“待打开”请求）、`buildSampleChartSpec` / `readChartSampleLabels`（八种示例规格）、
`confirmInvalidChartPaste`（粘贴含无效围栏时的人工决策）、`listChartIssues`（给人看的问题清单）。

## 约定

- **同一准入**：面板里的“有效”与写入文档时的准入是同一个函数（`admitMarkdownChartFenceBody`），所以保存不会写入文档会拒绝的内容。
  源码初始内容就是规格的 canonical 文本；空白与键序差异不算改动。
- **预览**：校验与诊断每次输入立即执行，预览只跟随最近一次有效规格并做短防抖，且不播放过渡；半成品 JSON 不会让图闪烁。
- **不静默丢字段**：切换 `chartType` 后重新校验，对该类型不适用的字段作为诊断报告，而不是悄悄丢弃。
- **有改动时不被误关**：存在未保存改动时，Esc 与点击遮罩不会关闭面板，只有“取消”会丢弃。
- **示例数据明确标注**：Slash 菜单或围栏输入插入的示例图表标题/说明都写明是示例，面板里再提示替换为实际数据。
- **粘贴含无效围栏**：文档保持不变，由用户选择“作为普通代码插入”（以 `json` 保存）或取消；绝不留下带保留语言的代码块，也不会部分落地。
- **待打开请求**：插入命令先落地节点，再请求其 NodeView 打开面板；请求按 Editor 会话与块身份定位。

## 分层

`definitions/` 示例文案 · `functions/` 示例规格、源码草稿解释、问题清单（纯规则） · `orchestration/` 草稿流程与粘贴决策 · `store/` 待打开请求 · `ui/ChartEditModal.vue`（预览复用 `chart-reading` 的 `ChartSurface`）。

```bash
pnpm exec vitest run apps/renderer/domains/editor/features/chart-editing
```

模态面板不阻止 Agent 或 Revision 更新文档。原规格变化或进入 Pending 时保留当前草稿但禁用保存（包括快捷键），避免覆盖较新的规格；用户可复制草稿后重新打开。
