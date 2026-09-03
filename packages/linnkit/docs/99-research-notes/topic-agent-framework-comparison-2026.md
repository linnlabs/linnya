# 主题调研 · 2026 主流 Agent 框架横向对比与 linnkit 评估

> - 调研日期：2026-05-11
> - 重大更新：2026-05-12，按 `@linnlabs/linnkit@0.5.0` 发布后的真实源码与接入文档重评 linnkit。
> - 二次更新：2026-05-13，按 `@linnlabs/linnkit@0.6.0` 发布后的真实源码重评 linnkit：Context Engineering 协议化（12 大分组 / ContextTrace / SystemReminder 注册表）正式纳入公共协议面。
> - 三次更新：2026-05-13，按 `@linnlabs/linnkit@0.7.0` 发布后的真实源码与本地 tag 重评：Quickstart helpers（`defineAgent` / `runAgent` / `defineConfig`）与 `linnkit init / run / doctor` CLI v0 正式上线；0.5 / 0.6 / 0.7 三个 minor 已完整落地，linnkit 进入"小步修缮"期，本次研究报告也是 0.x 阶段最后一次大跨度校准。
> - **四次更新（治理校准）：2026-06-22**——linnkit 实际版本已达 **`0.21.0`**（见 [`CHANGELOG.md`](../../../CHANGELOG.md)，含 0.11–0.20 里程碑：canonical telemetry usage / token ledger / token cost / context token components 等）。本报告 §0.5 / §16 中的 `0.7 / 0.8` 版本号是**历史快照**，治理时不逐行重写；版本与"已落地能力"一律**以 `CHANGELOG.md` + [`framework/14-governance-and-cleanup-plan.md`](../framework/14-governance-and-cleanup-plan.md) 为权威**。§17.8"伪待办"结论（MemoryPort / KnowledgePort / PromptTrace 不做 framework port）经 2026-06-22 复核**维持有效**。
> - **五次更新（发布校准）：2026-08-09**——linnkit 实际版本已达 **`0.28.0`**；`0.22.0`–`0.27.0` 为并入本次发布的内部里程碑。运行身份、规范化 `tool_output`、ephemeral `subrun_trace`、host-owned 产品语义和 durable observation reference 的现状以 [`CHANGELOG.md`](../../../CHANGELOG.md) 为权威；本文中的早期版本号继续作为历史快照保留。
> - **六次更新（上下文机制校准）：2026-08-25**——旧 `context_checkpoint` 工具、专用 Summary Provider / Agent、checkpoint step-reset 与相关配置已删除；当前由 Context Manager 生成纯压缩计划，Graph 在同一 tick 使用 run 已锁定模型执行并提交 durable `history_summary`。本文后续关于旧 checkpoint 与 12 分组配置面的描述只保留为历史评估，不代表 `0.31.0` 公共合同；现行入口见 [`integration/context-engineering.md`](../integration/context-engineering.md)。
> - 调研范围：linnkit 本地源码（含 26 条 strict invariants）、Linnya host 装配层、同级 `claude-code-main` 与 `hermes-agent` 源码/文档、主流 Agent 框架官方资料。
> - 产出性质：横向研究报告，不是落地设计文档。若后续进入协议改造，请把本报告结论摘到 `docs/framework/<topic>.md`。
> - 重要限制：Claude Code 同级目录是非官方公开快照，仅作为本地架构观察；公开结论优先引用 Anthropic 官方 Claude Agent SDK/Claude Code 文档。

---

## 0. 一句话总评

`@linnlabs/linnkit@0.7.0` 之后，linnkit 已经从"内核优先、宿主自装配、事件治理很强"的 TypeScript Agent runtime，**完成了向"协议型 Agent framework + 试用入口"的跃迁**。0.5.0 补齐 Agent 静态画像、run 生命周期、决策审计三块硬骨头；0.6.0 把 Context Engineering 从"内部装配能力"升级为 12 大分组的"外部声明式控制面"，并配套可观测的 `ContextTrace`；0.7.0 用 `defineAgent` / `runAgent` / `defineConfig` 与 `linnkit init / run / doctor` 把首次试用路径压成几行命令。

它仍然不做平台、不塞业务工具、不抢 host 的产品决策；但已经把 Agent 静态画像、run 生命周期、审计事实表、上下文策略、父子 run 成本口径、测试不变量与首次试用路径纳入了框架公共面。**0.5 / 0.6 / 0.7 三个 minor 是 linnkit 协议层的最后一次大跨度扩张**——0.7.0 起进入"**协议稳定 + 小修小补 + 按需触发可视化工具**"的长期状态。Replay SDK / DevTools / CostLedger 等可视化工具只在**真实业务需求出现时**才启动，不预先承诺时间表。

linnkit 的六块稀缺长期价值（截至 0.7.0）：

> 2026-08-14 修订：`contextPolicy.providerReplay` 已从公开合同移除。Provider continuation 要求由 Host 显式 inference route 唯一拥有；本文后续出现的 providerReplay 内容仅保留为历史研究记录，不代表当前 API。

1. **Agent 是一等对象**：`AgentSpec` 已进入 `linnkit/contracts`，含 `id / version / role / description / capabilities / tools / contextPolicy / modelHints / audit / metadata`；Provider continuation 能力不属于 Agent contextPolicy。
2. **run 生命周期有标准遥控器**：`RunSupervisor` / `RunHandle` 提供 `registerRun / spawnDetached / observeRun / cancel / peek / list / waitForTerminal / findActiveByConversation / drain / recoverOnBoot`；`RunHandle` 暴露 `signal / cancel() / observe() / cost() / meta() / spec() / request()` 与显式 lifecycle mark。
3. **审计是事实表，不是 telemetry**：`AuditEnvelope` / `AuditPort` 协议化 `model.select / model.fallback / tool.allow / tool.deny / wait_user.request / run.cancel`，支持 console / file / EventStore / composite sink；audit 不进入 UI、context、SSE。
4. **上下文工程是声明式 + 可观测**：12 大分组覆盖预算、工具历史、tool output 治理、provider replay、摘要、必保留、工作记忆、checkpoint、reasoning 保留、token 估算、system reminder、context trace；`ContextTrace` 把 "effective policy / 阶段 token delta / 每条消息 keep/drop 原因" 做成机器可读 sidecar。
5. **测试守协议**：`testkit/run-harness` 提供 **15 条 run 不变量 + 11 条 contextPolicy 不变量 = 26 条 strict invariants**，覆盖 lifecycle / audit / telemetry / cost / EventStore / ToolCall 配对 / wait_user 联动 / detached 终态 / effective policy / message decision / 工具配对一致性 / must-keep 类型保留。
6. **DX 入口已铺**：`defineAgent` / `runAgent` / `defineConfig` + `linnkit init / run / doctor` 让 5 分钟跑通 hello-agent；明确**仅作 demo host**——不替代生产接入。

真实剩余项（按"是否会真的去做"重排）：

1. **Replay SDK 未实装**：`EventStore` 是事实表底座，但回放协议（按 runId 回流事件、复现 contextTrace、复现 audit）还没产品化——**按需触发**，前置依赖 = 至少一个外部 host 提出"我能不能重放这次决策"的真实需求。
2. **DevTools 未实装**：Event Timeline / Context Window 视图缺；当前 audit / trace 只能 grep 日志——**按需触发**，前置依赖 = Replay SDK 形状稳定。
3. **CostLedger / QuotaPort 未实装**：`RunHandle.cost()` 是运行期口径，长期账单、quota、美元结算仍待 G-2——**按需触发**，前置依赖 = 真实多租户产品需求。
4. **冷暂停 / runTree / handleFailure 仍 NotImplemented**：明确按真实业务需求触发，不因为协议洁癖提前做。
5. **外部接入压测仍少**：Linnya 是唯一深度接入方；linnsy / 知识库类 host 是未来压测对象，但**它们的业务能力不应反向变成 linnkit 内置能力**。
6. **tool calls result 对象未标准化**：Vercel AI SDK 把 `steps / toolCalls / toolResults` 暴露成产品级 result 对象——linnkit **明确不做**，因为这是 host adapter 的工作；framework 已通过 `ToolRuntimePort` + `AuditEnvelope` + tool 配对不变量（C10）守住协议；接入方应在 host 层标准化（参考 linnya tool 开发规范），integration docs 会加一节提示。

> **被本次审视移出"短板清单"的伪待办**（详见 §17.7）：PromptTrace（context 段落溯源到原始事件）/ cache miss reason / context diff 可视化——它们的核心价值 ContextTrace 已经覆盖，剩余是 DevTools 层 / provider 层 / host 数据库 JOIN 层的事，不是 framework 的协议待办。

当前与各家的核心差距（按 0.7.0 状态校准）：

| 对手 | linnkit 已接近/领先的点 | linnkit 明确不追的点 |
|------|----------------------|---------------------|
| LangGraph | vendor-neutral run lifecycle、事件治理、context policy 集中度更高；固定 loop 心智更轻 | 任意 graph、durable graph state、time travel、LangSmith 生态 |
| OpenAI Agents SDK | provider-neutral、context token 策略全部白盒可声明、audit 是协议级 | hosted tools、sandbox agents、官方 tracing/evals、平台级结果状态 |
| Claude Code / Codex | host-neutral checkpoint、声明式 contextPolicy、audit/testkit 进入框架协议 | 软件工程工具链、权限/sandbox、MCP/skills/hooks 产品化、prompt cache 生产细节 |
| Mastra | 协议纪律 + 上下文配置面更深；不绑 memory/workflow/platform | TS all-in-one DX、DevTools、memory/evals/approval 一体化 |
| Vercel AI SDK | 生命周期、审计、上下文治理远强；Quickstart 入口已对齐 | 极简 API、Web streaming/UI/Fluid compute 部署 |
| LlamaIndex | runtime governance、context lifecycle、audit/testkit 更强 | 数据接入、RAG、index/query planning（linnkit 不追）|
| CrewAI / AutoGen | 可审计性、固定 loop 可控性强 | 多 agent 自由对话心智、Studio/企业工具链 |

定位判断的最终表述（0.7.0 起稳定）：

> **linnkit 是 TypeScript 生态里给长期产品复用的 Agent framework kernel**：固定主循环、声明式上下文工程控制面、强 run 生命周期管理、强审计事实表、强测试不变量、宿主自定义产品层。它不做"又一个 LangGraph"、不做"开源 Claude Code"、不做 all-in-one 产品平台；它的差异化是**协议精度 + 可观测精度**，不是功能广度。

---

## 0.5 做 / 不做 / 按需做 · 三栏边界（0.7.0 起稳定）

这是 linnkit 0.7.0 后**最重要的一节**：明确产品定位的具体表现。每一条都对应已经做到、明确不做、或保留按需触发的协议边界。读这份对比报告的人，看完这一节就能在 5 分钟内判断 linnkit 是不是适合自己。

### 0.5.1 framework 一定做（已在 0.5–0.7 落地）

| # | 能力 | 协议入口 | 落地版本 |
|---|------|---------|---------|
| 1 | Agent 静态画像 | `AgentSpec` / `contracts` / zod schema | 0.5.0 |
| 2 | Run 生命周期管理 | `RunSupervisor` / `RunHandle` / `MemoryRunRegistryStore` / `RunStatus` | 0.5.0 |
| 3 | 异步后台 run | `spawnDetached` + `RunExecutorPort` + `waitForTerminal` + `drain` + `recoverOnBoot` | 0.5.0 |
| 4 | 同步子 agent | `child-runs` + `invokeChildRun` + `parent_tool_use_id` | 0.5.0 |
| 5 | 决策审计 | `AuditEnvelope` / `AuditPort` / console / file / EventStore / composite sink | 0.5.0 |
| 6 | 事件治理 | `RuntimeEventLifecycleDecision` 4 维（uiProjection / persist / replayToUi / enterAgentContext / realtimeChannel）| 0.5.0 |
| 7 | TelemetryPort 父子聚合 | `runId` / `parentRunId` + 父子 `childrenTotal` 聚合 | 0.5.0 |
| 8 | 浏览器安全 seam | `runtime-kernel/events` 浏览器入口、纯函数事件治理 | 0.5.0 |
| 9 | 上下文工程协议 | `AgentSpec.contextPolicy` 12 大分组 + `ContextTrace` sidecar | 0.6.0 |
| 10 | 工具历史压缩 | `toolHistory.strategy: per-pair / per-run / none` + `overflowStrategy` 安全阀 | 0.6.0 |
| 11 | host-neutral checkpoint | `context_checkpoint` 工具 + `keepPairsBefore` / `triggerToolName` | 0.6.0 |
| 12 | tool output 治理 | `toolOutput.observationGovernance` + `ObservationPreviewPort`（落盘仍归 host）| 0.6.0 |
| 13 | provider replay 策略 | `providerReplay.{provider, requiresReasoningDetailsForToolReplay, missingSidecarBehavior}` | 0.6.0 |
| 14 | system reminder 注册表 | 6 个内置 trigger kind + spec 引用式 `extraRules` + 阈值覆盖 + 启用/禁用 | 0.6.0 |
| 15 | 测试不变量 | 15 条 run + 11 条 contextPolicy = 26 条 strict invariants | 0.6.0 |
| 16 | Quickstart 三件套 | `defineAgent` / `runAgent` / `defineConfig` | 0.7.0 |
| 17 | CLI v0 | `linnkit init / run / doctor` | 0.7.0 |

### 0.5.2 framework 明确不做（产品决策，不是缺陷）

| # | 不做的能力 | 为什么不做 | 替代方案 |
|---|----------|-----------|---------|
| 1 | 任意 graph DSL / 用户画图 | 90% agent 是固定形态，过设计；自由图模型让审计与回放变难 | 固定主循环 + 节点插槽（`before_llm` / `after_llm` / `before_tool` / `after_tool`）|
| 2 | 内置 RAG / 向量索引 / 检索 | 那是数据库 / 检索引擎的事 | host 自实现；未来仅给 `KnowledgePort` 边界 + citation 治理 |
| 3 | 内置业务工具（Read / Write / Edit / Bash / WebSearch 等）| host 产品决策 | host 通过 `ToolRuntimePort` 自注册 |
| 4 | Sandbox 具体实现（Seatbelt / bubblewrap / Docker / Firecracker）| 安全策略是 host 安全工程师的事 | 未来仅给 `SandboxPort` 边界 |
| 5 | IM 通道适配器（Telegram / WeChat / Slack / Discord / Signal）| 产品决策；调用面千差万别 | host 自接 |
| 6 | 内置 Memory 后端（Mem0 / Honcho / Holographic / Letta 等）| Hermes 走 all-in-one；linnkit 只给 port + 1-2 参考实现 | 未来仅给 `MemoryPort` 边界 |
| 7 | 多 agent 自由 chat / role / backstory 协议 | 容易把 prompt 产品语义升格成框架协议语义 | role/backstory 走 `AgentSpec.metadata`；多 agent 走 child-run 与 detached run |
| 8 | 按系统资源 / 任务复杂度自动切模型 | 4 家共识不做 | host `modelPolicyResolver` |
| 9 | 主机资源监控（CPU / 内存 / 磁盘 / 网络）| 4 家共识不做 | host telemetry 自接 Datadog / Prometheus |
| 10 | Prompt 正文持有 | framework 持有 prompt 文本 = 一旦改动让所有 host 的 LLM 行为偏移 | 摘要走 `summarization.agentId` 引用 host 注册的无工具 agent / chat；framework 只持有 ID |
| 11 | reminder 持久化进 history | 违反 reminder "瞬态状态注入"的协议本质 | 需要持久化提示走 fence `lifetime: 'persisted'` |
| 12 | host 中文表达层（`[任务完成]` / `<additional_context>` / `编辑器写作` 等）| 已被 Phase C `no-host-leakage` guard 守住 | host 表达层完全归 host |
| 13 | function 注入式扩展点（spec 里塞函数）| 破坏序列化、可回放、可审计能力 | 所有 host 自定义走"声明式 ID + 装配期注册表"（如 SystemReminder 的 trigger kind / template）|
| 14 | `steps / toolCalls / toolResults` 产品级 result 对象（Vercel AI SDK 风格）| SDK 层产物 / host adapter 工作；framework 已通过 `ToolRuntimePort` + `AuditEnvelope` + tool 配对不变量 C10 守住协议层 | host 自实现 / integration docs 提示参考 linnya tool 开发规范 |
| 15 | PromptTrace 独立溯源协议（context 段落 → 原始事件）| ContextTrace 的 `message-decision` 已覆盖核心价值；溯源到 event id 是 host EventStore JOIN 工作，不该再造独立协议 | ContextTrace + host DB JOIN |
| 16 | cache miss reason 独立诊断协议 | provider 内部信息，framework 不发明协议、只透传 provider 给的元信息 | TelemetryPort 透传 `prompt_cache_hit_tokens` 等 |
| 17 | context diff 独立协议 | DevTools 层可视化工具，按需触发；`replacementSourceIds` 已是协议层可对比基础 | DevTools v0（按需触发）|
| 18 | **MemoryPort** 边界 / 任何 memory 相关协议 | 本质是 host 业务层的"工具 + 召回 + fence 注入"——`write_memory` / `recall_memory` 工具走 `ToolRuntimePort`、召回结果走 fence（`lifetime: 'persisted'`）、关键 memory 走 `contextPolicy.mustKeep`，framework 已有协议足够表达 | host 业务层自实现 |
| 19 | **KnowledgePort** 边界 / 任何 RAG / 召回 / citation 协议 | 本质是 host 业务层的"工具 + 召回 + citation 字段约定"——`search_knowledge` 工具走 `ToolRuntimePort`、召回结果走 fence、citation 字段由 tool 返回结构决定（参考 linnya tool 规范的 `data` / `observation` 分层），framework 不需要硬编码 citation 协议 | host 业务层自实现 + 引用 linnya tool 规范 |
| 20 | **skills / tool catalog progressive disclosure** 协议 | 本质是 host 决定的"按上下文动态返回工具子集"——`ToolRuntimePort.list()` 已经是 host 接入面，可以根据当前 fence / mustKeep / 上下文返回不同工具集；"技能文档"通过 fence 注入即可 | host 业务层自实现 |
| 21 | **跨 provider 统一计费 token 数协议 / 自己造一份 token 数事实表** | 不同模型 token 计算口径不一样（OpenAI tiktoken / Anthropic claude-tokenizer / Gemini own / 国产各家自己一套），framework 发明跨 provider 标准化 token 数 = 必然与真实计费偏离 = 误导接入方 | 计费 token 数由 provider 返回的 `usage` 决定，host 自己消费；framework 不发明跨 provider 统一协议 |

> **澄清**（2026-05-13 后审视 · 术语校正）：**`tokenizer` 是"计算 token 的方法"的统称**——linnkit **内置一个默认 tokenizer**（实现：`DefaultTokenizerPort` 包装 `TokenCalculator` + `tiktoken@^1.0.22`；主路径走 OpenAI 编码族 + CJK 检测；tiktoken 失败时退到字节比兜底）。这是协议层既定事实，**不在"明确不做"清单**。它用于 `contextPolicy.budget` 决策（"还能塞多少消息"）。host 可通过 `contextPolicy.tokenEstimation` 的 3 个参数调整默认 tokenizer 的行为（encoding / avgCharsPerToken / toolCallOverhead）；**0.8.0 已新增 `TokenizerPort` 协议接口**——host 可以实现这个接口、注入自己的 tokenizer 替换默认（详见 §0.5.3.1 已落地项）。"明确不做"的是"对外暴露 / 标准化跨 provider 计费 token 数"，**不是**"linnkit 自己不持有任何 tokenizer"。

### 0.5.3 framework 按需触发（不预先承诺）

| # | 能力 | 触发条件 |
|---|------|---------|
| 1 | `pause / resume` 进程级冷暂停 | linnsy 或下游产品出现真实需求（当前 `wait_user` 已覆盖 95% 中断场景）|
| 2 | `runTree(rootRunId)` 父子 run 树形可视化 | DevTools 需要 / 真实复杂调度场景 |
| 3 | `handleFailure` 故障策略 | failover / 自动重试 / circuit breaker 真实需要 |
| 4 | AgentMessageBus（进程内 actor）| 真实出现"两个 agent 互相对话" / orchestrator + worker 场景 |
| 5 | EventBusPort 跨进程 / 分布式 Checkpointer / EventStore | 真实出现跨进程 / 集群部署需求 |
| 6 | `wait_external` 泛化（webhook / IM 回调）| 真实出现 webhook / IM 回调 / 子 agent 完成回调场景 |
| 7 | `SandboxPort` 实际接入 | 真实出现"自动化执行外部命令"场景 |
| 8 | `RedactionPort`（PII 脱敏）| 真实多租户 PII 需求 |
| 9 | reasoning artifact 协议 / NodeRegistry | ≥ 2 个消费者真有需求 |
| 10 | diff-based 重渲染（Codex `reference_context_item`）| alpha 验证后再评估 |
| 11 | 摘要 prompt 默认模板（framework 持有 prompt 正文）| 需要单独立项决策——它是个新的边界开口，不在 0.x 任何 minor 夹带 |

> **0.7.0 后审视移除**：`KnowledgePort` / `MemoryPort` 边界 / `skills` progressive disclosure 协议——本质是 host 业务层的"工具 + 召回 + fence 注入"，framework 已有协议（`ToolRuntimePort` + fence + mustKeep）足够表达；移入 §0.5.2 明确不做。

### 0.5.3.1 已落地的按需触发项

| # | 能力 | 落地状态 |
|---|------|---------|
| 1 | **`TokenizerPort` 协议接口**（host 用自定义 tokenizer 替换默认）| **0.8.0 已落地**——术语：`tokenizer` 是"计算 token 的方法"统称，linnkit 默认 tokenizer = `DefaultTokenizerPort`（tiktoken + 字节比兜底）；0.7.x 已通过 `tokenEstimation` 3 参数支持基础调整；0.8.0 起 host 可实现 `TokenizerPort` 并注入自定义 tokenizer 替换默认（用 Anthropic / Gemini 等真实 tokenizer 而非 OpenAI 编码近似）。公开 API 只保留 `@linnlabs/linnkit/runtime-kernel` / `@linnlabs/linnkit/ports` 等稳定入口；真实实现文件在 `src/shared/`，不进入 package exports。详细实施计划见仓库内 `docs/framework/12-tokenizer-port-plan.md`（内部档案，不在 npm tarball）|

### 0.5.4 这套"做 / 不做 / 按需做"为什么决定了 linnkit 定位

它直接决定了 linnkit 与同类框架的差异化：

- **vs Mastra（all-in-one）**：linnkit 拒绝把 memory / workflow / approval / evals / DevTools / platform 一口吃下。代价：入门门槛比 Mastra 高；收益：任何外部接入方都可以替换底层 port 而不被框架心智牵着走。
- **vs LangGraph（任意 graph）**：linnkit 拒绝把执行模型暴露成"用户画图"。代价：复杂拓扑要靠节点插槽 + child-run + detached run 组合；收益：80% agent 产品不需要先学 StateGraph。
- **vs Claude Code / Codex（产品内核）**：linnkit 拒绝内置软件工程工具链、TUI、IDE bridge、MCP/skills/hooks 产品化。代价：不能直接当编程 agent 跑；收益：任何垂直产品都可以基于 linnkit 自建工具与权限模型。
- **vs Vercel AI SDK（loop helper）**：linnkit 拒绝把自己降级成 streamText 包装器。代价：API 比 `generateText + tool + stopWhen` 复杂；收益：有真正的 run 生命周期、审计、上下文工程，不是几十行 demo 跑完就废。

**结论**：linnkit 的产品定位不是"功能最多的 agent 框架"，而是"协议精度最高 / 可观测性最好 / 与 host 边界最干净的 TypeScript Agent framework kernel"。这条路注定不会赢入门人数，但会赢长期产品。

---

## 1. 调研方法

### 1.1 本地阅读

本次先读本地代码再做判断，重点覆盖：

- `packages/linnkit/README.md`
- `packages/linnkit/package.json`
- `packages/linnkit/docs/README.md`
- `packages/linnkit/docs/integration/*`
- `packages/linnkit/docs/framework/00-vision-and-positioning.md`
- `packages/linnkit/docs/framework/01-peer-comparison.md`
- `packages/linnkit/docs/framework/02-current-state-evaluation.md`
- `packages/linnkit/docs/framework/07-roi-ranked-priorities.md`
- `packages/linnkit/src/runtime-kernel/*`
- `packages/linnkit/src/context-manager/*`
- `packages/linnkit/src/ports/*`
- `src/app-hosts/linnya/*`
- `<upstream-workspace>/claude-code-main`
- `<upstream-workspace>/hermes-agent`

### 1.2 外部资料

优先使用官方资料或官方仓库：

- LangGraph 官方文档：<https://docs.langchain.com/oss/python/langgraph/overview>
- OpenAI Agents SDK 官方文档：<https://developers.openai.com/api/docs/guides/agents>
- OpenAI Codex agent loop 官方文章：<https://openai.com/index/unrolling-the-codex-agent-loop/>
- Vercel AI SDK agent guide：<https://vercel.com/kb/guide/how-to-build-ai-agents-with-vercel-and-the-ai-sdk>
- Mastra 官方框架页：<https://mastra.ai/ai-agent-framework>
- DeerFlow GitHub：<https://github.com/bytedance/deer-flow>
- CrewAI 官方文档：<https://docs.crewai.com/en/index>
- Microsoft AutoGen 官方文档：<https://microsoft.github.io/autogen/dev/index.html>
- LlamaIndex Agents 官方文档：<https://developers.llamaindex.ai/python/framework/use_cases/agents/>
- Claude Agent SDK 官方文档：<https://code.claude.com/docs/en/agent-sdk/overview>
- Claude Code settings / subagents / hooks 相关官方文档：<https://docs.anthropic.com/en/docs/claude-code/settings>、<https://code.claude.com/docs/en/features-overview>
- OpenHands SDK 论文页面：<https://arxiv.org/abs/2511.03690>

### 1.3 评价维度

本报告按 9 个维度评价：

1. 开发体验
2. 执行模型
3. 性能与成本
4. 管理与生命周期
5. 上下文工程
6. 配置与扩展
7. 多 Agent
8. 可观测、审计与测试
9. 框架边界与长期演进

---

## 2. linnkit 当前架构画像

### 2.1 包形态

`@linnlabs/linnkit` 当前 `package.json` 真实版本是 `0.7.0`，本地已有 `v0.7.0` tag。公开子入口包括：

- `.`
- `./ports`
- `./contracts`
- `./runtime-kernel`
- `./runtime-kernel/events`
- `./context-manager`
- `./testkit`
- `./quickstart`
- `./package.json`

本地证据：

- `packages/linnkit/package.json:2-3`：包名与版本。
- `packages/linnkit/package.json#exports`：根入口 + `ports/contracts/runtime-kernel/runtime-kernel/events/context-manager/testkit/quickstart` 子入口 + `./package.json` 元数据入口。
- `packages/linnkit/package.json#bin.linnkit`：CLI v0 入口 `./dist/cli.cjs`。
- `packages/linnkit/docs/release/RELEASE.md`：0.5.0 记录 N-1 / N-3 / G-1 / testkit / docs integration 拆分；0.6.0 记录 Context Engineering 协议化；0.7.0 记录 Quickstart + CLI v0。

0.5.0 → 0.7.0 的公开面变化：

- `docs/framework/`、`docs/archive/`、`docs/99-research-notes/` 是仓库内部档案，不再作为 npm tarball 对外契约。
- 外部接入方主要读 `docs/integration/` 的 17 个主题化手册。
- `linnkitCompat` 下线（0.5.0），host 产品字段从 framework 协议中剥离，接入方必须按子入口导入。
- `defineAgent` / `runAgent` / `defineConfig`（0.7.0）已从根入口和 `./quickstart` 导出，但**明确仅服务 quickstart / smoke test，不等同于生产 host adapter**——生产 host 仍需按主题手册替换底层 port。
- CLI v0（0.7.0）只承诺 `init / run / doctor` 三件套；`replay / inspect` 等到 Replay SDK 形状稳定后再补。
- 0.6.0 一次性把 12 大分组 `contextPolicy` + `ContextTrace` + 26 条 strict invariants 一起释出；这是 0.x 阶段单次最大的协议扩张。

### 2.2 Runtime Kernel

`runtime-kernel` 的核心组成：

- `graph-engine`：固定状态机、节点注册、checkpoint、run loop。
- `events`：RuntimeEvent 生命周期治理。
- `execution`：event bus、sequencer、错误映射。
- `llm`：LlmCaller、model resolver、policy engine、streaming 工具调用累积。
- `tools`：工具协议、tool context、idempotency、artifact context。
- `child-runs`：同步 child-run 调用协议，父 agent 等子 agent 返回结果。
- `child-run-trace`：子 run 进度观测协议，公开事件 type 仍保留 `subrun_trace`。
- `run-supervisor`：`DefaultRunSupervisor`、`RunHandle`、`MemoryRunRegistryStore` 与 run lifecycle 管理协议。
- `audit`：AuditPort sink，包含 noop / console / file / EventStore / composite。
- `telemetry`：TelemetryPort、noopTelemetry、基础 contract test。

关键代码观察：

- `GraphExecutor` 仍然保持纯执行角色，通过 `AbortSignal` 接收取消，不直接依赖 RunSupervisor。
- `RunSupervisor` 负责把 `AbortController`、EventBus、EventStore、CostCollector、AuditPort 织成可管理的 run。
- `spawnDetached` 已经通过可注入 `RunExecutorPort` 表达异步后台 run；没有 executor 时明确抛 `NotImplementedError`，不会假装可用。
- `wait_user` 和冷暂停是两个语义：`awaiting_user` 来自用户交互等待；`paused` 留给未来 `pause/resume` 冷暂停。

评价：

- 优点：执行内核保持解耦，生命周期管理上提到 RunSupervisor；这比把 supervisor 硬塞进 engine 更健康。
- 缺点：冷暂停、run tree、标准失败策略还未实装；复杂父子 run 管理仍要等真实业务推动。

### 2.3 Event Governance

这是 linnkit 当前最强的资产之一。

本地证据：

- `RuntimeEventLifecycleDecision` 定义了 `uiProjectionKind / persist / replayToUi / enterAgentContext / realtimeChannel`。见 `packages/linnkit/src/runtime-kernel/events/eventGovernance.ts:36-42`。
- `describeRuntimeEventLifecycle` 统一判断事件是否持久化、是否回放 UI、是否进入上下文、是否走实时通道。见 `eventGovernance.ts:176-225`。
- 代码注释明确要求新增事件优先改这里，不要散落到 bridge/orchestrator/converter/projector。见 `eventGovernance.ts:3-8`。

对比结论：

- LangGraph 强在 state diff、interrupt、persistence，但它的事件投影更多依赖 LangSmith / runtime 生态，不像 linnkit 把 UI 回放、上下文准入、持久化、实时通道集中成框架内纯函数。
- Vercel AI SDK 的 `steps/toolCalls/toolResults` 很好用，但不是完整事件治理事实表。
- Claude Code/Codex 的事件和消息体系很强，但更像产品内核，不是独立框架公开的 vendor-neutral event governance。

### 2.4 Context Manager

Context manager 当前有 provider pipeline、summary、history purification、fence、must keep policy、agent/chat profiles，并已经接入 AgentSpec context policy。

本地证据：

- `runContextPipeline` 按 provider 顺序处理消息、维护 token budget、收集事件、记录阶段耗时和 token 用量。见 `packages/linnkit/src/context-manager/shared/context-pipeline.ts:42-140`。
- `AgentSpecContextPolicy` 包含 `profileId`、`budget`、`toolHistory`、`summarization`。
- `toolHistory` 支持 `strategy: 'per-pair' | 'per-run' | 'none'`、`overflowStrategy: 'keep-latest' | 'fail-fast'`、`maxInteractionGroups` 等字段。
- `MessageFormatter` 不再替 host 注入 `<additional_context>` 或 `[任务完成]` 这类表达层文案。

评价：

- 优点：上下文策略从"全局默认"升级为"按 AgentSpec 声明"，并且 framework/host 边界更干净；0.6.0 后 `ContextTrace` 把"每条消息 keep/drop 原因 / 阶段 token delta / 命中策略"做成机器可读的 sidecar，已经覆盖了大部分诊断需求。
- 改进余地：DevTools 层（Event Timeline / Context Window）尚未产品化，目前只能 grep `ContextTrace` JSON——按需触发，不是协议层缺陷（详见 §17.8）。

### 2.5 Ports 与 Host 边界

Linnya host 真实装配放在 `src/app-hosts/linnya/*`，这点很健康：

- runtime assembly 负责把 `GraphAgentExecutor`、`LlmCaller`、默认工具、上下文 builder、model resolver 拼起来。见 `src/app-hosts/linnya/adapters/runtime-assembly/graphRuntimeFactory.ts:61-87`。
- agent registry 把 promptKey、工具策略、模型策略、history builder extender、request enricher 收口到一个 `AgentDefinition`。见 `src/app-hosts/linnya/agent-registry/types.ts`。
- flow agent runner 承接 SSE、event bridge、run bootstrap、tool context、audit scope、finalizer。见 `src/app-hosts/linnya/adapters/flow/flow.agent-runner.service.ts`。
- 0.5.0 后，Linnya host 通过 `AgentSpec`、RunSupervisor、AuditPort、Telemetry scope、CostCollector 与 linnkit 公共协议对齐。

评价：

- 优点：host 与 framework 边界做得比较自觉。
- 缺点：作为外部框架，集成者仍需要理解 host runner、EventStore、realtime adapter、AgentDefinition 到 AgentSpec 的映射；CLI/示例 host 还没把这条路压成一条命令。

### 2.6 类型债与代码体量

本地发现：

- 阶段 0 已把 `BaseTool.run/validateArguments` 和 `AgentTool / OpenAIToolSchema / ToolCallResult` 收口到 `ToolArgs = Record<string, unknown>`。
- `runtime-kernel/llm/caller.ts` 和 `runtime-kernel/events/eventMappers.ts` 已按职责拆分，原 700 行以上旧债已还。
- `runtime-kernel/child-runs/internalAgentInvoker.ts` 已重命名为 `childRunInvoker.ts` 并拆分，主文件降到健康体量。
- `runSupervisor.ts` 仍接近 700 行关注线，已经登记观察；等 `runTree / handleFailure / recover` 继续扩展时，应拆 `detached-runner` / `terminal-waiters` / `run-recovery`。
- host 侧部分历史文件仍有体量与类型债，属于 Linnya host 清扫范围。

判断：

- 框架公开类型边界已经明显改善。
- 下一轮代码健康重点不在“公开工具 any”，而在 RunSupervisor 后续拆分、host schema 副本清理、CLI/quickstart 对外体验。

---

## 3. 主流框架概览

### 3.1 LangGraph

官方定位：

- LangGraph 是“low-level orchestration framework and runtime”，面向 long-running、stateful agents。
- 官方强调 durable execution、human-in-the-loop、memory、streaming、persistence、LangSmith observability。
- 官方也明确说它很 low-level，刚入门或要高级抽象时建议先用 LangChain agents。

来源：LangGraph 文档说明它专注 durable execution、streaming、human-in-the-loop、persistence 等底层编排能力，并把 LangGraph 定义为 orchestration runtime。

优点：

- 图模型强，适合复杂拓扑。
- persistence、interrupt、time travel、subgraphs 体系成熟。
- LangSmith 生态补齐调试、评估、部署。

缺点：

- 心智门槛高。写 agent 先理解 StateGraph、node、edge、state、interrupt。
- 对 80% 标准 ReAct / tool loop 产品来说，任意图是能力也是负担。
- TypeScript 生态虽然有支持，但核心声量与最佳实践仍偏 Python。

linnkit 对位：

- linnkit 不应该追求任意图，而应守住“固定主循环 + 可扩展协议点”。
- 可以学 LangGraph 的 durable execution / interrupt 抽象，但不要把用户心智变成画图。

### 3.2 LangChain Agents

官方栈里 LangChain 是更高层 agent framework，LangGraph 是 runtime。LangChain 适合快速组合模型、tools、retrievers、prompt templates。

优点：

- 生态最大，集成最多。
- 文档、示例、社区丰富。
- 适合从 RAG / chain / tool use 快速进入 agent。

缺点：

- 历史包袱大，抽象层较多。
- 真正复杂的 long-running agent 仍要下沉到 LangGraph。
- 对强事件治理、强上下文审计并不天然友好。

linnkit 对位：

- linnkit 不拼集成数量，应该拼“核心 loop 与上下文治理稳定可审计”。

### 3.3 OpenAI Agents SDK

官方定位：

- 用 SDK track 时，应用服务器拥有 orchestration、tool execution、state、approvals。
- 官方文档覆盖 agent definitions、running agents、sandbox agents、orchestration/handoffs、guardrails、results/state、observability、evals。
- 2026 文档和产品路线开始把 shell、apply patch、skills、tool search、background mode、webhooks、compaction、prompt caching 等都纳入 agent 平台能力。

优点：

- Agent、handoff、guardrail、trace、sandbox 的整体体验快速变强。
- 对 OpenAI 模型和 Responses API 的适配最顺。
- 官方 hosted tools、sandbox、background mode、observability 对生产很有吸引力。

缺点：

- provider-native，vendor-neutral 能力弱于自研内核。
- 很多能力会与 OpenAI 平台绑定，深度定制边界不如白盒框架。
- 事件治理、上下文策略会更依赖 SDK/平台设计。

linnkit 对位：

- linnkit 可以学习 `AgentSpec`、guardrail/permission、sandbox host port、results/state 设计。
- 不应该把 OpenAI hosted tools 或 Responses API 私有语义打进内核。

### 3.4 Vercel AI SDK

官方定位：

- 以 `generateText/streamText + tool + stopWhen/stepCountIs` 快速构造 agent loop。
- 文档强调工具定义、参数校验、自动执行工具、追加 tool result 到 conversation history、继续生成。
- Vercel Fluid compute 解决部署运行时长、冷启动、并发等 serverless 问题。

优点：

- TypeScript/Next.js 体验非常好。
- tool API 简洁，zod schema 友好。
- 前端 streaming、chat UI、部署一体化很强。

缺点：

- 更像"agent loop helper + UI/deploy SDK"，不是完整 agent runtime。
- 缺少框架级 checkpoint、事件治理、child-run、wait_user、审计事实表。
- long-horizon / 多 agent / 复杂上下文治理需要大量自研胶水。
- `steps / toolCalls / toolResults` 是产品级 result 对象，前端友好；但它是 SDK 层产物，不是协议层产物——linnkit 把这一层让给 host adapter 处理。

linnkit 对位：

- 学它的 API 清爽度（已在 0.7.0 `defineAgent` / `runAgent` 中体现）。
- **不把自己降级成 `streamText` 包装器**——这是 linnkit 与 Vercel 最大的方向差异。
- **`steps / toolCalls / toolResults` result 对象标准化** = host adapter 的工作，不是 framework 协议。framework 已通过 `ToolRuntimePort` + `AuditEnvelope` + 协议级 tool 配对不变量（C10）守住底层；接入方如果需要产品级 result 对象，应在 host 层做（参考 `src/app-hosts/linnya` 的 tool 开发规范）。**在 integration docs 里加一段提示就够了，不内置**。
- 事件治理事实表（4 维 lifecycle）是 linnkit 的强项，超过 Vercel 的 `steps` 概念——但 `steps` 这种"产品级 result 对象"对前端友好，host 层应当吸收。

### 3.5 Mastra

官方定位：

- TypeScript all-in-one agent framework。
- 官网强调 tools + MCP、memory、tool approval、workspaces、supervisor agents、guardrails、scorers、evals、tracing。
- Workflows 支持 type-safe flow、步骤、并行、条件、循环、suspend/resume。

优点：

- TS 生态里产品化程度高。
- DevTools、workflow、memory、approval、evals 打包得很完整。
- 对业务应用开发者友好，上手比 LangGraph 更产品化。

缺点：

- all-in-one 意味着框架边界更重，宿主想替换某些底层策略时可能会被框架心智牵着走。
- workflow 与 agent 同时做一等对象，复杂应用里需要团队约束使用方式。

linnkit 对位：

- Mastra 是 linnkit 在 TS 生态最应该正视的对手。
- linnkit 当前内核纪律更强，但 DX/DevTools/Memory/Approval/Supervisor 明显落后。

### 3.6 DeerFlow

官方仓库定位：

- ByteDance 开源的 long-horizon SuperAgent harness，能 research、code、create。
- README 标题强调 sandboxes、memories、tools、skill、subagents、message gateway。
- 当前 v2 README 中有 LangGraph-compatible API gateway、sandbox modes、MCP server、IM channels 等。

优点：

- 长任务/深度研究产品形态完整。
- LangGraph 生态借力明显。
- sandbox、MCP、skills、IM channels、daemon/deploy 路径比较实用。

缺点：

- 更像完整产品/harness，不是一个小而稳的内核包。
- 基于 LangGraph 之后，继承了 LangGraph 心智复杂度。
- 对自定义产品的框架边界未必像 linnkit 这么干净。

linnkit 对位：

- 可以学 DeerFlow 的 gateway/API 兼容层、sandbox mode 配置、IM channel session 配置。
- 不建议学它把产品通道和框架内核绑得太紧。

### 3.7 CrewAI

官方定位：

- “Build collaborative AI agents, crews, and flows”。
- 官方强调 agents、crews、flows、guardrails、memory、knowledge、observability。
- 以 role/task/crew 为核心心智。

优点：

- 多 agent 协作叙事清晰，业务团队容易理解。
- crew/task/role 对自动化流程很直观。
- Python 生态成熟，企业化工具链持续补齐。

缺点：

- role/backstory/goal 容易把“prompt 产品语义”变成框架协议语义。
- 对强事件治理、上下文窗口审计、复杂恢复的底层透明度不如内核型框架。

linnkit 对位：

- 学任务分派和 crew 管理体验。
- 不把 role/backstory 固化进核心协议。它们更适合 `AgentSpec.metadata`。

### 3.8 AutoGen / Microsoft Agent Framework

官方 AutoGen 当前分 Studio、AgentChat、Core：

- Studio：无代码原型工具。
- AgentChat：构建 conversational single/multi-agent apps。
- Core：底层事件/actor 编程模型。

优点：

- 多 agent 对话和 group chat 经验丰富。
- Studio 对调试和原型很强。
- Microsoft 生态整合后，未来企业管理能力可能会更强。

缺点：

- Python/.NET 心智为主，TS 产品接入不如原生 TS 框架。
- 多 agent chat 模式容易产生“会说话但不可控”的协作复杂度。

linnkit 对位：

- 学 actor/message bus 与 Studio。
- 不把多 agent 先做成自由聊天，应该从可审计的 child-run/message bus 开始。

### 3.9 LlamaIndex Agents / Workflows

官方定位：

- LlamaIndex 强项是 data/RAG/indexing/retrieval。
- Agents 定义为使用 LLM、memory、tools 处理外部输入的系统。
- Workflows 提供 event-driven orchestration foundation。

优点：

- 数据接入、检索、RAG 生态非常强。
- workflows 与 agents 结合后适合知识密集应用。
- Query planning、routing、sub-questions、tool use 是强项。

缺点：

- 如果不是 RAG/knowledge-heavy 场景，框架优势会下降。
- runtime governance 不是它最核心的卖点。

linnkit 对位：

- linnkit 不应该补一个内置 RAG / index / retriever 子系统；那会把 framework kernel 拖向知识库平台，偏离定位。
- 正确边界是：知识库、RAG、向量索引、引用检索都由 host 或外部 adapter 提供；linnkit 只保证这些结果进入 agent runtime 时可被 fence、mustKeep、ContextTrace、AuditEnvelope、EventStore 与 testkit 不变量治理。
- 如果未来出现 `KnowledgePort`，它也应是**可选 port 边界**，不是内置 RAG 实现；引用/citation/source event ids 是治理要求，不是检索实现。

### 3.10 Claude Code / Claude Agent SDK

官方 SDK 文档显示：

- Claude Agent SDK 支持 built-in tools、hooks、subagents、MCP、permissions、sessions。
- 内置工具包含 Read、Write、Edit、Bash、Monitor、Glob、Grep、WebSearch、WebFetch。
- subagents 通过 Agent tool 调用，消息带 `parent_tool_use_id`。
- hooks 可在 tool use 后执行脚本/函数逻辑。

本地 `claude-code-main` 观察：

- 代码规模极大，约 1800+ TS/TSX 文件。
- 核心包括 `QueryEngine.ts`、tools、commands、MCP、plugins、skills、bridge、remote、tasks、memory、permission、hooks。
- 这是成熟产品内核，不是单纯 framework。

优点：

- 工具、权限、MCP、skills、subagents、hooks、IDE bridge、TUI 体验完整。
- 对软件工程任务的工具编排和上下文启发很强。
- 延迟优化、lazy loading、并行预取、权限模式都是产品级细节。

缺点：

- 强 Anthropic/Claude Code 产品语义。
- 不适合作为通用框架直接模仿。
- 本地快照来源不是官方仓库，只能做防御性架构观察。

linnkit 对位：

- 可以学 `Task/Agent tool`、hooks lifecycle、defer-loading/tool-search、permissions。
- 不抄文件式 memory、具体工具、TUI 产品层。

### 3.11 Codex / Codex CLI

OpenAI 官方文章说明：

- Codex 一次 turn 可包含多次模型推理和工具调用。
- conversation history 会进入下一轮 prompt，context window 管理是 agent 的职责。
- Codex 会为 prompt caching 做很多结构稳定性工作，例如配置变化尽量追加新消息，而不是改旧消息。
- 当超过 token 阈值时会 compact conversation，用较小的 item list 替换原 input，并使用特殊 compaction item 保留理解。

优点：

- 上下文窗口和 prompt caching 的工程纪律非常值得学；append-only message strategy 与 compaction 公开文章是核心参考。
- 对本地沙箱、权限、apply_patch、AGENTS.md、subagents、skills、hooks 的产品化能力很强。
- 公开文章把 agent loop、context、prompt cache 的 tradeoff 讲得很实在。

缺点：

- 强 OpenAI Responses API / Codex 产品语义。
- 框架可复用面不等于产品内核——Codex 不是 vendor-neutral 框架，它的 context window 管理是"平台级产品工程"，不是"声明式可外部配置的协议面"。
- 客观限定：本报告最初由 Codex 协作生成，原稿在 "性能/成本" 与 "上下文工程" 上给 Codex 自己打了满分 5；经指挥官审视后调整为 4.5 + 4.5（详见 §4.0 评分口径声明 + §4.2 修正说明）。读者应当意识到——**Codex 的工程深度真实存在，但与 linnkit 这类"声明式协议框架"不在同一维度比较**，把两者评分等同是误导。

linnkit 对位：

- 重点学 prompt item 稳定性、compaction、reference/citation、sandbox/approval 作为 host port。
- 不把 Responses API 私有 item 搬进 vendor-neutral contract。
- linnkit 在"框架协议精度"维度领先 Codex；Codex 在"产品级工程深度"维度领先 linnkit——两者目标场景本来就不同。

### 3.12 Hermes Agent

本地 README 与架构文档显示：

- Hermes 是 Nous Research 的 self-improving AI agent。
- 支持 CLI、Telegram、Discord、Slack、WhatsApp、Signal 等多通道 gateway。
- 内置 learning loop、memory、skills、cron、subagents、terminal backends、MCP、ACP、RL training。
- 架构文档显示核心 `AIAgent` 在 `run_agent.py`，agent loop 文件约 10,700 行，CLI/gateway 也都有巨型文件。

优点：

- 产品功能广度极强：多 IM、cron、skills、memory、terminal backend、gateway、ACP。
- session storage、gateway session key、platform delivery、cron output 等经验对 Linnya/linnsy 有参考价值。
- 自改进 skill/memory loop 很有想象力。

缺点：

- 巨型单文件多，架构洁癖角度不值得学。
- 产品能力和框架能力混在一起，边界不如 linnkit 清晰。
- Python monolith 对 TS 内核包的迁移借鉴有限。

linnkit 对位：

- 学它的 session key、gateway、cron、memory provider、environment backend。
- 不学它的巨型实现组织方式。

### 3.13 OpenHands Software Agent SDK

论文摘要定位：

- 面向 production software engineering agents 的 SDK。
- 强调 sandboxed execution、lifecycle control、model-agnostic multi-LLM routing、security analysis。

对 linnkit 的启发：

- 如果 linnkit 要进入“软件工程 agent”或“可执行自动化”场景，SandboxPort、PermissionPort、RunSupervisor、AuditEnvelope 是绕不开的。
- 它证明“生产 agent SDK”已经不只是 prompt + tool loop，而是执行环境、生命周期、安全、模型路由、评估的组合。

---

## 4. 维度对比总表

评分采用 1-5 星，表示该框架在该维度的成熟度或产品化程度，不表示绝对优劣。

| 框架/产品 | 开发体验 | 执行模型 | 性能/成本 | 管理生命周期 | 上下文工程 | 配置扩展 | 多 Agent | 审计测试 | 适合场景 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| linnkit | 4 | 4 | 3.7 | 4 | **5** | 4.5 | 3.5 | 4.7 | 自研长期产品框架内核 |
| LangGraph | 2.5 | 5 | 4 | 4.5 | 4 | 4 | 4.5 | 4.5 | 复杂状态图/长任务 |
| LangChain Agents | 4 | 3.5 | 3.5 | 3 | 3.5 | 5 | 3 | 4 | 快速集成 LLM/RAG/Tools |
| OpenAI Agents SDK | 4.5 | 4 | 4.5 | 4 | 4 | 4 | 4 | 4.5 | OpenAI 模型优先生产应用 |
| Vercel AI SDK | 5 | 2.5 | 4 | 2.5 | 2.5 | 4 | 1.5 | 3 | Web/Next.js 快速 agent loop |
| Mastra | 4.5 | 4 | 4 | 4 | 4 | 4.5 | 4 | 4.5 | TS all-in-one 业务 agent |
| DeerFlow | 3.5 | 4 | 4 | 4 | 4 | 4 | 4 | 3.5 | 深度研究/长任务 harness |
| CrewAI | 4 | 3.5 | 3 | 3.5 | 3.5 | 4 | 4.5 | 3.5 | 角色分工/业务流程自动化 |
| AutoGen | 3.5 | 4 | 3 | 3.5 | 3 | 4 | 5 | 4 | 多 agent 对话/研究原型 |
| LlamaIndex | 4 | 3.5 | 3.5 | 3 | 4.5 | 4.5 | 3.5 | 3.5 | 数据/RAG 密集 agent |
| Claude Code SDK | 4.5 | 4.5 | 4.5 | 4 | 4.5 | 5 | 4.5 | 4 | 编程 agent/本地工具产品 |
| Codex | 4.5 | 4.5 | 4.5 | 4.5 | 4.5 | 4.5 | 4 | 4.5 | 编程 agent/沙箱/长任务 |
| Hermes | 4 | 3.5 | 3.5 | 4.5 | 4 | 5 | 4 | 3.5 | always-on 私人/多通道 agent |

### 4.0 评分口径声明（重要）

本表把"产品内核"（Codex / Claude Code / Hermes / DeerFlow）与"框架协议"（linnkit / LangGraph / OpenAI Agents SDK / Mastra / Vercel AI SDK / CrewAI / AutoGen / LlamaIndex）混在一起打分，**存在维度模糊**——例如同样是"上下文工程 5 分"，对 Codex 表示"产品级 compaction 工程深度"，对 linnkit 表示"声明式协议精度 + 可观测 + 可机器校验"。这两者是**不同侧面**的强，不应等同视之。

读这份评分表时，请按下面口径理解：

| 评分维度 | 对"框架协议"意味着 | 对"产品内核"意味着 |
|----------|------------------|------------------|
| 开发体验 | 入门门槛、API 清爽度、文档密度 | 产品使用体验、CLI/IDE/TUI 体验 |
| 执行模型 | 抽象清晰度、扩展点合理性 | 运行稳定性、错误恢复、并行度 |
| 性能/成本 | 框架本身开销、token 估算精度、cache 友好度 | 产品级 prompt cache 工程、长任务成本控制 |
| 管理生命周期 | run lifecycle 协议完整度 | 后台/恢复/sandbox/session 等产品功能 |
| **上下文工程** | **声明式协议精度 + 可观测 + 可机器校验** | **产品级 token 控制工程深度** |
| 配置扩展 | port/插件/协议扩展点 | settings/hooks/MCP/skills 等产品配置 |
| 多 Agent | child-run/bus/capability 协议 | subagents/sandbox/worktree 产品组合 |
| 审计测试 | 协议级 invariants/audit envelope | 平台级 tracing/evals/observability |

**透明度声明**：本报告最初由 Codex（OpenAI Codex CLI）协作生成。原稿中 Codex 在 "性能/成本 5" 与 "上下文工程 5" 两项打了满分，经指挥官人工再审视后调整为 4.5 + 4.5——理由：(a) Codex 在 prompt cache stability 上确实领先，但 Claude Code 也做了同等工程，5 满分应匹配"无可挑剔的单项最强"，4.5 更对应"领先但有同档对手"；(b) Codex 的上下文工程是"产品级 compaction 工程"，linnkit 是"声明式协议精度"，两者是不同侧面的强，不应并列 5 分。Codex 原稿存在**自评偏倚**，本表已修正。本表其余分数（包括 linnkit 0.7.0 评分）按"协议入口可机器验证"原则审视过，详见下方调整说明。

### 4.1 linnkit 0.5/0.6/0.7 评分调整说明

- 开发体验 3.5 → 4：CLI v0 + Quickstart helpers 已就位；仍不到 4.5 因为没有 DevTools / Replay UI。
- 上下文工程 4.7 → **5**：12 大分组 + ContextTrace + 11 条 contextPolicy 不变量；这是 linnkit 在维度对比里**唯一独占 5 分**的项，超过所有同类 TS 框架，也超过 Codex 这类产品内核在"框架协议精度"维度的表现。
- 管理生命周期 3.8 → 4：`spawnDetached / waitForTerminal / drain / recoverOnBoot` 已发布；冷暂停 / runTree / handleFailure 仍 NotImplemented。
- 配置扩展 4 → 4.5：`AgentSpec.contextPolicy` + `defineContextPolicy()` + SystemReminder 注册表 + ContextPolicyFallback 已成体系。
- 审计测试 4.4 → 4.7：26 条 strict invariants 是 TS 同类框架里最系统的协议级守门；不到 5 是因为缺平台级 tracing/evals。
- 性能/成本 3.5 → 3.7：ContextTrace 改善可解释性，`replacementSourceIds` + `toolHistory.strategy: 'per-run'` 已在协议层落实 prompt cache 稳定性原则；不到 4 是因为 CostLedger / QuotaPort 尚未产品化（按需触发）。**注意**：PromptTrace / cache miss reason 已从"待办"剔除——它们不是协议层缺失，详见 §17.8。

### 4.2 Codex 评分修正说明

- 性能/成本 5 → **4.5**：Codex 在 prompt cache stability 上确实领先，公开文章把 append-only message strategy / compaction 讲得很实在；但 Claude Code 也做了 prompt caching / 并行预取 / tool use 优化，给 4.5。5 满分应匹配"无可挑剔的单项最强"，Codex 与 Claude Code 持平更客观。
- 上下文工程 5 → **4.5**：Codex 的强项在 Responses API + 平台级 compaction + reference_context_item，是"产品级 token 控制工程深度"；linnkit 的强项在 12 大分组 contextPolicy + ContextTrace + 26 条机器校验 invariants，是"框架级声明式协议精度"。两者是不同维度的最强，但**这份对比表的口径偏向"框架协议精度"**——所以让 linnkit 独占 5 分、Codex 与 Claude Code/Hermes 都收敛到 4.5，对应"产品级工程深度的领先档"。
- 其余 6 项分数维持原值，复核认为合理。

---

## 5. 开发体验对比

### 5.1 linnkit 当前体验（0.7.0 之后）

优点：

- 文档密度高，模块边界写得清楚；`docs/integration/` 已拆为 17 个主题手册（installation / quickstart / tools / context-fences / context-engineering / run-supervisor / audit / telemetry / testing / llm-provider / persistence / realtime / glossary / constraints-and-pitfalls / tool-history / child-runs / README）。
- `testkit` 从 scripted AI engine、graph loop harness、context harness，扩展到 RunSupervisor harness、collecting audit、mock telemetry、**26 条 strict invariants**（15 run + 11 contextPolicy）。
- 子入口明确，`runtime-kernel/events` 浏览器安全入口很贴心；`./quickstart` 子入口让 helper API 与运行时核心分开。
- `AgentSpec` + `RunSupervisor` + 12 大分组 `contextPolicy` 让"如何注册一个 agent / 如何启动一个 run / 如何控制每一个 token / 如何 cancel / 如何 cost"都有协议级公共面。
- **`linnkit init / run / doctor` + `defineAgent` / `runAgent` / `defineConfig` 已就位**：外部用户 5 分钟跑通 hello-agent；`linnkit init <name>` 直接 scaffold quickstart 模板，`doctor` 检查 Node 版本 / API key / config 合法性。

缺点（按 0.7.0 之后真实剩余项）：

- 第一次"生产接入"成本仍高：从 quickstart demo 到生产 host 之间，外部用户需要替换 `AgentAiEngine` / `ToolRuntimePort` / `FenceRegistry` / `Checkpointer` / `EventStore` 这一整层 port；目前没有 `examples/minimal-host` 这种"中间深度"的可运行示例。
- 没有 DevTools / Replay UI / 项目级配置迁移器；audit 和 ContextTrace 已是事实表，但 grep 日志体验对外部接入方不够友好。
- 模板生态空：CLI 目前只有一个 hello-agent 模板；后续需要 `tool-agent`（zod tool + scripted test）和 `host-agent`（SQLite EventStore + SSE + context fence）两个进阶模板。
- 0.x 文档漂移风险仍在：每个 minor 都扩 API，文档必须保持同步发版；当前已经把"package.json 版本 / README 状态 / 公开入口数量 / integration 手册"加入发版检查清单，但仍要持续守门。

与对手对比（0.7.0 重新校准）：

- Vercel AI SDK 的 `generateText + tool + stopWhen` 仍是入门最低门槛——但跑完几十行 demo 就到天花板。
- OpenAI Agents SDK 和 Claude Agent SDK 都有 `AgentDefinition / allowed_tools / query` 这类直接的 entry，且自带 hosted tools；linnkit 不追这条路。
- Mastra 的 `npm create mastra` + DevTools + 平台化路线更适合"快速业务 agent"；linnkit 的 `linnkit init` 已经追上"入门 5 分钟"这一基线，但 DevTools / 平台化短期不做。
- LangGraph 入门门槛仍比 linnkit 重——它的 StateGraph / interrupt / persistence 心智需要先理解；linnkit 的固定主循环对 80% 场景更轻。
- linnkit 在 5 分钟入门体验上已经是 **TS 同类框架第二梯队**（接近 Mastra，超过 LangGraph TS），但平台化体验仍是第三梯队（落后 Mastra 一个 minor 不止）。

剩余建议：

1. ✅ ~~做 `create-linnkit-app` 或 `linnkit init`~~（已完成于 0.7.0）。
2. 补 2 个进阶模板：`tool-agent`（zod tool + scripted test + testkit invariants）+ `host-agent`（SQLite EventStore + SSE + context fence + 完整 port 替换示例）。
3. 把 `docs/integration/02-quickstart.md` 的最小骨架固化成 CI smoke example，避免文档与真实可运行路径漂移。
4. 等 Replay SDK 形状稳定后再补 `linnkit replay / inspect`，不强行先做。

---

## 6. 执行模型对比

### 6.1 三类主流执行模型

1. **固定 loop**
   - 代表：linnkit、Vercel AI SDK、Claude Code/Codex 内部主 loop。
   - 优点：心智稳定，容易审计。
   - 缺点：复杂拓扑需要协议扩展。

2. **显式 graph/workflow**
   - 代表：LangGraph、Mastra Workflows、LlamaIndex Workflows。
   - 优点：复杂编排强。
   - 缺点：上手门槛高，容易把业务流程和 agent reasoning 混在一起。

3. **多 agent conversation**
   - 代表：AutoGen、CrewAI、部分 DeerFlow。
   - 优点：角色分工自然。
   - 缺点：可控性、收敛性、审计成本高。

### 6.2 linnkit 的执行模型

linnkit 当前是固定主循环：

```text
user -> llm -> tool -> llm -> ... -> answer / wait_user
```

代码上则拆成：

- `GraphExecutor`：负责节点推进、checkpoint、yield/pause。
- `GraphAgentExecutor`：负责单次 LLM tick 的上下文构建和决策。
- `LlmNode/ToolNode/AnswerNode/WaitUserNode/UserNode`：节点实现。

优点：

- 对常见 agent 产品足够。
- 可审计性比自由 graph 好。
- host 不需要设计复杂拓扑。

短板：

- `verify/critic/plan/reflect/route` 这类节点目前没有一等扩展协议。
- child-run 是父子单向，尚不能表达 agent mesh/message bus。
- wait_user 已经成形，但 wait_external / async callback 还没泛化。

建议：

- 不做用户手写 graph DSL。
- 做“固定 loop + 插槽”：例如 `before_llm`, `after_llm`, `before_tool`, `after_tool`, `before_final_answer`, `on_wait`。
- 多 agent 先做 message bus/actor mailbox，而不是把图暴露给用户画。

---

## 7. 性能与成本对比

### 7.1 影响 Agent 性能的主要变量

1. 模型推理次数。
2. 工具调用串行/并行。
3. prompt token 体积。
4. prompt cache 命中率。
5. context compaction 时机。
6. provider fallback 和 retry 策略。
7. stream projection 与 UI 回放开销。

### 7.2 linnkit 现状

已有能力：

- `TokenCalculator` 和 tiktoken 依赖。
- context pipeline 有 token budget。
- LLM caller 有 retry/fallback/model resolver/policy engine。
- event governance 可避免部分事件进入上下文或 UI 回放。
- provider sidecar replay 逐步支持 reasoning details。
- `toolHistoryCompressor` 默认改成 `per-run`，支持按用户 run 边界保留工具历史，有利于 prompt cache 稳定。
- `TelemetryScope` 已补 `runId / parentRunId`，父子 run 成本不再只能靠 conversation/turn 粗粒度推断。
- `RunHandle.cost()` 已成为标准查询入口，testkit 的 mock telemetry 能校验父子 `childrenTotal` 聚合口径。

短板（按需触发，不预先做）：

- 没有标准 CostLedger / QuotaPort——美元成本、长期账本、quota 待 G-2，前置依赖 = 真实多租户产品需求。
- `prompt cache miss reason` / `cacheable prefix` 这类 provider 元信息——属于 provider 层产物，framework 顶多在 telemetry 透传 `prompt_cache_hit_tokens` 之类的 provider 元信息，**不应该发明一个独立的 PromptTrace 协议**。

对比：

- Codex 官方文章把 prompt cache 稳定性作为核心工程问题，配置变化尽量 append message，避免修改前缀导致 cache miss——linnkit 已通过 `toolHistory.strategy: 'per-run'` 默认 + `replacementSourceIds` 契约 + ContextTrace 的 message-decision reason 落实了同等的稳定性原则。
- Vercel 的性能优势更多来自部署平台和 Fluid compute——不是框架本体差异。
- LangGraph 的 durable execution 对长任务失败恢复强，但不自动解决 prompt cache。
- Claude Code / Codex 产品化处理了工具顺序、MCP tool list 变化、压缩等细节——但这是产品工程，不是框架协议。

建议（已校准，按"真实做不做"分档）：

1. ✅ **不做"PromptTrace"协议**：ContextTrace 已经覆盖核心价值（每条消息 keep/drop 原因 / 阶段 token delta / 命中策略）；要溯源到"某段 context 来自哪个原始事件"，是 host EventStore JOIN 的事，不是 framework 协议。
2. 🔵 **按需做 `CostLedgerPort`**：前置 = 真实多租户产品需求；`RunHandle.cost()` 是运行期内存口径，与未来 CostLedger 长期账本口径明确分层，不让单一接口承担所有结算职责。
3. 🔵 **按需在 telemetry 透传 provider cache 元信息**：如果 provider 返回 `prompt_cache_hit_tokens` 等字段，linnkit 应当通过 TelemetryPort 透传，但不发明独立协议；这是"透传 provider 给我的"而不是"linnkit 自己造一份"。
4. ✅ **`replacementSourceIds` 已存在并被 ContextTrace 间接消费**——这是 linnkit 已有的"prompt cache 稳定性的协议基础"，不需要再造一份产品化诊断工具。

---

## 8. 管理与生命周期对比

### 8.1 对手能力

- LangGraph：durable execution、persistence、fault tolerance、time travel。
- OpenAI Agents SDK：background mode、webhooks、sandbox agents、results/state。
- Mastra：workflows suspend/resume、tool approval、observability、deployment/platform。
- DeerFlow：daemon、Docker/prod deploy、sandbox mode、IM channel workers。
- Hermes：gateway daemon、cron、session store、platform delivery、restart/takeover/locks。
- Claude Code/Codex：sessions、permissions、subagents、hooks、worktrees、sandbox、background/proactive 能力。

### 8.2 linnkit 现状

已有：

- `GraphExecutor.runUntilYield`。
- `Checkpointer`。
- `EventStore` port 与 host 实现。
- `RunRegistryStorePort` + `MemoryRunRegistryStore`。
- `DefaultRunSupervisor`。
- `RunHandle`。
- `spawnDetached` + `RunExecutorPort`。
- `waitForTerminal` / `findActiveByConversation` / `drain` / `recoverOnBoot`。
- `RunStatus` 覆盖 `pending / running / awaiting_user / paused / completed / failed / cancelled`，其中 `awaiting_user` 已由 wait_user 链路联动。
- TelemetryPort 与 AuditPort。

缺失：

- 冷暂停 `pause/resume`。
- `runTree`。
- 标准 `handleFailure` 策略。
- 后台任务、cron、heartbeat。
- 多租户/workspace/actor/session key 标准。

建议优先级：

1. 先用 `spawnDetached + waitForTerminal` 服务在线秘书 agent 这类外部接入方，验证后台 run API 形状。
2. `pause/resume` 等真实 UX 出现再做，不因为协议洁癖提前复杂化 engine。
3. `runTree` 与父子 cost/trace 的长期持久化一起设计。
4. `cron/automation` 不建议内置成业务工具，先用 RunSupervisor + host scheduler port 表达。
5. 多租户/workspace/actor/session key 归 host 或未来 platform port，不塞进 framework 默认。

---

## 9. 上下文工程对比

### 9.1 linnkit 强项

- context provider pipeline。
- MustKeepPolicy。
- fence registry / fence lifetime。
- history purification。
- summarization trigger/candidate/state utils。
- `replacementSourceIds` 契约。
- runtime event 是否进入上下文由 event governance 控制。
- `AgentSpec.contextPolicy` 使 budget、tool history、summarization 变成按 agent 声明的协议，而不是全局隐式默认。
- `toolHistory.strategy` 支持 `per-pair / per-run / none`，并用 `overflowStrategy` 控制极端溢出行为。
- host 产品语义通过 fence 注入，不再污染 framework message formatter。

### 9.2 对手强项

- Codex：context window management、Responses compaction、prompt cache 稳定性。
- Claude Code：CLAUDE.md、skills、subagents 隔离上下文、hooks、tool search/defer loading。
- Hermes：SOUL/MEMORY/USER/context files、periodic nudges、session search、skill self-improve。
- LlamaIndex：RAG/data/query planning。
- LangGraph：short-term/long-term memory 与 graph state 结合。
- Mastra：memory 与 observational memory 产品化。

### 9.3 linnkit 下一步（0.7.0 后真实剩余项）

1. 🔵 **按需做 MemoryPort / KnowledgePort 边界**：仅在 ≥ 2 个知识库类外部 host 真有需求时启动；只定义 source / citation / governance 契约，不内置 RAG、索引或检索实现。
2. 🔵 **按需做 skills / tool catalog progressive disclosure**：避免所有工具和技能一次性进 prompt；前置依赖 = 外部接入方真实出现"工具集 ≥ 30 个、需要按上下文动态裁剪"的场景。
3. ✅ **不做 PromptTrace 独立协议**：ContextTrace 已经覆盖"每条消息 keep/drop 原因 / 阶段 token delta / 命中策略"的核心价值；"某段 prompt 来自哪个原始事件"是 host EventStore JOIN 的事，不应在 framework 协议层再造一份。
4. ✅ **不做 prompt cache 独立诊断工具**：`replacementSourceIds` 契约 + `toolHistory.strategy: 'per-run'` 默认 + ContextTrace 已经把 prompt cache 稳定性原则落到协议层；provider 元信息（如 `prompt_cache_hit_tokens`）通过 TelemetryPort 透传即可。
5. 🟢 **把 fence 与 context injection 的 host 示例进一步压成 quickstart `tool-agent` / `host-agent` 进阶模板**——这是 0.7.x 小修缮期的真实工作。

---

## 10. 配置与扩展对比

### 10.1 linnkit 当前扩展点

- `AgentAiEngine`
- `ToolRuntimePort`
- `Checkpointer`
- `EventStore`
- `RunRegistryStore`
- `TelemetryPort`
- `FenceRegistry`
- `AuditPort`
- `RunExecutorPort`
- `AgentSpec`
- context provider registry
- host agent registry

### 10.2 对手扩展方式

- Claude Code：settings、CLAUDE.md、skills、subagents、hooks、MCP、plugins。
- Codex：AGENTS.md、config、rules、hooks、MCP、plugins、skills、subagents。
- Mastra：agents、tools、workflows、memory、MCP、DevTools、platform。
- Hermes：config.yaml、skills、plugins、memory provider plugin、context engine plugin、gateway config。
- CrewAI：agents/tasks/crews/flows。
- LangGraph：nodes/edges/state/checkpointer/store。

### 10.3 linnkit 建议

短期：

- 把 `AgentSpec` 与 host `AgentDefinition` 的适配器继续打磨，减少每个接入方重复写 registry glue。
- `HostCapabilities` 描述宿主支持哪些能力，例如 persistence、realtime、detached run、audit sink、telemetry sink。
- `ToolSpec` 与 `ToolBindingSpec` 继续收口工具 schema、typed args、运行期 tool 实例之间的映射。

中期：

- `PluginManifest`：声明 tools、agents、memory providers、hooks。
- `CapabilityNegotiation`：agent 选择工具/子 agent 前可查询能力。

长期：

- `linnkit/plugin` 子入口。
- `linnkit devtools`。
- 第三方 package 注册 agent/tool/memory provider。

---

## 11. 多 Agent 对比

### 11.1 现有模式

- linnkit：child-run，父子单向。
- Claude Code：subagent 通过 Agent/Task tool，隔离上下文，结果回主 agent。
- Codex：subagents 与 app/CLI/worktree/sandbox 结合。
- CrewAI：crew/task/role 协作。
- AutoGen：group chat。
- LangGraph：subgraphs 和 graph 拼装。
- Mastra：Supervisor Agents。
- DeerFlow：lead agent + subagents + LangGraph。
- Hermes：delegate tool + parallel workstreams。

### 11.2 linnkit 判断

当前 child-run 与 RunSupervisor 已经形成两个清楚层次：

- `child-runs`：同步嵌入式子 agent 调用，父 agent 等子 agent 完成，结果回到父工具调用。
- `child-run-trace`：观测协议，继续保留公开事件 `subrun_trace`。
- `RunSupervisor.spawnDetached`：顶层异步后台 run，调用方后续 `peek / observe / waitForTerminal / cancel`。

仍然不够的地方：

- `runTree(rootRunId)` 还没实装。
- 子 run 的长期账本与美元成本仍缺 G-2。
- 缺 AgentMessageBus。
- 缺 capability negotiation。
- 子 run 失败后的标准 `handleFailure` 策略还没实装。

建议路径：

1. 保持同步 `invokeChildRun()` 与异步 `spawnDetached()` 两条 API，不做一个含糊的 executionMode 开关。
2. `runTree` 在真实调试/账单需求出现时补，优先用 parentRunId 与 EventStore 事实表驱动。
3. 做 in-process `AgentMessageBus` 前，先观察在线秘书 agent / 知识库类 host 是否真需要 agent 互相对话；不要因为知识库场景存在，就把 RAG 能力塞进 linnkit。
4. 再考虑 distributed bus。
5. 谨慎引入自由 group chat，优先保持可审计。

---

## 12. 可观测、审计与测试对比

### 12.1 linnkit 优势

- testkit 分层清楚，并且 0.5.0 后升级成协议级 run harness。
- package exports 有 snapshot test。
- events governance 有 contract test。
- host flow 有 integration tests。
- TelemetryPort 与 AuditPort 都已进入公共协议。
- `validateRunInvariants()` 默认校验 15 条 run 不变量，覆盖 lifecycle / audit / telemetry / cost / EventStore / ToolCall 配对 / wait_user / detached terminal outcome。

### 12.2 短板

- AuditEnvelope 已经解决第一层事实表，但覆盖面仍需继续扩展到 context compaction、resume、error classification。
- 缺 Replay SDK。
- 缺 DevTools。
- 缺面向外部接入方的 `defineAgentTest()` 更高层 DSL；当前 testkit 更偏 harness primitives。

### 12.3 对手参考

- LangSmith 是 LangGraph/LangChain 生态巨大优势。
- Mastra 的 tracing/evals/scorers/DevTools 对 TS 开发者很实用。
- OpenAI Agents SDK 官方文档把 integrations/observability/evaluate agent workflows 放进主路径。
- Claude Code/Codex/Hermes 都有产品级 session/history/diagnostics/doctor/usage。

建议（已校准）：

1. 🔵 **按需做 `Replay SDK`**：前置依赖 = 至少一个外部 host 真实提出"我能不能重放这次决策"的需求；当前没有就先不做。
2. 🟢 **可以现在做 `defineAgentTest()` fluent DSL**：是当前 testkit primitives 之上的薄壳，1-2 天工作量；属于 0.7.x 小修缮期合理任务。
3. 🔵 **按需做 DevTools v0**：Event Timeline、Context Window 两视图；前置依赖 = Replay SDK 稳定。Prompt Diff 单独不做（其核心价值 ContextTrace 已覆盖）。
4. 🟢 **把 26 条不变量接入示例 host / quickstart 的 CI**：证明不是只服务 Linnya；0.7.x 小修缮期真实工作。

---

## 13. linnkit 优缺点清单

### 13.1 优点（0.7.0 后真实在册项）

1. **边界纪律强**：framework 与 host 分离；host 中文表达层 / 业务工具 / sandbox / IM 通道 / memory 后端 全部归 host。
2. **事件治理强**：四维生命周期（uiProjection / persist / replayToUi / enterAgentContext / realtimeChannel）是稀缺设计；浏览器安全 seam 让前端可用纯函数事件治理。
3. **上下文工程是 linnkit 的杀手锏**：`AgentSpec.contextPolicy` 12 大分组 + `ContextTrace` sidecar + 11 条 contextPolicy 不变量 + SystemReminder 注册表——这是 TS 生态里**唯一**做到"声明式协议 + 可观测 + 可机器校验"三位一体的上下文工程方案。
4. **AgentSpec 已落地**：Agent 静态画像、工具绑定、12 大分组 `contextPolicy`、`modelHints`、`audit config`、`metadata` 都有 zod 合同；`defineContextPolicy()` helper 让外部接入方一行生成完整默认策略。
5. **RunSupervisor 已落地**：`registerRun / cancel / observe / cost / meta / spawnDetached / waitForTerminal / drain / recoverOnBoot / findActiveByConversation` 已从 host 临时代码上升为框架协议。
6. **AuditEnvelope 已落地**：模型选择、fallback、工具允许/拒绝、wait_user、cancel 等非确定性决策有协议级追加只读事实表；audit 不进入 UI / context / SSE。
7. **vendor-neutral**：不绑定 OpenAI / Anthropic / LangChain；provider replay 通过 `providerReplay` 三态字段可声明覆盖 host 模型默认策略。
8. **测试守协议**：testkit 已从单元 fixture 升级到 **26 条 strict invariants**，能机器校验 lifecycle / audit / telemetry / cost / EventStore / ToolCall 配对 / wait_user 联动 / detached 终态 / effective policy / message decision / must-keep 类型保留。
9. **交互式工具暂停路线正确**：`wait_user` 是协议级而非 UI patch，与 `RunStatus = 'awaiting_user'` 联动。
10. **两类 checkpoint 意识正确**：执行恢复（`Checkpointer`）与上下文摘要（`CheckpointSummarizationProvider` + `context_checkpoint` 工具）不混；checkpoint 工具名通过 `triggerToolName` 在 spec 中统一控制。
11. **DX 入口已铺**：`linnkit init / run / doctor` + `defineAgent` / `runAgent` / `defineConfig` 让 5 分钟跑通 hello-agent；明确**仅作 demo host**，不替代生产接入。
12. **0.5–0.7 三连发版纪律**：每个 minor 都跑 typecheck / build / smoke / dist smoke / guard / pack dry-run + git diff --check；release docs 按 Breaking / New / Improved / Internal 四段写。

### 13.2 真实剩余项（0.7.0 后 · 已剔除伪待办）

> 本节按"是否真的会去做"分档：🟢 = 0.7.x 小修缮期合理工作；🔵 = 按需触发，不预先承诺；✅ = 已经在协议层覆盖，不需要再做独立工具。

1. 🔵 **Replay SDK**：EventStore + AuditEnvelope + ContextTrace 三层事实表都已就位，但回放协议（按 runId 回流事件、复现 contextTrace、复现 audit）还未产品化——**前置依赖 = 至少一个外部 host 提出真实需求**。
2. 🔵 **DevTools v0**：Event Timeline / Context Window 视图缺；当前 audit / trace 只能 grep 日志——**前置依赖 = Replay SDK 形状稳定**。
3. 🔵 **CostLedger / QuotaPort**：`RunHandle.cost()` 是运行期口径，长期账单 / quota / 美元结算仍待 G-2——**前置依赖 = 真实多租户产品需求**。
4. 🔵 **管理面留白**：`pause / resume / runTree / handleFailure` 明确 NotImplemented——按真实业务需求触发，不因为协议洁癖提前做。
5. ✅ **多 Agent 协议刻意克制**：child-run（同步）与 detached run（异步）已有；AgentMessageBus / capability negotiation **不是遗漏，是产品决策**——只在真实出现"两个 agent 互相对话"场景时启动。
6. 🟢 **`examples/minimal-host` 缺**：quickstart 模板与生产 host 之间缺中间深度示例（SQLite EventStore + SSE + context fence + 完整 port 替换）——属于 0.7.x 小修缮期真实工作。
7. 🟢 **`runSupervisor.ts` 文件体量**：当前接近 700 行关注线；等 `runTree / handleFailure / recover` 任一启动时拆 `detached-runner` / `terminal-waiters` / `run-recovery` 三块。
8. 🟢 **`defineAgentTest()` fluent DSL**：当前 testkit 是 primitives；薄壳 DSL 提升外部接入方测试体验。
9. 🟢 **0.x 文档漂移守门**：release docs / integration docs / research notes 持续同步——已加入发版检查清单。
10. ✅ **Vercel-style `steps / toolCalls / toolResults` result 对象未在 framework 内置**：**不是缺陷，是产品决策**——这是 host adapter 的工作；framework 已通过 `ToolRuntimePort` + `AuditEnvelope` + 协议级 tool 配对不变量（C10）守住底层。Integration docs 应加一段提示外部接入方如何在 host 层标准化（参考 linnya tool 开发规范）。

### 13.2.1 已剔除的伪待办（曾经写进短板，0.7.0 后审视移除）

| 伪待办 | 移除理由 |
|--------|---------|
| **PromptTrace（context 段落溯源到原始事件）** | ContextTrace 的 `message-decision` 已经能解释每条消息的 keep/drop 原因 + 命中策略；"溯源到 EventStore 原始事件"是 host 数据库 JOIN 的事，不是 framework 协议待办 |
| **cache miss reason 诊断** | provider 内部信息，framework 只能通过 telemetry 透传 provider 给的 `prompt_cache_hit_tokens` 等元信息；**不应该发明 framework 层的独立诊断协议** |
| **context diff 可视化（两次 run 上下文差异）** | DevTools 层产品化能力；属于按需触发，不是"短板"（详见 §17.7）|
| **`PromptTrace` / `cache hash` / `cacheable prefix`** | 这些是 SDK/产品层概念，linnkit 已通过 `replacementSourceIds` + `toolHistory.strategy: 'per-run'` + ContextTrace 在协议层落实了 prompt cache 稳定性原则 |

### 13.3 潜力（0.7.0 起稳定）

linnkit 的潜力不是"马上比所有框架功能多"，而是已经成为一个很难得的中间层：

```text
比 Vercel AI SDK 更能长期维护；
比 LangGraph 更少心智负担；
比 OpenAI/Claude/Codex SDK 更 vendor-neutral；
比 Hermes/DeerFlow 更框架化；
比 CrewAI/AutoGen 更工程审计友好；
比 Mastra 协议精度更高、与 host 边界更干净。
```

**进度回顾**：

- **0.5.0 之前**（≤ 2026-05-11）：这段话还是愿景。
- **0.5.0**（2026-05-12）：AgentSpec / RunSupervisor / AuditEnvelope 落地——linnkit 从"内部好内核"变成"外部可接入框架"。
- **0.6.0**（2026-05-13）：12 大分组 `contextPolicy` + ContextTrace + 26 条 strict invariants 落地——linnkit 在"上下文工程"这个维度成为 TS 生态最深的方案。
- **0.7.0**（2026-05-13）：Quickstart helpers + CLI v0 落地——外部接入方 5 分钟可跑通 hello-agent。

**0.7.0 之后**：linnkit 不再需要证明"内核能做"或"外部可用"。下一阶段进入"**协议稳定 + 小修小补 + 按需触发可视化**"长期状态：

- **小修小补**（0.7.x 真实工作）：输出更安静、CLI 体验润色、tool-agent / host-agent / minimal-host 进阶模板、文档补洞、host 接入反馈修正、testkit fluent DSL、26 条不变量接入 quickstart CI。
- **按需触发**（真实业务需求出现再启动）：Replay SDK / DevTools / CostLedger / KnowledgePort / MemoryPort / AgentMessageBus / pause-resume / runTree / handleFailure。
- **明确不做**（不是路线图项）：PromptTrace 独立协议、cache miss reason 诊断协议、context diff 可视化、任意 graph DSL、内置 RAG / Memory 后端 / IM 通道 / sandbox 实现、`steps / toolCalls / toolResults` result 对象、framework 持有 prompt 正文（详见 §17.7）。

这是 linnkit 0.x → 1.0 之间最后一公里——但**不是"必须再做 N 件大事"才能 1.0**，而是"协议层已经稳定到可以发 1.0"，剩下的工作都是质量打磨与按需触发。

---

## 14. 推荐路线图

### 14.1 已完成 · 0.5.0（2026-05-12 发布）

1. Phase E boundary cleanup：host 产品字段从 framework 协议中剥离；`MessageFormatter` 删除产品文案包装；`FenceRegistry` / `context_injection` / `fences[]` 成为通用上下文注入路径。
2. Stage 0 cleanup：公开工具类型边界收口到 `Record<string, unknown>`；`ContextProviderError` 替代中文字符串 fatal 判断；LLM caller / event mappers / child-run invoker 主要超长文件已拆。
3. N-1 `AgentSpec`：schema 进入 `linnkit/contracts`；`contextPolicy` 支持 budget / toolHistory / summarization；`per-run` 成为 tool history 新默认。
4. N-3 `RunSupervisor` / `RunHandle`：`registerRun / spawnDetached / observeRun / cancel / list / peek / waitForTerminal / findActiveByConversation / drain / recoverOnBoot` 落地；`RunHandle` 提供 `signal / cancel / observe / cost / meta / spec / request / mark lifecycle`；`pause / resume / runTree / handleFailure` 保持明确 NotImplemented。
5. G-1 `AuditEnvelope` / `AuditPort`：决策事实表与 console / file / EventStore / composite sink 落地；EventStore audit event 不进 UI / agent context / SSE。
6. Testkit run-harness：**15 条 run 不变量** + collecting audit + mock telemetry + supervisor harness + failure injection。
7. INTEGRATION_GUIDE 拆分为 17 主题手册；framework / archive / 99-research-notes 移出 npm tarball。

### 14.2 已完成 · 0.6.0（2026-05-13 发布）

1. **Context Engineering 协议化**：`AgentSpec.contextPolicy` 从 3 大分组扩到 12 大分组（`budget / toolHistory / toolOutput / providerReplay / summarization / mustKeep / workingMemory / checkpoint / reasoningRetention / tokenEstimation / systemReminder / contextTrace`）；`defineContextPolicy()` helper 补齐默认值。
2. **`ContextTrace` 最小观测协议**：`ContextBuildResult.contextTrace` 记录 effective policy / 阶段 token delta / 剩余预算 / 策略命中 / message keep/drop 决策；`maxTraceEvents` 限流，默认关闭。
3. **SystemReminder 注册表 + spec 引用架构**：6 个内置 trigger kind（`phase-equals` / `remaining-steps-leq` / `step-count-modulo` / `tool-call-streak` / `budget-warning` / `agent-has-tool`）；`enabledRuleIds` / `disabledRuleIds` / `thresholds` / `extraRules` 全部协议化；spec 100% 可序列化、可回放、可 diff。
4. **host-neutral checkpoint**：`context_checkpoint` 工具 + `keepPairsBefore` + `triggerToolName` 协议化；checkpoint 工具名同时驱动 context trimming、GraphExecutor step-reset、`context_budget_warning` 文案。
5. **tool output 治理**：`toolOutput.observationGovernance.{enabled, maxChars, maxLines}` + `ObservationPreviewPort` 边界；落盘后端仍归 host。
6. **provider replay 策略**：`providerReplay.{provider, requiresReasoningDetailsForToolReplay, missingSidecarBehavior}` 优先级：agent 级 spec > host/model 默认 > framework 默认 `allow`。
7. **摘要 agent 协议化**：`summarization.agentId` + host 注册表；framework 不持有 prompt 正文，也不直接发起裸 LLM call；`failureBehavior: 'fail-fast' | 'continue-if-within-budget'`。
8. **host 装配级 fallback 通道**：`AgentMessageOrchestrator({ contextPolicyFallback })` 双层合并；按分组字段级合并，数组整体替换。
9. **`AgentWorkingMemoryProvider` 拆分**：主文件 683 行 → 249 行；working-memory 子模块全部 ≤134 行。
10. **testkit 扩展**：新增 11 条 contextPolicy 不变量，共 **26 条 strict invariants**。

### 14.3 已完成 · 0.7.0（2026-05-13 发布）

1. **Quickstart helpers**：`defineAgent` / `runAgent` / `defineConfig` 从 `./quickstart` 子入口与根入口导出；明确**仅作 demo host**，不替代生产接入。
2. **CLI v0 三件套**：
   - `linnkit init <name>`：在当前目录下创建同名子目录，scaffold hello-agent 模板。
   - `linnkit run <agent-id>`：跑指定 agent，实时打印事件流。
   - `linnkit doctor`：检查 Node 版本 / API key / config 合法性。
3. **`linnkit-cli` 入口**：`package.json#bin.linnkit -> ./dist/cli.cjs`；npm publish 自动清理 bin 脚本名（不影响包可用性）。
4. **整套发版纪律**：`typecheck` / `build` / `test:smoke` / `test:smoke:dist` / `guard:agent-boundary` / `publish:dry-run` / `git diff --check` 全绿；`prepublishOnly` 在发布时自动跑 build + 两轮 smoke。

### 14.4 接下来 · 小步修缮（0.7.x ~ 0.9.0）· 真实工作

0.5 / 0.6 / 0.7 三个 minor 是协议层的最后一次大跨度扩张。**0.7.0 之后 linnkit 进入小修小补 + 按需触发的长期状态——这是健康状态，不是停滞**。按优先级排：

1. **输出更安静**：移除散落在 orchestrator / provider 里的 `[DEBUG-SUMMARY]` console 调试残留（0.6.0 已收口大部分到 ContextTrace，剩余持续清理）。
2. **CLI 体验润色**：错误消息更友好、`doctor` 检查项更全、`init` 模板补 `tool-agent` 与 `host-agent` 两个进阶模板。
3. **`examples/minimal-host` 中间深度示例**：从 quickstart 到生产 host 之间的可运行示例（SQLite EventStore + SSE + context fence + 完整 port 替换）。
4. **integration docs 补 "tool calls 标准化指引"**：明确告诉外部接入方 framework 不持有 `steps / toolCalls / toolResults` result 对象，host adapter 该如何在 host 层标准化（参考 linnya tool 开发规范）。
5. **`defineAgentTest()` fluent DSL**：当前 testkit 是 primitives，薄壳 DSL 提升外部测试体验；1-2 天工作量。
6. **26 条不变量接入 quickstart CI**：证明不是只服务 Linnya。
7. **文档补洞**：根据外部接入方反馈，补 integration / quickstart 漏掉的边角说明；保持 release docs / research notes / package.json 三者同步。
8. **host 接入反馈修正**：linnsy / 在线秘书 agent 实际接入压测后的小 schema 修正、错误码补齐。
9. **runSupervisor.ts 拆分**：当前接近 700 行；待 `runTree / handleFailure / recover` 三块中任一启动时一并拆。

### 14.5 按需触发 · 不预先承诺时间表

等真实业务需求出现再启动。没出现就不做，避免无效造轮子：

1. **G-3 Replay SDK**：`linnkit/replay` 子入口；按 runId 回流 EventStore，复现 ContextTrace 与 audit；前置依赖 = 至少一个外部 host 需要 PR-level "我能不能重放这次决策"。
2. **DevTools Web v0**：Event Timeline + Context Window 两视图；前置依赖 = Replay SDK 形状稳定。
3. **G-2 CostLedger / QuotaPort**：长期账单、quota、美元结算；前置依赖 = 真实多租户产品需求。**注意**：CostLedger 是"事件维度记账协议"，不持有 token 计算逻辑——token 数由 host 注入。
4. **N-5 PermissionPort**：先 ask + 白名单，sandbox 后置；前置依赖 = 真实自动化执行外部命令需求。
5. **AgentMessageBus in-process**：前置依赖 = 真实多 agent 互相对话 / orchestrator + worker 场景。
6. **Telemetry 透传 provider cache 元信息**：如果 provider 返回 `prompt_cache_hit_tokens`，通过 TelemetryPort 透传；前置依赖 = 真实 host 关心成本归因。**注意**：这是"透传 provider 给的"，不是"linnkit 发明独立 PromptTrace 协议"。

> **本次审视从"按需触发"剔除的伪需求**（详见 §17.8）：MemoryPort / KnowledgePort / skills / tool catalog progressive disclosure / **跨 provider 统一计费 token 数协议**（注意：**不是 tokenizer 本身**——`tokenizer` 是"计算 token 的方法"统称，linnkit 内置一个默认 tokenizer（tiktoken + 字节比兜底），0.8.0 起通过 `TokenizerPort` 协议接口让 host 用自定义实现替换默认）——本质都是 host 业务层的"工具 + 召回 / 工具 + 文档 / 不同模型不同口径"，framework 已有协议（`ToolRuntimePort` + fence + mustKeep + 默认 tokenizer + `TokenizerPort`）已足够表达，不需要新协议。

### 14.6 永远不做（不在路线图 · 0.7.0 后审视加强）

详见 §0.5.2 与 §17.8。摘要：

- **能力层不做**：任意 graph DSL、内置 RAG、内置业务工具、Sandbox 具体实现、IM 通道适配器、内置 Memory 后端、自由 chat 多 agent 协议、模型自动切换、主机资源监控、host 中文表达层、function 注入式扩展点。
- **协议层不做**：prompt 正文持有、reminder 持久化进 history、`steps / toolCalls / toolResults` 产品级 result 对象（让给 host adapter）、PromptTrace 独立溯源协议（ContextTrace 已覆盖核心价值）、cache miss reason 独立诊断协议（provider 元信息透传即可）、context diff 独立协议（DevTools 按需触发）。
- **业务层不做（0.7.0 后新增）**：MemoryPort（本质是 host 的 `write_memory` / `recall_memory` 工具 + 召回逻辑 + fence 注入）、KnowledgePort（本质是 host 的 `search_knowledge` 工具 + citation 字段约定）、skills / tool catalog progressive disclosure（本质是 host 在 `ToolRuntimePort.list()` 里按上下文返回工具子集 / 通过 fence 注入技能文档）——framework 协议（`ToolRuntimePort` + fence + mustKeep + 12 大分组 contextPolicy）已经足够表达，不需要新 port。
- **跨 provider 计费 token 标准化不做**：不同模型 token 计算口径不一样（OpenAI tiktoken / Anthropic claude-tokenizer / Gemini own tokenizer / 国产模型各家一套），framework 不可能也不应该提供统一计费 token 事实表。linnkit 持有的是**上下文预算 tokenizer**：默认走 `DefaultTokenizerPort`，host 可通过 `tokenEstimation` 三参数调整默认估算，也可在 0.8.0+ 注入 `TokenizerPort` 替换默认。CostLedger 即便未来做，也只是"事件维度记账协议"，计费 token 数由 provider `usage` 提供。

---

## 15. 具体隐患与建议

### 15.1 文档版本漂移

调研时曾发现：

- 包根 README 写 `0.1.1`。
- `package.json` 是 `0.2.2`。
- 0.5.0 后 `package.json` 已是 `0.5.0`，README 改为以 `package.json#version` 与 release docs 为准，并同步修正 framework 文档中的入口数量说法。

影响：

- 外部接入者会怀疑文档可信度。
- 0.x 期间版本语义很重要，尤其你已经写了“minor 才允许签名变化”。

后续建议：

- 把“package.json 版本、README 状态、公开入口数量”加入发版检查清单。
- 每次 minor release 后同步更新 research notes 中的 linnkit 画像，避免横向报告继续传播旧短板。

### 15.2 工具协议类型收口

问题：

- 调研时 `BaseTool.run(args: Record<string, any>)` 是公开面。
- 阶段 0 已改为 `BaseTool<TArgs extends ToolArgs = ToolArgs, TResult extends string = string>`，并同步迁移 host 工具调用方的核心签名。

影响：

- 编译期无法保证 tool args。
- provider tool schema 与 runtime args 无法形成强类型闭环。
- 与项目 AGENTS.md “禁止使用 any 类型断言”精神冲突。

后续建议：

```ts
export abstract class BaseTool<TArgs extends Record<string, unknown> = Record<string, unknown>, TResult = string> {
  abstract run(args: TArgs, context: ToolExecutionContext): Promise<TResult>;
}
```

0.5.0 里这条公开面已经基本完成。后续重点是继续清理 host mock/test helper 中的历史 `any` 断言，避免测试层成为类型漏洞。

### 15.3 字符串 fatal error

问题：

- 调研时 `isFatalProviderError` 判断中文错误消息。
- 阶段 0 已改为 `ContextProviderError`。

影响：

- 若后续新增 provider 绕开 `ContextProviderError`，fatal 行为仍可能退回脆弱字符串语义。

建议：

- 保持所有 provider fatal/control-flow error 统一走 `ContextProviderError`，字段包括 `code / fatal / providerName / cause`。

### 15.4 文件体量

旧问题：

- `runtime-kernel/llm/caller.ts` 约 800 行。
- `runtime-kernel/events/eventMappers.ts` 约 751 行。
- host event-store sqlite implementation 约 1004 行。

0.5.0 状态：

- LLM caller 已按 `request build / streaming adapter / retry fallback / usage telemetry / sidecar replay` 拆。
- event mapper 已按职责拆。
- child-run invoker 也已重命名和拆分。

后续建议：

- `runSupervisor.ts` 接近 700 行关注线；等 `runTree / handleFailure / recover` 继续扩展时拆。
- sqlite event store 可按 `schema / append / query / migration / mapper` 拆。

### 15.5 host 装配可复制性

0.5.0 状态：外部接入者需要读 `src/app-hosts/linnya` 才知道完整装配；integration docs 已经解释公共协议，但还没有把一套完整装配压成可运行 example。

0.7.0 状态：`linnkit init <name>` + `defineAgent` / `runAgent` / `defineConfig` 已经提供"5 分钟入门"的最小可运行示例，覆盖**从零到 hello-agent 跑起来**这段路径。但 quickstart 模板与"生产 host"之间仍缺一层"中间深度示例"——也就是 `examples/minimal-host`：

- hello-agent（0.7.0 已就位）：无 persistence、无 SSE、只跑一轮。
- **tool-agent**（待补）：一个 zod tool + scripted test + 跑通 testkit invariants。
- **host-agent / minimal-host**（待补）：SQLite EventStore + SSE + context fence + 完整 port 替换示例，可用于 CI smoke。

建议：把 `tool-agent` 与 `host-agent` 作为 0.7.x 小步修缮期的优先项。

### 15.6 release docs 状态文案

旧风险：release docs 容易把"源码准备线 / 候选线 / 已发布 tarball"混在一起。

0.7.0 状态：0.5 / 0.6 / 0.7 三次 minor 都已按 Breaking / New / Improved / Internal 四段写完整 release note，并通过 `prepublishOnly` 在发版时自动跑 build + 两轮 smoke。release docs 顶部状态已明确区分：已发布版本（package.json#version + git tag）、当前源码版本、下一次计划发布版本。

剩余建议：

- 每次 minor 发版后立即同步更新 `docs/99-research-notes/` 里的研究报告 linnkit 画像，避免横向对比报告继续传播旧短板（本次更新就是这条建议的体现）。
- `npm publish` 过程中 npm 自动清理 `bin[linnkit]` 脚本名是 npm 自身行为，不影响包可用性；如未来发布注册中心切换，注意核对 bin 字段。

---

## 16. 最终判断（0.7.0 起稳定 · 0.8.0 已落地 TokenizerPort）

linnkit 当前仍不是"功能最多"的 agent 框架——但**这是产品定位选择，不是缺陷**。0.5 / 0.6 / 0.7 / 0.8 四个 minor 让 linnkit 越过了从"内部好内核"到"外部可用框架"的关键分水岭：

| 版本 | 关键交付 | 跨越的分水岭 |
|------|---------|------------|
| **0.5.0** | AgentSpec / RunSupervisor / RunHandle / AuditEnvelope / testkit 15 invariants / docs 17 主题手册拆分 | 外部框架必须有的"协议骨架"补齐 |
| **0.6.0** | 12 大分组 contextPolicy / ContextTrace / SystemReminder 注册表 / host-neutral checkpoint / 26 条 strict invariants / 摘要 agent 协议化 | "声明式上下文工程控制面"成形——这是 TS 生态独有差异化 |
| **0.7.0** | defineAgent / runAgent / defineConfig / linnkit init / run / doctor | 外部接入方"5 分钟入门"路径已铺；linnkit 不再只藏在源码里 |
| **0.8.0** | `TokenizerPort` 协议 / `DefaultTokenizerPort` / `ContextManagerBaseOptions.tokenizer` 注入点 / `C12_HOST_TOKENIZER_DRIVES_BUDGET` 不变量 / testkit `createMockTokenizerPort` | host 可以用真实 Claude / Gemini / 私有模型 tokenizer 替换默认实现——provider-neutral 边界闭合（开源前的最后一块协议补齐）|

**主流框架里各家赢的地方**（0.7.0 校准后）：

- **LangGraph** 赢在复杂编排和 durable runtime；linnkit 不追任意 graph。
- **OpenAI / Claude / Codex** 赢在产品化 agent harness 和 hosted tools；linnkit 不追平台化、不绑 provider。
- **Mastra** 赢在 TS all-in-one DX；linnkit 不追"框架内一口吃下所有能力"。
- **Vercel AI SDK** 赢在极简 API 和 Web / Fluid compute 部署；linnkit 不降级成 streamText 包装器。
- **CrewAI / AutoGen** 赢在多 agent 自由对话心智；linnkit 通过 child-run + detached run 表达多 agent，不做自由 chat。
- **LlamaIndex** 赢在数据 / RAG / index / query planning；linnkit 不追 RAG，只保证外部知识结果进入 agent 上下文后能被 fence / mustKeep / ContextTrace / AuditEnvelope / testkit 治理。
- **Hermes / DeerFlow** 赢在长任务产品功能广度；linnkit 不绑 IM 通道、不内置 cron、不打包 sandbox 实现。

**linnkit 赢在哪里**（0.7.0 起稳定的差异化）：

> linnkit 是 TS 生态里**协议精度最高 / 可观测精度最好 / 与 host 边界最干净**的 Agent framework kernel。它的核心宗旨是"让上下文工程变成精细化、可自由配置、可观测、可审计的事"——12 大分组 contextPolicy + ContextTrace + 26 条 strict invariants 让它在"控制发给 LLM 的每一个 token"这件事上**超过所有同类 TS 框架**。注意：Codex / Claude Code 这类**产品内核**在 prompt cache stability 与 compaction 工程深度上有不同维度的优势，与 linnkit 是"协议精度 vs 产品工程深度"的差异化（详见 §4.0 评分口径声明）。

**下一阶段（0.7.0+）的路线非常清楚——进入"小修小补 + 按需触发"长期稳定状态**：

- ✅ ~~先扩工具~~（不做）
- ✅ ~~先堆 IM 通道~~（不做）
- ✅ ~~先做任意 graph~~（不做）
- ✅ ~~先补 quickstart / CLI~~（0.7.0 已完成）

linnkit 未来的工作**只剩五件事**——这五件事都是"持续打磨已赢的差异化"，不再追加协议项：

| 维度 | 内容 | 性质 |
|------|------|------|
| **1. 审计** | AuditEnvelope / AuditPort 持续打磨；新非确定性决策点逐步纳入 audit；按真实接入方反馈补 sink 实现 | 长期维护 |
| **2. 测试** | 26 条 strict invariants 持续扩展；testkit fluent DSL；CI 接入外部 quickstart 模板 | 长期维护 |
| **3. 回放** | Replay SDK / DevTools v0——按需触发，前置依赖 = 真实合规类外部 host 提出 "PR-level 回放" 需求 | 按需触发 |
| **4. 性能优化** | ContextTrace 揭示的优化机会；token 估算精度；prompt cache stability；preprocessor 编排顺序 | 长期维护 |
| **5. 常规 bug 与维护** | host 接入反馈、Node 版本升级、依赖升级、文档守门、release 流水维护 | 长期维护 |

**明确不再追加协议项**（详见 §17.8 自我校准台账）：

- ❌ **协议层**：PromptTrace / cache miss reason / context diff / `steps/toolCalls/toolResults` result 对象。
- ❌ **业务层**：MemoryPort / KnowledgePort / skills disclosure（本质都是 host 业务层"工具 + 召回 + fence 注入"，framework 协议已足够表达）。
- ❌ **计算层**：跨 provider 统一计费 token 数协议（不同模型口径不一样，对外标准化 = 必然不准 = 误导）。注意：linnkit **内置一个默认 tokenizer**（tiktoken + 字节比兜底）是合理且必须的——它用于 budget 决策；0.8.0 通过 `TokenizerPort` 协议接口让 host 用自定义实现替换默认（详见 §0.5.3.1）。

**关于"未来发展方向像小修小补"这件事的态度**：

> **是的，linnkit 进入了小修小补状态——这是健康的，不是停滞**。0.5 / 0.6 / 0.7 三个 minor 已经把协议层做到位了。"小修小补"不意味着无所作为，而意味着 **linnkit 不再需要追加协议项才能赢**。它已经赢在"协议精度 + 可观测精度"维度——下一步五件事（审计 / 测试 / 回放 / 性能优化 / 常规 bug）都是持续打磨已赢的差异化，而不是再造新能力。
>
> 如果未来某一天 linnkit 觉得"我还差很多大块协议要做"——那大概率是又被某个产品的漂亮 UI 误导成"我也要那个 UI"。**0.7.0 后的判定原则**：评价一个待办是否真实，看它**能不能在协议层独立定义清楚 + 在所有 provider / host 下保持准确**，而不是"另一个产品有这个 UI"（详见 §17.8）。

**linnkit 的产品特色钉死在这一句话**：

> **"对每一个发给 AI 的 token 进行精细化管理"** —— 性能最优、上下文工程最强、极具精细化管理；但精细化管理的代价是复杂度上升，linnkit 在尽量降低这份复杂度（通过 `defineContextPolicy()` 默认值 + quickstart helpers + CLI v0 + 26 条 invariants 提前暴露错配）。别的方面可以学，但不必什么都学——尤其是 host 业务层的"漂亮 UI"，那不是 framework 该追的方向。

一句更直白的话：

> **0.5.0 之前，linnkit 的优势藏在源码里；0.6.0 把它变成接入方能配置、能解释、能复现的上下文工程能力；0.7.0 把它变成 5 分钟可试用的入口。0.7.0 之后，linnkit 不再需要证明"框架能做"——它需要做的是把已有的协议精度持续打磨成可视化、可回放、可审计的开发者体验，但只在真实需求出现时启动**。这不是再一次大跨度升级，而是把已经赢的差异化做得更顺手——并且诚实承认"小修小补"就是健康终态。

---

## 17. 客观短板与不打算克服的差异（产品定位声明）

写这份报告的核心目的之一是**客观**。linnkit 0.7.0 之后仍有几类差异，**不是因为还没做，而是因为产品定位决定了它不会做**。把这些写清楚，让外部接入方在选型时心里有数。

### 17.1 linnkit 永远不会有 Mastra 那种 all-in-one DX

Mastra 的卖点是 `npm create mastra` 起步、自带 memory / workflow / approval / evals / DevTools / platform 一整套。它适合"我要做一个业务 agent，不想自己管底层"的团队。

linnkit 的方向相反：**所有底层 port 都让 host 替换**。代价是 host 装配工作量比 Mastra 重；收益是 host 可以在不被框架心智牵着走的前提下做任何垂直产品。

**如果你的诉求是"3 天上线一个客服 agent"，应该选 Mastra；如果是"3 年维护一个长期产品的 agent kernel"，应该选 linnkit**。

### 17.2 linnkit 永远不会有 LangGraph 的图编排生态

LangGraph 的 StateGraph / interrupt / subgraph / time travel 是为复杂状态机设计的；LangSmith / Studio 是它的生态护城河。

linnkit 选择固定主循环 + 节点插槽 + child-run + detached run 组合，这能覆盖 90% agent 形态——剩下 10% 需要任意图编排的场景，linnkit 主动让出。

**如果你的产品需要"用户能在 UI 上画 agent 流程图"，应该选 LangGraph；如果是"有限几个固定 agent 形态但都要长期可维护"，应该选 linnkit**。

### 17.3 linnkit 永远不会有 OpenAI Agents SDK 的 hosted tools

OpenAI Agents SDK 的最大优势是"web_search / file_search / code_interpreter / image_generation"等 hosted tools 开箱即用，与 Responses API 深度绑定。

linnkit 不会内置任何业务工具，因为：(a) 工具 = 产品决策；(b) 绑 provider 会破坏 vendor-neutral 定位。

**如果你的产品想"All in OpenAI、把工具调用交给 OpenAI 平台"，应该选 OpenAI Agents SDK；如果是"我要在多个 provider 之间切换、自己控制每一个工具的边界"，应该选 linnkit**。

### 17.4 linnkit 永远不会有 Claude Code 那种 IDE / TUI 产品体验

Claude Code 是 Anthropic 的产品内核——内置 Read / Write / Edit / Bash / WebSearch、TUI、IDE bridge、MCP / skills / hooks 产品化、permissions / sandbox 产品级实现。它是为"编程 agent"这一垂直场景做的完整产品。

linnkit 不会做这些，因为它是 framework 而不是产品。任何想做"开源 Claude Code"的人，应当**基于 linnkit 自建产品层**，而不是期待 linnkit 内置。

**如果你的诉求是"我直接要一个能用的编程 agent"，应该选 Claude Code SDK 或 Codex CLI；如果是"我要做一个垂直领域的 agent 产品、基础设施需要自己掌控"，应该选 linnkit**。

### 17.5 linnkit 永远不会有 Hermes 那种产品功能广度

Hermes 内置多 IM 通道、cron、skills、memory、terminal backend、gateway、ACP、RL training——这是为 always-on 私人助理这一垂直场景做的完整产品。

linnkit 不会做这些，因为：(a) IM 通道适配器是 host 集成工作；(b) cron / scheduler 是 host 的事；(c) memory backend 千差万别，不应由 framework 选择。

### 17.6 这些"不做"为什么是好事

一个 framework 的价值不只是"它做了什么"，更是"它不做什么"——后者决定了它能不能在 3 年后还是同一个心智模型。

- **linnkit 不做的东西，决定了它能跑 3 年**：
  - 不绑 provider → 模型 / API 换代不影响 framework。
  - 不绑业务工具 → host 工具迭代不影响 framework。
  - 不绑 UI / IM / sandbox → 产品形态变化不影响 framework。
  - 不持有 prompt 正文 → LLM 行为改进不影响 framework。
  - 不内置 RAG / memory → 数据后端选型不影响 framework。

- **linnkit 做的东西，3 年内不应大改**：
  - AgentSpec / RunSupervisor / AuditEnvelope 协议
  - 12 大分组 contextPolicy 字段语义
  - 4 维事件治理 lifecycle
  - 26 条 strict invariants
  - child-run / detached run 双协议

这是"协议层 vs 实现层"的二分法。linnkit 守住协议层、永远不下沉到实现层；这条线越严格，长期价值越大。

### 17.7 不做的东西什么时候可能变？

只有一个变量：**真实业务需求超过 ≥ 2 个独立外部接入方**。

`KnowledgePort` 边界、`SandboxPort` 边界、`MemoryPort` 边界、`AgentMessageBus` ——它们都会在"两个以上的真实外部 host 提出同一类需求"时被启动设计。但即便启动，linnkit 也只做 **port + 1-2 个参考实现**，不会做完整产品方案。

这是 linnkit 0.7.0 起稳定的产品哲学：**协议层做深、实现层做浅**。

### 17.8 0.7.0 后审视移除的伪待办（自我校准台账）

> 本节诚实记录 0.7.0 后一次"指挥官级审视"砍掉的伪待办。重要的是**为什么不做**，而不是"我以为我缺什么"。

| 曾经的"待办" | 移除理由 | 替代去向 |
|------------|---------|---------|
| **PromptTrace（context 段落溯源到原始事件）** | ContextTrace 的 `message-decision` 已经能解释每条消息的 keep/drop reason + 阶段 token delta + 命中策略——这些是核心价值。"某段 prompt 来自哪个原始事件 id"是 host EventStore 的数据库 JOIN 工作，**不应该在 framework 协议层再造一份独立协议**。 | 留在 ContextTrace + host EventStore JOIN；不发明 framework 协议。 |
| **cache miss reason 诊断协议** | cache miss 是 OpenAI / Anthropic provider 内部信息，framework 只能透传 provider 给的元信息（如 `prompt_cache_hit_tokens`），**不能凭空发明 cache hash / cacheable prefix 这种 framework 层协议**——那会让 framework 持有 provider 的隐含语义。 | 按需通过 `TelemetryPort` 透传 provider 元信息（§14.5#7）；不做独立协议。 |
| **context diff 可视化（两次 run 上下文差异）** | DevTools 层产品化能力；`replacementSourceIds` 已经是协议层的可对比基础，diff 视图是按需触发的可视化工具，**不该写进"缺点清单"**。 | DevTools v0（§14.5#2）按需触发。 |
| **`PromptTrace` / `cache hash` / `cacheable prefix`** | 这些是 SDK / 产品层概念，linnkit 已通过 `replacementSourceIds` + `toolHistory.strategy: 'per-run'` 默认 + ContextTrace 在协议层落实了 prompt cache 稳定性原则。**协议已经覆盖核心**。 | 已在协议层，无需再造产品化诊断工具。 |
| **`steps / toolCalls / toolResults` result 对象（Vercel AI SDK 风格）** | 这是 SDK 层产物，不是协议层产物。linnkit 已通过 `ToolRuntimePort` + `AuditEnvelope` + tool 配对不变量 C10 守住协议；产品级 result 对象是 host adapter 的工作。 | Integration docs 加一段提示（§14.4#4）；framework 不内置。 |
| **MemoryPort 边界 / memory 相关协议** | 本质是 host 业务层的"工具 + 召回 + fence 注入"：`write_memory` / `recall_memory` 工具走 `ToolRuntimePort`、召回结果走 fence（`lifetime: 'persisted'`）、关键 memory 走 `contextPolicy.mustKeep`。framework 已有协议**完全足够表达**，再造新 port 就是在 framework 层硬编码 host 业务决策。 | host 业务层自实现；integration docs 提示"如何用 fence + mustKeep 实现 memory"。 |
| **KnowledgePort 边界 / RAG / 召回 / citation 协议** | 本质是 host 业务层的"工具 + 召回 + citation 字段约定"：`search_knowledge` 工具走 `ToolRuntimePort`、召回结果走 fence、citation 字段由 tool 返回结构决定（参考 linnya tool 规范的 `data` / `observation` 分层）。framework 硬编码 citation = 框死 host 业务决策。 | host 业务层自实现；integration docs 引用 linnya tool 规范。 |
| **skills / tool catalog progressive disclosure 协议** | 本质是 host 决定的"按上下文动态返回工具子集"：`ToolRuntimePort.list()` 已经是 host 接入面，可以根据当前 fence / 上下文返回不同工具集；"技能文档"通过 fence（lifetime: 'turn'）注入即可。**framework 协议不需要新一层 `skill` 类型**——`skill = tool + 文档 + 触发条件`，三件都已有协议表达。 | host 业务层自实现。 |
| **跨 provider 统一计费 token 数协议**（注意：**不是** "framework 不持有 tokenizer"）| 术语：`tokenizer` 是"计算 token 的方法"统称。不同模型 token 计算口径完全不一样，framework 把它对外标准化成跨 provider 统一数字 = 必然与真实计费偏离 = 误导接入方在不准的口径上做决策。**但 linnkit 内置一个默认 tokenizer 是合理的**——budget 决策需要一个本地估算，0.7.x 已经用 `TokenCalculator`（tiktoken + 字节比兜底）实现，0.8.0 通过 `TokenizerPort` 协议接口让 host 用自定义 tokenizer 替换默认。**不做的是"对外暴露 / 跨 provider 标准化 token 数"**，**做的是"默认 tokenizer + 协议接口可替换"**。 | 计费 token 数由 provider `usage` 决定（host 自己消费）；预算决策走当前生效的 tokenizer（默认 = tiktoken + 字节比兜底；host 可调 3 参数；0.8.0+ 可注入实现替换）。 |

#### 共同模式

这些伪待办都来自三种错觉：

| 错觉 | 真相 | 典型例子 |
|------|------|---------|
| **"X 框架有一个看起来漂亮的产品化协议，linnkit 没有，所以 linnkit 缺"** | linnkit 协议层已经能覆盖核心价值，剩下是 DevTools / host adapter 包装工作 | ContextTrace 之于 PromptTrace；fence 之于 KnowledgePort |
| **"X 框架把业务能力标榜成框架能力，linnkit 也得标榜"** | X 框架的"port" / "协议"其实是 host 业务层硬编码——linnkit 协议层已经够灵活，不需要硬编码 | MemoryPort / KnowledgePort / skills disclosure |
| **"X 框架对外暴露 Y 标准化协议，linnkit 也得对外暴露"** | Y 在不同模型 / provider 下口径不一样，framework 把它**对外标准化** = 必然不准 = 误导。注意：framework **内部用**它做决策是合理的（如 linnkit `TokenCalculator` 内部估算 budget），不暴露给 host 当跨 provider 计费数字。 | 跨 provider 统一计费 token 数 / cache miss reason |

**0.7.0 之后的判定原则**：评价一个"待办"是不是真的，看它**能不能在协议层独立定义清楚 + 在所有 provider / host 下都能保持准确**——而不是"另一个产品有这个 UI"。**协议层已经稳定**——下一阶段不应该再追加协议项，而应该把已有协议层的事实表通过 DevTools / Replay SDK / CostLedger 这些可视化工具呈现出来——而这些工具只在真实需求出现时启动。

#### 这次审视对 linnkit 的意义

- **当前"小修小补"状态是健康的，不是停滞**：协议层在 0.7.0 已经稳定，再补能力会越界。
- **未来发展方向不是"再做 N 件大事"**：而是按需触发 + 持续守护协议精度。
- **要警惕"自我虚构待办"**：每次看到"某个框架有 X，linnkit 没有"，先问"X 是协议层的吗？协议层 linnkit 已有的东西能不能替代 X 的核心价值？"再决定是否纳入路线图。
