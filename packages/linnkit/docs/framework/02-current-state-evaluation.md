# 02 · 现状评估

> 客观、偏严格地评估 linnkit 在 2026-05-13 这个时间点的水平。0.5.0 是上一条已发布基线；本文按当前源码状态评估 **0.6.0 候选线**，不等同于已发布版本。0.6.0 需在文档审阅通过后再 tag/publish。

> **⚠️ 历史快照**：本文记录 2026-05-13 的阶段性判断，不再定义当前合同。2026-08-25 起，文中的专用 Summary Provider / 摘要 Agent、`contextPolicy.summarization`、`contextPolicy.checkpoint`、`ContextCheckpointTool` 与 step-reset 已成组退役，由“Context Manager 纯计划 + Graph tick 自动 compaction + Host durable commit 后 end / publisher fan-out”统一替代；不保留旧字段或工具兼容。当前规范见 [`integration/context-engineering.md`](../integration/context-engineering.md) 和 [Graph Engine README](../../src/runtime-kernel/graph-engine/README.md)。

---

## 1. 总评

> linnkit 已经从"单宿主单机 agent 内核"升级成一个更完整的 **TypeScript Agent framework kernel**：Agent 静态画像、run 生命周期、审计事实表、上下文工程配置、父子 run 成本口径、testkit 不变量都已经成型。它仍然不是平台，不内置 IM / Memory backend / 沙箱 / 产品工具；它的价值在于把长期 agent 产品最难守住的内核协议做稳。

打分（满分 10）：

| 维度 | 现状评分 | 备注 |
|---|---:|---|
| 架构纪律（边界 / 不变量 / 守门） | **9.2** | AST guard、no-host-leakage、公开出口 snapshot、testkit 不变量一起守边界 |
| 内核可复用性（runtime-kernel） | **8.6** | graph loop / tick pipeline / tool protocol / RunSupervisor / AuditPort 已 product-neutral |
| 上下文工程（context-manager） | **9.0** | `AgentSpec.contextPolicy` 已开放预算、工具历史、must-keep、摘要、checkpoint、tool output、provider replay 等核心旋钮 |
| 可观测 / 审计 | **7.8** | G-1 AuditEnvelope + AuditPort 已落地；还缺 Replay SDK / DevTools Web / PromptTrace 产品化 |
| 生命周期管理 | **7.5** | RunHandle / RunSupervisor / spawnDetached / waitForTerminal 已落地；冷 pause/resume、runTree、handleFailure 仍按需后置 |
| 多 Agent / 协作 | **5.2** | child-run + detached run 已够产品使用；自由 agent mesh / message bus 还未做 |
| 集群 / 分布式 | **2.5** | EventBusPort 跨进程、分布式 Checkpointer / RunRegistry 仍未启动 |
| 开发者体验 | **6.8** | integration 文档很强，testkit 很强；CLI / 真正 5 分钟模板还没做 |
| 扩展机制 | **7.0** | AgentSpec、ports、registries 已经成型；MemoryPort / PermissionPort / SandboxPort 仍待真实需求拉动 |

**两条加权结论**：

- 如果按**"长期产品内核质量"**加权：8.8 / 10。linnkit 在事件治理、上下文工程、生命周期审计、测试不变量上已经接近顶级闭源产品内核的工程纪律。
- 如果按**"外部开发者第一周体验"**加权：6.8 / 10。接入文档够细，但还缺 CLI、模板、DevTools 和 replay。

---

## 2. 做对的 8 件事（必须继续守住）

### 2.1 Phase E 真抽包 + host 边界清理

`packages/linnkit/src/*` 是真源；宿主示范 / 默认值留在宿主侧，framework 不再认识 `document_fragment`、`user_quote`、`additional_context`、`[任务完成]` 这类产品表达层语义。

AST 级 `guard:agent-boundary` 强制规则包括：

- 内核不能直接 import 宿主代码
- ports 文件夹不能含实现
- shared 不能反向 import profiles
- testkit 不能依赖产品代码
- 公开入口必须走 `package.json#exports`

这是框架化的底线。后续越开放配置，越不能把具体 host 的默认值塞回 linnkit。

### 2.2 根入口 + 6 个稳定子入口公开面

```text
linnkit                          # 主入口（Node-only）
linnkit/ports                    # 宿主接入合同
linnkit/runtime-kernel/events    # 浏览器安全 slim seam
linnkit/contracts                # 协议类型
linnkit/runtime-kernel           # 完整 runtime
linnkit/context-manager          # 上下文子系统
linnkit/testkit                  # 测试工具
```

`linnkit/runtime-kernel/events` slim seam 是成熟设计：前端可以使用事件治理纯函数，不需要拉整个 Node-only runtime。

### 2.3 事件三层模型 + eventGovernance 四维

三层：

1. `AnyAgentEvent`：业务事件（thought / tool_call / answer / ...）
2. `RuntimeEvent`：包治理元信息的事实事件
3. realtime/SSE 投影：面向 UI 的实时视图

四维 `eventGovernance`：

| 维度 | 用途 |
|---|---|
| `persist` | 是否进 EventStore |
| `replayToUi` | 是否需要 UI 回放 |
| `enterAgentContext` | 是否进上下文窗口 |
| `realtimeChannel` | 是否走实时通道 |

这个设计让 SSE / 持久化 / 上下文准入成为同一份事实的不同视图，而不是三套 ad-hoc 逻辑。

### 2.4 `AgentSpec` 成为一等对象

0.5.0 之后，agent 不再只是 host registry 里的一条隐式记录。`AgentSpec` 已进入 `linnkit/contracts`，承载：

- `id` / `version` / `role` / `description`
- `capabilities`
- `tools`
- `contextPolicy`
- `modelHints`
- `audit`
- `metadata`

它与单次请求并存：`AgentSpec` 描述"这个 agent 是什么"，request 描述"这次要它做什么"。这个切分是 RunHandle、AuditEnvelope、testkit 和外部接入的共同基础。

### 2.5 当时的 Context Engineering 协议面（已由自动 compaction 收敛）

在 0.6.0 候选线，`AgentSpec.contextPolicy` 曾从最初 3 个粗粒度分组扩展成以下协议面：

- `budget`
- `toolHistory`
- `summarization`
- `mustKeep`
- `workingMemory`
- `checkpoint`
- `reasoningRetention`
- `tokenEstimation`
- `systemReminder`
- `contextTrace`
- `toolOutput`

Provider continuation replay 不属于 Agent 上下文策略，现由 Host 的 `inference_route.continuation.tool_replay` 声明并注入 strict guard。

其中 `summarization` 与 `checkpoint` 已由统一 `compaction` 分组替代；`reasoningRetention` 也已删除，因为 UI `thought` 不再是模型上下文策略，canonical reasoning 统一由 ordered Assistant replay 保留到正式压缩。保留下来的原则仍是：每个会影响最终 LLM 输入 token 的机制，都应该能被 host 声明、被 framework 合并、被 trace 解释、被 testkit 证明。

### 2.6 当时的“两类 checkpoint”表述（已退役）

当时文档用“执行控制层 `Checkpointer`”与“上下文 checkpoint marker”区分程序恢复和理解恢复，并在 0.6.0 候选线加入了 host-neutral `ContextCheckpointTool`。后续实践证明，同名 marker/tool 仍会把压缩、TaskState 与步数预算重新耦合，因此上下文侧整套能力已退役。

当前只有执行控制层 `Checkpointer` 使用 checkpoint 术语；它保存 Graph state、pending tool calls 与 wait-user resume 节点。模型上下文由自动 compaction 管理，以 `history_summary` 事实表达，不创建 marker、不暴露工具，也不修改步数预算。

### 2.7 `RunSupervisor` / `RunHandle` 让 run 有身份证和遥控器

run 生命周期已经从散落的 `AbortSignal`、EventBus、EventStore、telemetry 拼图，升级成统一管理面：

- `registerRun`
- `spawnDetached`
- `observeRun`
- `cancel`
- `peek` / `list`
- `waitForTerminal`
- `findActiveByConversation`
- `drain`
- `recoverOnBoot`

`RunHandle` 暴露 `signal`、`cancel()`、`observe()`、`cost()`、`meta()`、`spec()`、`request()`、`markRunning()`、`markCompleted()`、`markFailed()`、`markAwaitingUser()`。

这件事让 cancel、成本、状态、审计、实时事件第一次有了同一个运行时身份。

### 2.8 AuditEnvelope + testkit 不变量开始守协议

G-1 已落地：

- `AuditEnvelope`
- `AuditPort`
- noop / console / file / EventStore / composite sinks
- `model.select` / `model.fallback` / `tool.allow` / `tool.deny` / `wait_user.request` / `run.cancel`

testkit 也从函数 fixture 升级到 run-level harness：

- `createRunSupervisorHarness`
- `createCollectingAuditPort`
- `createMockTelemetryPort`
- `validateRunInvariants`
- 15 条 run invariants
- 失败注入

这意味着框架的行为不只靠人工 review，而是有可复用的协议级测试地基。

---

## 3. 当前短板（按优先级）

### 3.1 外部 DX 还没压平

文档已经从单文件拆成 `docs/integration/` 主题手册，内容足够深；但外部开发者第一周仍然会遇到三件事：

- 没有 `linnkit init` 生成最小项目
- 没有 `linnkit run` 跑一个 agent
- 没有 `linnkit doctor` 检查 provider / EventStore / contextPolicy / audit 配置

下一步不是急着做平台，而是把这条接入路径压成最短路径。

### 3.2 DevTools / Replay / PromptTrace 还没有产品化

linnkit 已经有足够多事实数据：

- RuntimeEvent
- AuditEnvelope
- ContextTrace
- RunRecord
- telemetry
- tool output preview / blob pointer

但还缺可视化和回放层：

- Event Timeline
- Context Window
- Prompt Diff
- Replay SDK
- Cost / audit 检索

这是"框架好用"与"框架可信"之间的差距。

### 3.3 Memory / Permission / Sandbox 仍是 port 空位

linnkit 目前坚持不做产品决策，这是对的。但未来要面向知识库 agent、在线秘书 agent、自动化 agent，至少需要产品中性 port：

- `MemoryPort`：强制 citation，不规定 backend
- `PermissionPort`：允许 host 自己接规则、小模型、人工审批
- `SandboxPort`：只描述执行合同，不内置 Seatbelt / Docker / bubblewrap
- `RedactionPort`：审计与隐私的共同基础

这些不该一次性做全，应该等真实接入方压出来。

### 3.4 冷 pause/resume、runTree、handleFailure 后置是合理的，但要守住边界

现在已有 `awaiting_user`，这是用户交互等待；`paused` 是未来冷暂停，两者不能混。

当前还未实装：

- 冷 `pause/resume`
- `runTree(rootRunId)`
- 标准 `handleFailure`
- 分布式 run recovery

这些都不是当前业务硬阻塞。正确策略是保留 NotImplemented 边界，等在线秘书 / 知识库 / 后台自动化真实需要时再补。

### 3.5 多 agent mesh / actor bus 还没开始

现在有 child-run 和 detached run，已经能覆盖父调子、后台执行、成本聚合。但还不是自由 agent mesh：

- 没有 mailbox
- 没有 publish/subscribe
- 没有跨进程 EventBusPort
- 没有 capability negotiation

这不影响 0.6.0 目标。不要为了完整性提前做 mesh。

### 3.6 chat 兼容层仍需收敛

`linnkitCompat` 已下线，但 chat profile 本体还没有彻底物理删除。长期目标仍然是 tools-disabled AgentSpec，而不是维护两套 agent/chat 心智。

这件事应该在 0.6.0 context engineering 审阅后择机清理，避免和当前发布线混在一起。

---

## 4. 评估结论

linnkit 当前瓶颈已经不是"缺一个像样的 agent 内核"。内核已经能站住。

接下来最重要的 4 件事是：

1. **把 0.6.0 context engineering 文档审阅完再发版**：这是一次大更新，必须把每个可配置字段的语义、默认值、host 边界写准。
2. **把外部接入路径压短**：Quickstart / CLI / 示例 host，让接入方不用先读完整架构史。
3. **把可观测事实变成工具**：Replay SDK / DevTools / PromptTrace，不然强事件治理的价值只停留在代码里。
4. **按真实接入方补 port**：Memory / Permission / Sandbox / Redaction，不做平台，不做多余实现。

一句话：linnkit 的护城河已经从"工程纪律"升级为"可审计、可测试、可配置的 agent kernel"。下一步要让外部接入方更容易用上这套能力。

---

## 5. 同行水平参照

| 维度 | linnkit | 国内 TS 同类（手搓） | 国际 TS 同类（开源） | 顶级闭源（CC / Codex） |
|---|---:|---:|---:|---:|
| 架构纪律 | 9.2 | 4-5 | 6-7 | 9 |
| 内核可复用性 | 8.6 | 3-4 | 7 | 8 |
| 上下文工程 | 9.0 | 3-4 | 5-7 | 9 |
| 可观测 / 审计 | 7.8 | 2 | 5-7 | 8 |
| 生命周期管理 | 7.5 | 2-3 | 6-8 | 8 |
| 多 Agent | 5.2 | 1-2 | 5-7 | 7 |
| 集群 | 2.5 | 1 | 3 | 5 |
| DX | 6.8 | 3 | 8 | 9 |

**结论**：linnkit 在内核纪律、上下文工程、run 生命周期审计上已经进入第一梯队；在 DX、DevTools、Replay、Memory/Permission/Sandbox ports 上还需要继续补。0.6.0 的目标应该是把 context engineering 配置面和文档闭环打实，而不是贪心扩大平台能力。
