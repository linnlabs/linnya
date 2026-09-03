# Conversation Execution Production Runtime

这里是 Linnya 对话执行 runtime 的唯一业务组合根。它创建 Commands owner、Profiled Code Sandbox scope、权限 authority 投影和插件 CLI launcher；不依赖 Electron，也不自行选择进程载体。

宿主必须显式注入 Command runner、Sandbox Utility fork、三档权限 authority、审批 host 与命令卡片 presentation host。生产只由 headless App Server composition 创建这些 owner；Electron Main 通过 typed RPC 连接，不能复制 owner。

Shell/Command Sandbox 与 Profiled Code Sandbox 只复用 local-process 的进程树机制，权限、审批、输出真源、profile 和业务终态保持分离。
