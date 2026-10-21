# Shell Tool

`shell` 是 Agent 调用本机 Shell 的薄工具入口。它只解析参数、调用 host 注入的 runtime 并把结果投影成稳定的 Agent 观察，不直接访问文件系统、启动 child 或解析平台对象。

## 参数

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `command` | 是 | 完整命令文本，禁止 NUL，最多 12,000 个 Unicode 字符；长资料使用现有物理文件路径，不把全文粘进命令 |
| `cwd` | 否 | Shell 的物理工作目录。省略时使用当前对话目录；相对路径会以该目录为基准解析，绝对路径按操作系统路径处理 |
| `interactive` | 否 | 是否为本次调用启用 PTY |
| `requires_write_access` | 否 | 只读档位下申请写入审批；不会自行扩大标准/完全访问的文件边界 |
| `initial_wait_ms` | 否 | 首次返回 running handle 前等待，整数 250–30,000 ms，不是总时长；长任务用 `process` 的 `action.type="wait"` 和 `action.wait_timeout_ms` 续等 |
| `hard_timeout_seconds` | 否 | 命令总运行期限 |

## 返回结果

工具始终返回 `StructuredToolResult` JSON：

- `data` 给程序和 Renderer 使用，包含 `status`、`processHandle`、`terminal`、输出引用和展示事实。
- `data.terminal` 的 `process_exit` 是命令真实退出事实；`completed` 只表示进程已完成终态，不能把它当成退出码为 0。
- `observation` 给模型使用：控制首行在外、命令正文进入动态不可信数据边界；不包含内部路径、PID、owner generation 或完整 raw artifact。
- `running` 结果必须带可供 `process` 使用的 opaque handle。
- `completed` 结果必须等待可信终态和输出结算后再返回。

## 参数拒绝

正式 `ShellToolArgumentsV1Schema` 在 `ShellTool.validateArguments` 接纳阶段执行，非法参数不会
发布 `tool_process(start)`，也不会进入目录准入、审批或进程启动。ToolRegistry 将其记为
`errorKind: protocol`、`errorCode: shell_protocol_violation`；命令启动后的失败仍属于原运行时合同。

错误提示按字段定位，给出通过同一 parser 的最小结构示例，并区分 Shell 首次等待与 Process
后续等待；不回显命令全文、cwd 或未知字段的值。未知字段仍严格拒绝，不删除、不猜测或改参重试。
`initial_wait_ms` 超过上限时不会自动截断，模型必须按提示修正后重新提交。

提示投影见 [shellProtocolViolationMessage](./functions/shellProtocolViolationMessage.ts)，不拥有第二份
字段或范围准入规则；通用字段拼写建议由 Linnkit 拥有，Shell 不实现近似匹配算法。

## 使用边界

- 文件工具优先，Shell 只补充文件工具无法表达的 CLI、脚本、进程和数据库操作。
- 每次调用创建新 Shell；`cd`、环境变量和 PTY 状态不会跨调用持久化。
- 网络和外部 CLI 按产品合同开放，Linnya 不负责它们的安装、版本或行为。
- 三档权限都不授予 GUI control；`full_access` 只取消命令审批。Shell 及其后代不得启动新的 GUI、普通 App 身份、Dock tile、控制台窗口或任务栏窗口。
- Shell 只理解操作系统文件系统路径。Agent 可以在 Shell 中执行 `pwd` 读取当前物理目录，也可以用 `cwd` 指定物理路径；内部默认目录不会因为工具结果而自动泄露。
- `/README.md` 这类以 `/` 开头的路径属于 Workspace 文件工具的虚拟路径，不应直接作为 Shell 的 `cwd` 或命令参数使用。
- Shell 创建的物理文件和 Workspace `write_file` / `edit_file` 写入的 VFS 文档当前没有自动同步。需要让 Shell 读取某份 Workspace 内容时，必须先有明确的物理文件来源；不能假定 VFS 文档已经落在 conversation cwd 中。

实现入口：[ShellTool.ts](./ShellTool.ts)。业务测试见同目录 `__tests__` 和 App Host 的 `shell-runtime` integration 测试。Workspace 虚拟路径与 Shell 物理目录的边界见 [Workspace 工具说明](../../workspace/README.md) 和 [Commands README](../../../domains/commands/README.md)。
