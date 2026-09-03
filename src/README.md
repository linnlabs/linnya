# Linnya 后端架构导航

> **全链路权威规范**：[`docs/conversation-platform/`](../docs/conversation-platform/README.md)。不变量以 [`00-invariants.md`](../docs/conversation-platform/00-invariants.md) 的 `INV-nn` 为准；本文是实现级说明，冲突时以规范为准。

本文说明 `src/` 的当前职责与阅读入口。代码事实优先于旧路径；已迁走的 `src/agent/*`、旧 Conversation flow 和兼容门面不再作为架构入口。

## 1. 总体分层

| 层 | 当前 owner | 职责 |
|---|---|---|
| 通用 Agent framework | `packages/linnkit/` | Runtime facts、Graph、LLM、tool/child-run 协议、context core、ports |
| Linnya App Host | `src/app-hosts/linnya/` | 请求接纳、runtime 装配、flow、realtime、persistence、产品 registry |
| 产品 domain | `src/domains/`、`src/features/` | 独立业务规则与用例；跨 domain 通过 port、registry 或 app orchestration 协作 |
| 产品工具 | `src/tools/` | Workspace、TaskState、知识库等具体工具能力 |
| 产品共享合同 | `packages/schemas/` | HTTP、IPC、Host/Renderer、插件间共同校验的 Linnya DTO |
| Headless App Server | `src/app-hosts/linnya/app-server-runtime/` | HTTP/SSE、Backend owner、数据库、Agent 与插件 Backend 的生产组合根 |
| Desktop Host | `src/electron-main/` | Electron 生命周期、窗口、系统能力、Renderer IPC gateway 与 App Server supervisor |

模型推理的跨端 route、Model Catalog、Host capability、Linnkit 与非 Agent 业务 port 之间的详细职责，以 [`docs/model-inference/README.md`](../docs/model-inference/README.md) 为准。

边界判断：

- 任何 Agent 产品都需要的机制进入 Linnkit。
- Linnya 如何接入通用机制进入 App Host。
- 某个产品业务规则进入对应 domain/feature。
- 跨进程或跨包确需共同理解的数据才进入 `@app/schemas`。

## 2. 运行入口

Electron 主进程从 `src/electron-main/index.js` 启动，并在创建业务窗口前用随包发布的固定 headless Node 拉起 `app-server-entry.cjs`。App Server 通过严格 bootstrap 获得冻结路径与运行事实，再由 `src/app-hosts/linnya/backend-runtime/orchestration/backendLifecycle.ts` 创建唯一 Backend owner。Main 不加载 Backend bundle，不打开业务数据库，也不承载 HTTP/SSE、Agent、命令输出或插件 Backend。

Conversation Agent 请求的主链是：

```text
HTTP request
  -> Linnya flow orchestration
  -> runtime assembly / GraphExecutor
  -> RuntimeEventSink admission
  -> RuntimeEventPublisher / EventBus
  -> persistence + realtime + observability
```

关键入口：

- App Host 总图：`src/app-hosts/linnya/README.md`
- Flow：`src/app-hosts/linnya/adapters/flow/README.md`
- Runtime 装配：`src/app-hosts/linnya/adapters/runtime-assembly/README.md`
- Realtime：`src/app-hosts/linnya/adapters/realtime/README.md`
- 持久化：`src/app-hosts/linnya/adapters/persistence/event-store/README.md`
- 通用 Runtime：`packages/linnkit/src/runtime-kernel/README.md`

## 3. 事实、存储与 UI read model

`RoutedRuntimeEvent` 是 Agent 执行事实。Linnya Host 将同一事实经 EventBus 分发给持久化和实时传输，不能分别生产“实时版本”和“落盘版本”。

```text
RoutedRuntimeEvent
  -> events                    durable fact source
  -> conversation_ui_messages rebuildable UI read model
  -> SSEEvent                  live transport DTO
  -> Conversation projection  renderer live state
```

约束：

- EventStore 只接受完成 admission 的事实，缺少 run/routing identity 必须失败。
- `events` 是审计、上下文和重建的事实源；UI 表只是可丢弃、可重建的读模型。
- Host UI row、HTTP DTO 与 Renderer window DTO 共用 `@app/schemas` 的 Conversation UI message 合同。
- 新事实不支持旧字段、旧 shape 或读取期身份恢复。发现非规范存量应执行明确的数据清理或重建，不能在主链增加 fallback。

## 4. 产品工具合同

工具必须返回结构化 JSON，事实结果与展示结构不能混在 observation 文本里。跨 Host/Renderer 的正式合同位于 `packages/schemas/src/tools/`。

当前重点合同：

- `taskstate.ts`：TaskState 读写结果。
- `workspace-document-read.ts`：Workspace 文档读取及 `blocks | outline | text` 展示联合。
- `tool-output-read.ts`：长工具输出续读窗口。
- `ask.ts`：交互问卷。
- `subrun-batch.ts`：系统批量 child run。

Renderer 必须解析正式 `data`，不得从 observation、Markdown 或旧 payload 猜业务字段。Workspace Markdown block 统一交给 Conversation 的 Markstream 渲染入口；`text` 与 `tool_output_read.window_text` 按原样文本展示。

## 5. 插件边界

`packages/plugin-host-contract/` 定义插件与宿主之间窄而稳定的 backend/renderer 扩展合同；插件私有业务定义留在各插件包。

- 插件 backend hook 可以返回 `WorkspaceDocumentReadData`，但不能定义第二套 Workspace read shape。
- 插件 renderer 注册组件与能力，不拥有 Conversation timeline message 或 Runtime fact。
- 插件 Host 合同不直接依赖某个插件的内部实现。

详见 `packages/plugin-host-contract/README.md`。

## 6. 代码归属规则

- 业务 domain 不直接依赖另一个 domain 的内部文件。
- 跨 domain 流程放 app-level orchestration，或通过 port/registry/domain event 协作。
- store 只持有状态并执行同步 action；规则放 `functions/`，异步多步骤流程放 `orchestration/`。
- 禁止新增 `utils/helpers/common/service/manager` 式杂物层；已有目录也不能继续扩大职责。
- 类型、schema、DTO 与业务枚举由对应 `definitions/` 或公共合同 owner 持有，消费方只导入。

## 7. 修改清单

修改 Runtime/Conversation 链路前必须回答：

1. 这是 Runtime fact、transport signal、产品 DTO、read model 还是纯 presentation entity？
2. 身份由谁创建，唯一性作用域是什么，live/reload 是否保持同一值？
3. 哪个 schema 是唯一 owner，所有生产者与消费者是否从公开入口导入？
4. 是否影响 EventStore、Agent context、HTTP DTO、Renderer projection 或虚拟化 key？
5. 是否引入旧 shape、随机 ID、index key、shape guessing 或静默 fallback？如果是，方案无效。

测试优先覆盖完整业务链和 live/reload parity，不为字段声明、CSS 数值或 README 写快照。

## 8. 文档入口

- Linnkit：`packages/linnkit/README.md`
- Linnkit Runtime：`packages/linnkit/src/runtime-kernel/README.md`
- Linnkit realtime：`packages/linnkit/docs/integration/realtime.md`
- Linnya App Host：`src/app-hosts/linnya/README.md`
- Linnya schemas：`packages/schemas/README.md`
- Model Inference 边界：`docs/model-inference/README.md`
- Plugin Host contract：`packages/plugin-host-contract/README.md`
- Conversation Renderer：`apps/renderer/domains/conversation/docs/README.md`
- Conversation virtualization：`apps/renderer/domains/conversation/docs/conversation-virtualization.md`
- Tools：`src/tools/README.md`
