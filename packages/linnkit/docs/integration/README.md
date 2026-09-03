# `@linnlabs/linnkit` Integration Guide

这是 `@linnlabs/linnkit` 的**接入文档集**——回答一件事：

> 你在自己的仓库装了 `@linnlabs/linnkit`，要把一个 Agent 跑起来，至少要写什么、应该从哪里开始抄。

**读者画像**：在外部独立仓库（如 daemon、桌面应用、Web 服务、知识库 agent 或任意自研 agent host）通过 `npm install @linnlabs/linnkit` 装包，准备从零接入的开发者。

---

## 1. 它是什么

`@linnlabs/linnkit` 是 **vendor-neutral 的 Agent 框架**：它只提供 runtime kernel + context manager + ports + testkit，**不内置任何具体业务实现**。

一句大白话：

> 你装的这个包负责"agent 怎么跑、上下文怎么治理"，不负责"用哪个 LLM 提供商、工具集长什么样、消息怎么落库、SSE 怎么推、产品里有哪些 agent"。这些通通是你（host）要自己写的。

这个边界是工程约束，不只是文档口号：Linnkit 核心不得 import Provider SDK，不解析厂商 request/response/SSE/usage 字段，也不按厂商名、模型名、base URL 或错误文本选择 codec。Host 必须实现 `CanonicalInferencePort`，并自行选择、实现和维护 Provider adapter。无论 Host 如何适配厂商协议，Linnkit 始终只消费 canonical port，继续拥有 Agent loop、上下文、工具执行、调用预算与 durable replay。

## 2. 你必须自己写的（接入面）

按重要度排序：


| 你必须自己写的                                 | linnkit 给的接入合同（type/symbol）                                                                             | 从哪里 import                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 1. LLM provider 适配器                     | `CanonicalInferencePort`                                                                                           | `@linnlabs/linnkit/ports`           |
| 2. 工具集                                  | `BaseTool` / `ToolRuntimePort`                                                                          | `@linnlabs/linnkit/runtime-kernel`  |
| 3. 上下文围栏（fence）注册 + 注入适配                | `FenceRegistry` / `FenceDescriptor` / `FenceInjection` / `MustKeepPolicy` / `FenceLifetimePreprocessor` | `@linnlabs/linnkit/context-manager` |
| 4. 持久化适配器                               | `Checkpointer` / `EventStore` / `RunRegistryStore`                                                      | `@linnlabs/linnkit/runtime-kernel`  |
| 5. 实时通道（SSE/WebSocket/MQTT）             | linnkit 不规定传输形态；标准 SSE 字段复用 `runtimeEventToSSEEvent`，host 只追加自己的 meta enrichment | `@linnlabs/linnkit/contracts`       |
| 6. graph executor 装配 + 默认 LLM/Tool node | `runtimeKernel.graph.GraphExecutor` 等                                                                   | `@linnlabs/linnkit/runtime-kernel`  |
| 7. agent 注册表                            | `promptKey` 是 opaque string，linnkit 不认识你的产品菜单；单轮/无工具能力也注册为 tools-disabled agent                    | （host 自定义）                          |
| 8.（可选）telemetry                         | `TelemetryPort`                                                                                         | `@linnlabs/linnkit/runtime-kernel`  |


## 3. 推荐目录形态（host 仓库内）

```text
app-hosts/<your-app>/
├── adapters/
│   ├── runtime-assembly/   # 把 GraphExecutor / LlmNode / ToolRuntime 拼起来
│   ├── context-injection/  # context builder + 注入 host 请求字段为 fences
│   ├── flow/               # history 读取 / pre-run policy / host session
│   ├── realtime/           # SSE / WebSocket / MQTT
│   ├── persistence/        # Checkpointer / EventStore / RunRegistryStore 实现
│   └── tools/              # 默认 ToolManager 装配
├── agent-registry/         # 你的 agent / single-turn / system 定义
├── context/agent/          # host invoke request shape + fence 注册 + injection adapter
├── context-policies/       # MustKeepPolicy / provider registry / 截断比例
└── testkit/                # host-bound harness（依赖你的默认 adapter）
```

这是建议而不是强制。下面的术语全部按这个分层取名。

## 4. 公开 API surface（8 个稳定子入口）

`package.json#exports` 写死的子入口当前是 8 个。任何不在这张表里的"deep import"（比如 `@linnlabs/linnkit/context-manager/shared/preprocessors/...` 或 `@linnlabs/linnkit/shared/...`）都不算公开 API，下个 minor 升级随时可能挪。


| 子入口                                       | 适用环境                                           | 你能从这里 import 到什么                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@linnlabs/linnkit`                       | **Node-only**                                  | `runtimeKernel` / `ports` / `contracts` 三个 namespace；`generateMessageId` / `generateRunId` / `withLLMTelemetryContext` / `setLlmAuditRecorder`                                                                                                                                                                                                                                                                                                                   |
| `@linnlabs/linnkit/ports`                 | **Node-only**                                  | `AgentInvocationRequest` / `CanonicalInferencePort` / `CanonicalInferenceEvent` / `ProviderContinuation` / `TokenizerPort` 等 host 必须实现的合同                                                                                                                                                                                                                                                                                                                       |
| `@linnlabs/linnkit/contracts`             | **Browser-safe**                               | 长期稳定的 Zod 合同：`AiMessage` / `SystemMessage` / `UserMessage` / `AssistantMessage` / `ToolMessage` / `RuntimeEvent` / `EventEnvelope` / `SSEEvent` / 默认执行常量；前后端 wire 边界共用                                                                                                                                                                                                                                                                                     |
| `@linnlabs/linnkit/runtime-kernel`        | **Node-only**（含 `node:async_hooks` / `crypto`） | 全套 runtime：`graph` / `tools` / `execution` / `events` / `runContext` / `llm` / `childRuns` / `childRunTrace` / `runSupervisor` / `telemetry` 等 namespace + 扁平 `BaseTool` / `ToolExecutionContext` / `ENGINE_ERROR_CODES` 等符号 + `createGraphLoopHarness` / `createDefaultGraphExecutor`（仅测试用）                                                                                                                                                                     |
| `@linnlabs/linnkit/runtime-kernel/events` | **浏览器安全**                                      | events governance 纯函数：`shouldPersistRuntimeEvent` / `shouldEnterAgentContext` / `shouldEmitRuntimeEventToSse` / `shouldReplayRuntimeEventToUi` / `getRuntimeEventUiProjectionKind` / `eventMapper`，外加 `AnyAgentEvent` / `RuntimeEventLifecycleDecision` 类型                                                                                                                                                                                                       |
| `@linnlabs/linnkit/context-manager`       | **Node-only**                                  | context core：`createMessageFormatter` / `formatAgentLlmMessages` / `messageFormatter` / `createFenceRegistry` / `FenceDescriptor` / `FenceInjection` / `FenceRegistry` / `FenceLifetimePreprocessor` / `MustKeepPolicy` / `DEFAULT_MUST_KEEP_POLICY` / `BaseContextProvider` / `AGENT_CONSTANTS` / agent profile namespace。chat profile 已删除；纯聊天/单轮能力请注册为 tools-disabled agent |
| `@linnlabs/linnkit/testkit`               | **测试专用**                                       | scripted canonical inference harness、graph loop harness、tool context fixture、replay harness、断言、`createRunSupervisorHarness` / `createCollectingAuditPort` / `createMockTelemetryPort` / `createMockTokenizerPort` / 15 条 run 不变量 + 12 条 context policy 不变量校验。`AGENT-GUARD-10-no-testkit-in-production` 强制守门——生产代码不能 import                                                                                                                                            |
| `@linnlabs/linnkit/quickstart`            | **试用 / demo**                                  | `defineAgent` / `runAgent` / `defineConfig`，用于 5 分钟跑通 hello agent；生产 host 接入仍按本目录主题手册逐项装配                                                                                                                                                                                                                                                                                                                                                                        |


## 5. 浏览器使用规则（硬约束）

**前端代码（renderer / browser bundle）禁止 import `@linnlabs/linnkit/runtime-kernel`**——这条入口是 namespace 全展开，会把 `node:async_hooks` / `crypto` 等 Node-only 子树拖进 frontend bundle。

前端如果只是要做事件展示决策（"这条 RuntimeEvent 该不该回放给 UI？"），从 `**@linnlabs/linnkit/runtime-kernel/events**` 这个 slim seam 取纯函数：

```ts
// renderer/src/agentEventPolicy.ts
import {
  shouldReplayRuntimeEventToUi,
  getRuntimeEventUiProjectionKind,
} from '@linnlabs/linnkit/runtime-kernel/events';
import type { RuntimeEvent } from '@linnlabs/linnkit/contracts';
```

`@linnlabs/linnkit/contracts` 是 browser-safe 的 Zod schema + 类型入口。前端处理不可信 RuntimeEvent / SSEEvent 时必须从这里按需导入 schema 并执行 parse；不要为了省 bundle 体积复制 TypeScript interface 或退回类型断言。只需要生命周期纯函数时继续优先使用更窄的 `/runtime-kernel/events`。

## 6. import 选择决策

```text
要决定一条 import 应该走哪个子入口？
├── 我在前端 bundle 里？
│   └── 是 ──▶ 只能是 /runtime-kernel/events 或 /contracts
├── 我在测试代码里？
│   └── 是 ──▶ 可以 /testkit；其它子入口照常用
├── 我要类型/合同？
│   └── 是 ──▶ /ports（host 实现合同）或 /contracts（消息/事件合同）
├── 我要 context 和 fence 机制？
│   └── 是 ──▶ /context-manager
└── 其它（runtime 装配、graph、tool runtime、LLM caller 骨架）─▶ /runtime-kernel
```

不要 `import { something } from '@linnlabs/linnkit/runtime-kernel/<deep>'`。`exports` 字段没声明的路径在 Node 16+ ESM 解析下会直接报错，且任何 deep path 都不在稳定 API 范围。

### 6.1 RuntimeEvent 发布与 incoming fact

Agent / Graph 生成的 RuntimeEvent 必须通过一次 execution 的 `RuntimeEventPublisher.publish` 发布，由 publisher 统一附着 `run_id / parent_run_id / lane / visibility`、创建 EventEnvelope，再让 realtime、persistence 和 observers 平级消费。Graph node、SSE adapter 和 persistence adapter 都不能自己补身份或补发事实。

Provider / Agent mapper 永远只创建 admission 前的 `RuntimeEvent` 草稿，不接收 routing identity。可执行 Graph 必须由装配层注入 `RuntimeEventSink`，并且只把 sink 返回的 `RoutedRuntimeEvent` 放入 journal。root、child、detached、quickstart 与 testkit 都遵守同一规则；禁止通过 `TickOutput.newEvents`、collector 或执行结束遍历 Graph result 维护第二事件通道。

Host 接纳的 incoming fact（用户输入、HITL interaction response 等）采用 durable-first：run admission 后先通过同一 publisher 的 `route` 得到正式事实，再在 admission transaction 提交；成功后使用 `publishRouted` fan-out，并避免 persistence consumer 重复写入。客户端只发送 command，不创建“已提交”RuntimeEvent。

Runtime 身份不是一条 `conversation → run → execution → turn → answer` 的父子链。conversation 同时拥有逻辑 turn 与 run；同一 run 在 wait-user / resume 前后保持稳定，并可包含多个 execution；resume 复用稳定 `turn_id`，只更换 `execution_id`；answer 绑定单次 execution 与该 turn，tool call 属于 run 并可跨 execution 延续。`turn_id` 在 conversation 内唯一，`answer_id` 全局唯一，`tool_call_id` 在 run 内唯一。即使 ID 本身全局唯一，运行态索引仍须保留 run / execution / turn scope，避免把生命周期归属退化成字符串碰撞判断。完整身份矩阵、关系图、final answer 等值关系与禁止替代规则见 [`runtime-identity.md`](./runtime-identity.md)。

持久化、read model 与观察器读取完整 RuntimeEvent 的正式身份时，必须使用 `parseRuntimeEventRoutingIdentity(event)`。该函数只接受顶层 `run_id / parent_run_id / lane / visibility`；禁止从 `metadata.run_id`、`metadata.run_context` 或 `turn_id` 猜测身份。缺少正式身份代表 publisher / admission 边界被绕过，应直接失败。

child fact 先进入独立 child EventBus/EventStore，父级 `subrun_trace` 只是通过 `source_event_id` 关联的展示 read model。child 工具 decision 在 trace 中保留 canonical `tool_calls[]` 完整批次，process 才表示单个调用经 owner admission 后实际开始；协议不定义 queued/pending 展示状态。成功 child 工具结果可以为完整详情保留经过合同校验的有序 durable resource refs，但 trace 不传资源字节、物理路径，也不把它们加入父模型输入。任何影响路由、归并、生命周期或副作用目标的值，都必须进入共享 contracts 或由 host/app 从已校验 DTO 建立显式 ID 映射；开放 `metadata/meta` 只能保存非关键展示和诊断信息。完整规范与测试门禁见 [`realtime.md`](./realtime.md)、[`child-runs.md`](./child-runs.md) 和 [`testing.md`](./testing.md)。

Host composition root 必须一次性装配 Supervisor、EventStore、cursor、Audit、Telemetry、
CostCollector 与模型输入端口，并创建一个 registered child invoker 显式注入 root
ToolContext；递归 child 继承该实例。执行链不得通过 global getter、lazy singleton 或
Memory fallback 补齐缺失依赖。需要接入多 agent、多 workspace 或可重建 runtime 时，
先阅读 [`child-runs.md §5.1`](./child-runs.md) 的 scope 合同，并按
[`testing.md`](./testing.md) 同时验证 run 身份隔离与双 runtime 实例隔离。

---

## 7. 文档索引

### 7.1 起步必读（按顺序）


| #   | 文档                                         | 内容                                   |
| --- | ------------------------------------------ | ------------------------------------ |
| 1   | 本文 §1-§6                                   | 它是什么 / 你要写什么 / 8 个公开 API 子入口 / 浏览器规则 |
| 2   | [01-installation.md](./01-installation.md) | 装包 / `.npmrc` 鉴权 / 验证                |
| 3   | [02-quickstart.md](./02-quickstart.md)     | 5 分钟最小 host 骨架                       |


### 7.2 单点接入（按你需要的功能查）


| 主题                                                                                    | 文档                                                                                                                          |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 接 LLM provider（OpenAI / Anthropic / DeepSeek / OpenRouter）                            | [llm-provider.md](./llm-provider.md)                                                                                        |
| 工具集接入面（`ToolRuntimePort` / `ObservationPreviewPort` / 流式生命周期 policy）                                  | [tools.md](./tools.md)                                                                                                      |
| **工具开发规范**（`BaseTool` 设计哲学 / `data`-`observation` 分层 / 错误处理 / `getExecutionSummary`）⭐ | [tool-development-guide.md](./tool-development-guide.md)                                                                    |
| 工具结果图片（selection、resolver、执行期能力校验与失败语义） | [tool-development-guide.md §7.4](./tool-development-guide.md) / [tools.md](./tools.md) |
| Host 确定性发起工具并直入 ToolNode                                                          | [host-originated-tools.md](./host-originated-tools.md)                                                                      |
| **Agent 注册与装配**（`AgentSpec` 静态蓝图 / `defineAgent` quickstart helper / 多 agent 协作）⭐     | [agent-registration-guide.md](./agent-registration-guide.md)                                                                |
| **上下文工程总览**（模型 route 容量基线 + `contextPolicy` 行为/显式 cap + Prompt 快照闭环）⭐        | [context-engineering.md](./context-engineering.md)                                                                          |
| **Token 管理口径**（预算估算 / remote count / provider usage / 账本 / calibration）                         | [token-management.md](./token-management.md)                                                                                |
| **接 context engineering（fence 注册 + 注入）⭐ 一等接入面**                                       | [context-fences.md](./context-fences.md)                                                                                    |
| 自定义 token 估算（`TokenizerPort` 替换默认 tokenizer · 0.8.0+）                                 | [token-management.md](./token-management.md) / [context-engineering.md §9.4](./context-engineering.md)                     |
| 配置工具历史保留策略（per-pair / per-run / none；drop / compress）                              | [tool-history.md](./tool-history.md)                                                                                        |
| 接持久化（Checkpointer / EventStore / RunRegistryStore）                                    | [persistence.md](./persistence.md)                                                                                          |
| 接 RunSupervisor + RunHandle                                                           | [run-supervisor.md](./run-supervisor.md)                                                                                    |
| 接 wait_user / HITL 一次性恢复与跨 transport 观察                                      | [run-supervisor.md](./run-supervisor.md) / [realtime.md](./realtime.md)                                                     |
| 同步嵌入 vs 异步后台子 agent                                                                   | [child-runs.md](./child-runs.md)                                                                                            |
| 接 AuditPort（决策账本）                                                                     | [audit.md](./audit.md)                                                                                                      |
| 接 telemetry                                                                           | [telemetry.md](./telemetry.md)                                                                                              |
| 实时通道（SSE / WebSocket / IPC）                                                           | [realtime.md](./realtime.md)                                                                                                |
| Runtime / answer / tool / UI message 身份合同                                                | [runtime-identity.md](./runtime-identity.md)                                                                                 |
| 新增或修改 RuntimeEvent / SSEEvent / lifecycle 语义                                       | [realtime.md §5](./realtime.md)                                                                                             |


### 7.3 测试 / 边界 / 速查


| 主题                                     | 文档                                                           |
| -------------------------------------- | ------------------------------------------------------------ |
| 测试与 testkit（两层架构）                      | [testing.md](./testing.md)                                   |
| 硬约束 + 不建议做的事 + FAQ                     | [constraints-and-pitfalls.md](./constraints-and-pitfalls.md) |
| 术语对照（Checkpoint / Event / Fence 的不同含义） | [glossary.md](./glossary.md)                                 |


### 7.4 推荐阅读顺序

**第一次接入（最少 30 分钟）**：

1. 本文 §1-§6 → 先把"我装了啥、它给我啥"看清
2. [01-installation.md](./01-installation.md) → 装包鉴权跑通 smoke
3. [02-quickstart.md](./02-quickstart.md) → 写一个能跑的最小骨架
4. [tool-development-guide.md](./tool-development-guide.md) ⭐ → **写工具**：`BaseTool` 设计哲学、`data` / `observation` 分层、错误处理协议
5. [agent-registration-guide.md](./agent-registration-guide.md) ⭐ → **注册 Agent**：`AgentSpec` 静态蓝图 / `defineAgent` quickstart helper / 多 agent 协作
6. [context-engineering.md](./context-engineering.md) ⭐ → **鸟瞰**：模型 route 与 Agent cap 如何形成有效预算、所有作用在 messages 上的机制是什么，以及如何用 policy trace 和成功 Prompt 快照解释最终 token 决策
7. [context-fences.md](./context-fences.md) ⭐ → **实操**：fence 注册与注入是 linnkit 一等接入面
8. [token-management.md](./token-management.md) → **口径**：预算估算、remote count、provider usage、账本与 calibration 分别是什么
9. 按需读单点接入文档

**续作（按需）**：

- 写测试 → [testing.md](./testing.md)
- 上线前 → [constraints-and-pitfalls.md](./constraints-and-pitfalls.md) + [glossary.md](./glossary.md)

### 7.5 按问题查文档（FAQ-style · AI agent 友好）

> 当 AI 助手 / 新接入者用自然语言提问时，这里把"我想……"映射到具体文档段落。每个条目精确到文件 + 段号，避免泛指。


| 我想……                                                  | 看这个                                                                                                                                                            |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ……装包跑通最小骨架                                            | [01-installation.md](./01-installation.md) → [02-quickstart.md](./02-quickstart.md)                                                                            |
| ……换一个 LLM 模型 / 接 OpenAI / Anthropic / DeepSeek        | [llm-provider.md](./llm-provider.md)                                                                                                                           |
| ……写一个自定义工具（怎么定义 `data` / `observation` / 错误处理）        | [tool-development-guide.md](./tool-development-guide.md) ⭐                                                                                                     |
| ……让模型读取工具刚产生的图片                                  | [tool-development-guide.md §7.4](./tool-development-guide.md)；host 装配见 [tools.md](./tools.md)                                                               |
| ……把工具注册到 agent 上                                      | [tools.md](./tools.md) + [agent-registration-guide.md §2](./agent-registration-guide.md) ⭐                                                                     |
| ……跳过首轮 LLM，由 host 确定性发起一个工具                         | [host-originated-tools.md](./host-originated-tools.md)                                                                                                         |
| ……让工具产生的超长 observation 不占满上下文                         | [tools.md §5](./tools.md)（`ObservationPreviewPort`）+ [context-engineering.md §6](./context-engineering.md)                                                     |
| ……定义一个新 agent / 写 `AgentSpec`                         | [agent-registration-guide.md](./agent-registration-guide.md) ⭐                                                                                                 |
| ……配 token 预算 / 控制每个 token / 确认改预算要不要到处改          | [context-engineering.md §0.1](./context-engineering.md#context-policy-source-of-truth)（配置真相源与三层合并）+ [token-management.md](./token-management.md) |
| ……让前端在每次成功 LLM 调用后刷新上下文占用                      | [token-management.md §3](./token-management.md#3-一轮请求的数据流) + [realtime.md §4](./realtime.md#4-几个常见事件的处置-cheatsheet) |
| ……用真实的 Claude / Gemini tokenizer 替代默认                 | [token-management.md](./token-management.md) + [context-engineering.md §9.4](./context-engineering.md)（`TokenizerPort`）                    |
| ……配置自动上下文压缩的触发/目标水位、输出上限或显式禁用 | [agent-registration-guide.md](./agent-registration-guide.md) §4.2 + [context-engineering.md](./context-engineering.md) §5.3 |
| ……把 host 的"当前文件 / 项目状态 / 引用段落"喂给 agent                | [context-fences.md](./context-fences.md) ⭐                                                                                                                     |
| ……让关键信息（如 user prefs）永远不被裁掉                           | [context-fences.md](./context-fences.md) ⭐（`mustKeep` policy）                                                                                                  |
| ……工具调用反复占满上下文要压缩                                      | [tool-history.md](./tool-history.md)（`per-pair` / `per-run` / `none`）                                                                                          |
| ……配 fence 生命周期（current-turn / persisted / boot-only）  | [context-fences.md §3](./context-fences.md) ⭐                                                                                                                  |
| ……让 run 跨进程崩溃后恢复                                      | [persistence.md](./persistence.md) + [run-supervisor.md](./run-supervisor.md)（`recoverOnBoot`）                                                                 |
| ……让用户能取消正在跑的 agent                                    | [run-supervisor.md](./run-supervisor.md)（`RunHandle.cancel`）                                                                                                   |
| ……让用户回答问题后恢复原 run，并防止重复提交                     | [run-supervisor.md](./run-supervisor.md)（`claimResume → activate/release`）                                                                                      |
| ……agent 里调另一个 agent / 多 agent 协作                      | [child-runs.md](./child-runs.md) + [agent-registration-guide.md](./agent-registration-guide.md) §8 ⭐                                                           |
| ……做后台异步长任务 / spawn detached run                       | [child-runs.md §2](./child-runs.md)（`spawnDetached`）                                                                                                           |
| ……把 agent 进度推到前端 / SSE / WebSocket / Electron IPC     | [realtime.md](./realtime.md)                                                                                                                                   |
| ……前端 import linnkit 报错（`node:async_hooks` / `crypto`） | [README §5](./README.md)（browser rules）+ [realtime.md](./realtime.md)                                                                                          |
| ……监控 token usage / 时延 / 接 Datadog / Otel              | [token-management.md](./token-management.md) + [telemetry.md](./telemetry.md)                                                                                 |
| ……做合规审计 / 追溯"agent 为什么这么做"                            | [audit.md](./audit.md)                                                                                                                                         |
| ……写第一个 agent 单测 / mock LLM                            | [testing.md](./testing.md)                                                                                                                                     |
| ……mock 自定义 tokenizer 验证 budget                        | [testing.md](./testing.md) + [context-engineering.md §9.4.6](./context-engineering.md)（`createMockTokenizerPort`）                                              |
| ……review 别人的接入是否符合 linnkit 边界                         | [constraints-and-pitfalls.md](./constraints-and-pitfalls.md) + [glossary.md](./glossary.md)                                                                    |
| ……同事说"Checkpoint" / "Fence" / "Run" 我搞混了              | [glossary.md](./glossary.md)                                                                                                                                   |


> **找不到匹配的问题？** 优先查 [context-engineering.md](./context-engineering.md) ⭐（上下文工程总览） / [agent-registration-guide.md](./agent-registration-guide.md) ⭐（agent 配置入口）；仍找不到，是真正的"linnkit 不直接做"——见 [constraints-and-pitfalls.md](./constraints-and-pitfalls.md) §2。

---

## 8. 当前版本与稳定性

- 当前版本：以 `package.json#version` 为准
- 0.x = pre-release 期：**任何加 export / 改既有签名都 bump minor**，patch 兼容
- 8 个稳定子入口已在 `package.json#exports` 锁定；任何 deep import 都不在稳定面
- 公开版本变化见仓根 `CHANGELOG.md`

---

## 9. 与其他文档的关系

- **包根 [README.md](../../README.md)**：包级总览
- **[docs/README.md](../README.md)**：框架总览（运行时分层、数据流、术语速查）
- **[CHANGELOG.md](../../CHANGELOG.md)**：公开版本更新记录
- **本目录**：接入手册（你正在读的）
