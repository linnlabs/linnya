# Profiled Code Sandbox Production Runtime

这里是 Profiled Code Sandbox 的唯一 App Host 组合根。它负责一次性运行目录、mailbox、Utility ACK/terminal、结果严格重读和 owner 收口；不依赖 Electron，也不处理 Shell 的三档命令权限。

最外层宿主必须显式注入 `SandboxUtilityProcessForkPort`。生产 App Server 只使用固定 headless Node 的 `child_process.fork`；测试可以注入受控 fake。任何 composition 都不能创建第二个 Sandbox owner。

Evaluator 继续使用随包、校验过的 headless Node runtime，并由 Utility 内的公共 local-process owner 负责整棵进程树停止与资源释放。App 关闭必须等待 scope 的 `endOwnerAndWait()`，不存在退出后的后台任务。

## Utility 预热

`utilityPrewarm: { idleMs }` 开启后，scope 在一轮运行完全收口后预先 fork 一个 Utility，让它完成启动并停在 ready；下一轮直接对它发送 start，省掉 Node 启动与 bundle 装载（macOS 开发机实测空求值中位数 118→85 ms）。生产 App Server 开启，空闲 5 分钟后退役。

- 每个 Utility 仍只承接一轮：预热进程在 start 之前不接触任何请求、源码或运行目录，运行目录与 mailbox 仍在本轮 execute 时创建。
- 只保留一个预热槽位；首轮结束后才开始预热，未使用沙箱的 App 不常驻进程。空闲 Utility 约占 65 MB 常驻内存。
- 取用前用 `isStartable()` 确认进程仍可承接 start；已退出或失败的预热进程退役，本轮现场 fork。ready 前失败只让出槽位，下一轮收口后再尝试，不连续重试。
- 空闲到期与 `endOwnerAndWait()` 都先发 owner end 并等待退出，失败再强杀；owner 收口等待这些退役完成。

Evaluator 的启动环境由 runtime resolver 从 Host 注入的环境事实中收窄并冻结。macOS 保持空环境；
Windows 仅保留 `SystemRoot`，因为 Node/OpenSSL 的随机数初始化需要系统目录，完全清空会在
evaluator 入口执行前触发 CSPRNG abort。不得透传整个 Host 环境、凭据、`NODE_OPTIONS` 或命令 PATH。
