# Markdown Domain Tools

本目录只承载需要 Markdown 文档实例语义的专属 Agent 工具。它不是 Workspace 五件套的一部分，也不处理任意 `text/markdown` 内容的通用预览。

当前包含两个专属工具：

### `markdown_create_annotations`

- Review enricher 只注入当前审阅的文档与角色元信息；
- 工具校验 Review fragment 对应的正式 Markdown 文档版本仍是最新版本，再展开 canonical root blocks；
- 工具只负责以稳定 `[#ref]` 确定性解析目标 blockId；实体创建、`confirmed` 初态与单版本提交统一委托给 annotations feature 的 `createMarkdownAnnotations()` 用例；
- 工具结果只报告逐项创建事实，不向 Workspace 工具层泄漏 Markdown repository。

同一个创建用例也由 Workspace `edit_file` / `write_file` 的 Markdown provider 调用：普通 `<!-- comment -->` 直接创建批注，正文差异才进入 pending revisions。工具名不同不代表存在第二套批注写入语义。

### `write_to_table`

- 它是 `table_ai_fill` child run 的终局输出，不是 Sheet 或通用二维数据工具；
- 工具只产生经过共享 schema 接纳的 TableBlock 写入意图，并以 `terminateRun + finalAnswer` 结束当前 child；
- App Host 的 table-fill workflow 拥有 `subrun_id -> unit_id` 映射，Renderer 的 `TableFillWritePort` 负责 FIFO 写入当前 Markdown 富文档 TableBlock；
- 工具不能自行相信模型提供的 `row/col` 决定副作用目标，也不直接操作 Renderer 或数据库。

工具注册由 App Host 汇集 `markdownToolClasses`。`src/tools/workspace` 只注册 `list_files/read_file/grep/edit_file/write_file`，不得为了专属工作流重新膨胀。

普通 Markdown 格式内容只需要来源领域返回 `text/markdown`；它没有 `document_versions`、Block identity、pending revisions、annotations 或 TableBlock 编辑 session，因此不能调用本目录的工具能力。
