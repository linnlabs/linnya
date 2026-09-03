# Markdown Domain Tools

本目录只承载需要 Markdown 文档实例语义的专属 Agent 工具。它不是 Workspace 五件套的一部分，也不处理任意 `text/markdown` 内容的通用预览。

当前包含两个专属工具：

### `markdown_create_annotations`

- Review enricher 只注入当前审阅的文档与角色元信息；
- 工具读取正式 Markdown 文档版本并展开 canonical root blocks；
- annotations feature 以稳定 `[#ref]` 确定性解析目标 blockId，并在写入前再次校验目标块仍属于当前文档；
- 工具结果只报告逐项创建事实，不向 Workspace 工具层泄漏 Markdown repository。

### `write_to_table`

- 它是 `table_ai_fill` child run 的终局输出，不是 Sheet 或通用二维数据工具；
- 工具只产生经过共享 schema 接纳的 TableBlock 写入意图，并以 `terminateRun + finalAnswer` 结束当前 child；
- App Host 的 table-fill workflow 拥有 `subrun_id -> unit_id` 映射，Renderer 的 `TableFillWritePort` 负责 FIFO 写入当前 Markdown 富文档 TableBlock；
- 工具不能自行相信模型提供的 `row/col` 决定副作用目标，也不直接操作 Renderer 或数据库。

工具注册由 App Host 汇集 `markdownToolClasses`。`src/tools/workspace` 只注册 `list_files/read_file/grep/edit_file/write_file`，不得为了专属工作流重新膨胀。

普通 Markdown 格式内容只需要来源领域返回 `text/markdown`；它没有 `document_versions`、Block identity、pending revisions、annotations 或 TableBlock 编辑 session，因此不能调用本目录的工具能力。
