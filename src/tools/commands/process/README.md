# Process Tool

`process` 是 `shell` 的后续控制入口。它通过 opaque process handle 查询和控制仍在运行或短暂保留的命令，不接受 PID、路径或任意 child 标识。

## 动作字段

| 动作 | 额外字段 | 说明 |
| --- | --- | --- |
| `poll` | `cursor` | 立即读取运行中输出窗口 |
| `wait` | `cursor`, `wait_timeout_ms` | 等待新输出或终态 |
| `cancel` | 无 | 停止整棵进程树 |
| `write` | `input` | 写入 PTY |
| `submit` | `input` | 写入 PTY 并发送 Enter |
| `eof` | 无 | 关闭 PTY 输入 |
| `resize` | `columns`, `rows` | 调整 PTY 尺寸 |

顶层只接收 `process_handle` 与 `action`；动作名位于 `action.type`，表格中的额外字段也
位于 `action` 内。公开给模型的 `action` 是七个封闭对象组成的判别联合，而不是字符串或
所有字段摊平后的宽对象。每个分支只允许表格中的字段；正式 Zod parser 与公开 JSON
Schema 使用同一组 required 和数值边界。未知字段不会被自动删除，也不会触发隐式改参重试。

非 PTY 命令不能使用 `write`、`submit`、`eof` 或 `resize`。运行中观察使用非消费式 cursor，多个调用方不会互相吞掉输出。

## 错误边界

handle 不属于当前 conversation、run 已结束、对话正在删除或平台资源已经失效时，返回稳定拒绝结果。工具层不把内部异常、PID 或 native 错误对象暴露给模型。

模型把 `action` 写成字符串，或 `wait` / `poll` 缺少必需字段时，统一返回
`process_protocol_violation`。错误定位直接来自正式 parser，精确指出 `action.cursor`、
`action.wait_timeout_ms` 或多余字段；不会把一个数值越界问题误报为缺少全部字段。
提示中的最小示例通过同一 schema 校验，明确动作对象层级；示例只说明结构，不会自动执行。
模型仍必须从同一进程最新结果复制 `process_handle` / `next_cursor`，不能照抄示例 cursor
或猜测 handle。此提示投影由 [processProtocolViolationMessage](./functions/processProtocolViolationMessage.ts)
负责，不拥有第二份准入规则。

这类错误在 `ProcessTool.validateArguments` 的 owner admission 阶段被拒绝，因而不会发布
`tool_process(start)`。ToolRegistry 同时将它归类为 `errorKind: protocol`、
`errorCode: process_protocol_violation`；进程已经启动后的 `unknown_handle`、`stdin_closed`
等仍按 process runtime 拒绝结果处理，不能混入协议错误统计。

实现入口：[ProcessTool.ts](./ProcessTool.ts)。生命周期测试位于 Commands process-control、App Host process-owner 和平台 runtime 的 integration 测试。
