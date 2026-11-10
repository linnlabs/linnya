# Linnya Backend Runtime Host Contract

本目录定义 Backend 业务 owner 与外层 Host 之间的启动合同。`BackendBootstrapFacts` 只包含冻结、可序列化的数据；`BackendHostDependencies` 组合现有业务端口与可选宿主能力（凭据文件存储、Renderer 投影、插件隐藏 Renderer worker 的 data-only host、Browser Pretext 文本测量、外部授权浏览器与 raster PDF），但不暴露 Electron 对象、Renderer、环境变量袋或任意进程控制。插件 hidden worker 的 codec 与同步 registry 在 Backend composition 内组装，不属于 Desktop 依赖。

Backend 只存在一套业务启动链：Desktop Electron Main 或源码 CLI Runtime 监督固定 headless Node，App Server 在独立进程中调用 `initializeAppServerBackend` 创建唯一 Backend owner。旧同进程入口、生命周期 facade、Renderer 不可达的启停 IPC 和宽配置对象已经删除。App Server bundle 不加载 Electron runtime；启动事实通过严格 bootstrap 数据进入 headless Node。Desktop 通过窄反向 RPC 提供完整能力，CLI Runtime 只提供终端命令审批及明确支持的 Node 能力；缺少 Chromium、PDF raster、系统 reveal、OAuth browser 或 Desktop export 时显式报告 unavailable。

`processRuntime` 只包含 Backend 自己拥有的 Qdrant、owned pipe launcher 与队列 Worker 运行依赖。它与对话 `conversationExecutionRuntimeFactory` 都由最外层 composition 注入；这样 App Server 可以选择纯 Node adapter，而无需在 Backend 入口里按宿主类型分支或读取 `process.env`。

可选 `agentToolEnvironment` 是 composition 的窄进程内端口，包含配套 ToolRuntime、ToolManager 和 physical file reader。路由将同一组合传给根模型、工具执行、child 和 CLI 工具用例；未提供时保持默认装配。它不进入 bootstrap，不承载具体实验政策，也不按 Agent 身份改变通用工具行为。

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

`commandApprovalControl`接入唯一Commands审批owner的窄控制端口。API Server在鉴权bridge就绪后注册可用性、关闭时撤销；不将Renderer票据、TTY或任意执行能力注入CLI。

可信知识库 Worker 通过独立入口 `workerModelServices.ts` 在自己的运行域调用 `initializeWorkerModelServices`，使用 owner 传入的
`profileRoot` 打开与 App Server 相同的凭据存储，安装模型端点与 Provider OAuth 端口。
任务消息只传路径事实，不传 Key/token；OAuth 更新复用同一原子写入合同。
此入口不能从轻量启动合同 `index.ts` 重导出，否则会把模型 SDK 和业务 owner 打进 CLI 父宿主。

延迟启动维护由 ServiceInitializer 创建并交给 Backend owner 收口：退出先取消尚未触发的延迟及 Qdrant 重试等待，
已开始的单次存储维护必须完成后才释放队列和 Qdrant。初始化中途失败也执行同一收口，避免关停 ACK 后仍有后台定时器存活。
Workspace 与会话维护不依赖知识库；知识库没有启动时只跳过知识库一致性清理。

## 启动步骤分两类

只有必需步骤失败才挡启动，由 Desktop 的[启动失败对话框](../../../electron-main/app-lifecycle/README.md)说明原因：
打开数据库、版本准入与 Host 迁移；读取运行保留集（到期清理要靠它保护可恢复的运行）；受管图片目录绑定；
插件运行资源同步（失败来自内建注册或文件系统，路由注册依赖同一份注册表，跳过它没有意义）；API server。
受管图片、命令输出、工具输出三项启动清理各自吞下失败、下次启动再跑，仍在开放写入前结束。

其余能力失败时只停掉这项能力，App 照常 ready（`ServiceInitializer` 的 `capabilityFailures`，
本 owner 的 `getStartupCapabilityFailure`）。不新增全局状态机或降级模式，失败的能力在自己的入口返回“不可用＋原因”，
诊断日志各记一条：

| 能力 | 失败时 | 入口说明 |
| --- | --- | --- |
| `knowledge-base`：Qdrant 进程、适配器与知识库服务 | Qdrant 没起来时收口已拉起的进程，整组跳过，不回退到默认地址 | 知识库 IPC 与 `/api/v1/knowledge-base` 返回原因；会话照常可用，知识库工具说明不可用 |
| `background-tasks`：任务队列与图谱编排 | 收掉已建好的队列 | 知识库导入、长音频预处理返回原因；退出前不再查询导入任务 |
| `models`：模型目录、Provider 配置与两项配置迁移 | 未初始化的注册表拒绝写入，不覆写已有配置文件；路由装配跳过启动刷新 | 模型、选择器、账号与三种接入入口统一返回 503 和原因 |

队列内部初始化失败由 `QueueManager` 回收；队列已就绪后，图谱编排装配失败由 `ServiceInitializer` 等待队列关闭，再交给外层记录能力不可用并继续启动。

项目知识库关联与转写服务只是构造对象、不会失败，不单独归类。
