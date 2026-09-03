# Electron App Server Runtime

本目录是 Desktop Main 对独立 App Server 的 composition root。Main 只解析随包固定 Node、编码一次性
bootstrap、托管子进程生命周期，并注册 safeStorage、隐藏 Chromium worker、文本测量、PDF、OAuth browser
与 Web Read renderer 等窄 Desktop reverse RPC。Backend 业务、Commands owner 和 Sandbox owner 不在这里创建。

App Server 不继承 Electron Main 的环境。命令所需的完整宿主登录环境走独立 bootstrap contract；sidecar 自身只取得
声明过的系统与 Linnya 配置变量，明确排除 `ELECTRON_RUN_AS_NODE`、`NODE_OPTIONS` 等启动注入入口。

隐藏 worker 是高权限 Desktop 能力。Main 会解析 symlink 并要求 HTML 与 preload 都是非空文件，且同时位于同一个
已批准插件 artifact 根目录中；仅有“绝对路径”不构成授权。

窗口关闭前的“是否仍有命令运行”也通过独立 activity RPC 查询。它只返回布尔事实，不把 process handle、PID 或
Commands owner 内部状态暴露给 Main，并允许原有关闭确认编排直接等待真实 App Server 状态。
