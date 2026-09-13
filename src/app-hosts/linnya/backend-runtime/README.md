# Linnya Backend Runtime Host Contract

本目录定义 Backend 业务 owner 与外层 Host 之间的启动合同。`BackendBootstrapFacts` 只包含冻结、可序列化的数据；`BackendHostDependencies` 组合现有业务端口与可选宿主能力（凭据保护、Renderer 投影、插件隐藏 Renderer worker 的 data-only host、Browser Pretext 文本测量、外部授权浏览器与 raster PDF），但不暴露 Electron 对象、Renderer、环境变量袋或任意进程控制。插件 hidden worker 的 codec 与同步 registry 在 Backend composition 内组装，不属于 Desktop 依赖。

Backend 只存在一套业务启动链：Desktop Electron Main 或源码 CLI Runtime 监督固定 headless Node，App Server 在独立进程中调用 `initializeAppServerBackend` 创建唯一 Backend owner。旧同进程入口、生命周期 facade、Renderer 不可达的启停 IPC 和宽配置对象已经删除。App Server bundle 不加载 Electron runtime；启动事实通过严格 bootstrap 数据进入 headless Node。Desktop 通过窄反向 RPC 提供完整能力，CLI Runtime 只提供凭据、终端命令审批及明确支持的 Node 能力；缺少 Chromium、PDF raster、系统 reveal、OAuth browser 或 Desktop export 时显式报告 unavailable。

`processRuntime` 只包含 Backend 自己拥有的 Qdrant、owned pipe launcher 与队列 Worker 运行依赖。它与对话 `conversationExecutionRuntimeFactory` 都由最外层 composition 注入；这样 App Server 可以选择纯 Node adapter，而无需在 Backend 入口里按宿主类型分支或读取 `process.env`。

App Server bootstrap 使用独立 fd 3 一次性 pipe，不进入 argv 或 lifecycle stdout。帧包含严格 Backend 配置、
`BackendBootstrapFacts`（含 `source / community / official` 发行身份）、Host 在内部环境写入前捕获的 Command host environment 与测量开关；child 完整校验后才可
启动 owner。lifecycle `ready` 必须在 Conversation routes 已挂载后返回真实 API port、renderer token、应用版本与数据库 ready 事实，不能用空 sidecar、部分路由或“进程仍存活”替代业务就绪。

发行身份由 Electron Main 验证并经 bootstrap 传入，Backend 只安装一次只读事实。它不能读取
`LINNYA_DEV_MODE`、`NODE_ENV` 或 `packaged` 自行推导官方身份；稳定合同见
[`shared/distribution-identity`](../../../shared/distribution-identity/README.md)。

Backend 的 start、stop、ready、health 和配置生命周期只属于 App owner。Renderer 不拥有启停或重启 Backend 的 IPC；前端只消费已经过认证的业务 HTTP/SSE 与明确的 Desktop capability。

Provider Onboarding 的账号模型同步 lifecycle 在路由装配时注册到本 owner，本地恢复和 route admission 完成后启动，
远端模型发现不阻塞 ready。关闭时先发出取消并停止接收新请求，等待同步和已开始的单条目录事务结束后再释放业务服务。
这项生命周期是具体用例的窄合同，不扩展为通用后台任务 registry。

App Server 在启动维护前取得 [Workspace 排他运行锁](./features/workspace-ownership/README.md)，
成功收口或进程退出时释放；同一 Workspace 不能同时有两个 Desktop/CLI 执行 owner。

数据库启动事实只携带当前受管运行路径。bootstrap 不传旧 Workspace 迁移专用的 Desktop userData 根，
Backend 不安装旧数据路径 registry，也不从当前路径推导旧文件来源。数据库版本准入由 DatabaseService 负责。

App Server 同样安装 event-loop 响应性 monitor。健康采样不刷日志，只有 p99/max 越过 Backend 阈值才记录结构化告警；CPU 密集型业务必须进入 feature-owned Worker，不能因为已经离开 Main 就在 App Server 事件循环同步执行。
