# Linnya App Server Runtime

本目录是 headless Node App Server 的 production composition root。它只消费严格 bootstrap、双向 RPC port 与
AppData 私有 mailbox 根；不导入 Electron，也不读取 PATH、`process.execPath`、`process.resourcesPath` 或可变环境袋。

这里创建当前 App 唯一的命令权限 authority、审批 host 与命令卡 control host，并把它们同时交给 Conversation
production runtime 和 typed Renderer RPC handlers。Command runner 与 Profiled Code Sandbox evaluator 使用 Main 已验证并
通过 bootstrap 传入的固定 Node executable；Qdrant、Queue Worker 与普通进程树 owner 也只消费冻结事实。

credential、Renderer projection、hidden worker、Browser Pretext、raster PDF、OAuth browser 与 Chromium Web Read 都通过
各自的窄 reverse RPC client 注入 Backend。插件和业务代码看不到 RPC peer、Electron 对象或任意 Desktop method table。

构建产物分成 tiny `app-server-entry.cjs` 与完整 `app-server-backend.cjs`。tiny entry 在动态加载 Backend 前先把全局
console 固定到 stderr，保证任何模块初始化日志都不能污染 lifecycle stdout；fd 3/4/5 之外不复用命令行或 Renderer IPC。
