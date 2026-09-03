# Linnya App Host 架构

`src/app-hosts/linnya/` 是 Linnya 接入 npm 包 `@linnlabs/linnkit` 的宿主层。Linnkit 是通用 Agent framework；App Host 负责把 framework 的 ports、protocol 与 Linnya 产品能力装配成可运行应用。

## 1. 所有权边界

| 问题 | owner |
| --- | --- |
| Agent framework 一般如何运行 | [独立 Linnkit 仓](https://github.com/linnlabs/linnkit) |
| Linnya 如何装配、接纳请求、传输和持久化 | `src/app-hosts/linnya/` |
| Workspace、TaskState、知识库等工具做什么 | `src/tools/` 或对应 product domain |
| 跨 Host/Renderer 的 Linnya DTO | `packages/schemas/` |
| 前端对话如何投影与渲染 | `apps/renderer/domains/conversation/` |

App Host 不定义 RuntimeEvent、Graph、tool/child-run kernel 协议，也不拥有前端 visual row 或组件。Linnkit 文档不得反向引用本目录；宿主接入细节只写在本目录文档中。

## 2. 目录地图

### `backend-runtime/`

定义 Backend owner 的 data-only 启动事实与窄宿主依赖。Electron Main 和 headless App Server 复用同一合同，不能把 Electron 对象或完整环境变量跨入业务后端。

### `adapters/runtime-assembly/`

组装 Linnya 默认 `GraphExecutor`、LLM caller、model catalog、tool runtime 与 execution-scoped ports。它只编排依赖，不重新定义 framework 协议。

### `adapters/inference/`

实现生产 canonical inference Host port：从 Model Catalog 读取显式 route，按 `capability_id` 进入唯一 Provider package factory，解析 attempt-scoped 凭据并校验 endpoint route identity。具体 AI SDK package import 全部收口在 Host 的类型安全 registry；Linnkit、业务 domain 和 Model Catalog 都不识别 npm package。正式 BYOK route 的 codec 对应用户实际直连 endpoint；Cloud route 的 codec 只对应客户端下一跳的 Cloud 对外协议，上游 Provider/model/credential 属于 Cloud 私有路由。该模块不执行工具、不拥有重试/切模或 Run 终态，也不记录 Provider body。当前已连接生产 `LlmCaller`；详见 `adapters/inference/README.md`。跨端 route、非 Agent port、Cloud 与 Provider SDK 的完整职责矩阵见 [`docs/model-inference/README.md`](../../../docs/model-inference/README.md)。

### `adapters/model-routing-policy/`

把 Host capability 已脱敏的 canonical failure code 映射为 Linnkit `switch_model/none` 建议。它不读取
Provider body、不改写请求/响应、不选择具体备用模型，也不拥有 retry/attempt 预算；详见该目录
`README.md`。

### `adapters/document-ocr/`

实现专用文档 OCR Host port：从 Model Catalog 严格投影 OCR profile，并调用 Paddle layout/job capability。它不是通用 LLM inference，不使用 AI SDK，不决定 Parser retry、partial 页或模型 fallback；详见 `adapters/document-ocr/README.md`。

### `adapters/context-injection/`

把 Linnya 请求、registry 与 context policy 转换为 Runtime 所需输入，构造 `ToolExecutionContext` 等宿主绑定能力。产品字段不能直接扩进 Linnkit 的通用 context。

### `adapters/flow/`

Conversation Agent run 的 application orchestration：请求接纳、Host session、incoming facts、Graph 执行、wait/resume、持久化 drain、run settlement 与 transport 收口。

规则和事实创建应下沉到明确 functions/owner；Flow 只组织顺序与跨边界协作。

### `adapters/realtime/`

订阅 EventBus，将正式 `RoutedRuntimeEvent` 通过 Linnkit 标准 mapper 投影为 wire DTO，再交给 Linnya transport。Transport end/error/status 是宿主信号，不能冒充 Runtime fact。

### `adapters/conversation-control-bridge/`

把 Conversation control use case 暴露为仅限本机 CLI 的 strict HTTP bridge，拥有独立 session token、私有连接描述和 App 实例生命周期。它只做传输、安全与依赖装配，不承载 Conversation 规则；详见该目录 `README.md`。

### `adapters/persistence/`

实现 Linnkit EventStore/Checkpointer ports，并维护 Linnya Conversation durable read model。详见：

- `adapters/persistence/event-store/README.md`
- `adapters/persistence/checkpointer/README.md`

### `adapters/tools/`

将 `src/tools/` 的具体实现注册到 Linnkit tool runtime。这里负责 port 与 registry 装配，不承载工具业务规则。
请求级动态 Schema 由 Linnkit 转交通用 invocation 到该 Host adapter；adapter 只派生 concrete tools 真正需要的窄产品上下文，禁止把 query/history 或开放 metadata 袋暴露给整个工具集合。字段的具体消费规则仍属于对应工具 feature。

### `adapters/child-runs/`

把 Linnkit child-run protocol 与 Linnya agent registry、默认 invoker 和 Host persistence/realtime 连接起来。Child facts 保持 child routing；父级只通过正式 `subrun_trace` 获得展示投影。

### `adapters/commands/`

装配 Shell/Process 的 execution owner、runner、输出与 artifact ingress。`plugin-cli-launcher` 只把极小原生 client 以 `linnya-<plugin>` 名称安装进受管 PATH；`application/plugin-cli-shell-bridge/` 把该 client 的调用绑定到父 Shell execution。插件 CLI 语义和执行实现仍属于插件包，bridge 不启动第二个 Electron，也不创建平行 owner、审批、输出或审计。

### `agent-registry/`

拥有 Linnya 的 agent definitions、prompt key 绑定、默认模型策略、工具集合、enricher 与产品层运行策略。它定义“Linnya 有哪些 Agent”，不定义“Agent framework 如何运行”。

### `context/` 与 `context-policies/`

- `context/`：Linnya request 到 context-manager 输入的绑定。
- `context-policies/`：默认 provider、context policy 与自动 compaction 的宿主装配。

通用 context 算法继续属于 独立 Linnkit 仓的 `src/context-manager/`。

### `plugin-registry/`

装配内置和外部插件贡献，消费 `@linnya/plugin-host-contract` 的窄合同。插件内部类型不得泄漏为 Host 全局合同。

### `application/`

保存跨 domain、runtime owner 或持久化边界的 Linnya 应用用例。公开能力使用 `*UseCase`；`Workflow` 名称保留给未来可注册、可配置、可执行的工作流产品。内部仍可使用 `orchestration/` 表达代码职责。完整边界见 `application/README.md`。

### `application/provider-onboarding/`

编排正式 Provider public catalog、Host 私有 runtime binding 与 Model Catalog 的原子注册流程。Renderer 只提交 Provider、目录模型与 Key；该用例投影 URL、auth、容量、视觉能力和 typed route。它不执行推理、不选择 package，也不把 Custom API 伪装成 ProviderDefinition。

### `application/custom-api-onboarding/`

编排自定义 API URL、Key、三选一格式和模型资料到 InferenceEndpoint 与 Model Catalog 的原子注册流程。格式到 route/auth/endpoint identity 的映射只存在于该用例；Renderer 不构造内部 route，本流程也不创建 ProviderDefinition 或模型 `provider` 字段。

### `application/conversation-control/`

编排外部调用方的发消息、历史查询、运行状态、`awaiting_user` 响应、终止与最终回答读取。它通过窄 ports 复用正式 Flow、run registry 和 durable read model，不提供主动暂停，也不拥有 HTTP 或数据库实现；详见该目录 `README.md`。

### `testkit/`

保存依赖 Linnya runtime assembly、Workspace、path manager 或数据库的宿主测试夹具。通用测试 primitive 属于 Linnkit testkit。

## 3. Runtime 事实主链

```text
request
  -> Host admission and run registration
  -> Graph creates RuntimeEvent drafts
  -> RuntimeEventSink attaches routing identity
  -> RuntimeEventPublisher publishes RoutedRuntimeEvent
  -> EventBus fan-out
       -> EventStore
       -> realtime adapter
       -> observability / run feedback
```

强制约束：

- RuntimeEvent draft 可以暂时没有 routing；进入 publisher 后必须成为 `RoutedRuntimeEvent`。
- Graph journal、EventBus、EventStore、replay 都只接收 admission 返回的同一事实对象。
- incoming `user_input` 与 HITL `tool_output` 由 Host 创建并先 durable commit，再 publish routed fact。
- summarization start/end/error 只进入 realtime presentation，并严格共享 Linnkit 定义的 `summarization_id + run_id + execution_id + turn_id`；其中 end 的 `summary_id` 必须等于对应 `history_summary.id`。Host adapter 必须显式映射 callback，禁止展开开放对象。只有 `history_summary` Runtime fact 能由 UI projector 写入 durable Conversation row；Host 必须使用 `@app/schemas` 的 summary payload 合同生产 row，不能写旧状态字段或持久化临时 presentation。
- `user_input` durable transaction 成功后，Host 通过 app-level `user_input_committed` ack 原样返回 conversation、message 与 operation identity；ack 不进入 Runtime EventBus/EventStore，也不能在 commit 前发送。`persist=false` 不产生 ack。
- root、resume、auxiliary、child、benchmark 与 testkit 都使用同一 admission 模型，不得建立简化旁路。
- 新事实缺少 identity、routing 或 lifecycle 字段时立即失败，不能在 persistence/realtime/UI 补齐。

## 4. 持久化与 UI read model

```text
RoutedRuntimeEvent
  -> events                         immutable durable facts
  -> conversation_ui_messages       disposable UI read model
  -> HTTP ui-messages API           @app/schemas DTO
  -> Renderer message window        validated product messages
```

`events` 是审计、Agent context 与 read model rebuild 的事实源。`conversation_ui_messages` 是性能优化后的派生表，可以重建，不能反向成为 Runtime 事实源。

Host projection、HTTP schema 和 Renderer DTO 共用 `@app/schemas` 的 `ConversationUiMessageSchema`。role/type、presentation、tool payload 和 message ID 不允许在各层重复定义。

当前合同不支持历史 shape：

- 缺 routing identity 的 stored event 必须拒绝。
- 非规范 UI row 必须报告 read model corruption。
- 合同变化通过显式清理或 rebuild 生效，不在读取主链恢复字段、猜测身份或维护双版本 union。

## 5. Realtime 与 durable parity

同一 Runtime fact 可以有多个消费者，但只能有一个生产源。Realtime adapter 必须复用 Linnkit `runtimeEventToSSEEvent()`；Host 只能增加不参与控制的展示 meta。

业务门禁应证明：

- live projection 与 durable rebuild 产生相同消息身份、类型、可见性、turn 和顺序。
- foreground、auxiliary 与 child facts 不串正文或 Agent context。
- answer chunk/seal、tool lifecycle 和 subrun trace 全程保持实体身份。
- persistence 失败阻止虚假 completed；transport 结束不补造业务终态。

## 6. 产品工具结果

具体工具返回 `StructuredToolResult` JSON。Observation 服务 Agent，结构化 `data` 服务业务消费者，两者不能互相解析替代。

Workspace document read、TaskState、问卷和 tool-output read 的跨端 schema 位于 `packages/schemas/src/tools/`。App Host 与插件 backend 必须生产这些合同，Renderer 直接 parse；禁止旧 payload fallback、空对象降级和 observation/Markdown shape guessing。

## 7. 修改归属检查

1. 通用 Graph、Runtime fact 或 port：改 Linnkit。
2. Linnya 默认装配、flow、persistence 或 realtime：改 App Host adapter。
3. 具体工具规则：改 `src/tools/` 或对应 domain。
4. 跨 Host/Renderer DTO：改 `@app/schemas`，同步生产者与消费者。
5. 插件扩展面：改 `@linnya/plugin-host-contract`，保持窄合同。
6. 前端投影、卡片、虚拟化：改 Conversation domain，不把规则倒灌 Host 或 Linnkit。

禁止把产品特判写入 Linnkit，禁止让 App Host 变成第二个 Runtime owner，也禁止用兼容 bridge 掩盖真实目录和合同。

## 8. 阅读顺序

1. 独立 Linnkit 仓的 `src/runtime-kernel/README.md`
2. 独立 Linnkit 仓的 `docs/integration/realtime.md`
3. 本文
4. `adapters/flow/README.md`
5. `application/README.md`
6. `application/conversation-control/README.md`
7. `adapters/conversation-control-bridge/README.md`
8. `adapters/persistence/event-store/README.md`
9. `packages/schemas/README.md`
10. `apps/renderer/domains/conversation/docs/README.md`
11. `apps/linnya-cli/README.md`

其它模块文档位于各目录 README；不存在 README 的模块以其公开 index 与 definitions 为准，并应在改变边界时补齐文档。
