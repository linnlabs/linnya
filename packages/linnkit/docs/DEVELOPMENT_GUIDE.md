# linnkit Development Guide

> 本指南是 linnkit package 内部开发约定。`packages/linnkit/src/*` 是 `linnkit` package 的真源，所有路径都用此前缀。

`packages/linnkit/src/*` 当前已经按 package-neutral 边界收口，并以独立 `linnkit` package 形态对外提供能力。

这份文档只回答一个问题：

**开发 linnkit 内部新能力时，代码到底该放哪。**

> 如果你在做的是接入方层的工作（把 linnkit 装进自己的产品），请改看 [`integration/`](./integration/) 下按主题拆分的手册集（从 [`integration/README.md`](./integration/README.md) 进入）。

---

## 1. 先判断 owner

先按这四问判断：

1. 这是任何 Agent 产品都需要的平台能力吗？
2. 它是否依赖具体宿主实现、数据库、SSE、Electron、renderer？
3. 它是否依赖具体产品语义，比如 agent 列表、promptKey、默认工具集、权限、产品请求形状？
4. 它是否只是测试支撑，而不是运行时代码？

结论规则：

- 平台能力：放 `packages/linnkit/src/*`（本仓库内）
- 宿主实现：**不在本仓库**——属于接入方自己仓库的 `app-hosts/<your-host>/adapters/*`
- 产品语义：**不在本仓库**——属于接入方自己仓库的 `app-hosts/<your-host>/agent-registry/*`、`context/*`、`context-policies/*`
- 通用测试支撑：放 `packages/linnkit/src/testkit/*`
- 宿主测试支撑：**不在本仓库**——属于接入方自己仓库的 `app-hosts/<your-host>/testkit/*`

如果你判断结果不是"平台能力"，那这一行代码不应该出现在 linnkit package 里。

---

## 2. 常见落点

### 2.1 `runtime-kernel`

放这里的东西：

- graph loop / tick pipeline / node protocol
- RuntimeEvent lifecycle
- tool runtime protocol
- child-run protocol
- LLM caller / resolver / streaming skeleton
- run-context / reminder / enrichment framework
- Telemetry port + 5 类 kind 常量
- RunSupervisor / RunHandle / RunRegistryStore port 与生命周期纯函数

不要放：

- 默认工具集
- 默认 model policy
- SSE / persistence / flow orchestration
- 任何 host 层请求 shape

### 2.2 `context-manager`

放这里的东西：

- shared pipeline / provider / preprocessor 框架
- history purification / working-memory / 自动压缩候选与重建
- agent profile owner
- 通用 message formatting / event conversion
- 单轮 / 无工具调用场景的通用表达仍是 agent profile：由 host 注册 tools-disabled agent，而不是新增 chat profile

不要放：

- promptKey 绑定
- registry 查询
- 任何 host 层 request/schema validation
- 默认 provider policy

> **agent-only 约定**：`context-manager/profiles/chat/*` 已删除。纯聊天、补全、翻译这类真正的单轮产品能力应在 host 层注册为 tools-disabled agent，并通过 fence / options 把产品字段转换成通用 agent 输入。自动上下文压缩不是独立 Agent：Context Manager 只负责纯计划、校验和重建，模型调用与 durable `history_summary` 提交由 Graph tick pipeline 负责。不要重新引入 chat profile、专用 Summary Agent 或 chat task resolver。

### 2.3 `ports` / `contracts`

放这里的东西：

- 任何 host 必须实现的最小接口（`ports/`）
- 任何长期稳定不变的合同结构（`contracts/`）

原则：

- ports 必须 package-neutral，不能假设某个 host 的具体实现形态
- contracts 一旦稳定就要尽量保持向后兼容

### 2.4 `testkit`

放在 `packages/linnkit/src/testkit/*` 的：

- package-neutral harness
- context replay / pipeline fixtures
- tool execution fixtures

**不**放在这里的：

- 任何依赖具体 host runtime assembly 的 harness（如 graphLoopHarness host wrapper / childRunHarness host wrapper / toolRegistryHarness host wrapper）—— 这些属于接入方自己 `app-hosts/<your-host>/testkit/*`

> **testkit 硬约束**（`AGENT-GUARD-10-no-testkit-in-production`）：生产代码（包括 `packages/linnkit/src/index.ts`）**禁止** import `linnkit/testkit` 或任何 `testkit/*` deep path；只能在测试文件中显式 import `linnkit/testkit` 子入口。
> 否则 `vitest` 等测试依赖会被 esbuild/tsup 打入生产 bundle（历史上发生过真实事故，已通过 AST guard 拦死）。

---

## 3. 当前硬边界

`npm run guard:agent-boundary` 当前已升级为 **AST 级**（基于 TypeScript Compiler API 遍历），并与其它边界门禁共同强制以下关键规则：

1. `packages/linnkit/src/*` 生产代码不得 import 任何 host 仓库路径（`src/app-hosts/*`、`src/electron-main/*` 等）
2. `packages/linnkit/src/*` 生产代码不得 import `packages/linnkit/src/*` 之外的其他 `src/*` owner
3. `packages/linnkit/src/*` 生产代码外部 workspace contract 引用受白名单约束
4. `packages/linnkit/src/host-adapters` / `packages/linnkit/src/product-extensions` 不得重新出现
5. **`AGENT-GUARD-10-no-testkit-in-production`**（见 §2.4 注解框）
6. `packages/linnkit/src/__tests__/no-host-leakage.test.ts` 以大小写不敏感方式扫描全部生产 TypeScript，禁止具体 host/product 名称和富请求字段进入框架；测试夹具因需验证历史 replay 而明确排除
7. `npm run guard:model-inference-boundary` 扫描 Linnkit 核心，禁止直接 import Provider SDK、厂商 wire 字段和按厂商/模型家族名称分支；codec 与 payload 解释必须留在 Host capability

这意味着：

- 如果你在 `packages/linnkit/src/*` 里想 import 任何 host 路径或外部 `src/*` owner
  - 先停下
  - 先判断 owner 是否应该内化到 `packages/linnkit/src/*`
  - 如果不该内化——这条改动应在 host 仓库做，不在 linnkit
- 如果你想 import `linnkit/testkit`（包括 deep path）
  - 必须确认这是测试文件（被 guard 的 `isTestFile` / `isTestInfrastructureFile` 识别）
  - 否则会被 CI 直接拦掉

---

## 4. 改动 checklist

改 `runtime-kernel` 时：

1. 先确认不是 host/product 逻辑
2. 确认协议 owner 在 `packages/linnkit/src/*`
3. 优先显式注入，不要偷默认实现
4. 补对应 unit / contract / integration 测试
5. **如果新加可序列化结构**（如新增 RuntimeEvent 类型 / 新增 Checkpointer schema 字段），需评估是否影响历史回放与 schemaVersion 兼容性
6. 新 RuntimeEvent 必须先确定事实创建者，再经 `RuntimeEventPublisher` 附着正式 run 路由身份并发布；节点、collector、transport adapter 不得分别创建同一事实
7. `run_id / parent_run_id / lane / visibility` 必须使用 contracts 正式字段；任何影响路由、归并、生命周期或副作用目标的值也必须进入共享合同或由上层已校验 DTO 显式绑定，开放 `metadata` 只承载非关键扩展信息
8. 事实创建者拥有的必填身份必须直接体现在 TypeScript 契约中；例如答案事件的 `answer_id` 和 chunk `seq` 不得声明为可选后再由 mapper 兜底
9. execution 收尾必须区分 durable `run_execution_metrics`、权威 `run_status` 与 wire-only `transport_end`；三者不得合并或互相推断
10. 修改 System Reminder 时先读 [`runtime-kernel/system-reminder/README.md`](../src/runtime-kernel/system-reminder/README.md)：普通 tick Reminder 拼入末条 content；压缩专用 Reminder 是完整原 Prompt 后新增的瞬态 user-role message；durable `history_summary` 当前使用 system role，但不是 Reminder

改 `context-manager` 时：

1. 先确认它是不是 profile/core，而不是 app binding
2. 如果需要 task resolver / default policy / request adapter
   - 这是 host 层职责，不在 linnkit
3. 不要把任何 host 默认策略塞进 shared/profile owner
4. context engineering 只能沉淀通用机制：`context_injection`、`FenceRegistry`、`MustKeepPolicy`、preprocessor 生命周期。具体标签、文案、产品字段转换必须留在 host 层。
5. **不要重新引入 `profiles/chat/*`**；单轮/无工具能力走 host tools-disabled agent（见 §2.2）
6. token 预算、压缩候选、工具历史截断等上下文决策必须走 `TokenizerPort` / `state.tokens` 这条统一口径；不要在 context-manager 功能代码里直接调用 `TokenCalculator`，否则 host 自定义 tokenizer 与 calibration 会失效。最终 Prompt 的压缩触发与容量接纳属于 Graph，不得下沉回 Context Manager。

改 `ports` / `contracts` 时：

1. 必须保证 package-neutral
2. 加新 port 前先判断"是否真是 host 必须实现的"——而不是 host 选择性提供的能力
3. 改既有 port shape 必须考虑向后兼容；不向后兼容时必须先升 schemaVersion

---

## 5. 最小验证集合

### 改 runtime-kernel

- `packages/linnkit/src/runtime-kernel/graph-engine/__tests__/*`
- `packages/linnkit/src/runtime-kernel/llm/__tests__/*`
- `packages/linnkit/src/runtime-kernel/child-runs/__tests__/*`
- `packages/linnkit/src/runtime-kernel/run-supervisor/__tests__/*`
- `packages/linnkit/src/runtime-kernel/run-supervisor/functions/__tests__/*`
- `packages/linnkit/src/runtime-kernel/telemetry/__tests__/telemetry.contract.test.ts`
- `packages/linnkit/src/testkit/__tests__/graphLoop.endToEnd.contract.test.ts` —— **包内端到端永久回归门**

### 改 context-manager

- `packages/linnkit/src/context-manager/__tests__/summary-purification-integration.test.ts`
- `packages/linnkit/src/context-manager/profiles/agent/context/providers/__tests__/multiToolFollowup.integration.test.ts`
- `packages/linnkit/src/context-manager/features/context-compaction/functions/contextCheckpointLifecycle.test.ts`
- `packages/linnkit/src/context-manager/features/context-compaction/functions/selectContextCompactionCandidate.test.ts`
- `packages/linnkit/src/runtime-kernel/graph-engine/__tests__/graph-agent-executor.context-compaction.test.ts` —— **压缩模型调用、重建、提交屏障与主调用顺序的端到端回归门**

当前 context-manager 没有已知的 skip 测试。长对话、压缩和回放属于事故高发区，禁止用 `skip` 绕过失败；无法稳定执行的场景应先提取确定性 port/harness。

### 改 ports / contracts

- 关注所有引用该 port 的 contract 测试
- 在 `__tests__/package.shell.test.ts` 看公开 API 表面是否被守住

---

## 6. 容易踩的术语陷阱

### 6.1 `Checkpoint` 只表示执行状态快照；上下文压缩不是工具

| 概念 | 谁 owner | 用途 |
|---|---|---|
| **Engine-state Checkpoint** | linnkit 平台层（`runtime-kernel/graph-engine/checkpointer/` 的 `Checkpointer` port） | 保存 `EngineState`（`nodeId / pendingToolCalls / local`），让 run 中断后能恢复 |
| **Automatic Context Compaction** | Context Manager + Graph tick pipeline | 由最终 Prompt 占用自动触发，用当前已锁定模型生成固定格式摘要；容量接纳后按 durable commit → progress end → publisher fan-out 提交 `history_summary` |

**判断规则**：

- 你在改"图执行如何中断/恢复" → 改 `runtime-kernel/graph-engine/checkpointer/`
- 你在改"候选区段如何选择、摘要如何校验、压缩后如何重建" → 改 `context-manager/features/context-compaction/`
- 你在改"何时压缩、如何调用当前模型、何时提交事实" → 改 `runtime-kernel/graph-engine/features/context-compaction/` 与 tick pipeline
- 你在改 `Checkpointer` port 时，**不要**试图在里面塞"摘要"语义；它就是个 K-V，key 是 `checkpointKey`，value 是 `EngineState`
- 可独立运行的 host run 必须使用稳定 `runId` 作为 `checkpointKey`；同步 child-run 使用内部隔离的 run-scoped key。RuntimeEvent / Audit / Telemetry 的 `conversationId` 只能来自 graph local / ToolContext
- 旧 `context_checkpoint` 工具、marker、步数重置、专用 Summary Agent 和设置项已直接删除；不要增加别名、兼容读取或第二条压缩路径

当前合同详见 [`context-manager/README.md`](../src/context-manager/README.md) 与 [`integration/context-engineering.md`](./integration/context-engineering.md)。

### 6.2 "Event" 的几个层

| 名字 | 所在层 | 用途 |
|---|---|---|
| `AnyAgentEvent` | runtime-kernel 内部领域事件 | graph node 内部产出的原始事件 |
| `RuntimeEvent` | runtime-kernel → host 持久化事件 | 持久化、上下文重建、history 回放的事实来源 |
| 实时通道事件（如 SSE） | host realtime adapter | 前端实时渲染（**接入方自己负责**） |

注意：`RuntimeEvent` 的**生命周期治理**（`persist / replayToUi / enterAgentContext / realtimeChannel`）由 `runtime-kernel/events/eventGovernance.ts` 决定，它是浏览器安全的（通过 `linnkit/runtime-kernel/events` slim seam 暴露）。前端 reload 回放也走这条 governance。

### 6.3 运行时事件开发规范

新增或修改运行时事件时，评审必须能回答以下问题：

1. 事实是什么，唯一创建者在哪里；
2. `id / conversation_id / turn_id / run_id / answer_id / tool_call_id` 各自由谁拥有；
3. 事件何时通过 `RuntimeEventSink → RuntimeEventPublisher → EventBus` 发布；
4. realtime、persistence、graph journal、history 和 Agent context 分别如何消费同一事实；
5. schema、publisher 或 persistence 失败时，run 为什么不会错误进入 completed；
6. root、resume、auxiliary 与 child 是否复用同一创建语义；
7. live 与 reload 后的业务内容如何由测试证明一致。

允许多个消费者和投影，不允许多个事实源。正常业务事实不得使用 collector-only、persistence-only、Host type cherry-pick 或 transport fallback。开放 metadata 不能承载路由、归并、生命周期或副作用目标语义，publisher 之后任何消费者都不能修改 payload。

execution 结算顺序是 `run_execution_metrics` 发布、persistence drain、RunRegistry 状态落定、`run_status`、`transport_end`。admission 前失败使用 `transport_error`，admission 后失败才能创建 RuntimeEvent `error`。网络 EOF 不能代替 run settlement。

Provider streaming adapter 唯一拥有流式 `answer_id` 与 chunk `seq`。Graph 只验证序号连续并原样透传；EventEnvelope 的顺序只能映射为 `execution_seq`。完整答案由 Graph 内纯 assembler 原样拼接后重新进入同一 publisher，不能 trim、重新编号或直接写数据库。

---

## 7. 反模式

不要这样做：

- 在 `packages/linnkit/src/*` 里 import 任何 host 仓库路径（`src/app-hosts/*` 等）
- 在 `packages/linnkit/src/*` 里偷用任何"默认 ToolRegistry / 默认 aiEngine / 默认 model policy"——这些都是 host 层职责
- 把任何 host request schema 混进 context core
- 把 host-bound harness 塞回 `packages/linnkit/src/testkit/*`
- 在生产代码里 import `linnkit/testkit`
- 在前端代码里 import `linnkit/runtime-kernel`（必须改用 `linnkit/runtime-kernel/events` slim seam）
- 重新新增 `context-manager/profiles/chat/*` 或 `ChatMessageOrchestrator` 一类兼容导出
- 为了复用，先造 bridge 再开发
- 在 graph node 中构造 SSE DTO，或在 host 中从 returned events 按 type 挑选后补发
- 让 collector 直接写 persistence，或为同一事实维护 realtime / persistence 两套对象

---

## 8. 当前已知"按需触发"项

这些不是 TODO，是**条件触发**——只在真实需求出现时才动手，不要为了完整性提前做：

| 项目 | 触发条件 | 备注 |
|------|---------|------|
| **memory port** | 调研到 ≥ 2 个真实消费者 + 穿透 [`docs/archive/engine-phases/00-engine-scope-audit.md §1.1`](./archive/engine-phases/00-engine-scope-audit.md) 4 条门槛 | 当前判断"产品层 wrap 一层就够"，归 host 层候选，不进 framework；详见 [`docs/framework/04-protocol-roadmap.md` N-4](./framework/04-protocol-roadmap.md) |
| **permission port** | 同 memory port | wait_user + control.requireUser + control.terminateRun 三件套已够，host 层用 wrapper 即可 |
| **wait_external** | wait_user 协议泛化触发条件出现 | 主流 agent 框架均"无内核暂停"，linnkit 的 wait_user 已是先进设计 |

---

## 9. 推荐阅读

1. [`packages/linnkit/docs/README.md`](./README.md)
2. [`packages/linnkit/src/runtime-kernel/README.md`](../src/runtime-kernel/README.md)
3. [`packages/linnkit/src/runtime-kernel/system-reminder/README.md`](../src/runtime-kernel/system-reminder/README.md)
4. [`packages/linnkit/src/context-manager/README.md`](../src/context-manager/README.md)
5. [`packages/linnkit/docs/integration/`](./integration/) —— 接入手册集（按主题拆分）
6. [`packages/linnkit/docs/integration/token-management.md`](./integration/token-management.md) —— token 口径、估算、账本与校准
7. [`packages/linnkit/docs/framework/`](./framework/) —— 框架演进活文档
