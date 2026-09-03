# Command Host Adapter

生产组合根见 [`production-runtime`](./production-runtime/README.md)。它已经从 Electron Main 抽离，
只依赖 Commands/domain port；Electron approval/card page 与 Utility runner 是可替换的外层 adapter，
不能反向渗入 owner、Shell、output 或 plugin CLI bridge。

## 1. 位置和职责

这是 Linnya App Host 的命令组合根。它把 Commands domain、conversation-files、audit、ToolOutputStore、公共 command runtime、local-process runtime 和 Electron host 组合成生产可用的 `shell`/`process` 工具。

组合根的价值是集中跨 domain 顺序，而不是集中所有业务规则。每个子模块拥有自己的状态和 port，组合根只连接稳定接口，避免 Commands、History、Renderer 各自复制一套“启动、审批、输出、删除”。

## 2. 目录树

```text
src/app-hosts/linnya/adapters/commands/
├── approval-host/       # pending approval 与页面票据的唯一业务 owner
├── artifacts/           # 通用 artifact ingress
├── command-card-control-host/ # 卡片控制、终态持久化与受保护输入 owner
├── output/              # raw/text/card 输出适配
├── permission-settings-authority/ # App 生命周期内唯一权限文档 authority
├── plugin-cli-launcher/ # 安装不启动 Electron 的同名薄 client facade
├── process-owner/       # execution ownership 和控制
├── runner-runtime/      # Electron Utility / disposable host 生命周期
├── renderer-rpc/        # App Server owner 与 Main Renderer IPC 的 typed gateway
├── shell-runtime/       # shell/process 用例编排
└── README.md
```

插件 CLI 的 app-level bridge 位于 `src/app-hosts/linnya/application/plugin-cli-shell-bridge/`。launcher 安装的
facade 是极小原生 client；它进入正常 Shell runtime 和唯一 execution owner，再以父 execution 的一次性 token
调用当前 App 内的 `pluginCli` contribution。bridge 不创建第二套容量、停止屏障或输出链。standalone command
mode 装配仍属于 `src/electron-main/plugins/loader/`，只服务人、开发脚本和 CI。

构建产物也必须遵守单一 owner：command runner 的 watcher 以 `clean=true` 独占 `dist/main/commands/`，Plugin CLI
native client 使用独立的 `dist/main/plugin-cli-runtime/`。禁止把 client 放回 runner 输出根，否则开发态 watcher
会删除它，导致整个 conversation 组合根初始化失败。

跨 domain 的 port 从 `src/domains/commands` 或公共 runtime 导入；禁止从另一个 adapter 目录深层导入实现文件。

## 3. 创建生产 scope

生产 scope 应该一次性创建并持有：

```text
conversation directory port
permission authority port
command authorization functions
approval host port
command execution owner
runner backend factory
raw artifact / text sink / presentation ports
audit port
```

scope 生命周期与 App Host 相同。对话切换只切换 admission scope，不能为每次工具调用重新创建第二个 owner 或第二个输出存储体系。

## 4. 跨 domain 调用顺序

1. `shell-runtime` 读取并校验工具输入。
2. `conversation-files` 提供安全 cwd 和 admission barrier。
3. permission authority 捕获本次 Agent run 的 snapshot。
4. authorization 决定直接允许、审批或拒绝。
5. approval host 负责页面交互，批准记忆由 conversation/commands port 持久化。
6. owner reserve/claim，runner runtime 才创建 OS 资源。
7. output adapter 分流 raw byte、Agent text、card 和 PTY screen。
8. audit domain 记录稳定事件，最后由 owner 结算。

## 5. 不允许的依赖

- 不创建 `BashExecutionService`、`ProcessManager`、`CommandLogManager` 等平行总管。
- 不在这里解析风险正则或读 Vue store。
- 不向模型返回 PID、Job、PGID、Utility generation、完整 env 或内部文件路径。
- 不管理 pip、npm、brew、pnpm、Python venv 等普通 CLI；它们由 Agent 在命令中自行使用。

## 6. 关闭和删除

App end、Agent run end、精准目录清理和完整 conversation 删除都必须先调用 owner stopping，再等待进程树、输出和 audit 收口。删除流程的跨 domain 排序见 [conversation lifecycle](../../application/conversation-lifecycle/README.md)。

## 7. 测试门禁

跨 domain 的变化必须在这里补真实组合测试；单模块测试只能证明局部函数。重点是审批前零 spawn、启动后错误仍能收口、输出 sink 独立失败、删除屏障拒绝迟到消息，以及两个 conversation 并发时互不干扰。
