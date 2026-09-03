# Command Runtime

## 1. 作用和边界

`command-runtime` 是命令执行的跨平台基础设施，负责把已经冻结的 launch request 变成可观察的 pipe/PTY runtime，并把字节投影成 raw、Agent text 和 terminal screen。

它不负责：

- 权限档位和高风险规则；
- 对话目录准入；
- Agent 工具注册；
- SQLite/audit 写入；
- 平台进程树 owner 的具体实现；
- Sandbox workload capability。

平台树 owner 在 [local-process-runtime](../local-process-runtime/README.md)，业务编排在 [Command Host Adapter](../../../app-hosts/linnya/adapters/commands/README.md)。

## 2. 代码树

```text
src/infra/adapters/command-runtime/
├── environment/       用户环境、PATH、Shell profile 和编码快照
├── output/            raw artifact writer、decoder、parser、text sink
├── pty/               terminal transcript 和 headless screen
├── runner/             disposable runner、child protocol、owned lifecycle
├── platform-runtime/  platform launch DTO、失败分类、launcher
├── working-directory/ cwd file system port
├── macos/              SRT + PTY/pipe 的 macOS command wrapper
└── windows/            command 专属 PTY/native wrapper
```

目录不能按“方便 import”重新合并。`output` 不得导入 `runner`，`runner` 不得导入 permission feature，平台目录不得向 Commands domain 反向暴露 native 类型。

## 3. 公共进程合同

runtime 通过 `OwnedPipeProcess`、`OwnedProcessRootExit`、`OwnedProcessTreeStopResult` 和 `OwnedProcessResourceReleaseResult` 表达四类资源事实。上层只使用这些稳定合同，不直接看 `ChildProcess`、`Readable` 或 native binding。

### prepare/start/stop

```text
prepare: 创建内存 controller，不创建 OS 资源
start: open transport → fork Utility → start request → observe started
stop: 只对未收到可信 terminal 的 runtime 发送停止
settle: terminal + output + tree-empty + release
```

prepare 与 start 分开，是为了让 conversation delete 或 App owner end 能停止“已经被 owner 接管但尚未 spawn”的 runtime。

## 4. Pipe 和 PTY 必须分路

### 普通 pipe

- stdout/stderr 两条独立 Readable；
- 从启动开始关闭 stdin；
- 每条流独立 sequence、decoder、ANSI parser、CR logical line；
- raw artifact 保存两份 stream；
- Agent observation 返回稳定文本 delta 和 cursor。

### PTY

- terminal 单流；
- 支持 write、submit、eof、resize；
- raw artifact 保存 terminal transcript；
- parser 维护 screen grid、scrollback、样式 allowlist；
- Agent text 和 screen snapshot 独立投影。

不能为了共用代码，把 PTY 当成 stdout/stderr 的特殊名称，也不能让 PTY control 消息绕过普通 output backpressure。

## 5. Runner 消息和身份

每次 runner 使用 execution identity、owner generation 和 transport generation。所有消息需要验证：

- protocol version；
- execution identity；
- stream/mode 是否与 launch 一致；
- sequence 是否严格递增；
- observed bytes 是否与已接收字节一致；
- terminal 是否只能出现一次；
- close 是否只来自当前 Utility。

错误身份、重复 ACK、跳号、terminal 后 output 或 output 后错误终态都必须关闭接纳，并保留已确认前缀。不能因为消息“看起来像当前命令”就放宽校验。

## 6. Output 链

```text
platform Readable
  → synchronous accept / exact byte ownership
  → raw artifact writer
  → decoder
  → control sequence parser
  → stable logical line
  → bounded Agent text preview
  → ToolOutputStore writer
```

系统 pipe callback 到 `accept/offer` 必须同步完成准入，首个 `await` 之后才进入磁盘 I/O。这样慢盘不会堵住 Readable，且 byte 所有权不会因调用方复用 Buffer 而丢失。

默认 raw writer 预算是每 execution 1,024 events / 4 MiB pending；这不是命令总输出上限。超限后只熔断该 sink 接纳，仍继续读 pipe、计数和结算 terminal。

## 7. 文本投影

### decoder

每条流有自己的 UTF-8/Windows code page decoder，跨 chunk 保留残片，EOF 时仍要 flush decoder。不得把 stdout/stderr 先合并再解码。

### control sequence parser

parser 要处理分块的 CSI、OSC、DCS、CR、LF 和 backspace。OSC/DCS payload 不能无限缓存；不支持的控制序列按有限状态机丢弃或转成稳定文本，不能使用无界字符串 buffer。

### logical line

CR 表示覆盖当前行，LF 提交逻辑行；跨 chunk 的 CRLF 只能提交一次。preview 采用 UTF-16 surrogate 安全边界，head/tail 省略必须明确告诉 Agent。

## 8. PTY screen projection

`PtyScreenProjectionSession` 接口：

```text
write(transcriptBytes)
resize(columns, rows)
snapshot()
finalize(sourceCompletion)
```

snapshot 返回 `screen`、`agentText` 和 `stableText`；finalize 还返回 source completion。`resize` 先做 columns/rows 和 cell budget 校验，失败的操作不能污染共享 operations promise 链。

screen 只允许白名单样式、有限 scrollback 和有界 cell memory。Renderer 不能直接渲染原始 ANSI。

## 9. Host 文本 sink

ToolOutputStore 是 awaitable writer，但系统 pipe 不得直接等待它。host 为 stdout/stderr 各自维护 sink 状态：

```text
accepting → draining → complete
                    └→ incomplete / failed
```

首次 I/O 失败、队列超限或 manifest 发布失败后停止重试，保留共同提交前缀并把 Agent 引用标为 incomplete。raw artifact 完整性和命令终态不被文本 sink 改写。

## 10. Runner/Host 最终期限

- handshake deadline：Utility 必须在有限时间内到达 ready/started；
- hard timeout：命令的 immutable 总期限；
- close deadline：terminal 后 Utility 必须完成 close；
- host final deadline：started 后永久沉默时的最后介入窗口。

这些 timer 必须由 lifecycle owner 统一创建和清理。收到 terminal 后应由 close deadline 负责收尾，不能让 fork 起算的 host final timer 抢先改写真实终因。

## 11. 环境和 launch profile

environment adapter 生成 immutable snapshot：Shell semantics、version、executable、编码、PATH 选择、继承变量和平台 invocation profile。launch adapter 不在运行中重新探测环境。

审计只保存允许的稳定摘要，不保存秘密值。Shell 路径不能由 Agent 传入，Plugin CLI 的 host module resolver 也不能被这个 runtime 复用成任意 package loader。

## 12. 失败分类

| 代码 | 发生阶段 | 行为 |
| --- | --- | --- |
| `environment_unavailable` | spawn 前 | 不创建用户 child，关闭 runtime |
| `sandbox_denied` | spawn 前 | 返回平台拒绝 |
| `launch_payload_too_large` | spawn 前 | 不伪造 exit/drain |
| `launch_failed` | spawn 前 | owner 收口后拒绝 |
| `runtime_lost` | started 后 | 保留已收到输出，终态不可信 |
| `internal_failure` | 任意 | 记录诊断，不暴露 stack |

系统 errno、HRESULT、helper 文案只进入内部诊断；UI/Agent 使用稳定 code。

## 13. 资源释放不变量

释放顺序必须保证：

1. 停止接收新的 control/input；
2. 结束 source output；
3. 等待已接受 byte 的 writer settlement；
4. 等待树为空；
5. 释放 PTY/Job/PGID/Utility；
6. 清理 timer、listener、registry entry 和临时目录。

`Promise.race(timeout, release)` 不能直接返回“释放成功”，否则迟到的 close 会在卡片完成后继续修改磁盘和审计。

## 14. 维护和风险

- 不新增第二个 output writer 或第二个 process owner；
- 不把 queue 放到 ToolOutputStore 内部；
- 不将 raw bytes base64 塞进 Agent result；
- 不在每个平台单独实现一套 terminal state machine；
- 不用 process name、PID 或 taskkill 作为生产归属依据；
- 不在 Electron main 直接加载平台 native/PTY 依赖；
- 不用测试 fake child 的 `exit` 证明 packaged Utility 已正确释放。

## 15. 测试矩阵

- runner：握手、ACK、generation、terminal/close、host final deadline、Utility crash；
- output：双流、UTF-8、CRLF、ANSI、DCS/OSC、慢 sink、4 MiB/1024 budget、前缀恢复；
- PTY：screen、resize budget、write/submit/eof、自然退出和取消；
- environment：GUI PATH、登录探测、Shell 版本、编码和敏感变量；
- platform：macOS process group、Windows Job/native loader、普通用户和外部进程树观察；
- packaged：真实 Electron Utility、runAsNode=false、asar/unpacked 路径、签名发布门。

## 16. 核心文件

| 文件 | 责任 |
| --- | --- |
| `runner/orchestration/createDisposablePipeCommandRun.ts` | pipe 一次性 run |
| `runner/orchestration/createDisposablePtyCommandRun.ts` | PTY 一次性 run |
| `runner/shared/ownedCommandLifecycle.ts` | 终态与 tree/release 协调 |
| `output/functions/createBoundedPipeCommandOutputObservation.ts` | 有界 raw/output observation |
| `output/orchestration/createPipeCommandTextProjectionSession.ts` | decoder→parser→logical line→preview |
| `pty/orchestration/createPtyScreenProjection.ts` | PTY screen session |
| `environment/functions/buildShellEnvironmentSnapshot.ts` | 环境快照 |
