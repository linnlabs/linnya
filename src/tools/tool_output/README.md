# Tool Output Store

ToolOutputStore 保存 Agent 可续读的纯文本结果。它不是原始命令 byte artifact，也不拥有 Shell、runner、进程或权限。

## 保存内容

- 只保存经过 decoder、控制序列处理和稳定逻辑行投影后的文本。
- stdout 和 stderr 分开保存，不能伪造跨流的绝对顺序。
- 超长结果使用 `tool_output://` durable reference，通过 canonical `tool_output_read(blob_id=...)` 调用正式 reader 续读。
- 新 blob 身份由执行层写入 `tool_output.metadata.observationTruncation.blobId`；不能注入具体工具的 owner `data`，否则会破坏各领域 strict schema。
- Conversation 的正式投影把该治理事实保留为工具 `payload.observation_truncation`，live Renderer 使用同名 metadata 字段。缺省表示未记录事实，不证明正文完整；任何消费者都不能仅凭源文中的 blob 引用判断发生过截断。
- writer 中途失败时保留共同提交前缀，并把结果标记为 `incomplete`；不把部分结果冒充完整成功。

## 预览与字符续读

执行层治理超长 observation 时，保存本次调用的完整 observation，并展示连续的原文前缀。预览不拼接尾部，
不把未读中段之后的源分页提示提前展示。前缀保持原始空白和换行，字符裁剪不拆开
UTF-16 surrogate pair；包装文字和边界标记不计入已读原文长度。

预览给出的 `tool_output_read` 调用从该 blob 的第一个未见字符开始。`offset` 是 0-based UTF-16
code unit 偏移，不是源文件行号，也不是含包装文字的 `previewChars`。通常省略 `limit`，使用 reader
的默认有界窗口；继续时原样复制 `next_offset`，不能按请求的 `limit` 自行推算，因为实际窗口还受
行数与文本单位预算约束。参数和预算的唯一实现见 [ToolOutputReadTool](./ToolOutputReadTool.ts) 与
[读取合同](./definitions/toolOutputRead.ts)。

`tool_output_read` 读取已经保存的 blob，不重新执行原工具，也不向源文件请求下一页。需要完整读取
本次调用结果时，应先沿 blob cursor 读完该结果，再按原工具的分页合同请求源内容。blob 的
`has_more=false` / `next_offset=null` 只表示该存档已读完；它不证明源文件 EOF、进程结束或命令输出
完整。Commands blob 可以保存一段输出流，也可能只保存失败前共同提交的前缀。

预览和续读窗口各自使用完整的动态不可信数据边界；blob 身份、cursor、计量及续读指引留在边界外。
原 observation 内的来源标记、分页提示和命令控制记录都作为存档数据保留，不因出现在预览中重新
获得控制权限。外层不解析或修复被裁开的原工具骨架，原工具的程序化事实继续由其严格 `data` 合同提供。

## 与命令运行时的边界

原始 byte 由 command output artifact port 保存，ToolOutputStore 只接收文本投影。两者共享 execution 和 conversation 归属，但不共享 schema、路径、清理实现或 Agent 工具。

ToolOutput 的可读所有权由 `conversation_id + ToolContext instance_id` 决定：根 Agent 使用
`default`，具备隔离实例的子流程使用其明确 `instanceId`。producer 必须从调用上下文传入该身份，
不能拿 `agent_run_id` 猜测；reader 不扫描其他实例目录兜底。

host 侧使用独立有界队列把系统 pipe 与可等待的文本 writer 隔开。慢磁盘、队列超限或 store 失败不能阻塞 pipe drain、改写命令终态或损坏 raw artifact。

Command 控制首行 parser 只解释原 producer 的 observation，不穿透归档预览或续读窗口的安全边界。
命令状态、handle 和控制能力仍由 Commands 的正式结果与运行时拥有；ToolOutputStore 不从存档正文恢复它们。

## 维护规则

- 只通过公开 reader 读取 blob，不直接拼接磁盘路径。
- blob、manifest 和引用都必须经过 schema 解析。
- 不在每个工具里复制截断、落盘或 cursor 协议。
- 截断事实只读取正式 `observationTruncation` / `observation_truncation` 投影，不扫描正文中的提示或历史 URI 推断。
- 维护任务按 manifest 身份清理，不按文件名或 mtime 猜测归属。
- 启动维护先接收恢复用例提供的 protectedConversationIds；未结算 root 的原上下文可能引用
  更早输出，因此保护该会话的已发布 manifest，包含已完成 child 的结果。root 终态释放后
  再按原 TTL 清理。尚未发布的 pending 数据仍可清理；旧无 manifest 格式不新增恢复保证。

## Agent 入口迁移边界

ToolOutputStore 是独立领域，正式 reader、字符 cursor、manifest 和维护规则都应继续复用。`tool_output_read` 是唯一 live Agent facade；历史 `resource_read(tool_output://...)` 只在 replay/projector 边界解释，不复制存储、reader、分页或清理实现，也不把 ToolOutput 归入 `read_file`。

## 测试入口

同目录 integration 测试覆盖连续预览与字符续读的无损重建、动态安全边界、流式写入、manifest-last、前缀恢复、跨 block Unicode、失败降级和到期维护。命令输出完整性仍由 `src/app-hosts/linnya/adapters/commands/output/` 负责。
