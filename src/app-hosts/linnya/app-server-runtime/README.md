# Linnya App Server Runtime

本目录是 headless Node App Server 的 production composition root。它只消费严格 bootstrap、双向 RPC port 与
AppData 私有 mailbox 根；不导入 Electron，也不读取 PATH、`process.execPath`、`process.resourcesPath` 或可变环境袋。

Host 解析生产启动计划时先创建 AppData 根，再将其作为固定 Node 的 cwd。全新安装不能依赖旧数据目录存在，
也不能把 cwd 的创建推迟到尚未启动的 Backend；目录创建失败应直接上报启动错误。

这里创建当前 App 唯一的命令权限 authority、审批 host 与命令卡 control host，并把它们同时交给 Conversation
production runtime 和 typed Renderer RPC handlers。Command runner 与 Profiled Code Sandbox evaluator 使用 Main 已验证并
通过 bootstrap 传入的固定 Node executable；Qdrant、Queue Worker 与普通进程树 owner 也只消费冻结事实。

`runLinnyaAppServerProcess` 可在独立开发产物中显式注入 typed composition factory；正式 entry 使用默认 factory。该接缝只替换依赖组合，不增加第二条启动、协议或 Agent 执行链。

Renderer projection、hidden worker、Browser Pretext、raster PDF、OAuth browser 与 Chromium Web Read 都通过
各自的窄 reverse RPC client 注入 Backend。插件和业务代码看不到 RPC peer、Electron 对象或任意 Desktop method table。

bootstrap 的 `host_kind` 只在 composition root 选择投影 presenter：Desktop 使用已验证 Renderer page，交互式 CLI Runtime 使用独立 Host presenter RPC。两者共享唯一 command approval owner、pending 与 settlement；CLI 不伪造 Renderer sender/page ticket。无 TTY 时 Host 不声明审批 presenter，命令权限层 fail closed。

构建产物分成 tiny `app-server-entry.cjs` 与完整 `app-server-backend.cjs`。tiny entry 在动态加载 Backend 前先把全局
console 固定到 stderr，保证任何模块初始化日志都不能污染 lifecycle stdout；fd 3/4/5 之外不复用命令行或 Renderer IPC。
bootstrap 同时冻结直接 parent PID。stdio/RPC EOF 是正常 parent-death 信号；平台未及时投递 EOF 时，App Server 的 parent-liveness monitor 会触发同一 shutdown，并关闭失联对端的残余 pipe，避免 launcher 被 `SIGKILL` 后留下半死 Backend。
正常关闭在业务收口、释放 Workspace owner 和发送 control ACK 后，继续读完 RPC，等待 parent
接收 ACK 并关闭写端；两个 pipe 没有跨管道的到达顺序保证，提前销毁读端会让迟到响应产生 EPIPE。
parent-liveness monitor 保留到该传输收口屏障结束，保证 parent 在关停期间崩溃也能完成退出。

凭据文件由本 composition 创建，模型、OAuth、插件和 Web 设置共享一个窄 storage port。路径使用
已冻结的 profileRoot，与 Workspace 分离。读写、权限、并发和故障合同见[文件凭据存储](../../../infra/adapters/credential-storage/file/README.md)。
