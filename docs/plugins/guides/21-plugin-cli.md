# 21 插件 CLI 与 Agent Shell 接入

## 1. 产品合同

插件 CLI 是插件领域能力，不是第九种 Agent 工具。Agent 只使用平台既有的 `shell` / `process`，由 Skill
提供 CLI 名称、参数、exit code 与产物读取方式。Host 不在 ToolContext、Commands schema 或 Renderer DTO
中增加插件字段。

```text
Agent
  -> shell({ command: "linnya-slides ..." })
  -> process（仅当父 Shell 返回 handle）
  -> read_file（读取 conversation locator 产物）
```

严禁恢复 `plugin_command`、Hosted Command owner、插件专属 Agent 工具或按 plugin ID 写进通用 Shell
逻辑。`linnya-<plugin>` 是 Shell 能找到的 CLI 命令，不是工具名。

## 2. 两种宿主 adapter

同一个插件 parser 和领域 orchestration 可以有两个明确分离的宿主 adapter：

| 入口 | 使用者 | 启动方式 | 数据与输出 |
| --- | --- | --- | --- |
| Agent facade | Agent | 父 Shell 启动极小 native client，再回到当前 App bridge | 继承父 Shell 权限；受管 conversation 输出 |
| standalone `entry.command` | 人、开发脚本、CI | manifest command mode，可启动独立 Electron/Node host | 显式 DB/output；自己的只读 adapter |

两者共享 argv parser、领域命令类型、exit code 和核心 orchestration；数据库/coordinator/worker 装配与默认
输出策略属于各自 adapter。不要让 Agent 直接执行 `entry.command`，也不要让 standalone CLI 依赖当前 App
的一次性 bridge token。

standalone 若只提供查询、诊断或导出，应建立与命令相称的只读 projection/runtime，不得为了复用少数方法
装配包含 mutation、codegen、compiler、workspace service 的完整 coordinator。复用边界应落在渲染模型构造、
inspection、quality、截图等窄领域能力；数据库 projection 仍须沿用正式持久化 codec 和一致性校验，不能另写
一套宽松解析。某项作者能力只影响编辑元数据时，应显式关闭该能力，而不是启动整条作者工具链补数据。

## 3. Backend contribution

只有宿主编译期认定的官方插件可以贡献 `pluginCli`：

- `prepare({ argv, invocationId, conversationRoot })` 只解析参数、形成 completed 结果或返回 access plan；
- prepare 阶段不得访问数据库、coordinator、worker、文件或网络；
- `execute({ hostContext, signal })` 只在 Host 权限门禁通过后运行；
- 插件必须用窄类型守卫读取 `hostContext: unknown`，不能用断言绕开边界；
- result 只包含有界 `exitCode/stdout/stderr`，业务错误仍使用插件自己的稳定 code。

v1 access plan：

| 能力 | 合法值 |
| --- | --- |
| internal data | `none | required` |
| conversation files | `none | write` |
| external files | `denied` |
| network | `denied` |
| GUI control | `denied` |
| local IPC control | `denied` |

若未来确有新能力，先修改公共合同、威胁模型和端到端测试；不能在某个插件里加可选字段或 fallback。

## 4. Launcher 与 native client

App 启动后根据 enabled `pluginCli` registrations 对账受管 launcher 目录，并把它放到冻结 Shell PATH 的
最前面。每个 facade 是同一个极小原生 client 的可执行副本，文件名为 `linnya-<plugin>`（Windows 为
`.exe`）；client 从文件名绑定 plugin ID，因此无需 wrapper script，也不会发生第二次 Shell argv 解析。

client 只能：

1. 读取父 Shell 注入的内部 endpoint/token；
2. 保留 argv 项边界并发送 versioned request；
3. 将 bridge output frame 写回真实 stdout/stderr；
4. 以插件 exit code 退出。

client 禁止读取 DB、插件 manifest、用户配置或 Renderer token，禁止解析插件子命令，禁止启动 Electron。
transport/协议失败使用独立错误 `plugin.cli.bridge_transport_failure` 和 exit code 70，不能伪造领域错误。

launcher 对账只能删除自己 manifest 管理的 stale 文件。迁移旧 v1 launcher 时，只精准删除已知插件的
`linnya-<plugin>` / `.cmd`，不得递归删除目录或触碰未知文件。

## 5. Execution-scoped bridge

bridge 是当前 App Host 中的 application use case，不属于 Commands domain，也不是进程 owner：

```text
Shell authorization/reservation/start
  -> token becomes active
  -> native client invokes loopback bridge
  -> registry lease
  -> plugin prepare
  -> access-plan gate
  -> plugin execute
  -> stdout/stderr/exit frames
  -> parent Shell observes normal process terminal
```

强制不变式：

- endpoint 只绑定 `127.0.0.1` 随机端口，使用独立 header/token；
- 每个父 Shell execution 一个高熵 token，prepared start 前与 terminal 后都无效；
- endpoint/token 属于 runner-only internal environment，Host 不把它写入 launch snapshot、Renderer、审计或
  普通 Agent 结果；模型主动执行 `env` 仍可能在本次 Shell 输出中看见它，但 token 不能跨 execution 使用；
- bridge invocation 是父 execution 的受管子活动，不调用 `reserve`、authorization 或 approval；
- bridge 不创建 process handle、output writer、ToolOutputStore、audit 或 terminal；
- 父 execution stop/terminal 先撤销 token并 abort invocation，再等待 activity/lease 释放；
- 插件 disable/upgrade 先拒绝新 invocation、abort 并等待旧 lease，再卸载 worker/runtime effect。

## 6. 权限与地址空间

Agent facade 完整继承父 Shell 的权限事实。需要写 conversation 文件时，Skill 必须给 Shell 设置
`requires_write_access: true`；`read_only` 未经批准时，bridge 在插件接触 DB/worker 前拒绝执行。内部数据
访问也必须继承父 snapshot 的 `internal_data_access`。

插件生成的普通文件放在 Host 提供的 conversation root 下，stdout 返回 `conversation:/...` locator；Agent
再用 `read_file` 读取。bridge 不把物理 root、DB path、token 或二进制内容写进 stdout。Workspace VFS 与
conversation 物理目录仍不自动同步。

standalone CLI 使用普通 OS `--output` 和 `file:` locator；它的权限与进程生命周期不由 Agent bridge 代管。

## 7. Skill 与 AgentDefinition

Skill 是 CLI 用户手册，不授予权限、不注册工具。它至少说明：

- facade 命令名和允许的子命令/参数；
- 哪些操作需要 `requires_write_access`；
- Shell `completed` 不等于成功，必须检查 `data.terminal.process_exit`；
- 长任务如何用 `process`；
- stdout report、locator 和 `read_file` 的消费顺序；
- 哪些参数只属于 standalone adapter，Agent facade 必须拒绝。

需要插件 CLI 的 AgentDefinition 只需包含 `shell`，长任务再包含 `process`；不得添加插件专属工具名。

## 8. 代码归属

| 内容 | 位置 |
| --- | --- |
| `pluginCli` 公共合同 | `packages/plugin-host-contract/backend/pluginCli.ts` |
| 插件 parser/领域 orchestration | 插件自己的 `features/<domainCli>/` |
| bridge use case | `src/app-hosts/linnya/application/plugin-cli-shell-bridge/` |
| launcher adapter | `src/app-hosts/linnya/adapters/commands/plugin-cli-launcher/` |
| native client | `src/infra/adapters/command-runtime/plugin-cli-client/native/` |
| production composition | `src/electron-main/commands/production-runtime/` 与 routes composition root |
| standalone command mode | Electron plugin loader / manifest `entry.command` |

standalone 制品必须有依赖图门禁，而不只检查压缩包总大小。重型插件应为 command entry 记录 raw byte budget，
并拒绝与该命令职责无关的依赖类别，例如编译器、mutation 引擎、完整 workspace 门面和其他插件源码；构建
metafile 只用于验证，不应随 artifact 发布。预算变化必须先解释真实业务增量并更新对应 smoke/文档。

Commands domain 只拥有父 Shell/process 合同；不得新增 plugin CLI feature。插件 domain 不得反向 import Host
bridge、Electron composition root 或 Commands 内部实现。

## 9. 验收清单

1. Default/专用 Agent 工具集中没有 `plugin_command`，需要 CLI 的 Agent 保留 `shell`；
2. facade 保留 argv 边界、stdout/stderr 和 0–255 exit code；
3. facade 进程树不出现第二个 Electron；
4. token start 前、terminal 后和其他 execution 中均不可用；
5. read-only 写入和 internal-data denial 在插件接触 DB/worker 前失败；
6. Shell cancel、hard timeout、Agent run stop、conversation deletion、App end 都会 abort 并等待 invocation；
7. 插件 draining 等待 invocation 后再卸载 worker；
8. launcher 对账保留未知用户文件并精准清除旧 v1 facade；
9. Agent render report 产出 `conversation:` locator，standalone CLI report 产出 `file:` locator；
10. macOS arm64 与 Windows x64 packaged artifact 含正确 native client，签名/架构/路径可验证；
11. 静态守卫阻止 Agent 工具、ToolContext、Hosted owner 和旧 contribution 命名复活。
12. standalone 只读命令未装配完整 mutation coordinator，构建图与 raw byte budget 均有自动门禁。
