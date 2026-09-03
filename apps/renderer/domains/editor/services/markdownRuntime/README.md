# Markdown Runtime

`apps/renderer/domains/editor/services/markdownRuntime/` 是 renderer 侧统一的 Markdown 语义运行时入口。

它的目标很明确：

- 让编辑器内所有“程序性消费 Markdown”的路径共享同一套语义来源
- 把 `Markdown -> BlockEvent -> inline projection / doc JSON / table rows` 这条链路收敛到一个目录
- 让 `Revision pending`、`autocomplete`、`paste`、`import`、`streaming` 尽量不再各自维护私有解释器

当前这条链路已经完成了“当前范围内”的统一收口：

- Markdown 语义源已统一到 WASM `BlockEvent`
- inline projection / table cell materialization 已统一
- pending 执行层已统一到 shared planner / execution plan
- **唯一保留的显式特例**：`table block` 的 replace/history 仍然是 schema 级执行语义特例

因此本文档描述的是**当前已落地现状**，不是未来方案草案，也不把“零特例”当成现状。

当前 Markdown 架构以这份 README、`features/Revision/README.md` 和后端 `src/domains/markdown/README.md` 为唯一现状说明。

## 设计原则

- 唯一语义源：Markdown 语义以 WASM parser 的 `BlockEvent` 为准
- 单向分层：`parser -> projection/materializer -> 调用方`，上层不反向依赖调用方细节
- 低耦合：runtime 不直接依赖 `Revision`、`Autocomplete`、`Paste` 的业务状态，只输出通用结果
- 可扩展：新增 Markdown 语义时，优先扩展 runtime，而不是在调用方写分支
- 无隐式初始化：纯转换能力不应强制触发 WASM 初始化副作用

## 目录结构

```text
apps/renderer/domains/editor/services/markdownRuntime/
├─ parser.ts             # Markdown -> BlockEvent[]，惰性加载 renderer 侧 WASM 服务
├─ inlineProjection.ts   # BlockEvent/structured_content -> inline projection / TextSpan
├─ materializer.ts       # BlockEvent -> doc JSON / rootBlock / table row materialization
├─ types.ts              # runtime 共享类型
├─ index.ts              # facade 导出入口
└─ *.spec.ts             # runtime 单元测试
```

## 三层结构

### 1. Parser 层

文件：[parser.ts](./parser.ts)

职责：

- 接收标准 Markdown 字符串
- 惰性调用 `shared/services/markdownService`
- 返回统一的 `BlockEventLike[]`

约束：

- 这里不做 editor schema 逻辑
- 这里不做 pending / diff / revision 逻辑
- 这里不缓存业务态，只负责解析

注意：

- `parseMarkdownToBlockEvents()` 使用动态 `import()`，目的是避免“只想使用 materializer / projection，却意外触发 WASM 初始化”
- 如果未来新增运行环境，优先替换 parser adapter，不要把环境分支散落到 projection/materializer

### 2. Inline Projection 层

文件：[inlineProjection.ts](./inlineProjection.ts)

职责：

- 把 `structured_content` 解释成结构化 inline fragments
- 产出统一的 `MarkdownInlineProjection`
- 为 `Revision` / `RichDiff` 提供可消费的 `TextSpan[]`
- 保留 `inlineLatex`、`hardBreak` 等 non-text inline 语义

当前协议：

- `text`
- `hardBreak`
- `inlineLatex`
- span marks 当前只向下游投影 `bold / italic / strike / code`
- `link` 等 richer mark 目前在 projection fragments 层保留，在 `TextSpan` 层不会全部透传到 RichDiff

这层的意义：

- 它把“Markdown 的 inline 语义”和“Revision/RichDiff 的消费协议”隔开了
- 调用方如果只关心 inline 结构，不需要关心完整 doc materialization

### 3. Materializer 层

文件：[materializer.ts](./materializer.ts)

职责：

- 把 `BlockEvent[]` 落成 editor schema 可消费的 doc JSON / rootBlock
- 统一 table 的 row/cell materialization
- 让 table 与普通块共享同一条 “structured_content -> projection -> node” 解释链

核心能力：

- `blockEventsToDocJson()`
- `blockEventToRootBlockNode()`
- `buildTableRowsFromInlineProjectionGrid()`
- `buildTableRowsFromTableModel()`

关键现状：

- table cell 不再由 pending 私自拼装 `tableRow/tableCell/tableCellContentBlock`
- pending table、普通导入、其他程序性 materialization 复用同一套 row/cell builder
- 完整 doc/rootBlock materialization 会把 fragments 中的 `link` 物化为正式 `link` mark，并保留 `href/title`；生产 Editor 通过 `marks/Link.ts` 消费同一合同
- table 仍然保留 block 级 replace/history 语义特例，但这已经是执行层问题，不再是 materialization 分叉

## 统一调用链

### A. 普通块 pending / autocomplete / 程序性插入

```text
Markdown
-> parseMarkdownToBlockEvents()
-> blockEventToInlineProjection() / blockEventsToInlineProjection()
-> RichDiff / pending executor
-> editor nodes
```

### B. 文档导入 / 流式块渲染 / 结构化落块

```text
Markdown
-> parseMarkdownToBlockEvents()
-> blockEventsToDocJson()
-> ProseMirror doc JSON / rootBlock
```

### C. 表格

```text
Markdown / TableBlock.attrs
-> structured_content
-> inline projection
-> buildTableRowsFromInlineProjectionGrid()
-> tableRow/tableCell/tableCellContentBlock
```

## 与其他模块的关系

### Revision

相关文件：

- [Revision README](../../features/Revision/README.md)
- [pendingMarkdownRuntime.ts](../../features/Revision/utils/pending/pendingMarkdownRuntime.ts)

现状：

- `Revision pending` 不再维护私有 Markdown 解释器
- pending 通过 runtime 消费 canonical block / inline projection / table materialization
- `inlineLatex`、`hardBreak`、table cell materialization 已在这条链路统一

边界：

- `Revision` 负责 diff、accept/reject、history、batch planner
- `markdownRuntime` 不负责 pending 的事务编排或 revision 业务状态

### markdownConversion

相关文件：

- [markdownConversion/index.ts](../markdownConversion/index.ts)

现状：

- `markdownConversion` 仍是更高层的导入/导出 facade
- `markdownRuntime` 是它的低层语义支撑之一
- 新增 Markdown 语义时，应先考虑 runtime 能否表达，再决定是否更新 conversion facade

### Input Rules

现状：

- input rules 仍然存在
- 但它们只负责“用户键入时的即时体验”
- 它们不是 Markdown 语义唯一事实源

规则：

- 不要再把 input rules 当成程序性插入的事实解释器
- 如果某种 Markdown 只在 input rules 生效，而 runtime 不支持，那不算当前架构上的“统一支持”

## 前端如何工作

可以把 renderer 侧 Markdown 处理理解为两类：

### 1. 解释 Markdown 语义

这部分已经收口到 runtime：

- `Markdown -> BlockEvent`
- `structured_content -> inline projection`
- `BlockEvent -> doc JSON`
- `table model -> row/cell nodes`

### 2. 执行业务动作

这部分仍由各 feature 自己负责：

- pending apply
- RichDiff
- accept/reject
- streaming 增量策略
- paste 的 editor command 编排

这两类职责现在是分开的。前者由 runtime 统一，后者按 feature 保留。

## 当前状态边界

当前 renderer 侧应这样理解：

- **已统一**
  - `Markdown -> BlockEvent`
  - `structured_content -> inline projection`
  - table cell row/materialization
  - pending 普通块 / autocomplete / paste / streaming 的主语义来源
- **未承诺完全无特例**
  - `table block` 的 replace/history 仍是 schema 级特例
  - `TextSpan` / `RichDiff` 仍是 Revision 消费协议，不是完整 Markdown AST
- **明确不是问题**
  - input rules 继续存在，不影响 runtime 已经成为程序性路径的语义事实源

## 扩展指南

### 新增一种 inline 语义

例如未来要支持新的 inline atom / richer mark：

1. 先扩 `types.ts`
2. 再扩 `inlineProjection.ts` 的 fragment 解释
3. 若需要可被 editor 落节点，再扩 `materializer.ts`
4. 若需要进入 `Revision/RichDiff`，再扩对应协议层

不要直接在 `Revision` 或 `Autocomplete` 里私下解析 Markdown。

### 新增一种 block 语义

1. 确认 WASM `BlockEvent` 是否已有稳定表达
2. 在 `materializer.ts` 增加 block-level materialization
3. 若该块需要 pending 特殊执行语义，再在 pending execution plan 层扩展

不要先在 pending 里加专用 block parser，再回来补 runtime。

### 新增 table cell 语义

优先扩 shared projection/materializer：

- `structured_contentToInlineProjection()`
- `buildTableRowsFromInlineProjectionGrid()`

不要重新手工拼 table cell JSON。

## 注意事项

- `markdownRuntime` 的“统一”指语义源统一，不等于所有 feature 共享同一个事务执行器
- `TextSpan` 不是完整 Markdown inline AST，它是 Revision/RichDiff 的消费协议
- `link` 已能在完整文档 materialization、生产 Editor 装载和 Markdown 导出中保留 `href/title`；但它尚未完整进入 `TextSpan/RichDiff` 的逐块行内 diff，扩展这条路径仍需升级 Revision 协议层
- `table block` 的 replace/history 仍然是 schema 级特例；这正是当前口径下唯一保留的显式执行层特例
- parser 层必须保持惰性加载，避免纯转换能力被 WASM 初始化副作用污染

## 何时更新本文档

出现以下变化时，必须更新本文档：

- 新增或删除 runtime facade
- 新增 Markdown inline/block 语义
- table materialization 路径发生结构性变化
- runtime 与 `Revision` / `markdownConversion` 的边界发生变化

## 相关文档

- [Editor README](../../README.md)
- [Revision README](../../features/Revision/README.md)
- [Markdown domain README](../../../../../../src/domains/markdown/README.md)
