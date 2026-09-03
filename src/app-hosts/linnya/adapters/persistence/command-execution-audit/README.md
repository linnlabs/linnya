# Command Execution Audit Persistence Adapter

该 adapter 把 Audit domain 的 `CommandExecutionAuditEvent` 投影成 Linnkit `AuditEnvelope`，再交给宿主已经组合好的 `AuditPort`。

它不会直接访问 SQLite、不会新建表、不会重试或吞掉错误。实际生产组合使用 `EventStoreAuditPort` 时，命令审计会成为不可见的 `audit_envelope` RuntimeEvent，因此不会进入界面或 Agent 上下文。

正式 Electron composition 已将该 adapter 装入 Shell 与 Agent Process 调用链。用户命令卡片取消不伪造 Agent process action；它仍会由原 execution 的唯一 terminal 审计收口。外层 drainable port 只跟踪已经开始的后台写入，确保 App 关闭数据库前完成结算；它不串行化、不重试，也不保存第二份事件。卡片 settlement 的 `audit_status` 仅保存“审计不完整”展示事实，不冒充事件重试。Commands 与 Audit domain 都不反向依赖本目录。
