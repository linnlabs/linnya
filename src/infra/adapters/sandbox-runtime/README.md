# Sandbox Runtime Infrastructure

这里放 Profiled Code Sandbox 的物理进程 adapter，不拥有 profile、capability、结果投影或 Commands 权限。

`local-process/child/sandboxUtilityProcess.ts` 同时接受 Electron Utility `process.parentPort` 与 Node child IPC，但一次运行只会绑定其中一种父通道；协议、ACK 和 terminal 完全相同。`createNodeSandboxUtilityProcessFork` 使用显式绝对路径的 headless Node、空 `execArgv`、无窗口配置和一次性 IPC child，不读取 PATH 或回退 Electron 主可执行文件。

真正的 evaluator 仍由 Utility 内的公共 local-process owner 启动，App Host 只有在 output drain、tree empty、resource release 和运行目录清理都完成后才公开终态。
