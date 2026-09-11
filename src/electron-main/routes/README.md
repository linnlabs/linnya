# App Server HTTP Routes

本目录是 App Server 的 Express route adapter 与当前路由组合入口。它仍物理位于 `src/electron-main/routes/`，但生产代码只在 headless App Server 进程运行；Electron Main 不挂载这些路由，也不拥有 HTTP/SSE、业务服务或数据库。

后端总导航见 [`src/README.md`](../../README.md)，App Server 生产组合根见 [`src/app-hosts/linnya/app-server-runtime`](../../app-hosts/linnya/app-server-runtime/README.md)。

## 负责与不负责

本目录负责：

- 把 HTTP method/path 映射到已经存在的 domain 或 App Host use case；
- 解析请求、调用正式接口，并把结果或错误序列化为稳定响应；
- 在 `index.ts` 组合当前路由，报告 Conversation 等关键 route family 是否成功挂载；
- 为上传、SSE、预览和仅开发环境端点声明各自的传输约束。

本目录不负责业务规则、数据库查询规则、Provider 协议、Agent loop 或 Renderer 状态。Router 不应自行创建另一个业务 service、绕过 public contract 直接跨 domain 读写，也不能导入 Electron API。

## 运行链路

`src/app-hosts/linnya/backend-runtime/orchestration/backendLifecycle.ts` 在 App Server 内创建唯一 `BackendRuntimeOwner`，取得 `ApiServer` 和已初始化服务后调用 `configureRoutes()`。`src/electron-main/services/apiServer.ts` 虽仍在历史目录，但同样运行于 App Server，负责 loopback HTTP Server、middleware、安全 token、CORS、请求体限制和关闭生命周期。

Provider route 装配完成本地 durable intent 恢复与账号能力投影后，只注册远端模型同步 lifecycle，不等待上游网络。
具体同步顺序由 Provider Onboarding 拥有，启动与关闭由 BackendRuntimeOwner 拥有；授权和登出复用同一个 lifecycle，避免并发写入与退出后的迟到更新。

主要入口：

- `index.ts`：`RouteDependencies`、route family 组合、Conversation runtime 初始化结果和可观测摘要；
- `orchestration/createConversationRouteLifecycle.ts`：Conversation route 准备失败时的资源回滚；
- `*Router.ts`：具体 HTTP adapter；
- `../services/apiServer.ts`、`../services/apiServerSecurityRules.ts`：HTTP Server 与统一安全边界。

## 当前 Route Families

以 `index.ts` 和各 router 为事实源，当前主要包括：

- `/health`：App Server 健康与关键服务可用性；
- `/api/v1/providers`、`provider-accounts`、`provider-onboarding`、`custom-api-onboarding`、`ollama-onboarding`、`models`、`model-picker`：模型与 Provider 产品接口；
- `/api/v1/transcription`、`/api/v1/knowledge-base`：业务服务接口；
- `/api/v1/conversation`、`/api/v1/workspace`、`/api/v1/storage-space`：Conversation、受管资源和存储空间；
- `/api/v1/conversation-control`：本机 CLI 使用的独立鉴权控制桥；
- `/api/v1/ollama`：本机 Ollama 代理；
- `/api/v1/debug/provider-outbound`：仅开发模式开放的只读诊断接口；
- `/static`：受管静态资源。

Conversation 的统一执行入口是 `POST /api/v1/conversation/next`；旧 `/api/v1/generate` 系列已删除。Conversation 的身份、事件、SSE 和历史一致性以 [Conversation Platform](../../../docs/conversation-platform/README.md) 为准。

## 新增或修改路由

1. 先确认业务 owner，在对应 domain/feature 或 App Host application 层实现规则和用例。
2. 跨 Renderer、CLI 或插件边界的 DTO 先进入 [`packages/schemas`](../../../packages/schemas/README.md)，Route 只执行 schema parse 和序列化。
3. Router 优先跟随业务 owner；只有当前组合尚未归位时，才在本历史目录增加最薄的 adapter，并在 `index.ts` 挂载。
4. 依赖从 `RouteDependencies` 或明确的 route factory 参数注入，不在 Router 内读取全局数据库或自行构造另一套 runtime。
5. 新 route family 若影响健康状态或启动诊断，同步更新 `RouteConfigurationResult` 与 `getRouteSummary()`。
6. 测试真实成功、鉴权、输入错误、取消/关闭和资源清理语义；不要只断言路径存在。

## 安全与进程边界

- App Server 只监听 loopback；Renderer 与 Conversation CLI 使用互不相通的 session token。
- CORS 不是鉴权。`ApiServer` 必须在 body parser 前完成来源和 token 校验，避免未授权大请求消耗解析资源。
- 默认请求体限制由 `ApiServer` 统一管理；上传、Conversation 和其他大 payload 必须在各自 route 明确限额。
- Router 不接触 `BrowserWindow`、`ipcMain`、Electron `shell` 或真实 Desktop credential；需要桌面能力时调用 App Host 的窄 port。
- Renderer 不接触数据库路径、资产物理路径或 Backend 内部对象，只消费稳定 ID 与 DTO。

## 历史目录债务

`routes/**`、`services/apiServer.ts` 和相关 Backend 初始化仍位于 `src/electron-main/**`，是 App Server cutover 后尚未完成的物理归位，不是继续向 Electron Main 聚合业务的理由。后续移动必须以 App Server 组合根、domain owner 和公开合同为单位，不能机械搬目录或建立兼容双入口。

## 验证

从仓库根按改动范围执行：

```bash
pnpm vitest run \
  src/electron-main/routes \
  src/electron-main/services/apiServer.test.ts \
  src/electron-main/services/apiServer.lifecycle.test.ts
pnpm guard:app-server-backend-boundary
```

涉及 Conversation 路由时，还需执行 [Conversation 测试门禁](../../../docs/conversation-platform/11-testing-gates.md) 中与改动对应的 gate。
