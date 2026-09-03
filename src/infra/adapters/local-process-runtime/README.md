# Local Process Runtime

## 1. 目标

`local-process-runtime` 是 Linnya 的平台进程树 ownership 层。它解决“本次命令以及所有后代由谁负责、怎样停止、怎样证明树为空、何时释放平台资源”，并向 Command Runtime 和 Sandbox 提供统一的 `OwnedPipeProcess` 能力。

它不是文件沙箱，不判断命令风险，也不向 Agent 暴露平台句柄。

## 2. 公共接口

上层使用 `shared/process-runtime` 定义的窄接口：

```text
launch(options) → OwnedPipeProcess
rootExit: Promise<OwnedProcessRootExit>
stdout / stderr: Readable
stopAndWaitForTreeEmpty() → Promise<OwnedProcessTreeStopResult>
releaseAfterTreeEmpty() → Promise<OwnedProcessResourceReleaseResult>
```

每个平台必须区分：

- root process exit；
- output EOF；
- tree empty；
- release success/failure。

“root exit”只说明根退出，不能证明后代结束；“kill request sent”只说明发送了请求，不能证明树为空。

## 3. ownership 原则

平台资源只能由创建它的 disposable runtime 持有：

- Main/domain 只保存 identity 和 port；
- Utility/runner 持有 pipe、PTY、Job、PGID、native binding；
- owner 只等待 stable facts，不猜 PID 或进程名；
- runner 关闭时才释放平台资源。

这样做是为了让 App 崩溃、Utility 强杀、命令取消和对话删除都能走同一套资源收口，不让 Electron main 留下长期 native 状态。

## 4. 启动屏障

启动不是简单的 `spawn()`：

1. 校验 launch snapshot 和平台 runtime manifest；
2. 创建 owner wrapper、pipe 和 tree accounting；
3. 在用户代码执行前完成平台归属；
4. 等待 owner/observer ready；
5. 再释放 start gate 让 Shell 或 Sandbox evaluator 运行；
6. 将 root、stdout/stderr 和 tree observer 交给上层。

启动任何一步失败都必须关闭执行并等待已经创建的资源；不能因为“用户 child 还没跑”就跳过 cleanup。

## 5. macOS 和 Windows 的共同合同

共同提供：

- 普通 pipe 的 stdout/stderr 双流；
- owner end/abort；
- root exit observation；
- tree stop 和 tree-empty 等待；
- release after tree empty；
- bounded startup/close deadlines；
- 外部可观察的资源终态。

共同不提供：

- 文件读写权限决策；
- 网络过滤；
- 高风险规则；
- PTY screen 业务投影；
- Agent handle registry。

## 6. macOS implementation

入口：[macOS README](./macos/README.md)。核心是 PGID/process group 和系统策略：

- root wrapper 创建独立进程组；
- owner pipe 用于结束整组；
- TERM 后观察组是否为空，必要时 KILL；
- `ESRCH` 可表示目标已消失，`EPERM` 不能静默当成功；
- SRT/Seatbelt 失败时返回 `sandbox_denied`/`sandbox_unavailable`，不裸跑。

## 7. Windows implementation

入口：[Windows README](./windows/README.md)。核心是 Job Object：

- CreateProcess 后尽早加入 Job；
- KILL_ON_JOB_CLOSE 作为最后释放保障；
- root exit 与 Job tree empty 分开观察；
- Job/process/thread/pipe handle 由 native owner 持有；
- native loader 必须验证 manifest、版本、架构、hash 和发布者。

Windows 使用普通用户权限，Job 不是文件系统沙箱。权限体验由 Commands authorization 和 UI 负责。

## 8. 背压和输出

平台输出进入 Node Readable 后必须尊重下游 backpressure。native callback 不能在缓冲已满时继续无限拉取；destroy 后到达的在途 byte 要按取消语义处理，EOF 后再来的 byte 才是协议错误。

平台层不保存全文。raw writer、decoder 和 ToolOutputStore 位于 Command Runtime/Host output 层，各自拥有容量和失败状态。

## 9. 终止和清理

终止流程统一为：

```text
request stop
  → stop root/whole tree
  → observe tree empty
  → close stdin/output source
  → release Job/PGID/native/PTY
  → resolve release barrier
```

自然 root exit 时仍要观察后代。用户 cancel、hard timeout、owner end、Utility crash 和 App quit 只能改变 termination cause，不能跳过 tree/release。

## 10. 失败分类

| 失败 | 说明 |
| --- | --- |
| startup cleanup failed | 创建平台资源后启动失败，必须保留 cleanup 事实 |
| process owner unavailable | 无法证明资源归属，禁止执行 |
| tree cleanup failed | 停止请求后仍无法确认后代消失 |
| resource release failed | tree 已空但 Job/PGID/native release 失败 |
| runtime lost | Utility/transport 失联，事实不完整 |

失败不能通过 fallback 变成裸 child，也不能通过固定 sleep 假装资源释放成功。

## 11. 兼容性和发布

- macOS 生产包需要真实 Electron Utility、SRT、PTY 和签名环境。
- Windows 支持 Win10 22H2 x64、Win11 x64；x64 包在 ARM64 兼容层运行不等于原生 ARM64 包。
- VC Runtime、NSIS、native `.node`/DLL、manifest 和 publisher identity 都是发布门。
- Sandbox 是该 owner 的窄消费者：随包 Node evaluator 仍走 macOS PGID / Windows Job，
  不在本层增加专用 kill 分支；Node runtime 与 evaluator bundle 的 catalog、hash、签名和路径
  由 Sandbox production composition/build 门禁负责。
- Docker/虚拟机可以验证部分协议和普通进程行为，不能替代 macOS SRT、Windows Job、真实 Electron 打包和干净安装包测试。

## 12. 关键文件

| 文件 | 责任 |
| --- | --- |
| `platform-runtime/definitions/localProcessPlatformRuntime.ts` | host-safe 平台 DTO |
| `production-runtime/createLocalProcessPlatformLauncher.ts` | 不含业务语义的平台 pipe owner 组合根 |
| `macos/createMacOsProcessGroupOwnedPipeProcess.ts` | macOS pipe owner |
| `macos/functions/ownedMacOsProcessGroup.ts` | PGID signal/tree-empty |
| `windows/createWindowsJobOwnedPipeProcess.ts` | Windows Job pipe owner |
| `windows/functions/loadVerifiedWindowsNativeRuntimeModule.ts` | native manifest 信任 |
| `windows/functions/parseWindowsOwnedPipeNativeEvent.ts` | native 事件严格解析 |

## 13. 测试门禁

- 三层进程树自然退出后仍有后代；
- cancel/timeout/owner end 的 tree-empty；
- stdout/stderr 背压和 8 MiB/128 MiB 压力；
- spawn/observer/native loader 失败；
- Utility 强杀后没有残留 child；
- Windows 普通用户、Job 归属、native hash/publisher；
- macOS SRT 拒绝、PGID ESRCH/EPERM、PTY close；
- packaged App 和干净发布矩阵。
