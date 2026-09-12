# Conversation Control Bridge

本 adapter 把 `application/conversation-control/` 暴露为仅供本机 Linnya CLI 使用的 HTTP bridge，并负责当前 App 实例的连接描述生命周期。它只做传输、安全和依赖装配，不拥有 Conversation 业务规则。

## 接口

固定命名空间：

```text
POST /api/v1/conversation-control/handshake
POST /api/v1/conversation-control/commands
```

`handshake` 返回协议版本、App 实例 ID、实际能力和请求/watch 上限；`commands` 使用共享 strict schema 接纳与返回命令。非法 JSON、超限 body、合同错误和 use-case 错误都投影为稳定 JSON，不落到 Express HTML 错误页。

当前握手声明 `send / models / projects / list / messages / status / respond / stop / result / audit / workspace_tools`。

能力公告允许未来新增合法标识符，消费者忽略不认识的能力；命令 union 和响应 schema 仍然封闭且严格。改变既有协议语义必须升级 protocol，不能借能力扩展绕过合同校验。

## 安全边界

- API Server 只绑定 `127.0.0.1`。
- CLI 使用独立的随机 256-bit session token；它不能访问 Renderer API，Renderer token 也不能访问 CLI 命名空间。
- 鉴权位于 body parser 前，避免未授权大请求先占用解析资源。
- 诊断日志只记录命令名与收敛后的错误类型，不记录 token 或请求正文。
- bridge 只消费共享 command DTO，不能把 Flow 内部开关、resume token 或数据库结构暴露为 wire。

## 连接描述生命周期

默认文件为 `~/.linnya/runtime/conversation-control-v1.json`，可用 `LINNYA_CLI_CONNECTION_FILE` 为测试或多实例场景覆盖。

descriptor owner 在 API Server 已绑定真实端口且路由装配成功后才原子发布文件。目录和文件权限分别为 `0700`、`0600`。撤销时只删除仍属于当前 `app_instance_id` 的文件，避免旧进程删除新实例刚发布的连接信息；Server 关闭时先撤销描述，再关闭 listener。

## 依赖装配

`createLinnyaConversationControlUseCase.ts` 是 app-level composition root：把 Model Catalog、Provider Account、Flow、run registry、durable Conversation history、Tool runtime 与 Telemetry 安全查询映射到 use case 的窄 ports。Tool runtime 只用于读取固定五个 Workspace 工具的真实 schema；CLI 不能借此访问其他已注册工具。模型查询只投影安全选择事实，并复用正式模型运行可用性判断；业务条件、状态选择、审计聚合和结果语义必须留在 application feature 的 functions，HTTP router 只能完成 parse、调用与错误投影。

## 测试

```bash
pnpm exec vitest run \
  src/app-hosts/linnya/adapters/conversation-control-bridge/__tests__ \
  src/electron-main/services/apiServer.test.ts \
  src/electron-main/services/apiServer.lifecycle.test.ts
```

门禁覆盖真实 HTTP router、strict request/response、描述文件原子发布与权限、实例安全撤销、Renderer/CLI token 双向隔离，以及 API Server 启停生命周期。真实 CLI 子进程测试见 `apps/linnya-cli/src/__integration-tests__/cliProcess.integration.test.ts`。

`projects` 通过注入的 Workspace 查询端口列出未删除项目，只投影 `project_id` 与 `name`。CLI 不读取数据库或物理路径。
