# Linnya 命令执行模块

## 1. 文档用途

这份文档是命令执行模块的跨模块产品和架构入口。它回答三类问题：

1. 用户和 Agent 实际获得了什么能力。
2. 命令从工具调用到操作系统进程，再到 UI、审计和对话删除，经过哪些模块。
3. 修改某个模块时，哪些事实不能被破坏，应该在哪个模块补测试。

模块细节、字段完整定义和代码入口以各自目录的 README 为准。本文档只保留跨模块的产品合同、架构关系和维护入口，不记录施工过程或历史验证流水。

## 2. 产品定义

Linnya 提供本地、一次性、可观察的 Shell 命令执行能力。Agent 可以调用本机 Shell、宿主 CLI、脚本、数据库和外部 Agent CLI；Linnya 负责把命令放进当前对话的运行环境，管理整棵进程树，向用户展示状态，保留审计事实，并在删除对话或退出 App 时完成清理。

它不是：

- 用户终端的替代品；
- coding agent 专用的远程开发环境；
- 普通 CLI、Python、npm、pip、brew 的安装市场；
- 把整个操作系统变成强隔离沙箱的安全产品；
- Workspace VFS 的镜像或自动导出/回填工具。

文件工具优先，Shell 负责补充文件工具无法表达的能力。Shell 可以联网，安全承诺是“平台进程边界 + 权限审批 + 审计”，不是“所有脚本行为都能被 Linnya 识别”。

## 3. 用户可见能力

### 3.1 Shell 工具

`shell` 每次启动一条新 Shell。短命令在初始等待内完成时直接返回终态；长命令返回 opaque process handle，由 `process` 继续查询或控制。

输入字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `command` | string | 完整 Shell 命令，禁止 NUL，最大 12,000 code point |
| `cwd` | string? | 本次命令的绝对工作目录，省略时使用对话根目录 |
| `interactive` | boolean? | 明确为 `true` 才创建本次 PTY |
| `requires_write_access` | boolean? | 只读档位下声明本条可能写入 |
| `initial_wait_ms` | integer? | 250 至 30,000 ms，默认 10,000 ms |
| `hard_timeout_seconds` | integer? | 1 至 600 秒，默认 180 秒 |

`requires_write_access` 只是授权输入，不是 Agent 自己提权。最终权限只能由当前权限设置、授权规则和用户审批决定。

### 3.2 Process 工具

`process` 只接受 `shell` 返回的 opaque handle 和一个动作：

| 动作 | 语义 |
| --- | --- |
| `poll` | 立即返回当前非消费式输出窗口 |
| `wait` | 在本次查询期限内等待新输出或终态 |
| `cancel` | 请求停止整棵进程树 |
| `write` | 向 PTY 写入文本，不隐式发送 Enter |
| `submit` | 写入文本并发送平台 Enter |
| `eof` | 结束 PTY 输入方向 |
| `resize` | 调整 PTY columns/rows |

`write/submit/eof/resize` 只能用于显式 PTY。用户的密码等保护输入走命令卡片的私有输入通道，不进入模型参数和普通审计正文。

### 3.3 权限设置和审批

权限是全局设置，当前对话不单独覆盖：

- `read_only`：默认只读；写入、删除、移动、上传等超出范围的命令需要审批。
- `standard`：默认档；命中固定高风险规则时需要审批。
- `full_access`：自动允许命令，不再弹审批，但风险最高。

审批有“允许本次”“本对话允许相同命令前缀”“拒绝”。对话记忆只适用于明确解析出的简单命令，并绑定平台、Shell 语义和 matcher revision。复杂脚本不会因为看起来相似而自动记忆。

GUI control 对三档权限固定为 `denied`。`full_access` 只表示命令不再弹审批，不授予启动新 GUI、普通 App 身份、Dock tile、控制台窗口或任务栏窗口的能力。正式平台门禁必须同时覆盖直接调用和解释器间接调用，包括 macOS `open -a`、`osascript`，Windows `Start-Process`，以及经脚本解释器或自定义二进制启动 GUI 的路径。

当前设置 schema 已锁定这项产品合同，但普通 Shell 的跨解释器平台 enforcement 与完整正式 fixture 尚未收口；这是 Command 上线前的工程门禁，不是新的权限档、GUI 授权弹窗或兼容模式。不能用词法 denylist、审批通过或“肉眼没有看到窗口”代替真实执行边界。

### 3.4 对话目录

每个对话有一个稳定的真实本地目录，同一对话的所有 Agent 共享它。Shell 进程不持久，文件持久；一条命令中的 `cd` 不改变下一条命令的默认 cwd。

### 3.5 OS 路径、文件 locator 和可见性

Shell 使用操作系统路径；模型侧文件工具使用带地址空间的 locator，二者不能混用：

| 地址 | 使用者 | 例子 | 含义 |
| --- | --- | --- | --- |
| Shell 物理路径 | `shell` / `process` 和操作系统命令 | `/Users/name/.../conversation_<sha256>`、`C:\\Users\\name\\...\\conversation_<sha256>` | 操作系统真实文件系统中的目录；`pwd` 可以让 Agent 读取当前实际路径 |
| Workspace locator | Workspace 五件套 | `workspace:/`、`workspace:/docs/plan.md` | 当前项目数据库 VFS |
| Conversation locator | `read_file` | `conversation:/slides-renders/run-1/slide-001.png` | 当前 conversation root 下的物理文件 |
| Host file locator | `read_file` | `file:///Users/name/project/README.md` | conversation 外的宿主绝对文件 |

默认 Shell 工作目录的物理路径由应用数据根目录和对话身份推导：

```text
<appDataRoot>/ConversationWorkDirectories/v1/workspaces/conversation_<sha256(conversationId)>
```

开发模式通常是：

```text
<projectRoot>/_dev_data/ConversationWorkDirectories/v1/workspaces/conversation_<sha256>
```

生产环境使用操作系统的用户数据目录。原始 conversation ID 不直接出现在目录名中，而是使用完整 SHA-256 生成 `conversation_<sha256>`；这是为了让目录身份稳定且不把用户输入直接放进文件名。

Agent 不会在每次 Shell 返回中自动获得这个内部绝对路径。需要知道真实路径时，应在 Shell 中执行 `pwd`，或明确传入 `cwd`；内部路径不会自动写入普通审计和工具结果。

这些地址空间没有自动 materialize/commit 桥接：

- `write_file(locator="workspace:/notes.md")` 写入 Workspace VFS 的数据库和 pending revision，不能假定 Shell 默认目录里的 `ls` 会看到它；
- Shell 中创建的 `notes.md` 是物理文件，也不能假定它会自动出现在 `workspace:/notes.md`；读取它应使用 `conversation:/notes.md`；
- `asset://...`、`tool_output://...` 等资源 URI 也不是 Shell cwd 的路径。

`read_file` 不接受裸路径，也不会按存在性猜来源。Shell 输出 conversation 外绝对路径时，Agent 应将其规范为 `file:` URL 后读取。`read_file` 的只读范围不随 `read_only`、`standard`、`full_access` 改变；三档仍只约束命令执行和写入，读取最终受操作系统权限、普通文件、格式和预算门禁约束。

显式 `cwd` 可以指定物理绝对路径；当前实现会记录它是否位于 conversation root，但并不把所有 outside-root 路径统一当作非法路径。实际能否访问仍由权限档、平台规则和操作系统文件权限共同决定。文档和 UI 不得把这条能力描述成“Shell 永远只能在对话目录内运行”。

删除对话时，系统先建立持久 cleanup job 和准入屏障，再停止进程和 Flow，最后删除目录、批准、卡片事实、对话事实和 identity metadata。

### 3.6 Agent 调用插件 CLI

Agent 不获得插件专属工具。插件通过 Skill 告知 Agent CLI 名称和参数，Agent 使用既有 `shell` 调用，例如
`linnya-slides render ...`；长任务仍由 `process` 跟进。命令文本、工作目录、权限、输出、进程树、审计和
终态全部沿用同一条 Shell execution 主链。

当前 App 在受管 PATH 中安装同名的极小原生 CLI client。client 不启动 Electron、不读取数据库、不解析
Slides 参数；它只从 executable 文件名绑定 plugin ID，保留 argv 边界，并通过 execution-scoped loopback
bridge 调用当前 App Host 中已启用的 `pluginCli` contribution。子命令、参数、exit code、stdout/stderr 和
领域 orchestration 仍由插件拥有。Slides 因此可复用当前 workspace SQLite、共享 `PptCoordinator` 与受管
raster hidden worker，同时避免启动第二个 Electron。

Plugin CLI bridge 的能力计划必须通过严格运行时校验：

- `internalDataAccess` 只能是 `none|required`；用户关闭内部数据访问时，在插件接触 DB 前拒绝；
- `conversationFiles` 只能是 `none|write`；`read_only` 下写入只能批准本次，不产生对话记忆；
- external files、network、GUI control 和 local IPC control 必须全部为 `denied`；
- 插件返回未知字段、越权值或无效结果时 fail closed 为 bridge runtime failure。

Host 不把整份 Agent `ToolContext` 交给插件。v1 只允许按 access plan 注入窄 internal-data context；
`internalDataAccess=none` 的 execute 收到空 context，避免借由其他 ToolContext 服务绕过能力计划。

bridge token 每次 Shell execution 单独生成，只在该 execution 成功进入 start 后有效；父 Shell terminal、
取消、超时、Agent run stop、conversation stop 或 App end 都会先撤销 token、abort 子 invocation 并等待
lease 释放。bridge 不创建第二个 command reservation、approval、output writer、audit 或 terminal。

Slides render 的 JPEG 检查图落在当前对话目录 `slides-renders/presentation-<id-hash>/`，内部按文稿版本与 raster profile 隔离。同一版本的局部 render 保留其他已完成页，新版本成功后淘汰整个旧版本；这只是 Agent 当前工作集，已经由 `read_file` 接管的 Conversation 历史图片不受清理影响。CLI 成功 stdout 是单行 JSON，其中包含 presentation 版本以及每页的 `slideNumber + conversation: locator`；模型随后直接把所需 locator
交给 `read_file`。这些文件不会自动进入 Workspace VFS 或项目资源库。render report 不包含 `.slides` 的
`deck.js` 源码、页面组织或 Inspect finding；源码继续通过 Workspace `read_file` 读取，质量问题通过
`ppt_inspect` / `linnya-slides inspect` 获取。Shell 的 `completed` 只表示形成终态，只有
`data.terminal.process_exit.exit_code=0` 的完整 stdout 才可消费。

`plugin.json.entry.command` 的 standalone command mode 仍保留给人、开发脚本与 CI。它可以使用
`LINNYA_PLUGIN_RUNTIME_DATABASE_PATH` 或显式 `--database`；Agent 则使用由 App 安装到 PATH 的薄 client，
两种宿主 adapter 复用同一个插件 parser 和领域 orchestration，但不复用进程入口。

命令卡片回放以 durable settlement 为终态事实：实时卡片优先按 `process_handle` 关联，历史消息缺少
`tool_output` 时按同一次 execution 的 `origin_tool_call_id` 关联。不能把历史 `loading` 状态直接改写成
“未执行”，也不能从命令文本、时间或日志猜测终态。

Shell 的 `completed` 只表示命令已经完成可信终态；是否成功必须读取结构化的
`data.terminal.process_exit` 和插件定义的机器输出合同，不能用 `tail`、`|| true` 或自然语言 stdout 推断。

## 4. 端到端架构

```text
Agent Graph / ToolRegistry
        │  shell / process DTO
        ▼
src/tools/commands/shell + process
        │  schema parse + result allowlist
        ▼
Commands domain
  ├─ shell-execution
  ├─ command-authorization
  ├─ permission-settings
  └─ process-control
        │  ports / public contracts
        ▼
Linnya App Host（独立 headless App Server）
  ├─ conversation admission
  ├─ process-owner
  ├─ output adapter
  ├─ shell-runtime
  ├─ plugin-cli-shell-bridge use case
  ├─ plugin-cli-launcher adapter
  └─ command audit
        │
        ├──────────────► fixed headless Node runner
        │                         │
        │                         ▼
        │                local-process-runtime
        │                ├─ macOS process group + SRT
        │                └─ Windows Job + native binding
        │                         │
        │                         ▼
        │                    Shell / child tree
        │                         │
        │                         └─ linnya-<plugin> thin client
        │                              └─ execution-scoped loopback bridge
        │                                   └─ pluginCli contribution
        │
        ├──────────────► ToolOutputStore / raw artifact
        ├──────────────► EventStore audit + card settlement
        └──────────────► typed Desktop RPC → Electron Main → Renderer approval / command card
```

## 5. 身份和信任边界

一次执行至少有以下身份：

| 身份 | 用途 | 能否给 Agent |
| --- | --- | --- |
| conversation ID | 对话归属和目录 | 由 ToolContext 注入 |
| agent run ID | 当前模型运行 | 不由模型参数指定 |
| origin tool call ID | 启动这条命令的调用 | 不由模型参数指定 |
| command execution ID | 这次具体执行 | 不直接给模型 |
| owner generation ID | 识别 owner 世代和迟到消息 | 不给模型 |
| process handle | 后续 process 查询凭据 | 可以，作为 opaque string |
| control tool call ID | 每次 process 控制动作 | 只进内部审计 |

进程 PID、Job handle、PGID、pipe、Readable、native binding 和内部文件路径永远留在 adapter。handle 先进入当前 conversation/run scope，再查找 owner，不能从全局表先取到再补校验。

## 6. 输出四层

1. **Raw byte artifact**：stdout/stderr 或 terminal transcript 的字节，保存 sequence、observed byte 和来源完整性。
2. **Agent text**：独立 decoder、控制序列 parser、CR 逻辑行和有界 preview；超长内容进入 ToolOutputStore。
3. **Card presentation**：命令摘要、运行状态、持续时间、结束状态、复制内容和错误提示。
4. **PTY screen**：终端网格和样式的安全投影，不是 stdout 拼接结果。

四层不能互相替代：卡片不能成为审计事实源，Agent text 不能反推 raw byte，PTY screen 不能作为原始证据。

## 7. 生命周期主线

```text
parse input
  → freeze identity / permission / launch
  → conversation admission
  → authorize
  → (optional) persist approval
  → reserve owner
  → prepare runtime (no OS resource)
  → start / spawn / started
  → observe output and process actions
  → terminal facts
  → output settlement + tree empty + release
  → Agent / card / audit projection
```

下面四件事必须分别观察：

- process exit：根进程的退出码或 signal；
- output drain：stdout/stderr/PTY 是否已经读完；
- tree cleanup：整棵后代是否已经消失；
- resource release：Job、PGID、PTY、Utility、reader 和临时目录是否释放。

只收到 child `exit`、只调用 `kill()` 或只收到 Utility `exit` 都不能返回“已完成”。

## 8. 平台策略

### macOS

- 默认 zsh；启动时冻结 Shell 语义和用户登录环境。
- 使用进程组接管整树。
- SRT/Seatbelt 负责平台文件边界；失败时关闭执行。
- PTY 与 pipe 使用不同 adapter，但共用 owner 终态合同。

### Windows

- 支持 Windows 10 22H2 x64、Windows 11 x64；x64 包可在 Windows 11 ARM64 兼容层运行。
- 默认普通用户；Job Object 负责整树接管和清理。
- PowerShell 7 优先，失败使用系统 PowerShell 5.1；Shell 语义、编码和 launch profile 启动时冻结。
- 不建设 OS 文件写入沙箱；用普通用户、固定风险规则、审批、Job 和审计降低风险，并明确可能漏判。
- native loader 校验 manifest、架构、hash、版本和发布者，不能回退到裸 child。

两平台 UI/UX 保持一致，但底层错误、Shell 语义、PTY 和发布限制可以不同。

## 9. 风险控制清单

- 权限配置和对话工作目录分离；Agent 不能通过工作目录改写权限 authority。
- 初始化后的权限配置缺失或损坏必须关闭新命令，不能静默变成 standard。
- 高风险规则只做审批触发，不能写成“完全安全”。
- 原始输出、环境、完整 argv、PID 和保护输入不进入审计正文。
- runner、owner、PTY 和 writer 都必须有界、可取消、可观察。
- `gui_control = denied` 必须在平台执行边界生效；三档权限、审批、解释器和自定义二进制都不能把它提升为 allowed。
- 删除 job 永久失败时必须保留失败状态和用户可见诊断，不能无限阻塞而无解释。
- App 退出、更新、窗口关闭和对话删除必须共享同一组 owner 收口事实。

## 10. 开发规范

- 业务规则写在 domain feature 的 `functions/`，流程顺序写在 `orchestration/`，平台实现写在 adapter。
- Renderer 只展示和提交动作，不读权限文件、不解析风险命令、不操作 owner 内部状态。
- DTO 使用 strict Zod schema；跨进程和跨 domain 只通过 schema 公开字段。
- 任何“为什么必须先做 A 再做 B”的顺序都要在核心代码写中文注释。
- 禁止新增第二套进程 owner、日志 writer、ToolOutputStore、审批事实源或全局 manager。

## 11. 测试门禁

业务端到端优先于孤立单测，至少覆盖：

1. 短命令正常完成；
2. 长命令 `shell → process.wait → process.cancel`；
3. read_only 写入审批、standard 高风险审批、full_access 免审批；
4. pipe 双流输出、超长输出、慢存储、磁盘写失败；
5. PTY write/submit/eof/resize 和屏幕投影；
6. owner 取消、hard timeout、runner 崩溃、迟到消息；
7. 对话删除、精准清理、App 退出和更新交接；
8. macOS/Windows 普通用户进程树外部观察；
9. `open -a`、`osascript`、`Start-Process`、解释器间接调用和自定义二进制的 GUI launch denial；
10. Renderer reload、旧页面审批回复、卡片复制和人工验收。

不写只锁定 padding、颜色、弹窗宽度或文本快照的测试。

## 12. 相关文档

- [Commands Domain](../../src/domains/commands/README.md)
- [Shell Tool](../../src/tools/commands/shell/README.md)
- [Process Tool](../../src/tools/commands/process/README.md)
- [Command Runtime](../../src/infra/adapters/command-runtime/README.md)
- [Local Process Runtime](../../src/infra/adapters/local-process-runtime/README.md)
- [Command Host Adapter](../../src/app-hosts/linnya/adapters/commands/README.md)
- [Command Approval Renderer](../../apps/renderer/domains/conversation/features/command-approval/README.md)
- [Command Execution Presentation](../../apps/renderer/domains/conversation/features/command-execution-presentation/README.md)
- [Conversation Files](../../src/domains/conversation-files/README.md)
- [Command Execution Audit](../../src/domains/audit/features/command-execution-audit/README.md)
