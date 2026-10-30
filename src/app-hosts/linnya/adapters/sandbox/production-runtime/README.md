# Profiled Code Sandbox Production Runtime

这里是 Profiled Code Sandbox 的唯一 App Host 组合根。它负责一次性运行目录、mailbox、Utility ACK/terminal、结果严格重读和 owner 收口；不依赖 Electron，也不处理 Shell 的三档命令权限。

最外层宿主必须显式注入 `SandboxUtilityProcessForkPort`。生产 App Server 只使用固定 headless Node 的 `child_process.fork`；测试可以注入受控 fake。任何 composition 都不能创建第二个 Sandbox owner。

Evaluator 继续使用随包、校验过的 headless Node runtime，并由 Utility 内的公共 local-process owner 负责整棵进程树停止与资源释放。App 关闭必须等待 scope 的 `endOwnerAndWait()`，不存在退出后的后台任务。

Evaluator 的启动环境由 runtime resolver 从 Host 注入的环境事实中收窄并冻结。macOS 保持空环境；
Windows 仅保留 `SystemRoot`，因为 Node/OpenSSL 的随机数初始化需要系统目录，完全清空会在
evaluator 入口执行前触发 CSPRNG abort。不得透传整个 Host 环境、凭据、`NODE_OPTIONS` 或命令 PATH。
