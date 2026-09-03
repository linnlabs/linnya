# Process Control Feature

## 1. 作用

`process-control` 定义 Agent `process` 工具、execution owner、opaque handle、运行中观察和唯一终态。它解决的是“如何继续找到并控制一条已经启动的命令”，不是“如何启动平台进程”。

## 2. process 输入

`ProcessToolArgumentsV1` 只有两个字段：

```text
process_handle: opaque string
action: ProcessControlActionV1
```

conversation、agent run、control tool call 和 owner generation 由当前 ToolContext/host 补齐，模型不能伪造这些身份。

动作结构：

| 字段 | 适用动作 | 约束 |
| --- | --- | --- |
| `type` | 全部 | poll/wait/cancel/write/submit/eof/resize 之一 |
| `cursor` | poll/wait | 非负、属于同一 execution 的观察版本 |
| `wait_timeout_ms` | wait | 只限制本次观察，不改 hard timeout |
| `input` | write/submit | UTF-8 byte 有界；write 不自动回车 |
| `columns`/`rows` | resize | 1..32767，且 PTY projection 还有 cell budget |

## 3. handle 解析顺序

```text
current conversation/run scope
  → owner binding
  → process_handle
  → action capability
  → current state
  → control operation
```

禁止先从全局 registry 找到 handle，再比较 conversation。这样可以防止一个对话中的 Agent 使用另一个对话的 handle。

## 4. owner 状态

```text
reserved
  ├─ invalidated / owner_ended
  └─ prepared
       ├─ stopping_before_start
       └─ started
            ├─ running
            ├─ stopping
            ├─ terminal_received
            └─ releasing
                  └─ replayable_terminal / forgotten
```

状态不是 UI 文案，而是控制动作的准入条件。每个状态要明确允许/拒绝哪些操作：

| 状态 | poll/wait | cancel | PTY action | publish handle |
| --- | --- | --- | --- | --- |
| reserved | 拒绝/尚未可观察 | 允许 owner end | 拒绝 | 尚未公开 |
| prepared | 拒绝 | 允许 | 拒绝 | 尚未公开 |
| running | 允许 | 允许 | 仅 PTY 允许 | 已公开 |
| stopping | 允许读取已接收输出 | 幂等复用 stop promise | 拒绝新输入 | 已公开 |
| terminal_received | 只允许读终态/replay | 不再发送 stop | 拒绝 | 已公开或 discard |
| forgotten | 拒绝 | 拒绝 | 拒绝 | 不存在 |

## 5. reservation 和 prepared runtime

### reserve

命令入口在 conversation admission callback 返回前完成 reservation。reservation 只保存业务身份、权限、mode 和生命周期状态，不创建 child、pipe、PTY 或文件 writer。

### prepareRuntime

准备 runtime 是同步 handoff：owner 先取得一个可 stop 的内存 runtime，再允许 `start()`。这样删除或 owner end 发生在 starting 阶段时，不会出现已 spawn 但无人负责。

### claimAndStart

`claimAndStart` 必须原子绑定 owner generation、runtime 和 execution identity。任何 setup 抛错都先结算 runtime resource，再向上返回错误。

## 6. publish/discard 竞态

短命令可能在 handle 公开之前就已经完成：

```text
start → terminal → output settled → discard
start → started → publish handle → running
```

只有收到可信 `started` 且 runtime 尚未 terminal 时才 publish handle。不能先返回一个可能已经失效的 handle 再靠 process.poll 修正。

## 7. 非消费式 observation

运行中输出由已有文本 projection 产生稳定 delta。cursor 是 execution 内版本，不是共享读指针：

- 两个 Agent 用同一 cursor 不会互相吞输出；
- cursor 落后于有界窗口时返回 omitted/overrun 事实；
- poll 立即返回，不等待磁盘；
- wait 只等待新输出或终态，不能改变命令 hard timeout；
- observation 不拥有 terminal、raw artifact 或平台资源。

stdout/stderr 保持独立，CR 当前行是快照，不能把“当前行”当作已经收到 newline 的完整记录。

## 8. control 动作

### cancel

cancel 进入当前 owner scope 后共享同一个 stop promise。并发 cancel 只能产生一个平台停止请求；先完成的真实 terminal 赢，迟到的 timeout/cancel 回调不能覆盖它。

### write/submit/eof/resize

这些动作要求 binding mode 为 `pty`，并经过同一 execution 的交互门串行化。输入写入失败返回稳定 `stdin_closed`、`incompatible_state` 或 `stale`，不能让异常穿过 IPC 让 Renderer 崩溃。

用户保护输入不经 Agent schema，但最终仍使用同一 owner binding 和 action gate；它不会获得绕过 owner 的特殊权限。

## 9. 终态和资源释放

owner 收到 runtime terminal 后仍要等待：

1. 双流/PTY source 已完成或中断；
2. raw artifact 和文本 sink settlement；
3. tree empty；
4. platform resource release；
5. durable card/audit sidecar 写入。

失败也必须有唯一 terminal。`runtime_failure` 表示运行事实无法可信获取；`resource_release_failed` 表示资源释放失败，不能把原始 `timed_out` 或 `user_cancelled` 改写掉。

## 10. 删除和 App end

对话 cleanup job 建立时，owner 立即写入 stopping tombstone：

- 迟到 `claimAndStart` 拒绝；
- 迟到 process action 拒绝；
- 已启动 execution 继续进行有限清理；
- 删除流程等待 owner stopAndWait 和 output settlement。

App end 使用同一 owner end 合同。Renderer 销毁不等于 owner end；主进程必须主动调用 endOwner，并让所有 pending approval/control/observation 以稳定结果结束。

## 11. 风险清单

- 只保存 child exit 会造成“卡片完成但后代还活着”；
- 先释放 owner entry 再保存 terminal 会让删除流程看不到活动；
- replay registry 无上限会把输出内存泄漏换成 tombstone 泄漏；
- Windows PTY 自然退出到 tree-empty 之间仍允许 resize，会触碰 native 对象；
- wait 的 timer 与 hard timeout 共用会误杀长命令；
- stop promise 不记忆化会重复 kill、重复审计和重复释放。

## 12. 核心文件

| 文件 | 责任 |
| --- | --- |
| `definitions/processOwnerState.ts` | owner 状态和生命周期字段 |
| `definitions/processControlAction.ts` | action schema |
| `functions/acceptProcessAction.ts` | 状态和 action 准入 |
| `functions/advanceProcessTerminalState.ts` | 终态竞争仲裁 |
| `functions/evaluateCommandExecutionStopRelease.ts` | 删除/退出是否可放行 |
| `ports/commandExecutionOwnerPort.ts` | App Host owner port |
| `src/tools/commands/process/ProcessTool.ts` | Agent 入口和结果 allowlist |
| `src/app-hosts/linnya/adapters/commands/process-owner` | 生产 owner 编排 |

## 13. 测试矩阵

- scope-first handle lookup；
- starting 期间 cancel/delete；
- terminal 与 timeout/cancel 竞态；
- root exit、double EOF、tree empty、release 分离；
- poll cursor、omitted、多个观察者；
- PTY action ordering、stdin closed、resize race；
- owner end、App quit、对话 delete、跨重启 replay；
- macOS PGID 和 Windows Job 的外部进程归零。
