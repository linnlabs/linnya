# ChartBlock

`chartBlock` 是 Editor 里的图表原子节点。持久语义与 Markdown 一致：`linnya-chart` 围栏 + canonical JSON，唯一必填属性 `spec`（无默认值，写入前必须已通过 `@app/schemas` 准入）。
绘制与阅读交互在 [chart-reading](../../features/chart-reading/README.md)，源码编辑在 [chart-editing](../../features/chart-editing/README.md)；本目录只负责节点结构、HTML 往返、命令与菜单。

## 结构

| 文件 | 职责 |
| --- | --- |
| `ChartBlock.ts` | 可交互节点：命令、阅读会话（`editor.storage.chartBlock.sessionId`）、删除块时释放阅读状态、销毁时释放会话 |
| `ChartBlockReadonly.ts` | 只读节点（块历史视图）：同一 schema，只带只读 NodeView，无命令与会话 |
| `chartBlockSchema.ts` | 两个节点共用的属性、HTML 解析与渲染规则 |
| `functions/` | 纯规则：figure HTML 往返、转换/更新事务构造、被删除块 id 收集、Pending 展示模型 |
| `orchestration/useChartRevisionView.ts` | 只读取 Revision 的 canonical 会话与投影账本，整理成 NodeView 的显示模型 |
| `menu/` | 块菜单“编辑图表”与 Slash 菜单“图表”分组（八种类型） |
| `ui/` | `ChartBlockView.vue`（可交互）、`ChartReadonlyView.vue`（只读） |

## 命令

- `convertToChartBlock(spec, { openEditor?, sample? })`：把当前内容块转成图表；位于文档末尾时补一个空段落；表格内拒绝。
- `convertToSampleChart(type?)`：转成明确标注为示例数据的图表并打开源码面板（Slash 菜单与输入 ```` ```linnya-chart ```` 共用）。

NodeView 保存编辑时用 Tiptap 的 `updateAttributes({ spec })`：一次确认 = 一个事务 = 一步撤销。
正文图表工具栏暂不展示“编辑图表”按钮；既有块菜单与插入示例的源码面板入口仍保留。

## HTML 与剪贴板

`html.ts` 是纯 HTML 合同的公开入口，供剪贴板消费，不加载 Vue NodeView；Revision 读取使用其公开 `useRevisionStore` 门面。

- 节点 HTML：`<figure data-type="chart-block" data-chart-spec="canonical JSON">`，内部粘贴经与 Markdown 导入相同的准入还原；规格无效则拒绝整批解析，文档不变；粘贴入口先提示，由用户明确选择按普通代码插入或取消。
- 块复制（`ClipboardCopyExtension`）：`text/plain` / `text/markdown` 是 canonical 围栏；`text/html` 是 figure + 标题 + 说明 + 数据表，外部应用至少能拿到数据。
  图表复制菜单另提供“复制为图片”（默认视图 PNG）和“复制为 Markdown”（canonical 围栏）；图片不在同步 copy 事件里生成。
- 外部 HTML 中带 `language-linnya-chart` 的 `<pre><code>`：合法才成为图表；非法规格必须先经同一个人工决策，不能静默降级。代码块语言入口、HTML 解析和输入规则都不会产生保留语言的 `codeBlock`。

## Pending

有未决修订的图表块显示“待确认的图表 / 待确认：删除此图表”标记，update 可切换查看原内容；Pending 期间不提供编辑入口。规则见 [Revision README](../../features/Revision/README.md)。

## 查找与并发编辑

- FindReplace 通过 `renderText` 查找标题、说明、类目、对象标签和系列名，每张图表只产生一个整块定位结果；替换当前/全部都不改图表，修改通过图表编辑面板。
- 块历史视图只读显示图表版本；没有语义 diff 摘要。恢复使用主编辑器 schema，规格同样经严格校验。
- 工作区同时存在两个 `prosemirror-transform` 版本：`@tiptap/pm/state` 产生的步骤不是 `@tiptap/pm/transform` 导出类的实例，识别步骤必须按结构而不是 `instanceof`。

```bash
pnpm exec vitest run apps/renderer/domains/editor/blocks/ChartBlock
```
