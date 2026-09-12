# Execution Audit EventStore Adapter

该 adapter 分页读取 Conversation EventStore，并只投影执行审计需要的安全事实：

- 从批次 `tool_call_decision.payload.tool_calls` 展开每个 canonical 工具身份；
- 从 durable `tool_output` 读取工具终态；
- 对成功 `write_file/edit_file` 用正式 Workspace 结果的 data schema 接纳结构化事实，
  只投影诊断严重度与未展示数；不扫描其他工具中碰巧同名的 `diagnostics` 字段；
- 从既有 `command.execution.terminal` 审计信封读取命令 exit 与稳定失败分类。

它不导出工具参数、observation、stdout/stderr 或原始错误正文，也不读取 UI read model。
文档诊断的 message、target、code、文件地址与 diff 都不进入此 port。code 尚无正式安全
标识符约束，不能因名称叫 code 就直接公开。成功 Workspace data 非法时明确失败，不能
静默当作零诊断；无诊断也不证明编译、渲染或质量通过。
`tool_process` 是 realtime-only 进度，持久化边界会拒绝它，因此这里不推断工具开始时间。
分页读取属于 adapter 职责；配对与聚合规则仍在
`application/execution-audit-export/functions/`，避免数据库适配层拥有业务判断。
