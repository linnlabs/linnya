# TableBlock AI 功能说明

本文记录 Table AI 批量填充的现行生产结构、列引用全链路和扩展边界。历史上的
`tableAssistantStore`、producer/consumer adapter、shared AI event bus、逐行执行器和
`TableToolExecutor` 均已删除，不再是可用入口。

## 一、生产结构

- `domains/editor/blocks/TableBlock/`：表格选区、列坐标、输出列、Decoration 和列引用 atom。
- `domains/editor/features/table-ai-mode/`：`off / active / closing` 模式会话、列引用解析/颜色、active refs、高亮和退出编排。
- `domains/editor/features/table-fill-write/`：请求前行计划、稳定写入目标和 ProseMirror FIFO 写回。
- `app/workflows/table-fill/`：Conversation Input Extension、forced `subrun_batch`、live trace 和 session 收尾。
- Conversation domain：只提供通用输入扩展宿主、composer inline token port、消息与工具卡挂载点，不认识表格坐标或列语义。

## 二、列引用全链路

1. `useTableAiActions` 从当前 `CellSelection` 提取可引用列、选区范围和输出列，必要时先插入输出列。
2. `activateTableAiMode` 建立带 `sessionId` 和稳定表身份的单一会话。
3. app 层 table-fill Input Extension 将 `TableAiComposerContext` 和 `ColumnReferenceNode` 接入当前 Conversation composer。
4. 点击列标签时，`activateTableAiColumnReference` 校验列坐标并写入 active refs；composer port 在当前光标位置插入 `columnReference` atom。
5. 手输或粘贴 `{{A}}` 时，`ColumnReferenceNode` 的 input rule / paste plugin 产出同一种 atom。
6. `parseTableAiColumnReferences` 从 composer 文本维护 active refs；同 feature 高亮 runtime 校验 `sessionId`，按稳定表身份从最新文档重定位表格并更新 Decoration。
7. `ColumnReferenceNode.renderText` 把 atom 按原位置序列化为 `{{refKey}}`。提交同步阶段先快照 active refs，宿主随后才清空 composer。
8. table-fill workflow 为每一行替换模板中的引用，构造 prompt、row context 和预绑定的 `unit_id` 写入目标。
9. forced `subrun_batch` 启动 child runs；`write_to_table` live trace 通过 `TableFillWritePort` 进入 Editor FIFO。
10. 成功、失败和取消都由 workflow 收尾；退出模式统一清理 Decoration，并按业务结果决定是否撤销新增输出列。

列引用必须保留为 inline prompt token。它在句子里有位置和重复次数，例如“根据 `{{A}}`，参考 `{{B}}`”；外置 Reference chip 不参与 prompt 句法，不能替代它。

## 三、颜色与样式约定

- 列颜色由 `table-ai-mode/functions/tableAiColumnReferences.ts` 根据当前上下文的列顺序纯计算。
- 不保存模块级或跨会话颜色映射；相同上下文中的同一列颜色稳定，会话结束无需额外 reset。
- active ref 的同一个 `color` 同时交给 composer atom、输入框上方列标签和主表 Decoration。
- Decoration 只通过 `--table-ai-column-ref-color` 传入动态颜色；默认色、背景透明度和伪元素层叠归 `styles/table.css`。
- Table AI 列标签只通过 `--table-ai-ref-color` 传色，背景必须在标签自身用该变量计算，不能在父级提前计算派生色。

## 四、状态与调用边界

- 模式状态只存在于 Editor `table-ai-mode` store；store action 只同步写状态，不执行解析、高亮或异步流程。
- 解析、颜色和坐标规则放 functions；进入、退出、延迟 InputRule 和高亮放 orchestration。
- 高亮是同一 Editor feature 内的直接能力调用，不经过全局 event bus，也不复制一份 `isActive`。
- 所有延迟调用必须携带创建时的 `sessionId`；旧会话不能更新新会话的表格。
- app workflow 不持有 ProseMirror node、position 或 Editor 实例；Conversation 不导入 TableBlock 内部实现。

## 五、扩展与验证

修改列引用时，应同时验证：

- 点击、输入、粘贴、删除和纯文本序列化仍产生一致的 inline token 语义。
- 多列 active refs 得到不同且稳定的颜色，Decoration 分别携带对应 CSS 变量。
- 整体选区引用必须解析到源列合并范围，不能误用输出列矩形。
- 延迟 InputRule 不能命中新会话，退出后主表高亮被清理。
- row plan 仍按 token 原位置替换真实单元格内容，提交清空 composer 不会抢先清掉 active refs。
- 浏览器中至少选择两列，检查表格背景、列标签背景、边框、文字和输入框 atom 使用对应列色。

写回、取消和失败语义分别以 `app/workflows/table-fill/README.md` 与
`domains/editor/features/table-fill-write/README.md` 为准。
