# Shell Execution Feature

## 1. 作用

该 feature 把 Agent 的 `shell` 参数变成不可变的 Shell command proposal 和 launch 输入。它是 Agent 输入的第一道业务边界，不是平台 spawn adapter，也不是权限规则库。

插件不扩展本 feature 的 schema。Agent 按 Skill 使用普通 Shell 文本调用 `linnya-<plugin>`；Host 在冻结的
environment PATH 前加入受管 launcher 目录，并通过 execution-scoped bridge 将薄 client 绑定到父 Shell。
本 feature 仍只理解 command/cwd/PTY/写权限等通用字段，不解析 plugin ID 或插件 argv。

实现入口：

- `definitions/shellCommandInput.ts`：输入类型；
- `definitions/authorizedShellExecution.ts`：授权后的执行输入；
- `definitions/shellWorkingDirectory.ts`：cwd admission 合同；
- `functions/validateShellCommandInput.ts`：命令文本校验；
- `functions/planShellWorkingDirectoryCandidate.ts`：cwd 候选规划；
- `functions/resolveShellInitialWait.ts`：初始等待值；
- `functions/resolveShellHardTimeout.ts`：总运行期限；
- `functions/resolveShellLaunchRequest.ts`：授权后 launch snapshot；
- `orchestration/resolveShellWorkingDirectory.ts`：调用 conversation-files port。

## 2. 输入字段和限制

| 字段 | 类型 | 限制 | 设计原因 |
| --- | --- | --- | --- |
| `command` | string | 非空、无 NUL、最多 12,000 code point | 防止 argv/日志/规则扫描被无限文本拖垮 |
| `cwd` | string? | 通常传物理路径；省略时使用对话根。相对路径会以对话根为基准解析，最终仍交给 admission port 做 realpath/marker 校验 | 让工作目录解析在授权和启动前冻结，避免不同入口产生不同结果 |
| `interactive` | boolean? | 默认 false | 普通 pipe 不需要 PTY 的 native 和输入复杂度 |
| `requires_write_access` | boolean? | 只能影响授权请求 | Agent 不能直接把权限改成 standard/full_access |
| `initial_wait_ms` | integer? | 250..30,000，默认 10,000 | 区分“先返回 handle”和“命令超时” |
| `hard_timeout_seconds` | integer? | 1..600，默认 180 | 防止单命令无限运行；不影响初始等待 |

schema 入口是 `packages/schemas/src/commands/shellTool.ts`；工具层用 `parseShellToolArguments()` 解析后再进入本 feature。unknown field 直接拒绝，不使用宽松对象。

## 3. 输入处理顺序

```text
ToolContext + raw arguments
  → parseShellToolArguments
  → validate command text
  → resolve initial wait / hard timeout
  → plan cwd candidate
  → conversation work-directory admission
  → create ShellCommandProposalV1
  → command authorization
  → resolve authorized launch request
```

顺序不能调换：

- 先授权再解析 cwd，会让用户批准的命令最终在另一目录运行；
- 先 spawn 再审批，会让拒绝失去意义；
- 在 runner 内重新解析 timeout，会让 Agent 看到的限制和实际限制不一致；
- 把 `cwd` 缺失回退到 `process.cwd()`，会让开发目录或 App 目录意外成为用户文件边界。

## 4. 工作目录语义

- 省略 `cwd`：使用当前 conversation 的工作目录根。
- 指定绝对 `cwd`：按物理文件系统路径解析，经过 conversation-files 的 admission port；不能只用字符串前缀判断是否在根目录。
- 指定相对 `cwd`：以当前 conversation 根目录为基准解析，再进入同一 admission 流程；Windows 盘符相对路径和单反斜杠路径会被拒绝，因为它们依赖宿主当前盘状态。
- 命令内部的 `cd`：只影响本次 Shell 及其子进程。
- 下一次 `shell`：重新使用对话默认根目录，除非 Agent 再次指定 `cwd`。

工作目录身份由 conversation-files 计算，Shell feature 不导入 `pathManager` 或本地目录 adapter。这样删除 cleanup job 可以在命令入口外部建立屏障，避免某条命令悄悄创建新目录绕过删除。

这里的路径是操作系统物理路径，不是 Workspace 文件工具使用的 `/` 开头的虚拟路径。Shell 可以通过 `pwd` 获取当前物理目录；`write_file("/x.md")` 和 Shell 的 `touch x.md` 属于两套存储，当前没有自动互相同步。

`withinConversationRoot` 是 admission 结果中的事实字段，用于观察和后续策略判断，不代表当前实现已经把所有显式绝对路径强制限制在 conversation root 内。不要在产品文案中把它写成完整文件沙箱。

## 5. Pipe 和 PTY

| 模式 | stdin | 输出 | 可用 process 动作 |
| --- | --- | --- | --- |
| `pipe` | 启动时关闭 | stdout/stderr 分开 | poll、wait、cancel |
| `pty` | 由 PTY 输入通道管理 | terminal 单流和 screen | poll、wait、cancel、write、submit、eof、resize |

普通命令默认 pipe。不要因为命令可能输出颜色就自动启用 PTY；是否需要终端语义由 Agent 明确设置 `interactive=true`。

## 6. 时间语义

### initial wait

initial wait 是 `shell` 调用等待首个结果的时间。到期时只返回 `running + process_handle`，不停止命令，不改变 hard timeout，不产生 timeout terminal。

### process wait

`process.wait` 是观察动作自己的等待期限。它到期只能返回 running 和当前 cursor，不得触发命令 hard timeout。

### hard timeout

hard timeout 从实际执行启动开始计算，覆盖命令、输出 drain、停止和最终资源收口需要的阶段。它产生 `timed_out` 终因，但仍需等待 tree empty/release 才能完成最终 settlement。

## 7. 命令文本和平台 payload

命令文本在 proposal 阶段冻结，规则、审批、审计和 launch 都引用同一份值。平台 adapter 可以追加固定 wrapper、helper 参数、Shell flags 和内部 marker，但这些内部参数不能反向改写 proposal。

启动前还要检查最终 executable、argv 和 environment 的平台长度预算：

- Agent 文本超过 12,000 code point：输入拒绝，不创建 execution；
- Windows 最终 UTF-16 命令行超限：`launch_payload_too_large`，不伪造 process exit；
- macOS spawn 返回 E2BIG/ENAMETOOLONG：归类为 launch payload 失败；
- 不自动切换 stdin、临时脚本或 encoded command，因为那会改变 Shell 语义和文件清理合同。

## 8. 与授权 feature 的连接

Shell feature 只生成 proposal，不决定是否需要审批。授权 feature 消费：

- 原始 command；
- cwd；
- 当前不可变权限快照；
- 平台和 Shell semantics；
- `requires_write_access`；
- 当前对话的批准记忆。

授权成功后，Shell feature 才创建 `AuthorizedShellExecution`，并交给 App Host 生成 launch snapshot。Shell 不读取设置文件，也不直接访问 approval host。

## 9. 公开结果

工具结果由 `ShellTool.ts` 做 allowlist projection：

- `running`：状态、observation、opaque process handle、cursor、display/presentation；
- `completed`：状态、observation、terminal、ToolOutputStore 引用、display/presentation；
- `rejected`：稳定 code 和 observation。

不得让 host 结果对象展开进入 Agent。特别禁止穿透：PID、owner generation、artifact absolute path、writer、native error、完整环境和内部 timeout timer。

## 10. 错误分类

| 阶段 | 示例 | 是否 spawn |
| --- | --- | --- |
| 输入 | empty/NUL/too long/invalid cwd | 否 |
| 权限 | permission settings unavailable | 否 |
| 审批 | denied/invalidated/persistence failed | 否 |
| 平台启动 | environment unavailable/launch payload too large | 否 |
| 运行期 | runtime lost/timeout/cancel | 可能已启动 |
| 增强投影 | text sink/audit incomplete | 不改写真实终态 |

错误分类必须在 host/domain 边界冻结，不能把任意系统错误字符串直接展示给 Agent。

## 11. 设计风险

- `cwd` 只做字符串前缀检查会导致符号链接逃逸；必须使用真实目录 adapter。
- 直接用 `process.cwd()` fallback 会把 App 安装目录当成用户工作目录。
- 自动 PTY 会引入 ConPTY/node-pty 的输入、resize 和 native 生命周期风险。
- 将 `requires_write_access` 当成最终权限会形成 Agent 自助提权。
- 在 Shell feature 内缓存上一条命令 cwd 或 env 会形成隐式持久 session。
- 为插件命令向 PATH 注入 launcher，会把需要主 App 能力的调用错误地送进 OS sandbox 和第二个进程。

## 12. 测试门禁

- schema：NUL、Unicode 计数、unknown field、timeout 边界；
- cwd：默认根、显式路径、缺失、普通文件、symlink/junction、cleanup in progress；
- mode：pipe/PTY 互斥、stdin 关闭、交互动作能力；
- timing：initial wait、process wait、hard timeout 不互相改写；
- launch：平台 payload 超限、环境缺失、Shell profile 不匹配；
- production：真实 ToolRegistry → shell-runtime → owner → runner → card/audit。

前端不测试这里的规则；Renderer 只验证 projection 和用户动作。
