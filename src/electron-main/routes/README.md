# `src/electron-main/routes/`：路由聚合与端点总览（当前实现）

> 本目录是 **TS 后端 Express 服务**的“路由装配层”。它不应承载业务规则，业务逻辑应在 `src/features/*` / `src/core/*` / `src/tools/*`。
>
> 后端宏观入口请先看：`src/README.md`

---

## 1) 路由是如何被配置的？（权威入口）

- 路由聚合入口：`src/electron-main/routes/index.ts`
  - `configureRoutes(app, dependencies)`：把各个 router 挂到 express app 上，并返回关键路由是否真实挂载成功
  - `getRouteSummary(dependencies, routeResult)`：用于启动日志与可观测摘要；会话路由初始化失败时不会继续展示对话端点
- HTTP Server：`src/electron-main/services/apiServer.ts`
  - 调用 `configureRoutes(...)` 完成挂载

依赖注入（RouteDependencies）：

- 目前主要是 `knowledgeBaseService` / `transcriptionService`
- 对话服务（conversation/agent）由 `routes/index.ts` 内部初始化并挂载（基于 EventStore + GraphExecutor）
- SQLite RunSupervisor 在这个装配阶段先执行 `recoverOnBoot()`；只有恢复成功才继续创建 FlowOrchestrator 和挂载会话路由

启动日志约定：

- 只有会话历史与会话流程路由都挂载成功时，才允许输出“应用路由配置完成”。
- 如果会话初始化失败，日志必须输出“部分完成/会话路由不可用”，并且 `/health` 中的 `chat` / `agent` 状态应为 `false`。

---

## 2) 当前端点列表（以代码为准）

在 `routes/index.ts` 中（按挂载顺序）：

- **健康检查**
  - `GET /health`（`healthRouter.ts`）
- **模型管理**
  - `GET /api/v1/providers`（内置 Provider 公开目录；可用 `q` 搜索）
  - `GET /api/v1/providers/:providerDefinitionId`（单个 Provider 与 bundled 模型资料）
  - `POST /api/v1/provider-onboarding/direct-providers`（用 API Key 连接正式 Provider，并启用少量近期模型）
  - `POST /api/v1/custom-api-onboarding/models`（按用户选择的 API 格式、URL、Key 和模型资料原子注册自定义模型）
  - `/api/v1/models/*`（`modelRouter.ts`）
- **静态资源**
  - `GET /static/images/:filename`（`staticRouter.ts`）
- **转录（若服务初始化成功）**
  - `/api/v1/transcription/*`
- **知识库（若服务初始化成功）**
  - `/api/v1/knowledge-base/*`
- **对话（统一端点）**
  - `POST /api/v1/conversation/attachments/images`（单图 multipart 草稿暂存；副本写入 AppData 会话附件存储）
  - `DELETE /api/v1/conversation/attachments/images/:draftId`（幂等释放未提交草稿）
  - `GET /api/v1/conversation/assets/images/:assetId/content`（鉴权并完整性复核的 durable 图片内容）
  - `POST /api/v1/conversation/next`（Conversation Flow，含 SSE）
  - `/api/v1/conversation/*`（历史等）
- **Workspace 资源库**
  - `GET /api/v1/workspace/assets/images/:assetId/content`（按 durable asset ID 读取并复核受管图片；Renderer 不接触账本路径）
- **调试（仅非生产环境）**
  - `/api/v1/debug/provider-outbound/*`
- **Ollama 代理**
  - `/api/v1/ollama/*`

> 重要说明：旧的 `/api/v1/generate` / `/api/v1/generate/stream` **已移除**。统一入口是 `/api/v1/conversation/next`（见 `routes/index.ts` 的日志说明）。

Provider Catalog 端点只返回 `@linnya/provider-catalog` 的 public read model。package、route profile、auth profile 和 API surface 属于 Host-only runtime binding，不能通过这个端点下发；“自定义 API”也不是目录 Provider。

Provider onboarding 路由只解析共享 command schema，并调用 App Host use case。URL、鉴权、容量、视觉能力与 runtime route 不由路由或 Renderer 拼接；完整边界见 `src/app-hosts/linnya/application/provider-onboarding/README.md`。

会话上传端点只创建会话附件副本，不创建 `project_asset_links`，因此附件不会自动出现在项目资源库。预览端点只接受 durable asset ID，并在 host 内解析和复核真实文件；Renderer 不接触 `assets.local_path`。完整生命周期与 Agent 读取链路见 `src/features/conversation/attachments/README.md`。

---

## 3) 如何新增一个路由/端点（推荐流程）

### 3.1 这是某个业务 Feature 的端点

建议把 router/handler 放在该 Feature 内（保持内聚），然后在此处挂载：

1. 在 `src/features/<feature>/` 内实现 router（或暴露 `createXxxRouter(service)` 工厂）
2. 在 `src/electron-main/routes/index.ts` 引入并 `app.use('/api/v1/xxx', createXxxRouter(...))`
3. 如果需要依赖服务实例，通过 `RouteDependencies` 传入（不要在 router 内自行 new 服务）

### 3.2 这是“环境适配型”路由

例如健康检查、静态文件、开发调试等，可以放在 `routes/` 内：

- 参考：`healthRouter.ts`、`staticRouter.ts`、`providerOutboundDebugRouter.ts`

### 3.3 更新可观测摘要（可选但推荐）

如果你希望启动日志能展示新端点，请同步更新：

- `getRouteSummary(...)`
