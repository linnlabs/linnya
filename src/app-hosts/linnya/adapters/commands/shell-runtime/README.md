# Shell Runtime

## 1. 生产用例边界

`shell-runtime` 是模型调用 `shell` 和 `process` 两个工具时的 App Host 编排层。它把输入 schema、工作目录准入、权限 authority、授权规则、审批 host、process owner、输出 adapter、审计和 runner runtime 连接起来。

它不把这些能力重新实现一遍：授权规则仍在 Commands domain，进程仍在公共 runtime，Renderer 只接收 projection。

## 2. 入口和输入

| 入口 | 作用 |
| --- | --- |
| `createShellToolRuntime` | 生产 Shell/Process runtime 的组合根 |
| `executeShell` | 校验 proposal、授权并启动一次新的命令 |
| `executeProcess` | 使用 handle 查询、等待、取消或操作 PTY |
| `createShellCommandRuntimeBackend` | 为 pipe/PTY 创建统一 backend |
| `withShellWorkingDirectoryAdmission` | 解析并冻结 cwd 与当前 conversation 根的关系 |

Shell 参数来自 `ShellToolArgumentsV1`：`command` 最多 12,000 个字符且不能含 NUL；`cwd`
省略时使用 conversation 根，相对路径以该根为基准，绝对路径按物理文件系统解析；`interactive`
决定是否显式使用 PTY；`requires_write_access` 表示模型声明需要写权限；`initial_wait_ms` 范围
250-30,000，默认 10,000；`hard_timeout_seconds` 范围 1-600，默认 180。

`toolOutputInstanceId` 不是 Agent 参数，而是 `ShellTool` 从当前 `ToolContext` 派生的会话实例身份。
runtime 必须把它原样传给文本 writer，使 Shell 产出的 `blob_id` 与同一上下文中的
`tool_output_read` 使用同一个 store root；短生命周期 `agentRunId` 只拥有命令 execution，不能代替它。

## 3. 固定顺序

```text
parse input
  → resolve conversation cwd
  → capture run permission snapshot
  → evaluate authorization
  → approval (if needed)
  → persist conversation approval (if selected)
  → reserve owner
  → prepare runtime
  → claimAndStart
  → observe output / terminal facts
  → settle sinks and durable facts
  → return Agent projection
```

审批和目录准入必须先于 spawn；prepared runtime 不得提前创建平台进程。`claimAndStart` 之后，如果 runner 已经启动，所有错误都必须保留“已启动”事实并进入停止/结算流程。

## 4. cwd 和会话语义

默认 cwd 是当前 conversation 的共享根目录。同一对话的所有 Agent 共享这个真实目录；一次 Shell 调用里的 `cd` 只影响该次进程，下一次调用仍从默认启动目录开始。工具不会伪造持久 shell session，也不会把一个 Agent 的当前目录泄漏给另一个对话。

cwd admission 只冻结进程从哪里启动，不授予该目录写权限。`requires_write_access` 也只参与授权，
不能自行把 run 提升为 `standard` 或 `full_access`。当前 macOS 标准档唯一可写根是 conversation
目录，因此新生成的临时文件默认优先省略 cwd 并使用相对路径；用户指定其他位置且当前权限允许时，
仍可使用对应绝对路径。外部绝对 cwd 本身不能被理解为写入授权。

只有 `conversation-files` domain 能决定目录是否安全、是否已初始化和是否处于 cleanup gate。shell runtime 不能自行 `mkdir` 或拼接 appData 路径。

## 5. pipe 和 PTY

- 默认 `interactive = false`，使用普通 pipe，适合 git、Python、ffmpeg、npm 等非交互 CLI。
- 只有明确 `interactive = true` 才建立 PTY；PTY 输入、resize 和屏幕投影都走 process control。
- 两条路径共享 execution identity、权限和 owner，但不共享输出解析器。pipe 保留双流，PTY 保留终端屏幕状态。

## 6. 结果投影

Agent 得到稳定的文本 observation、状态和受控 artifact 引用；Renderer 得到命令摘要、运行状态、时间、复制内容和必要的 PTY 屏幕。raw byte、PID、环境、内部路径和完整审计 envelope 不直接进入模型。生产文本预算还必须给通用 ToolNode observation 治理留出控制行与续读说明空间，避免同一份 Shell 全文再次落成第二个 blob。

公开拒绝要区分输入无效、权限不可用、审批拒绝、cwd 不安全、进程启动失败和运行时丢失。不要把所有失败归成“命令失败”，否则用户无法知道该修设置、重试命令还是检查平台环境。

## 7. 资源和退出

Shell runtime 不负责“发一个 kill 就返回”。它必须等待 owner 的 terminal、输出 drain、进程树清理和 resource release，才将完成状态写入 durable settlement。App 关闭或 conversation cleanup 时，通过 owner 的窄 port 收口，不直接操作 child。

## 8. 测试门禁

主测试必须使用真实 permission authority、conversation admission、owner、output sink 和 production scope。至少覆盖：审批前零 spawn、启动后 cancel、超时、cwd 缺失、磁盘写失败、慢输出、PTY resize、App end、对话删除和跨对话 handle。UI 测试只验证 projection 与 IPC，不复制 runtime 规则。
