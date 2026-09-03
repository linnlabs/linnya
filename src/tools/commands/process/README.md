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

公开给模型的 `action` 是七个封闭对象组成的判别联合，而不是所有字段摊平后的宽对象。每个分支只允许表格中的字段；正式 Zod parser 与公开 JSON Schema 使用同一组 required 和数值边界。未知字段不会被自动删除，也不会触发隐式改参重试。

非 PTY 命令不能使用 `write`、`submit`、`eof` 或 `resize`。运行中观察使用非消费式 cursor，多个调用方不会互相吞掉输出。

## 错误边界

handle 不属于当前 conversation、run 已结束、对话正在删除或平台资源已经失效时，返回稳定拒绝结果。工具层不把内部异常、PID 或 native 错误对象暴露给模型。

实现入口：[ProcessTool.ts](./ProcessTool.ts)。生命周期测试位于 Commands process-control、App Host process-owner 和平台 runtime 的 integration 测试。
