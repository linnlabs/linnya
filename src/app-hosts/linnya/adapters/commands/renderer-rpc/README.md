# Command Renderer RPC

此模块连接 App Server 中唯一的命令权限、审批与命令卡 owner，以及 Electron Main 中现有 Renderer IPC。它只暴露稳定页面 DTO 和用户动作，不传 PID、进程对象、环境变量、完整 command owner 或任意方法名。

Main→App Server 方法覆盖设置读取/更新、审批页面 open/read/invalidate/reply、命令卡页面 open/read/invalidate、取消和受保护输入。App Server→Main 只发送两种 `changed` 信号；Main 收到后按当前 page ticket 重新读取严格快照并投影到原 Renderer channel，因此 UI 数据源、卡片、审批与 reload 语义不变。

卡片变化发布器最多保留一个 in-flight 请求和一个 dirty bit。它不会因 PTY/terminal 变化无限堆积 RPC pending；断线失败交给 App Server/Desktop supervisor，不能回退到 Main 内启动第二套 Backend。
