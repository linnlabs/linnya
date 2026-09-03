# Tool Output Store

ToolOutputStore 保存 Agent 可续读的纯文本结果。它不是原始命令 byte artifact，也不拥有 Shell、runner、进程或权限。

## 保存内容

- 只保存经过 decoder、控制序列处理和稳定逻辑行投影后的文本。
- stdout 和 stderr 分开保存，不能伪造跨流的绝对顺序。
- 超长结果使用 `tool_output://` durable reference，通过 canonical `tool_output_read(blob_id=...)` 调用正式 reader 续读。
- 新 blob 身份由执行层写入 `tool_output.metadata.observationTruncation.blobId`；不能注入具体工具的 owner `data`，否则会破坏各领域 strict schema。
- writer 中途失败时保留共同提交前缀，并把结果标记为 `incomplete`；不把部分结果冒充完整成功。

## 与命令运行时的边界

原始 byte 由 command output artifact port 保存，ToolOutputStore 只接收文本投影。两者共享 execution 和 conversation 归属，但不共享 schema、路径、清理实现或 Agent 工具。

ToolOutput 的可读所有权由 `conversation_id + ToolContext instance_id` 决定：根 Agent 使用
`default`，具备隔离实例的子流程使用其明确 `instanceId`。producer 必须从调用上下文传入该身份，
不能拿 `agent_run_id` 猜测；reader 不扫描其他实例目录兜底。

host 侧使用独立有界队列把系统 pipe 与可等待的文本 writer 隔开。慢磁盘、队列超限或 store 失败不能阻塞 pipe drain、改写命令终态或损坏 raw artifact。

## 维护规则

- 只通过公开 reader 读取 blob，不直接拼接磁盘路径。
- blob、manifest 和引用都必须经过 schema 解析。
- 不在每个工具里复制截断、落盘或 cursor 协议。
- `tool_output_read` 只信任 blob 身份、cursor 和计量；续读正文统一进入动态不可信数据边界。原工具的可信骨架不能从任意中间字符窗口伪造恢复。
- 维护任务按 manifest 身份清理，不按文件名或 mtime 猜测归属。

## Agent 入口迁移边界

ToolOutputStore 是独立领域，正式 reader、字符 cursor、manifest 和维护规则都应继续复用。`tool_output_read` 是唯一 live Agent facade；历史 `resource_read(tool_output://...)` 只在 replay/projector 边界解释，不复制存储、reader、分页或清理实现，也不把 ToolOutput 归入 `read_file`。

## 测试入口

同目录 integration 测试覆盖流式写入、manifest-last、前缀恢复、跨 block Unicode、失败降级和到期维护。命令输出完整性仍由 `src/app-hosts/linnya/adapters/commands/output/` 负责。
