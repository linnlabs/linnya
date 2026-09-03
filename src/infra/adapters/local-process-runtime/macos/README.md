# macOS Local Process Runtime

## 1. 实现目标

macOS adapter 为一次命令创建独立进程组，并用系统策略和 owner pipe 保护启动与清理。它向上层提供统一 `OwnedPipeProcess`，不把 PGID、child PID 或 SRT policy 暴露给 Commands domain。

## 2. 启动步骤

1. 校验 Shell executable、argv、cwd、环境和 SRT policy。
2. 启动 owner wrapper，建立 stdout、stderr、owner pipe、ready pipe 和 start gate。
3. wrapper 输出 ready marker，主进程确认资源数量和类型。
4. owner 记录 process group 并发出 gate release。
5. 真实 zsh/命令开始运行。

如果 owner pipe、ready marker、start gate 或资源类型缺失，启动整体失败；不能只使用 `child.stdout` 继续运行。

## 3. 进程组终止

- normal exit：先等待 root close，再等待 process group empty。
- user cancel：发送 TERM，等待有限窗口，仍存活才 KILL。
- hard timeout：记录 timed_out，再执行同样的整组清理。
- App owner end：停止所有属于 conversation/App owner 的 execution。
- `ESRCH` 表示目标已经不存在；`EPERM`、未知错误和观察超时不能默认为成功。

进程组空不等于输出已排空，输出 reader 和 raw/text sink 仍需单独 settlement。

## 4. SRT/文件边界

SRT/Seatbelt 是 macOS 的强制文件边界，策略创建和 spawn 失败时必须 fail closed。该 adapter 不根据命令字符串猜测路径，也不负责把 Workspace VFS 转成磁盘权限。

权限档、内部数据开关和审批原因由 Commands domain 冻结后传入；平台 adapter 只执行已经决定的 policy。

## 5. PTY 关系

显式 PTY 使用独立 `createMacOsSandboxedOwnedPtyCommandProcess` 路径，仍复用进程组/owner 的终态合同。PTY listener、Readable、native fd 和 screen parser 必须在 finalize 的 `finally` 中释放，release 失败要可重试或显式报告。

Sandbox evaluator 使用同一个 pipe owner，但 executable 是随包签名的无界面 Node CLI，不是
Linnya/Electron GUI Main。Node 必须成为独立 PGID root；Utility 被强杀后 owner pipe 关闭，
整组仍需归零。LaunchServices 不应为 evaluator 注册 App identity。

## 6. 风险

- root exit 后后代仍可能存活；不能以 `exit` 结算；
- SRT 不可用时回退裸 zsh 会形成严重安全回退；
- `EPERM` 被吞掉会让删除屏障提前放行；
- PTY resize/close race 会触碰失效 fd；
- GUI 启动缺少 PATH 时不能从 App host `process.env` 盲目继承。

## 7. 测试

必须覆盖真实 Electron Utility、macOS SRT、zsh 登录环境、三层进程树、PTY、8 MiB 背压、cancel/timeout、App end 和签名包形状；Sandbox 还要覆盖随包 Node 的 PGID、签名、Utility crash 清理和无 LaunchServices App identity。只在 Node 中 mock `spawn` 不能证明本 adapter 正确。
