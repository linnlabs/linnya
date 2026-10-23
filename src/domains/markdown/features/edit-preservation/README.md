# Markdown 编辑保真

本能力保留正文改写中仍可对齐的颜色、高亮。Markdown 不增加颜色语法，Agent 不选择颜色；用户在编辑器设置的呈现事实仍归用户所有。

`functions/preserveInlinePresentation.ts` 接收同一 rootBlock 的基线与新稿 ProseMirror 节点，返回恢复呈现的新稿。它只依赖 ProseMirror、现有文本 diff 库与 domain 内的顺序对齐函数，不读取存储或 UI 状态。Backend 通过 feature 入口调用，Renderer 只依赖浏览器安全公开入口 `@linnya/markdown-domain/editing`；不得从该入口导入数据库、Markdown 导入器或 Host。

## 保留规则

- 同类型块中的未改文字保留原有 `textColor` 与 `textHighlight` 属性，两者可同时存在。新增或替换的字素不继承相邻颜色，不按新文字的意义猜测重点。
- 粗体、斜体、链接等由新 Markdown 决定。仅改粗体时仍保留文字颜色；转为行内代码时遵守 code 的 mark 排斥规则。
- Unicode 按完整字素确认，包括组合音标、肤色与 ZWJ emoji。Revision 增删节点切开字素时，先按完整新稿判断，再恢复节点 marks。
- 行内公式、引用等原子节点只按稳定载荷对齐；重新生成的节点 ID 不导致样式丢失，内容变化也不能借相同占位字符继承样式。
- 表格先按出现顺序锚定未变单元格，再配对间隙内的修改。重复内容遵守与全文块规划相同的确定性顺序；不宣称能从全文重写推断移动身份。整块类型转换、新增块不迁移行内呈现。

文本保真使用原始相等范围，不使用为了美化修订展示而合并过的 diff。差异计算限定在配对的单个文本块，关闭基于时间的非确定性超时，使预览与接受使用同一结果。无呈现 mark 的块直接返回。

## 接入与验证

Backend 在 Pending 接受、完整 schema 校验和版本提交之前恢复呈现。Renderer 在登记投影账本之前调用同一函数；删除投影保留原节点，提议只修改 marks，不改变位置。这样部分接受、部分拒绝、刷新和保存基线均沿用现有文档会话事务，不新增持久化副本。

业务回归位于 document-write 的 `readableProjectionWrite.integration.test.ts` 与 Renderer document-session 的 `markdownDocumentSession.test.ts`，覆盖真实解析、全文写入、Pending、接受／拒绝、再次读写、表格插行、公式和 Unicode 边界。
