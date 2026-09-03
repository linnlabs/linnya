# Linnya 命令执行

## 1. 领域职责

Commands domain 是命令执行的业务核心，定义“这次命令是谁发起、能否执行、如何继续控制、何时才算完成、输出哪些事实”。它不直接调用 `child_process`、Electron、Node stream、SQLite 或 Vue。

Linnya 提供本地、一次性、可观察的 Shell 命令执行能力。Agent 可以调用本机 Shell、宿主 CLI、脚本、数据库和外部 Agent CLI；Linnya 负责将命令放进当前对话的运行环境，管理整棵进程树，展示状态、保留审计事实，并在删除对话或退出 App 时完成清理。

它不是用户终端、远程开发环境或 CLI 安装市场，也不承诺把整个操作系统变成强隔离沙箱。文件工具优先，Shell 只补充文件工具无法表达的能力；Shell 可以联网，安全边界是“平台进程边界 + 权限审批 + 审计”，不是识别所有脚本行为。

## 2. 领域边界

### 2.1 领域拥有的事实

- Shell command proposal；
- command execution identity；
- permission snapshot 和授权来源；
- approval request、reply、settlement；
- process reservation、opaque handle、owner binding；
- process observation 和 terminal 业务结果；
- raw output artifact 的公共完整性合同；
- Agent model observation 和 card projection 所需的稳定字段。

### 2.2 领域不拥有的事实

- 操作系统 PID、Job handle、进程组、PTY fd、Node stream；
- 当前 Renderer 页面、窗口、IPC sender；
- 对话目录的物理路径和清理 job；
- EventStore 的表结构和审计文件；
- Python/npm/brew 等外部工具的安装状态；
- UI 颜色、布局、弹窗尺寸和组件生命周期。

这些事实通过窄 port 或 application use case 进入，避免 domain 变成 Electron 的第二个主进程。

### 2.3 对话目录与地址空间

每个对话拥有稳定的本地工作目录，同一对话的 Agent 共享目录中的物理文件，但 Shell 进程、`cd` 和环境变量不跨调用持久化。默认目录由应用数据根与 conversation identity 推导，目录名使用完整 SHA-256，不直接暴露原始 conversation ID。

Shell 路径与产品 locator 是不同地址空间，禁止按字符串或文件是否存在互相猜测：

| 地址 | 使用者 | 示例 | 含义 |
| --- | --- | --- | --- |
| Shell 物理路径 | `shell`、`process` 与操作系统命令 | `/opt/project`、`C:\\work\\project` | 操作系统真实文件系统路径 |
| Workspace locator | Workspace 文件工具 | `workspace:/docs/plan.md` | 当前 Workspace 数据库 VFS |
| Conversation locator | `read_file` | `conversation:/renders/page-1.png` | 当前对话物理目录内的文件 |
| Host file locator | `read_file` | `file:///opt/project/README.md` | 对话目录外的宿主文件 |

Workspace VFS 与 Conversation 物理目录之间没有自动 materialize/commit：`write_file` 写入的 Workspace 文档不会自动出现在 Shell 的 `ls` 中，Shell 创建的文件也不会自动进入 Workspace。Agent 需要真实 Shell cwd 时应执行 `pwd`；内部绝对路径不自动写入普通工具结果或审计正文。

显式 `cwd` 可以指向对话目录外的物理路径。是否可访问由权限档、平台边界和操作系统权限共同决定，不能把产品描述成“Shell 永远只能在对话目录运行”。删除对话时必须先建立持久 cleanup job 和准入屏障，再停止进程和 Flow，最后清理目录、审批、卡片、对话事实与 identity metadata。

## 3. 代码树

```text
src/domains/commands/
├── definitions/
│   ├── commandExecution.ts       execution identity、owner binding、mode
│   ├── commandPermission.ts      三档权限和 grant source
│   ├── commandApproval.ts        approval request/reply/settlement
│   ├── commandOutputArtifact.ts  raw artifact 公共字段
│   ├── commandOutputProjection.ts Agent/card/PTY 输出投影
│   └── processOutputObservation.ts 运行中非消费式 observation
├── ports/
│   ├── commandExecutionOwnerPort.ts
│   ├── commandProcessControlPort.ts
│   ├── commandApprovalPort.ts
│   ├── commandPermissionSettingsPort.ts
│   ├── commandOutputArtifactPort.ts
│   └── commandProcessObservationPort.ts
└── features/
    ├── shell-execution/
    ├── process-control/
    ├── command-authorization/
    ├── permission-settings/
    ├── protected-input/
    ├── agent-command/
    ├── host-module-resolution/
    └── process-execution/
```

Feature 导航见 [features/README.md](./features/README.md)。

### 3.1 端到端链路

```text
Agent Graph / ToolRegistry
  → shell / process 工具（参数接纳与结果投影）
  → Commands domain（授权、身份、owner 与终态合同）
  → Linnya App Host（conversation admission、process owner、output、audit）
  → fixed headless Node runner
  → local-process-runtime（macOS process group / Windows Job）
  → Shell 与整棵 child process tree

同一执行同时投影到：
  → ToolOutputStore / raw artifact
  → EventStore audit 与 durable card settlement
  → Desktop RPC / Renderer approval 与 command card
```

Agent 调用插件 CLI 仍走这条主链：受管 PATH 中的极小 client 通过 execution-scoped bridge 调用已启用插件的 `pluginCli` contribution，不创建第二套 command owner、审批、输出或终态。

## 4. 核心身份合同

`CommandExecutionIdentity` 由 host 创建，包含：

```text
conversation_id
agent_run_id
origin_tool_call_id
command_execution_id
owner_generation_id
created_at_ms
```

这些字段全部属于一次执行，不能用其中任意一个替代另一个：一个 Agent run 可以有多条命令，同一个对话可以有多个 run，PID 还可能被操作系统复用。

`CommandExecutionOwnerBindingV1` 在身份上增加：

```text
process_handle: opaque string
mode: pipe | pty
```

handle 是跨 tool call 的连接凭据，不是 PID。任何 `process` 动作都先按 conversation/run scope 找 owner，再按 handle 找 execution，顺序不能反过来。

命令卡片的 durable settlement 同时保留 `process_handle` 和
`origin_tool_call_id`。Renderer 实时收到 tool output 时通常按 handle 关联；历史消息若只有
`tool_call_decision`、没有对应 `tool_output`，则按原始 tool call ID 关联同一条 settlement。
这两个身份都来自同一次 execution，不能用命令文本或消息时间猜测终态。

## 5. 权限和授权

`CommandPermissionSnapshotV1` 字段：

| 字段 | 说明 |
| --- | --- |
| `base_level` | 当前全局设置选择的档位 |
| `effective_level` | 当前 execution 最终有效档位 |
| `grant_source` | `global_setting`、`allow_once` 或 `conversation_approval` |
| `internal_data_access` | 是否允许访问 Linnya 内部数据 |
| `identity` | 必须和 execution 完全一致 |

Zod schema 结构性限制：

- global setting 不能改变 `base_level`；
- approval 只能把 read_only/standard 提升到 standard；
- full_access 不产生 approval request；
- approval settlement 的 grant source 必须和用户选择一致。

授权本身分为两层：

1. `read_only` 下检测是否越出只读范围；
2. `standard` 下匹配固定高风险规则。

规则只决定“是否需要用户审批”，不能证明脚本、解释器或外部 CLI 的完整行为。复杂命令无法可靠生成可记忆前缀时，只允许本次。

插件 CLI 不进入 Commands domain 的 DTO 或专属 feature。Agent 通过普通 Shell 文本调用 facade；Commands
只冻结并授权父 Shell。app-level bridge 根据父 execution 的 permission snapshot 校验插件 access plan，且必须
在调用插件 execute、数据库或 coordinator 前拒绝 `internal_data_access=denied` 或只读写入。

## 6. 输出合同

### 6.1 Raw artifact

`CommandOutputArtifactPort` 保存原始 byte。pipe 的 stdout/stderr 分开，PTY 是 terminal 单流；每个流都有 source completion、observed bytes、sequence 和存储完整性。

默认 writer 预算：

```text
maxPendingEvents = 1024
maxPendingBytes  = 4 MiB
```

这是内存中的 pending 准入预算，不是命令总输出、磁盘总量或用户可配置的硬配额。首次 writer failure 或 overloaded 后熔断接纳，但继续 drain、校验 sequence 和记录 observed bytes。

### 6.2 Agent text

解码、控制序列处理、CR 逻辑行和 preview 位于 infra/runtime。Commands domain 只看到稳定 observation 和 cursor，不拥有 decoder 或正文缓存。

### 6.3 Card / PTY

卡片只展示稳定摘要、状态、持续时间、终因和 `tool_output://` 引用。PTY 屏幕由专门 schema 投影，不能从卡片文本反向恢复。

## 7. 终态模型

一次命令至少有四个事实：

| 事实 | 示例 |
| --- | --- |
| `process_exit` | observed exit code/signal、not_started、unavailable |
| `output_drain` | complete、failed、not_started |
| `tree_cleanup` | succeeded、failed、not_required |
| `resource_release` | succeeded、failed、not_required |

业务 outcome 另行表示 `exited`、`timed_out`、`user_cancelled`、`owner_ended` 或 `runtime_failure`。退出码 124/130 等不能自行推导 timeout/cancel；终因由 owner/runtime 的真实控制事实决定。

成功条件不是某个单独事件，而是：

```text
terminal cause settled
AND output settlement finished
AND tree empty observed
AND platform resource released
```

如果资源释放失败，命令可以保留真实的 timed_out/cancelled 终因，同时把 release 标为 failed，阻止对话删除继续放行。

## 8. Prepared runtime 和 owner

`CommandExecutionOwnerPort` 的关键顺序：

1. `reserve`：只建立业务 reservation。
2. `prepareRuntime`：创建内存 controller，不创建 OS 资源。
3. `claimAndStart`：把 prepared runtime 交给 owner，再允许 spawn。
4. `publish`：只有 shell 已明确返回 handle 时才公开 binding。
5. `discard`：terminal 先于 handle 发布时关闭 runtime，避免短命令泄漏。

删除屏障建立后，Commands tombstone 立即拒绝迟到 start、control、publish。starting 期间 runtime 已挂载但未 spawn，也必须可以被 stop。

## 9. Port 设计

Port 只暴露业务需要的最小能力：

- approval port：request、settle、revoke；
- permission settings port：读取/写入版本化全局文档；
- execution owner port：reserve、prepare、claim、observe、stop、forget；
- output artifact port：open、append、complete、discard、maintenance；
- process observation port：非消费式 cursor、poll、wait；
- protected input port：绑定当前 PTY 的用户输入。

不要把一个 `CommandManager` 作为所有 port 的集合。port 的存在是为了让 Electron、平台 runtime、对话目录和 audit 可以独立替换。

## 10. 与其他 domain 的协作

```text
Commands → conversation-files: work-directory admission port
Commands → Audit: command execution audit port
Commands → App Host: production scope / workflow
App Host → EventStore: durable card settlement and audit envelope
App Host → Renderer: strict presentation DTO / IPC gateway
```

Commands 不直接调用 History、Workspace、Renderer store 或 SQLite repository。对话删除使用 [Conversation Lifecycle Workflow](../../app-hosts/linnya/application/conversation-lifecycle/README.md) 统一排序。

### 10.1 Plugin CLI app workflow

插件 registry 通过 public contribution 暴露一个 `pluginCli`。App-level `plugin-cli-shell-bridge` 只在父 Shell
execution 已通过 Commands 授权并 start 后激活一次性 token，再校验 access plan 并把窄 host context 交给
插件 execute。bridge 是父 execution 的子活动，不调用 Commands reserve/authorize，不产生第二个 terminal。
Commands domain 不 import 插件实现，不解析插件子命令，也不持有 Slides 语义。

standalone `entry.command`、active artifact 和 `LINNYA_PLUGIN_RUNTIME_DATABASE_PATH` 属于插件 CLI/loader
边界；Agent PATH facade 是另一种宿主 adapter，两者复用插件领域 orchestration。

## 11. 设计原因和维护风险

### 为什么不把 Bash 写成一个大 Service

Shell 输入、风险规则、进程 owner、输出管道和 UI 生命周期变化原因不同。一个大 Service 会把平台对象、权限决策和前端状态绑在一起，任何 bug 都只能靠分支补丁解决。

### 为什么 Plugin CLI bridge 不拥有第二套命令执行

插件领域命令需要复用当前 App 的数据库、coordinator 和受管 worker，但 Agent 的稳定抽象仍应是 CLI。
因此 Shell 只启动极小原生 client，而不是第二个 Electron；client 通过 execution-scoped bridge 回到当前
App。权限、owner、process handle、输出和 terminal 都继续属于父 Shell，bridge 只管理 token、invocation
abort 与 plugin draining。这样既不复制 Commands domain，也不把插件语义塞进 Shell schema。

### 平台策略

- macOS 默认使用 zsh，启动时冻结 Shell 语义和用户登录环境；进程组负责整树接管，SRT/Seatbelt 平台边界建立失败时关闭执行。
- Windows 支持 Windows 10 22H2 x64 与 Windows 11 x64；Job Object 负责整树接管，PowerShell 7 优先、系统 PowerShell 5.1 作为明确启动配置。native loader 必须校验 manifest、架构、hash、版本与发布者，不能回退到裸 child。
- 两个平台保持一致的产品权限、状态与 UI 语义，但允许底层 Shell、PTY、错误和发布限制不同。Windows 不伪装拥有 OS 文件写入沙箱，其风险由普通用户权限、固定审批规则、Job 与审计共同约束。

### 主要风险

- approval request 与 proposal identity 不一致；
- handle 未先做 scope 校验导致跨对话控制；
- raw artifact 和文本 store 混用导致证据丢失；
- terminal 早于 output/tree/release 结算；
- Windows loader/Job 失败时裸跑；
- 删除 job 和 owner stopping 没有原子屏障；
- 新增 fallback 使平台或权限静默降级。

## 12. 核心文件说明

| 文件 | 责任 |
| --- | --- |
| `definitions/commandExecution.ts` | identity、owner binding、mode |
| `definitions/commandPermission.ts` | 权限档和 schema 级限制 |
| `definitions/commandApproval.ts` | 审批请求、回复、结算和原因 |
| `features/shell-execution` | Shell 输入和 launch 参数 |
| `features/process-control` | owner、handle 和终态 |
| `features/command-authorization` | 风险规则和审批判断 |
| `ports/commandExecutionOwnerPort.ts` | domain 到 host owner 的窄边界 |
| `ports/commandOutputArtifactPort.ts` | raw artifact 所有权和维护 |

## 13. 测试门禁

最小业务测试矩阵：

- Shell 短命令、长命令、cwd 缺失、NUL/长度超限；
- read_only 写入、standard 风险、full_access；
- allow once、allow for conversation、deny、持久化失败；
- handle scope、poll/wait cursor、并发 cancel、迟到 terminal；
- 双流输出、慢 sink、raw/text 失败、PTY projection；
- 删除屏障、App owner end、Utility crash、平台资源泄漏；
- macOS SRT/zsh、Windows PowerShell/Job/native loader。

测试必须穿过真实 composition；纯函数只覆盖规则和投影，不替代生命周期 E2E。

## 14. 修改流程

1. 先定位业务归属，不在 `shared/utils` 增加不明用途代码。
2. 更新 definitions schema 和对应模块 README 的字段表。
3. 在 orchestration 中只改变步骤顺序，不把规则写进去。
4. 在关键分支添加中文“为什么”注释。
5. 补正常、失败、取消和竞态的业务测试。
6. 检查双平台、Sandbox、删除和 App 退出是否受影响。
7. 更新跨模块入口和子模块链接。

## 15. 相关文档

- [Shell Tool](../../tools/commands/shell/README.md)
- [Process Tool](../../tools/commands/process/README.md)
- [Command Runtime](../../infra/adapters/command-runtime/README.md)
- [Local Process Runtime](../../infra/adapters/local-process-runtime/README.md)
- [Command Host Adapter](../../app-hosts/linnya/adapters/commands/README.md)
- [Command Approval Renderer](../../../apps/renderer/domains/conversation/features/command-approval/README.md)
- [Command Execution Presentation](../../../apps/renderer/domains/conversation/features/command-execution-presentation/README.md)
- [Conversation Files](../conversation-files/README.md)
- [Command Execution Audit](../audit/features/command-execution-audit/README.md)
