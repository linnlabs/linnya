# Plugin CLI Shell Bridge

## 职责

本 use case 把父 Shell execution 中的 `linnya-<plugin>` 薄 client 调用连接到当前 App Host 已启用的
`pluginCli` contribution。它解决的是跨 domain 编排，不拥有插件子命令语义，也不建立第二套命令执行。

```text
Agent shell
  -> command owner / runner / OS Shell
  -> linnya-<plugin> native thin client
  -> execution-scoped loopback endpoint
  -> enabled pluginCli contribution
```

## 所有权边界

- 父 Shell 拥有 permission snapshot、approval、owner reservation、process handle、stdout/stderr、审计与 terminal。
- launcher adapter 只把同一原生 client 复制成 `linnya-<plugin>` facade，并将目录加入冻结 PATH。
- bridge 只拥有一次性 token、invocation lease、access plan 校验和 abort/draining。
- 插件拥有 argv parser、领域命令、exit code、stdout/stderr 与产物格式。
- standalone `entry.command` 是人/CI 的另一个宿主 adapter，不经过本 bridge。

禁止在 bridge 中新增 command reservation、审批记忆、输出存储、Renderer DTO、插件参数分支或第二个
Electron。Commands domain 和 Shell tool schema 不得出现 plugin ID 字段。

## 生命周期与权限

每个已授权 Shell execution 获得独立 endpoint/token 内部环境。token 在 prepared runtime `start()` 前无效；
父 execution terminal、stop、timeout、Agent run stop、conversation stop 或 App end 会撤销 token、abort 所有
invocation 并等待 lease 释放。Host 不把 token 写入 Agent 环境快照、Renderer、审计或普通工具结果；模型
主动执行 `env` 仍可能在本次 Shell 输出中看见它，因此安全边界是“仅当前 execution 可用的窄能力”，不是
对父 Shell 保密。

插件 `prepare` 只能解析 argv 和返回严格 access plan，不得接触 DB/worker。bridge 在 execute 前验证：

- internal data 只能声明 `none|required`，且必须继承父 Shell 的 internal-data permission；
- conversation files 只能声明 `none|write`，只读父 Shell 不得执行写入；
- external files、network、GUI 和 local IPC 固定为 denied。

## 协议

v1 使用 `127.0.0.1` 随机端口、固定 route、独立 token header 和有界 NDJSON frame。插件结果的
`stdout + stderr` 按 UTF-8 bytes 共用 8 MiB 上限，bridge 以 64 KiB raw byte 分帧；Rust client 逐帧读取并原样
写回 stdout/stderr，不为完整响应再分配一份 body。最终以插件 exit code 退出。超过总预算会返回独立的
`output_limit_exceeded`，不得伪装成未知 runtime failure。

Rust client 从自身文件名绑定 plugin ID，逐项传输 argv。结果预算属于 bridge v1 transport，插件领域命令不应
自行复制一份字符数上限；如需输出更大的资产，应写入已授权的 conversation files，再在 stdout 返回引用。
transport/协议失败使用独立稳定错误和 exit code 70，不能伪装成插件领域失败。

未知异常必须经过 `PluginCliBridgeDiagnosticPort`：对 CLI 只返回稳定的 exit code 70、泛化文案和安全关联号；
App Host 内部记录关联号、失败阶段、父 execution identity、plugin/invocation identity 与真实异常。
禁止把 argv、token、host context、异常栈或异常正文放进 bridge frame。权限拒绝、插件 unavailable 和取消属于
已知业务结果，不记为未知异常。

## 测试门禁

至少覆盖 token start 前/terminal 后拒绝、真实 stdout/stderr/exit code、权限在 DB/worker 前拒绝、父 Shell
取消 invocation 并等待清理、插件 draining，以及真实 native client 到 bridge 的端到端调用。launcher 测试还要
证明只清理 manifest 管理文件和旧 v1 已知 facade，不递归删除用户文件。
