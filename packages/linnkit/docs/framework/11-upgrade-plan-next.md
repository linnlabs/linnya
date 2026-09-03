# 11 · 升级计划（Next）

> **⚠️ 2026-06-22 治理校准**：本文立稿于 2026-05-12。其中阶段 **1F 已于 0.6.0 完成、1C 已于 0.7.0 完成**，实际版本已达 `0.21.0`。本文保留作历史规划档案；**最新真实状态与施工清单以 [`14-governance-and-cleanup-plan.md`](./14-governance-and-cleanup-plan.md) + [`CHANGELOG.md`](../../CHANGELOG.md) 为准**。仍有效的未完成项：1D（chat 兼容层物理删除，host 仍在用）。

> **⚠️ 2026-08-25 上下文机制替代说明**：§1 中 `summarization.agentId`、`history_compression`、`checkpoint.*`、`ContextCheckpointTool`、step-reset、`context_budget_warning` 与独立摘要模型都是当时 1F 的实施历史，现已成组退役。当前唯一 live 机制是 `contextPolicy.compaction`：Context Manager 生成纯计划，Graph 使用当前已锁定模型自动压缩并在容量接纳后提交 durable `history_summary`；旧字段和工具不保留兼容。当前合同只看 [`integration/context-engineering.md`](../integration/context-engineering.md)、[Graph Engine README](../../src/runtime-kernel/graph-engine/README.md) 与 [`CHANGELOG.md`](../../CHANGELOG.md)。下文历史清单不据此回写或伪装成现状。

> **2026-05-12 立稿**。本文承接 [`10-history-and-decisions-2026.md`](./10-history-and-decisions-2026.md)——10 文档归档了 2026 H1 已完成阶段（阶段 0 / 1A / 1B / G-1 / 0.5.0 发版准备）的执行记录与设计决策档案；本文只登记**还未做、下一步要做**的内容。
>
> **写作约定**：阶段从已完成的"主线后段"接续；任务清单按"前置依赖 → 工作量 → 完成判据"三栏写；阶段完成后内容**整体下沉**到 10 文档归档，本文只保留"未来"。
>
> **读者画像**：linnkit 维护方、规划 0.5.0 之后版本演进的内部团队。
>
> **不是接入手册**：外部接入方读 [`docs/integration/`](../integration/)。
>
> **指挥官 / 实施者分工约定**（2026-05-12 立）：本文档由"指挥官"角色维护，负责设计、规划、决策、文档；不直接写实现代码。各阶段的代码实施由独立工程师 / agent 接手——本文档是 spec，必须做到"接手即能按日推进"。每个阶段的设计稿包括：(1) 设计原则、(2) 数据/接口形态、(3) 子任务清单与工时、(4) 实施切片建议、(5) 风险登记、(6) 测试策略、(7) 完成判据。阶段进入实施期后，进度由实施者在"§X · 状态登记"中追加记录。

---

## 0. 一句话路线（0.5.0 之后）

```text
阶段 1F · Context Engineering 协议化（≈2.5 人周，0.6.0） ⏳ **最高优先级**——兑现 linnkit 宗旨
阶段 1E · linnsy 适配（≈2-3 天 host 侧 thin wrapper）   ⏳ 0.5.0 发版后立即启动；与 1F 并行（不同人）
阶段 1C · Quickstart + linnkit-cli v0（≈1 人周）        ⏳ 1F 完成后启动（CLI 命令依赖 1F 协议）
阶段 1D · chat 收敛 + 删 linnkitCompat（≈1.5 人周）     ⏳ 阶段 2 起手前清干净
阶段 2 · Phase G 性能/DX 子集（≈10 人周）               ⏳ 1C/1D 完成后
阶段 3 · 按需触发（不预先承诺）                          🔵 视真实需求
```

总计阶段 1F+1C+1D+1E：约 6.5 人周左右；阶段 2 再 2 个月。

**阶段 1F 为什么是最高优先级**：

linnkit 的宗旨是"让上下文工程变成精细化、可自由配置、可观测、可审计的"。agent 开发的顶级思想就是**精细化控制发给 AI 的每一个 token**——这是 linnkit 与 LangGraph / Mastra / OpenAI Agents SDK 真正的差异化。Quickstart / CLI 这些都是"易用性糖"，可以后做；**协议级开放上下文工程配置**是产品定位的核心承诺，必须先兑现。

---

## 1. 阶段 1F · Context Engineering 协议化（0.6.0，**最高优先级**）

> 决策日期：2026-05-12
> 目的：兑现 linnkit "让上下文工程变成精细化、可自由配置、可观测、可审计"的核心宗旨。把目前散落在 framework 内部 magic number、host 装配级隐式配置、AgentSpec 已开放字段三处的上下文工程参数，**统一收口到 `AgentSpec.contextPolicy` 协议**——任何 agent 都能通过声明式配置精细化控制发给 LLM 的每一个 token。
>
> **本轮评估修订（2026-05-12）**：读完现有 `AgentSpec` / `AgentMessageOrchestrator` / `AgentWorkingMemoryProvider` / `SystemReminder` / `TokenCalculator` 后，确认原计划方向正确，但需要三处加强：(1) `AgentWorkingMemoryProvider` 先拆职责再继续扩字段；(2) 摘要 prompt 必须通过注册表引用纳入 1F，否则"每个 token 可控"不完整；(3) 只开放配置不够，必须同步落 `ContextTrace`，让接入方能看见每个字段如何影响最终 messages。

### 1.1 设计原则（必须坚持）

| # | 原则 | 反例 |
|---|------|------|
| 1 | **新增字段 optional + framework 默认值兜底**；0.5.0 已有的 `contextPolicy.profileId` 继续保持原语义，外部可用 `defineContextPolicy()` 自动补默认 | 强制所有 host 改 AgentSpec 才能跑（破坏向下兼容）|
| 2 | **声明式 + 注册式扩展，不做"函数注入"** | 在 spec 里塞个 `customRule: (ctx) => string`——破坏序列化、回放、审计能力 |
| 3 | **不破坏 0.5.0 既有 AgentSpec** | 改既有字段语义 → 任何依赖 0.5.0 的 host 立即破 |
| 4 | **不开放反协议能力** | reminder 持久化进 history、tool_calls/tool_output 配对解绑 等 |
| 5 | **不开放协议骨架** | P1-P4 优先级数字、ContextProvider 三阶段顺序、preprocessor 优先级层级 |
| 6 | **每条新字段必须能从 `docs/integration/context-engineering.md §11 三色表` 找到对应位置** | 加了字段但文档不更新——配置面变隐形债 |
| 7 | **host 装配级 fallback 通道**：host 可声明"我的所有 agent 默认 policy"，agent 不显式设的字段用 host fallback 而非 framework 默认 | 强制每个 agent 都得重复填同一个 policy |
| 8 | **每个可配字段必须有可观测结果**：ContextTrace / AuditEnvelope / testkit invariant 至少覆盖一种 | 字段进了 schema，但没人能证明它真的影响最终 LLM 输入 |

### 1.2 `AgentSpec.contextPolicy` 扩展面（11 大分组；Provider replay 已下沉 route）

> AgentSpec 保留 11 个上下文行为分组。早期加入的 `providerReplay` 已于 2026-08-14 退役，因为它不是 Agent 行为策略，而是 active inference route 的 Provider 协议能力。这里的目标不是"字段越多越好"，而是：凡是会改变最终 LLM 输入 token 的机制，都要能被外部声明、被框架合并、被测试证明、被 trace 解释。

#### 1.2.1 `budget`（已有，扩字段）

| 字段 | 默认 | 含义 | 状态 |
|------|------|------|------|
| `maxTokens` | 未声明（继承模型 route） | Agent 显式总窗口上限 | ✅ 已开放 |
| `reservedForResponse` | 未声明（继承模型 route） | Agent 显式输出上限 | ✅ 已开放 |
| `workingMemoryBudgetPercentage` | `0.70` | 工作记忆占可用预算的比例 | ✅ 已开放 |

#### 1.2.2 `toolHistory`（已有，扩字段）

| 字段 | 默认 | 含义 | 状态 |
|------|------|------|------|
| `strategy` | `'per-run'` | 三策略 | ✅ 已开放 |
| `keepLatestToolPairs` | `2` | per-pair 用 | ✅ 已开放 |
| `keepLatestRuns` | `1` | per-run 用 | ✅ 已开放 |
| `maxInteractionGroups` | `12` | 硬上限 | ✅ 已开放 |
| `overflowStrategy` | `'keep-latest'` | 硬上限溢出策略 | ✅ 已开放 |

#### 1.2.3 `toolOutput`（🆕 F1.14 新增分组）

控制工具执行期 observation 预览治理。注意：AgentSpec 只控制治理阈值与启停，真正的落盘路径、对象存储、文件名规则由 host 的 `ObservationPreviewPort` 实现。

| 字段 | 默认 | 含义 | 状态 |
|------|------|------|------|
| `observationGovernance.enabled` | `true` | 是否启用执行期 observation 预览/落盘治理 | ✅ 已开放 |
| `observationGovernance.maxChars` | `20000` | 超过多少字符触发 preview + blob 指针 | ✅ 已开放 |
| `observationGovernance.maxLines` | `1200` | 超过多少行触发 preview + blob 指针 | ✅ 已开放 |

#### 1.2.4 Provider replay（2026-08-14 收回 AgentSpec 开放面）

`contextPolicy.providerReplay` 已退役。Provider 工具回放要求不是 Agent 行为策略，而是 active inference route 的协议能力；继续允许 Agent 覆盖会把 required route 关闭，造成无效请求。Host 只从 `inference_route.continuation.tool_replay` 注入 required/optional/unavailable，required route 的完整工具组缺失 `assistant_replay_parts` 中对应的 tool continuation 时 fatal，不降级、不补空字段、不猜测 part 顺序。

#### 1.2.5 `summarization`（已有，1F 扩展为注册表引用）

| 字段 | 默认 | 含义 | 状态 |
|------|------|------|------|
| `enabled` | `true` | 是否注册自动 Summary Provider；`false` 时不调摘要模型 | ✅ 已开放 |
| `triggerThreshold` | `0.70` | 触发摘要的预算比例 | ✅ 已开放 |
| `budgetPercentage` | `0.12` | 可执行的摘要输出上限占有效消息预算比例；还要受摘要模型 route 收窄 | ✅ 已开放 |
| `oldestMessagesPercentage` | `0.75` | 选最老消息的比例 | ✅ 已开放 |
| `agentId` | `undefined`（host 默认 `history_compression`） | 引用 host 注册的无工具摘要 agent/chat；spec 只存 ID，不存 prompt 文本 | 🆕 1F |
| `failureBehavior` | `'fail-fast'` | 摘要失败后的行为；默认保持 0.5.0 的 fatal 语义 | 🆕 1F |

> **修订说明（2026-05-12）**：原草案把 `promptTemplate` 延后到阶段 2，但"控制每一个 token"绕不开摘要 prompt。F1.9 再次收窄边界：摘要不是"选一段 prompt 模板"，而是**调用一个已注册的无工具 agent/chat**。因此协议字段使用 `summarization.agentId`，framework 只保存注册引用；prompt 正文、模型策略、执行方式都由 host 注册表负责。
>
> `failureBehavior` 只允许安全枚举：`'fail-fast' | 'continue-if-within-budget'`。第二种只有在当前未超预算时才允许继续；如果已经超预算，仍然必须抛 `ContextProviderError`，不能静默塞爆上下文。
>
> **2026-08-24 合同收口**：Summary 默认开启，新增显式 disable 语义。`SummaryGenerationRequest.maxOutputTokens` 与 `SummaryGenerationResponse.appliedMaxOutputTokens` 共同锁定 Provider 请求及返回上限；`history_summary` 只由 Graph 消费 `summaryEvents` 发布，Host lifecycle callback 只发 SSE-only progress。

#### 1.2.6 `mustKeep`（🆕 1F 新增分组）

把 `MustKeepPolicy` 从 host 装配级上提到 AgentSpec：

| 字段 | 默认 | 含义 |
|------|------|------|
| `alwaysKeepTypes` | `['system_prompt', 'user_input']` | 按 AiMessage.type 列表——一律不裁 |
| `alwaysKeepFenceKinds` | `[]` | 按 fence kind 列表——一律不裁（host 想 must-keep 哪些 fence 就显式声明）|
| `truncationRules` | `[]` | 限量截断规则：`Array<{ fenceKind, maxBudgetFraction, strategyName }>` |

host 仍然可以通过装配级注入更复杂的 policy（如 custom matcher 函数），但**协议层涵盖 95% 场景**。

#### 1.2.7 `workingMemory`（🆕 1F 新增分组）

把当前 host 装配级的工作记忆调参上提到 AgentSpec：

| 字段 | 默认 | 含义 |
|------|------|------|
| `maxRecentToolRuns` | `2` | 原始 tool_calls 形态保护的最近工具 turn 数 |
| `maxRecentToolInteractions` | `2` | Deprecated alias，兼容旧配置 |
| `minToolInteractionsToKeep` | `2` | compressed 历史工具摘要的预算兜底组数 |
| `toolPairingSearchRange` | `10` | 搜工具配对的窗口范围 |

#### 1.2.8 `checkpoint`（🆕 1F 新增分组）

| 字段 | 默认 | 含义 |
|------|------|------|
| `keepPairsBefore` | `2` | checkpoint 之前保留多少对工具交互（解 `KEEP_RECENT_TOOL_PAIRS_BEFORE_CHECKPOINT` 硬编码）|
| `triggerToolName` | `'context_checkpoint'` | 触发 checkpoint 的工具名（允许 host 改名，但仍是产品决策"是否注册"）|

> **接入边界修订（2026-05-13）**：linnkit 提供 checkpoint marker、上下文裁剪、step-reset、SystemReminder 联动，以及 host-neutral 的最小 `ContextCheckpointTool` / `createContextCheckpointTool()`。host 若想启用主动 checkpoint，必须把 `checkpoint.triggerToolName` 对应工具注册进 agent 工具集；默认工具只处理 `summary -> CHECKPOINT_MARKER_TYPE`，TaskState / SharedMemory / 外部文档写入仍归 host，可通过 hook 扩展或自定义工具实现。这保持 framework 不绑定 host 状态系统，同时降低外部接入成本。

#### 1.2.9 `reasoningRetention`（历史方案，已退役）

1F 曾用 `keepLatestThoughts` / `MAX_THOUGHTS_TO_KEEP` 控制独立 thought。现已确认这是错误分层：`thought` 是 UI / 审计投影，canonical reasoning 的模型侧 owner 是 ordered Assistant replay。该分组及运行时映射已删除，全部 reasoning 随所属 replay 保留到正式压缩。

#### 1.2.10 `tokenEstimation`（🆕 1F 新增分组）

| 字段 | 默认 | 含义 |
|------|------|------|
| `encoding` | `'cl100k_base'` | tiktoken encoding 名 |
| `avgCharsPerToken` | `2.0` | 兜底估算比（tiktoken 不可用时用）|
| `toolCallOverhead` | `50` | 单次 tool_call 的额外 token 估算开销 |

#### 1.2.11 `systemReminder`（🆕 1F 新增分组，**最复杂的一段**）

| 字段 | 默认 | 含义 |
|------|------|------|
| `enabledRuleIds` | `null`（= 全部启用） | 白名单：只启用列出的规则 ID |
| `disabledRuleIds` | `[]` | 黑名单：禁用列出的规则 ID（与 enabled 二选一）|
| `thresholds.toolCallStreak` | `10` | 工具调用 N 次提醒的阈值 |
| `thresholds.periodicReflectionPeriod` | `30` | 每多少步触发反思 |
| `thresholds.budgetWarningRatio` | `0.9` | 上下文预算告警比例 |
| `thresholds.lastStepsHintThreshold` | `0`（host runner 注入）| 剩余 N 步开始提示 |
| `extraRules` | `[]` | host 注入的额外规则——**通过注册表**而非函数（见 §1.3）|

#### 1.2.12 `contextTrace`（🆕 1F 新增分组，最小可观测闭环）

| 字段 | 默认 | 含义 |
|------|------|------|
| `enabled` | `false` | 是否记录本次上下文构建 trace |
| `includeMessageIds` | `true` | trace 中是否包含消息 ID，便于调试裁剪来源 |
| `includeTokenBreakdown` | `true` | 是否输出每阶段 token 用量与增减 |
| `maxTraceEvents` | `200` | 防止 trace 自身膨胀 |

> **边界**：这不是完整 DevTools / PromptTrace。1F 只提供机器可读的最小 `ContextTrace`，证明每个 contextPolicy 字段如何影响最终 messages。可视化、prompt diff、跨 run 对比放到阶段 2。

#### 1.2.13 协议级**不**开放的字段

明确登记哪些**不进 AgentSpec**，防止社区压力推上来：

| 字段 | 不开放的原因 |
|------|------------|
| Reminder 持久化进 history | 违反 reminder 协议本质（瞬态状态注入）；需要持久化请走 fence `lifetime: 'persisted'` |
| ContextProvider 三阶段顺序 | 协议骨架；改了破坏所有 host 的可预期性 |
| Preprocessor pipeline 默认顺序与优先级 | 同上 |
| P1-P4 优先级数字 | 算法骨架 |
| tool_calls / tool_output 配对不变量 | 协议级硬约束 |
| `CORE_MESSAGE_TYPES` / `P1_CONTENT_TYPES` 等枚举 | 协议 vocabulary，host 决定不了 |

### 1.3 SystemReminder 自定义规则：声明式注册（不是函数注入）

**关键设计**：host 不通过"塞个 `when: (ctx) => boolean` 函数进 spec"扩展规则——那会破坏 spec 的声明性、可序列化、可回放、可审计能力。

**正确做法**：分两层

**第一层：spec 层声明**

```ts
// AgentSpec.contextPolicy.systemReminder.extraRules
extraRules: [
  {
    id: 'memory-density-warning',           // host 自定义 ID
    trigger: {
      kind: 'tool-call-streak',             // 协议级 trigger 枚举
      threshold: 5,
      moduloStep: true,                     // 每 5/10/15 触发
    },
    contentTemplate: 'memoryDensityWarning', // 引用 template 名
    contentArgs: { resourceName: 'memory_recall' },
  },
]
```

**第二层：host 启动时注册 trigger 类型与 content template**

```ts
import { systemReminder } from '@linnlabs/linnkit/runtime-kernel';

systemReminder.registerTriggerKind('tool-call-streak', (ctx, config) => {
  // 协议层定义"这类 trigger 怎么判断"
  return countToolCallsInCurrentRequest(ctx.history, config.toolName) >= config.threshold;
});

systemReminder.registerContentTemplate('memoryDensityWarning', (ctx, args) => {
  return `你已连续 ${ctx.toolCallStreak} 次调用 ${args.resourceName}...`;
});
```

**协议层提供的内置 trigger 枚举（host 必须从这里选）**：

| trigger kind | 行为 | 用 framework 内置规则提供 |
|--------------|------|--------------------------|
| `phase-equals` | `executorLocal.phase === value` | ✅ |
| `remaining-steps-leq` | `remainingSteps <= threshold` | ✅ |
| `step-count-modulo` | `stepCount > min && stepCount % period === 0` | ✅ |
| `tool-call-streak` | 当前 request 工具调用数 ≥ threshold | ✅ |
| `budget-warning` | `stepCount >= maxSteps * ratio` | ✅ |
| `agent-has-tool` | `request.availableTools.includes(toolId)` | ✅ |

这 6 个 trigger kind 已经能覆盖现有 5 条内置规则 100%。host 想做"我自己的 trigger 类型"——通过 `registerTriggerKind` 在装配期声明，**spec 层只引用 kind 名字**。

**收益**：

- spec 100% 可序列化、可回放、可 diff
- host 自定义规则的"trigger 逻辑代码"显式分离，单元测试友好
- DevTools 未来能直接渲染规则触发链路（spec 是事实源）

### 1.4 子任务清单与工时

| 子任务 | 工时 | 依赖 | 完成判据 |
|--------|------|------|---------|
| F1.0 `AgentWorkingMemoryProvider` 先拆职责（已从 683 行拆到 249 行）| 1.0d | — | ✅ 已完成：抽出 `CurrentToolInteractionRetention` / `HistoricalToolInteractionRetention` / `ToolGroupKeeper` / `TextConversationRetention` / `PostToolCallRetention` / `HistoricalToolCandidates` 等小模块；所有新职责文件 ≤ 134 行；行为测试零 diff |
| F1.1 `AgentSpec.contextPolicy` schema 扩展（10 大分组）+ `defineContextPolicy()` helper | 1.0d | — | ✅ 已完成：新字段全部 optional；0.5.0 spec 可解析；helper 可补 `profileId: 'agent'` 与默认结构；contract test 通过 |
| F1.2 `agentSpecAdapter.ts` 扩展：把新字段映射到 builder config + preprocessor/provider/system-reminder options | 1.0d | F1.1 | ✅ 已完成：adapter 覆盖 builder / preprocessor / provider / systemReminder 四类运行时选项；未填字段不改变 0.5.0 行为 |
| F1.3 `ContextPolicyFallback` 合并器 | 0.5d | F1.1 | ✅ 已完成：`mergeContextPolicy({ frameworkDefault, hostFallback, agentSpec })` 独立函数；按分组字段级合并，数组整体替换；矩阵单测覆盖 |
| F1.4 `MustKeepPolicy` 装配链路改造：`AgentMessageOrchestrator` 按 request 构造 provider registry | 1.0d | F1.1-F1.3 | ✅ 已完成：`mustKeep.{alwaysKeepFenceKinds, truncationRules}` 已经通过 request policy 重建 provider registry；产品级 `additional-context` 这类 must-keep 从 framework/registry 硬编码迁到 host fallback policy |
| F1.5 `WorkingMemory` 内部 magic number 改为 `Partial<AgentContextBuilderConfig>` 注入；`AgentSpec.workingMemory` 透传 | 1.0d | F1.0-F1.3 | ✅ 已完成：`maxRecentToolRuns`（`maxRecentToolInteractions` 兼容 alias）/ `minToolInteractionsToKeep` / `toolPairingSearchRange` 走 `contextPolicy -> contextBuilderConfig -> AgentWorkingMemoryProvider` 链路；provider 与 orchestrator 测试覆盖 |
| F1.6 `CheckpointSummarizationProvider.keepPairsBefore` / `triggerToolName` 改为构造参数 + spec 透传 | 0.5d | F1.1-F1.3 | ✅ 已完成：spec 设 `keepPairsBefore: 4` → 实际保留 4 对工具交互；provider 按 `triggerToolName` 识别 checkpoint 工具组；`keepPairsBefore: 0` 明确表示不额外保留 checkpoint 前工具对 |
| F1.7 `tokenEstimation` 配置上提：`TokenCalculator` / `TokenEstimator` 接受 encoding / 兜底比 / overhead 注入 | 0.75d | F1.1-F1.3 | ✅ 已完成：`ContextManagerBase` 通过 `TokenCalculator.estimateMessageTokens()` 消费 `TOKEN_ENCODING_NAME` / `AVG_CHARS_PER_TOKEN` / `TOOL_CALL_OVERHEAD_TOKENS`；host 切换 encoding 与工具调用 overhead 已从 spec 生效 |
| F1.8 thought 保留策略（历史任务） | 0.5d | F1.0-F1.5 | ✅ 后续收敛：旧字段与硬编码已整体删除；ordered Assistant replay 是唯一模型侧 reasoning owner |
| F1.9 Summarization 注册 agent + failure behavior | 1.0d | F1.1-F1.3 | `agentId` 只引用 host 注册的无工具摘要 agent/chat；默认可以解析到 host 注册的 `history_compression` 这类摘要项；`failureBehavior` 默认 `fail-fast` 零行为漂移 |
| F1.10 SystemReminder 改造为**注册表 + spec 引用**架构 | 2.0d | F1.1-F1.3 | ✅ 已完成：内置 5 规则迁到 trigger/template 架构；`enabledRuleIds` / `disabledRuleIds` / thresholds / extraRules 运行时生效；checkpoint 工具名与 step-reset / reminder 统一 |
| F1.11 `ContextTrace` 最小观测协议 | 1.0d | F1.2-F1.10 | ✅ 已完成：`ContextBuildResult.contextTrace` 可产出 effective policy、provider 阶段 token delta、message keep/drop 原因；默认关闭并受 `maxTraceEvents` 限流 |
| F1.12 文档：`docs/integration/context-engineering.md` 三色表更新 + 各章节同步 + 新增"声明你的第一个 system reminder / summarization agent"小节 | 1.0d | F1.1-F1.11 | ✅ 已完成：三色表 30+ 字段从 🟡/🔴 转 ✅；`context-fences.md` / `tool-history.md` 已同步 `contextPolicy` / `ContextTrace` 口径 |
| F1.13 testkit 不变量补充（新增 11 条"contextPolicy 各字段生效"断言）| 1.0d | F1.11 | ✅ 已完成：`validateContextPolicyInvariants` / `assertContextPolicyInvariants` 进入 public testkit，覆盖 trace 开关、effective policy、预算、provider token delta、message keep/drop、工具配对与 must-keep |
| **合计** | **≈13.25d / 约 2.5 人周** | | 0.6.0 发版 |

> **实施边界**：1F 可以新增注册表与 helper，但不能把 prompt 正文、host 中文表达层、业务工具策略塞进 framework。所有"自定义文本"都必须通过 ID 引用 host 注册内容。

### 1.5 实施切片建议（按日推进，约 13 个工作日）

> 给接手实施的工程师 / agent 一份"按日推进"的切片建议。每天结束后跑一次本文 §1.7 的测试矩阵；每个切片视为一个独立 PR / commit。

| 日 | 子任务 | 输出物 |
|----|--------|--------|
| D1 | F1.0 provider 拆分 + 行为基线 | `AgentWorkingMemoryProvider` 主文件 ≤ 420 行；现有 working-memory 测试零 diff |
| D2 | F1.1 schema + helper | `AgentSpec.contextPolicy` 10 大分组；`defineContextPolicy()`；contract test 覆盖空/半/全字段 |
| D3 | F1.2 adapter + F1.3 merge helper | `agentSpecAdapter.ts` 完整映射；`mergeContextPolicy()` 6 组矩阵测试 |
| D4 | F1.4 `MustKeepPolicy` | provider registry 能按 request 构造；`alwaysKeepFenceKinds` 通过 e2e 验证 |
| D5 | F1.5 `WorkingMemory` | 三个 magic number（`maxRecentToolRuns` / `minToolInteractionsToKeep` / `toolPairingSearchRange`）走 spec |
| D6 | F1.6 + F1.7 + F1.8 | checkpoint 保留数 / token estimation / thought retention 三条小链路收口 |
| D7 | F1.9 Summarization 注册 agent | `agentId` + `failureBehavior` 落地；默认 callback 路径行为零变化 |
| D8 | F1.10 SystemReminder 注册表第一段 | 内置 5 规则迁到 trigger/template 架构，snapshot 0 diff |
| D9 | F1.10 SystemReminder 注册表第二段 | host extraRules + thresholds + enabled/disabled refine 覆盖 |
| D10 | F1.11 `ContextTrace` | effective policy、阶段 token delta、message keep/drop reason 可观测 |
| D11 | F1.12 文档第一段 | `context-engineering.md` 三色表 30+ 字段；新增 summarization agent / system reminder 示例 |
| D12 | F1.12 文档第二段 + host 对齐 | `context-fences.md` / `tool-history.md` / host 配置示例一致 |
| D13 | F1.13 testkit | 11 条新不变量；linnsy 不改 spec 跑通 chat / cron / delegate 三套场景 |

**关键里程碑**：

- 🟢 **D3 完成**（schema + adapter + merge helper）：1F 协议骨架 ready，后续每个改造子任务都能并行 cherry-pick
- 🟢 **D10 完成**：所有字段实际生效且可 trace，可以让 linnsy 提前接入做兼容验证
- 🟢 **D13 完成**：发 0.6.0-rc.1

### 1.6 已识别风险与隐患

| # | 风险 | 影响 | 缓解 |
|---|------|------|------|
| R1 | **新字段过多导致 spec schema 变大，IDE 自动补全压力** | DX 略降 | 在 `AgentSpec.contextPolicy` 上提供 `defineContextPolicy()` helper + JSDoc 分组注释；rich type hover 引导 |
| R2 | **F1.10 注册表 + spec 引用**：现有 5 条内置规则迁到新架构时行为漂移 | 既有 host 行为变化 | 必须先写"行为 snapshot"测试再迁移；迁移前后 snapshot diff 须为 0 |
| R3 | **fallback 通道的合并算法**：spec / host fallback / framework default 三层合并，深合并 vs 浅合并语义模糊 | host 误以为字段会被覆盖 | 协议明确为"按分组字段级合并"：`budget/toolHistory/...` 内部字段逐项合并，数组整体替换；附 6 个合并矩阵单测 |
| R4 | **TokenCalculator encoding 配置开放后**，host 切到非 cl100k_base 编码可能让现有 token 预估偏差 | budget 触发点漂移 | 默认值仍为 `cl100k_base`；切换 encoding 在 audit 中记录 |
| R5 | **`alwaysKeepFenceKinds` 误配置导致预算被 must-keep 撑爆** | run 直接抛 budget 超限 | testkit 不变量：mustKeep 总和 token > budget × 0.8 时触发 warning audit；文档明示反例 |
| R6 | **SystemReminder `extraRules` 顺序与去重** | 同 trigger 触发多条 reminder 导致 token 浪费 | 协议层规定：同一 trigger 命中多条规则时按 spec 中数组顺序触发；contract test 覆盖 |
| R7 | **thought 移动窗口会改写 Prompt 中部** | 缓存前缀抖动、reasoning 重复 | 已删除整条策略；UI thought 不进入 Prompt，ordered replay 保留到正式压缩 |
| R8 | **指挥官 / 实施者分工新流程**：spec 写得不够细导致实施者反复回来问 | 推进慢 | 每日切片产出物明确；每个子任务的"完成判据"必须可机器校验（rg/jest/zod）|
| R9 | **`AgentWorkingMemoryProvider` 当前 683 行**，继续加配置容易越过 700 行并形成大泥球 | 后续每次开放字段都更难验证 | F1.0 先拆职责，拆完再接新配置；不接受"先加字段后面再拆" |
| R10 | **摘要 `agentId` 注册表**可能被误用成 framework 内置 prompt 文本 | framework/host 边界回潮 | schema 只接受 ID；agent/chat resolver 由 host 注入；no-host-leakage guard 禁止 framework 出现 host prompt 正文 |
| R11 | **ContextTrace 自身膨胀** | 调试信息反过来吃掉内存/日志 | `maxTraceEvents` 硬上限；默认 `enabled=false`；trace 不进入 LLM messages |
| R12 | **`AgentMessageOrchestrator` 仍有多处 `[DEBUG-SUMMARY] console.log`** | 1F 引入 ContextTrace 后，调试输出可能双轨并存、噪声变大 | F1.11 同窗口把散落 console 调试收口到 `ContextTrace` / `Logger`，默认关闭 |

### 1.7 测试策略

**三层测试金字塔**（实施者按此结构补测）：

1. **协议层（contract test，约 12-14 个）**
   - `AgentSpec.contextPolicy` 各分组空值、半值、全值 zod 校验
   - schema 的向下兼容：load 0.5.0 spec → 0.6.0 zod 不报错
   - fallback 合并矩阵：`{ agentSpec, hostFallback, frameworkDefault }` × 6 组用例
   - `systemReminder.enabledRuleIds` 与 `disabledRuleIds` 二选一 refine
   - `summarization.agentId` 只接受已注册 agent/chat ID，不接受 prompt 正文

2. **装配层（adapter test，约 8-10 个）**
   - 每个新分组：spec 字段 → builder/preprocessor option 的映射正确
   - 既有 5 条 SystemReminder 规则迁到注册表后 snapshot 0 diff
   - Summarization template resolver 未注入时仍走 0.5.0 callback 路径
   - `ContextTrace` 能记录 effective policy 与阶段 token delta

3. **行为层（testkit 不变量，新增 11 条）**
   - `alwaysKeepFenceKinds` 实际生效（must-keep fence 不会被裁）
   - `maxRecentToolRuns` 实际生效（超出 turn 窗口的 raw tool_calls 被整组丢弃）
   - thought 只进入 UI / 审计；ordered replay reasoning 在模型输入中完整且只出现一次
   - `keepPairsBefore` 实际生效（checkpoint 前的 tool pair 保留数）
   - `tokenEstimation.encoding` 切换后 token 估算曲线 plausible
   - `summarization.agentId` 选择了正确注册 agent/chat，且 prompt 正文不进入 spec
   - SystemReminder `extraRules` 触发顺序与去重
   - `contextPolicyFallback` 在 agent 未填字段时正确兜底
   - `ContextTrace` 中每个 drop/keep 决策都能指向规则来源
   - linnsy 现有 agent 升级到 0.6.0 跑通 chat / cron / delegate

**回归基线**：1F 完成时跑 `npm run test:smoke` + 既有 testkit 15 条 run 不变量 + 新增 11 条 contextPolicy 不变量，全绿。

### 1.8 1F 完成判据（0.6.0 发版门槛）

- [x] `AgentSpec.contextPolicy` 扩展完成，所有新字段 optional + zod 校验 + framework 默认值
- [x] `AgentWorkingMemoryProvider` 拆分完成，主文件 ≤ 420 行；所有新职责文件 ≤ 250 行
- [x] `docs/integration/context-engineering.md §11 三色表`：✅ AgentSpec schema 列从当前 ~10 字段增加到 30+ 字段，并标明 runtime pending 字段
- [x] 🔴 暂未开放清单从 7 条减少到 ≤ 3 条（仅保留协议性不开放与算法骨架）
- [x] testkit 新增 11 条不变量覆盖每个新字段的"声明 → 生效"链路
- [x] `ContextTrace` 可解释每个阶段 token 增减与消息 keep/drop 原因
- [x] 摘要调用通过 `summarization.agentId` + host 注册表可控；framework 不持有 host prompt 正文，也不直接发起裸 LLM call
- [x] SystemReminder 通过 trigger/template 注册表解释；内置规则、host extraRules、阈值覆盖与启用/禁用规则均可由 `AgentSpec.contextPolicy.systemReminder` 控制
- [x] 文档更新：`context-engineering.md` / `context-fences.md` / `tool-history.md` 引用一致
- [x] 向下兼容：0.5.0 host 升级到 0.6.0 不需要改任何 spec，行为零变化
- [x] 示例 host 接入：agent registry 文件与上下文政策装配层全部走 `contextPolicy`（chat / cron / delegate 三套场景 host 自验证已绿）
- [x] `npm pack --dry-run` tarball 文件数与大小变化合理：94 files、tarball 2.3MB、unpacked 12.1MB，新增 `docs/integration/context-engineering.md`（31.5KB），0 新 dep
- [x] `runtime-kernel/index.exports.snapshot` 同步 F1.10/F1.11 新增公开符号（已完成：snapshot 现含 `systemReminder` / `SystemReminderRegistry` / `BUILTIN_SYSTEM_REMINDER_TRIGGERS` 等符号，见 `runtime-kernel/__tests__/__snapshots__/index.exports.snapshot.test.ts.snap`）

### 1.9 1F 的收益（对外讲故事的口径）

发完 0.6.0 后，linnkit 与同类框架的差异化定位可以这样讲：

> linnkit 是**第一个**把 agent 上下文工程做成"声明式协议 + 可观测 trace"的框架——30+ 个上下文参数全部通过 `AgentSpec.contextPolicy` 在 agent 定义里精细化声明，不需要 host 写 framework 内部装配代码。任何 agent 都能精细化控制发给 LLM 的每一个 token，并能通过 `ContextTrace` 解释这些 token 为什么被保留、裁剪、压缩或注入；这份声明可序列化、可 diff、可回放、可审计。

### 1.10 状态登记（追加历史，不修改）

- **2026-05-12 立项**：指挥官（本助手）完成 1F 完整设计稿——7 大分组 / 25+ 字段 / SystemReminder 注册表 + spec 引用架构 / host 装配级 fallback 通道。决策：(a) 摘要 `promptTemplate` 不在 1F 实现，移至阶段 2 单独立项；(b) host 装配级 fallback 通道保留实现（F1.9）；(c) 切片建议、风险登记、测试策略写齐，待实施者接手。工时合计 ≈9.5d ≈ 2 人周。
- **2026-05-12 1F 评估修订**：实施前读代码复核 `AgentSpec` / `AgentMessageOrchestrator` / `AgentWorkingMemoryProvider` / `SystemReminder` / `TokenCalculator` 后，修订 1F 范围：(a) 7 大分组修正为 10 大分组 / 30+ 字段；(b) `AgentWorkingMemoryProvider` 当前 683 行，新增 F1.0 先拆职责；(c) 摘要 prompt 从阶段 2 提前到 1F，但只开放 `summarization.agentId` + host 注册表引用，不让 framework 持有 prompt 文本或直接发起裸 LLM call；(d) 新增 `ContextTrace` 最小观测闭环，保证每个字段不只是"能配置"，还能解释最终 token 决策；(e) fallback 合并语义修正为"按分组字段级合并，数组整体替换"。工时从 ≈9.5d 上调到 ≈13.25d（约 2.5 人周）。
- **2026-05-12 F1.0 完成**：实施者补齐 `AgentWorkingMemoryProvider` 行为基线测试，并完成职责拆分：主 provider 从 683 行降到 249 行；working-memory 子模块全部 ≤134 行；P1 当前轮工具保留、P2 文本/thought 保留、P3 历史工具保留、POST_TOOL_CALL 最近工具组优先保留各自独立。目标是为 F1.1-F1.8 的 contextPolicy 字段扩展留出稳定接入点，不再往大类里继续堆逻辑。
- **2026-05-12 F1.1 完成**：新增 `contracts/contextPolicy.ts`，把 `AgentSpec.contextPolicy` 从 3 大分组扩到 10 大分组 / 30+ 字段；所有新增分组保持 optional，现有 `{ profileId: 'agent' }` host 配置继续合法；新增 `defineContextPolicy()` 默认补全 helper，拒绝函数式 rule 注入与内联 summary prompt 对象。同步更新 contracts public export snapshot 与 `docs/integration/context-engineering.md` 三色表。下一站：F1.2 adapter 映射 + F1.3 fallback merge helper。
- **2026-05-12 F1.2/F1.3 完成**：扩展 `shared/agentSpecAdapter.ts`，把 10 大分组映射成 context builder / preprocessor / provider / systemReminder 四类运行时选项；新增 `shared/contextPolicyMerge.ts` 纯函数，按 `frameworkDefault < hostFallback < agentSpec` 做字段级合并，数组整体替换，`systemReminder.thresholds` 做嵌套字段合并。保持 `AgentMessageOrchestrator` 只负责编排，不直接理解每个字段细节。下一站：F1.4 `MustKeepPolicy` 装配链路，把 `mustKeep` 从 schema 映射真正接入 provider registry。
- **2026-05-12 F1.4/F1.5 完成**：`AgentMessageOrchestrator` 增加 `createProviderRegistry({ request, contextPolicy, contextBuilderConfig })` 注入点，每次 request 按 effective `contextPolicy` 重建 provider registry；产品级 `additional-context` 这类 must-keep 改为 host fallback policy，不再写死在 framework provider 默认策略里。`AgentWorkingMemoryProvider` 消费 `Partial<AgentContextBuilderConfig>`，`workingMemory.maxRecentToolRuns` / `minToolInteractionsToKeep` / `toolPairingSearchRange` 已从 spec 透传到运行时；补齐 provider 与 orchestrator 链路测试。下一站：F1.6 checkpoint 策略参数化。
- **2026-05-12 F1.6 完成**：`CheckpointSummarizationProvider` 消费 `checkpoint.keepPairsBefore` / `checkpoint.triggerToolName` 构造参数，host 默认 provider registry 已把 effective `contextPolicy.providerOptions.checkpoint` 透传进去；同步修复 `keepPairsBefore: 0` 触发 `slice(-0)` 反向保留全部工具对的根因问题。边界：这一步先控制 context trimming 的 checkpoint 识别与保留策略；GraphExecutor step-reset 与 SystemReminder 内置提醒已在 F1.10/SystemReminder 注册表与 runtime 工具名统一时收口。下一站：F1.7 token estimation 配置上提。
- **2026-05-12 F1.7 完成**：`TokenCalculator` 增加声明式 `TokenEstimateOptions`，支持 `encoding` / `avgCharsPerToken` / `toolCallOverhead` 注入；`ContextManagerBase.estimateTokens()` 不再只按字符数粗估，而是统一走 `TokenCalculator.estimateMessageTokens()`，让 `AgentSpec.contextPolicy.tokenEstimation` 的三个字段真实影响 context pipeline 的预算判断。边界：当时留下的 ContextTrace/telemetry 观测缺口已在 F1.11 补齐。下一站：F1.8 reasoning retention 接线。
- **2026-05-12 F1.8 完成**：复核发现 `reasoningRetention.keepLatestThoughts` 已在 F1.2/F1.5 链路中完成运行时接线：adapter 映射到 `MAX_THOUGHTS_TO_KEEP`，`TextConversationRetention` 按配置保留最近 N 条 thought，provider 测试已覆盖 `MAX_THOUGHTS_TO_KEEP: 2` 时保留最近两条。本文档与接入指南同步从 pending 改为已完成。下一站：F1.9 Summarization 注册 agent + failure behavior。
- **2026-05-12 F1.9 完成**：`summarization.agentId` 替代模板式字段，摘要调用收口为"引用 host 已注册的无工具摘要 agent/chat"；framework 只传注册 ID，不持有 prompt 正文，也不直接发起裸 LLM call。host 可默认解析到已注册的 `history_compression` 这类摘要项，并支持 agent 级覆盖到其它注册项；`failureBehavior` 支持 `fail-fast` 与 `continue-if-within-budget`，后者只有在当前上下文仍未超预算时才继续，超预算仍抛 typed fatal `ContextProviderError`。下一站：F1.10 SystemReminder 注册表与 checkpoint 工具名统一。
- **2026-05-12 F1.10 完成**：SystemReminder 内置 5 条规则迁到 trigger/template 注册表；runtime 统一消费 `executorLocal.systemReminderPolicy`，`enabledRuleIds` / `disabledRuleIds` / `thresholds` / `extraRules` 均生效。`checkpoint.triggerToolName` 现在同时驱动 context trimming、GraphExecutor step-reset、`context_budget_warning` 工具名判断与文案；host agent 定义可从旧 ruleIds 配置迁到 `contextPolicy.systemReminder.enabledRuleIds`。下一站：F1.11 ContextTrace 最小观测闭环。
- **2026-05-12 F1.11 完成**：新增 `ContextTraceCollector` 与 `ContextBuildResult.contextTrace` sidecar；trace 默认关闭，开启后记录 effective `contextPolicy`、provider token delta、剩余预算、策略命中、message keep/drop 决策，并通过 `maxTraceEvents` 防止 trace 自身膨胀。同步把 `AgentMessageOrchestrator` / `SummarizationProvider` 中散落的 `[DEBUG-SUMMARY]` 与无条件 `console.log` 收口到 debug/trace 路径；修复 `ContextManagerBase` 忽略 `debugMode: false` 的老问题。下一站：F1.12 文档总收口。
- **2026-05-12 F1.12 完成**：接入文档完成总收口：`integration/README` 把 Context Engineering 定位为 `contextPolicy` + `ContextTrace` 闭环；`context-engineering.md` 新增 ContextTrace、summarization agent、system reminder 三个实操小节；三色表清空 F1.11 pending；`context-fences.md` / `tool-history.md` 同步到声明式 `contextPolicy` 与 trace 验证口径。下一站：F1.13 testkit 不变量补充。
- **2026-05-12 F1.13 完成**：`context-harness/invariants` 新增 11 条 contextPolicy 不变量，`validateContextPolicyInvariants()` / `assertContextPolicyInvariants()` 已进入 public testkit；可用 `ContextTrace` 机器校验 effective policy、trace 限流、预算、provider token delta、message keep/drop reason、工具配对与 must-keep 类型保留。下一站：1F release gate 核验（兼容 / pack / 外部 host）。
- **2026-05-13 F1.14 完成（历史记录）**：当时开放了 `contextPolicy.toolOutput.observationGovernance` 与 `contextPolicy.providerReplay`。其中 tool output 治理继续保留；`providerReplay` 后于 2026-08-14 退役并下沉到 `inference_route.continuation.tool_replay`，Agent 不再能覆盖 Provider 协议要求。
- **2026-05-13 1F 指挥官验收 review**：linnkit `typecheck` 绿 / `test:smoke` 绿 / `npm pack --dry-run` 绿（94 files、tarball 2.3MB、unpacked 12.1MB，含 `docs/integration/context-engineering.md` 31.5KB）；全套 vitest 561 / 562 通过，唯一红线是 `src/runtime-kernel/__tests__/index.exports.snapshot.test.ts` 的"runtime-kernel 公开命名空间快照"未跟随 F1.10/F1.11 新增导出更新——新增符号包括 `systemReminder` 命名空间、`SystemReminderRegistry`、`createDefaultSystemReminderRegistry`、`defaultSystemReminderRegistry`、`BUILTIN_SYSTEM_REMINDER_TRIGGERS/TEMPLATES`、6 个 trigger（`phaseEqualsTrigger` / `remainingStepsLeqTrigger` / `stepCountModuloTrigger` / `toolCallStreakTrigger` / `budgetWarningTrigger` / `agentHasToolTrigger`）与对应 template、`createSystemReminderRules`、`SYSTEM_REMINDER_RULES`、`applySystemReminders`、`countToolCallsInCurrentRequest`、`DEFAULT_CONTEXT_CHECKPOINT_TOOL_NAME`、`readContextCheckpointToolName`、`readNonEmptyStrings`、`toDisplayStep`。逐项核对：均为 F1.10/F1.11 设计稿明确的 host-facing API（用于声明式 SystemReminder 注册表与 checkpoint 工具名统一），不是意外泄漏。**Release gate 前必修动作**：(a) 实施者跑 `npx vitest run src/runtime-kernel/__tests__/index.exports.snapshot.test.ts -u` 接受新 snapshot；(b) 同步在 `packages/linnkit/docs/release/RELEASE.md` 0.6.0 release note 的 "New" 一节登记上述新公开符号，并标注它们与 `AgentSpec.contextPolicy.systemReminder` / `checkpoint.triggerToolName` 的绑定关系。完成后 1F release gate 即可全部勾选，可发 `0.6.0-rc.1`。

---

## 2. 阶段 1C · Quickstart + linnkit-cli v0（0.6.x ~ 0.7.0）

**目的**：外部消费者第一周体验。前置依赖：**阶段 1F 必须先完成**——CLI 命令的核心价值在于"声明式 agent，开箱即跑"，而声明式 agent 的全部威力需要 1F 完成的 30+ 字段 `contextPolicy` 与 `ContextTrace` 才能展现。

> 详见 [`06-developer-experience-roadmap.md §2-§3`](./06-developer-experience-roadmap.md)。

### 2.1 v0 命令优先级

| 命令 | 用途 | 依赖 | 优先级 |
|------|------|------|--------|
| `linnkit init <name>` | 起一个 hello-agent 项目 | N-1 AgentSpec ✅ | P0 |
| `linnkit run <agent-id>` | 跑指定 agent；实时打印事件流 | N-1 ✅ | P0 |
| `linnkit doctor` | 检查 Node 版本 / API key / config 合法性 | — | P0 |
| `linnkit replay <run-id>` | 从 EventStore 回放一条 run | G-3 Replay SDK | P1（推迟到阶段 2）|
| `linnkit inspect <run-id>` | 打印 run 的 context window / cost / events 摘要 | G-1 AuditEnvelope ✅ + G-3 | P1（推迟到阶段 2）|

**P0 三件**先做；P1 两件依赖 G-3 Replay SDK（阶段 2），暂缓。

### 2.2 5 分钟 quickstart

30 行代码跑起 hello-agent，**不要求**理解 `GraphExecutor` / dep bag / bridge。

**实现要点**：

- 不新增 `@linnlabs/llm-openai` / `@linnlabs/store-memory` starter 包，避免 1C 过早扩大维护面
- `linnkit init` 生成一个自包含 demo host：`linnkit.config.mjs` + `agents/hello.mjs` + OpenAI-compatible `fetch` adapter
- demo host 使用 memory runtime，只服务首次试跑；生产接入仍按 `docs/integration/*` 逐项替换

### 2.3 v0 明确不做

- 不做 `replay` / `inspect`：这两件依赖 G-3 Replay SDK 和真实 EventStore 接入，放到阶段 2
- 不做独立 provider/store starter 包：quickstart 模板内联 demo adapter/store，生产 host 自行实现
- 不把 OpenAI adapter 放进 linnkit runtime：framework 继续保持 provider-neutral

### 2.4 工时拆分

| 子任务 | 工时 |
|---|---|
| `linnkit-cli` 项目骨架 + `init` 命令（含模板）| 1.0d |
| `run` 命令 + 事件流实时打印 | 1.0d |
| `doctor` 命令 | 0.5d |
| `defineAgent` / `runAgent` / `defineConfig` quickstart helper | 1.0d |
| docs/integration/02-quickstart.md 升级为真实可跑代码 | 0.5d |
| host-side smoke test | 0.5d |
| **合计** | **≈4.5-5d（≈1 人周）** |

---

## 3. 阶段 1D · chat 兼容收敛 + 删 linnkitCompat（0.9.0+，待重新排期）

**目的**：在阶段 2 起手前把 0.4.0/0.5.0 留下的过渡兼容债清零。

| 任务 | 工作量 | 完成判据 |
|------|--------|---------|
| 把 host 中现有 `chat` 调用迁到 tools-disabled `AgentSpec` | 1 人周 | host 内 `mode: 'chat'` 0 条引用 |
| 物理删 `packages/linnkit/src/context-manager/profiles/chat/*`（21 个文件）| 0.5 天 | `rg "profiles/chat"` 0 条 |
| 删 `linnkit/context-manager` 主入口的 5 个扁平兼容符号（`ChatMessageOrchestrator` / `BaseConversationalTask` / `chatMessageToAiMessage` / `aiMessageToChatMessage` / `buildGenerateRequestFromAgentRequest`）| 含上 | snapshot test 通过 |
| 删 `src/index.ts` 的 `linnkitCompat` | 0.5 天 | `rg linnkitCompat` 0 条 |
| 物理删 `userQuoteLifetime`（已迁到 chat 兼容层，跟着一起删）| 含上 | 0 条 |

**前置**：接入方 host 完成 chat → tools-disabled AgentSpec 迁移。

---

## 4. 阶段 1E · linnsy 适配（0.5.0 之后，外部）

> 不是 linnkit 内部工作，但是 0.5.0 发版后**必须立即做**——linnsy 在 host 层自己实现了一整套 RunSupervisor 包装，0.5.0 已经把这些能力收回 framework，linnsy 应当迁到 linnkit 0.5.0 的 thin wrapper 模板，删除重复代码。

| 任务 | 工作量 |
|---|---|
| linnsy 把自己的 `runtime/run-spawner/` 改为对 `runtimeKernel.runSupervisor` 的薄包装（host 只接 SQLite RunRegistryStore + AbortReason 词表） | 2-3 天 |
| linnsy 默认 child-run executor 改为 `invokeChildRun`；后台任务改为 `spawnDetached` | 0.5 天 |
| linnsy 接 G-1 AuditPort（EventStore sink + 文件 sink）| 0.5 天 |
| linnsy 接 RunCostCollector，让父子 run cost 聚合到顶层 spawn | 0.5 天 |

**完成判据**：

- linnsy `runtime/run-spawner/run-spawner.ts` 由 ~700 行减到 ~300 行（去掉所有 linnkit 已覆盖的能力，只剩 host-specific 装配）
- linnsy 跑通自己的 contract test 矩阵
- 在 linnsy 反馈基础上补一个 "host RunSupervisor thin-wrapper template" 章节到 `docs/integration/run-supervisor.md`

---

## 5. 阶段 2 · Phase G 性能/DX 子集（0.9.0 ~ 1.0.0）

> 详细任务见 [`07-roi-ranked-priorities.md §3.2`](./07-roi-ranked-priorities.md#32-phase-g接下来-3-6-个月-p1)。本节仅登记**性能/DX 优先级排序**。

| # | 任务 | 工作量 | ROI |
|---|------|--------|-----|
| 1 | **prompt cache 稳定性指南 + PromptTrace** | 1 人周 | ⭐⭐⭐⭐⭐ |
| 2 | **G-3 Replay SDK**（`linnkit/replay` 子入口）| 1 人周 | ⭐⭐⭐⭐⭐ |
| 3 | **DevTools Web v0**（Event Timeline + Context Window + Prompt Diff 三视图）| 3 人周 | ⭐⭐⭐⭐⭐ |
| 4 | **G-2 CostLedger + QuotaPort**（内存实现 + contract test）| 1 人周 | ⭐⭐⭐⭐ |
| 5 | **Test DSL `defineAgentTest()`** | 1 人周 | ⭐⭐⭐⭐ |
| 6 | **N-4 MemoryPort + 2 个参考实现**（in-memory + markdown，**强制 citation 字段**）| 2 人周 | ⭐⭐⭐⭐ |
| 7 | **N-5 PermissionPort**（先 ask + 白名单，sandbox 后置）| 1 人周 | ⭐⭐⭐ |
| 8 | **Checkpointer contract test 升级**（恢复偏移 / 幂等 append / 乱序重放）| 1 人周 | ⭐⭐⭐ |

**起跑前提**：1C / 1D 全部清零；linnsy 1E 适配已稳定运行 ≥ 2 周。

---

## 6. 阶段 3 · 按需触发（不预先承诺）

| 项 | 触发条件 |
|----|---------|
| N-2 AgentMessageBus（进程内 actor）| 真实出现"两个 agent 互相对话" / orchestrator + worker 场景 |
| N-6 EventBusPort 跨进程 | 真实出现跨进程 / 集群部署需求 |
| 分布式 Checkpointer / EventStore | 同上 |
| `wait_external` 泛化 | 真实出现 webhook / IM 回调 / 子 agent 完成回调场景 |
| SandboxPort 实际接入 | 真实出现"自动化执行外部命令"场景 |
| G-4 RedactionPort | 真实多租户 PII 需求 |
| reasoning artifact 协议 / NodeRegistry | ≥ 2 个消费者真有需求（不接受单消费者）|
| diff-based 重渲染（Codex `reference_context_item`）| alpha 验证后再评估 |
| `RunHandle.pause()` / `resume()` 进程级冷暂停 | linnsy 或下游产品出现真实需求 |
| `runTree()` 父子 run 树形可视化 | DevTools 需要 / 真实复杂调度场景 |
| `handleFailure` 故障策略 | failover / 自动重试 / circuit breaker 真实需要 |

---

## 7. 必不做清单（防止压力推上来）

继承自 10 文档 §1.3，登记本阶段仍然不做的事：

| 项 | 不做的原因 |
|----|----------|
| 任意图编排 / NodeRegistry / 用户画图 | 90% agent 是固定形态，过设计 |
| Memory backend 全家桶（Mem0/Honcho/Holographic 等 ≥ 3 个）| Hermes 是产品决策；linnkit 给 port + 1-2 参考实现 |
| `bash` / `web_search` / `read_file` 等业务工具内置 | 产品决策，归宿主 |
| Sandbox 具体实现（Seatbelt / bubblewrap / Docker）| 出 `SandboxPort`，宿主自实现 |
| IM 通道适配器（Telegram / WeChat / Slack）| 产品决策 |
| 按系统资源 / 任务复杂度自动切模型 | 4 家共识不做；属 host `modelPolicyResolver` |
| 主机级 CPU / 内存 / 磁盘监控 | 4 家共识不做；属 host |
| 把任何中文表达层标签（`[任务完成]` / `<additional_context>` / `编辑器写作` 等）放进 framework | host 表达层，已被 Phase C `no-host-leakage` guard 守住 |
| 在 framework 中加 `mode: 'agent' \| 'chat'` 新字段 | Phase F 退役方向，不要逆流 |

---

## 8. 状态登记（追加历史，不修改）

- **2026-05-12 立稿**：从 10 文档抽出"未来计划"另起一文；10 文档转为"历史 + 决策档案"专用，本文档承接后续阶段。
- **2026-05-12 阶段 1F 立项**：用户决策——quickstart / CLI 优先级降级，**Context Engineering 协议化提升为最高优先级**。理由：linnkit 宗旨是"精细化控制发给 AI 的每一个 token"，是与同类框架的核心差异化。1F 计划完整设计完成（7 大分组 / 25+ 字段 / 系统提醒注册表 + spec 引用架构 / 装配级 fallback 通道），工时 ≈2 人周。阶段 1C 后置（依赖 1F 协议 freeze），1E 可继续与 1F 并行。详见 §1。
- **2026-05-12 1F 实施前评估修订**：读代码后确认原方向正确但范围需加强——1F 更新为 10 大分组 / 30+ 字段，新增 F1.0 拆 `AgentWorkingMemoryProvider`、F1.9 摘要注册 agent、F1.11 `ContextTrace` 最小观测闭环；工时修订为 ≈13.25d。详见 §1.10。
- **2026-05-12 F1.0 完成**：`AgentWorkingMemoryProvider` 职责拆分完成，主文件 249 行，working-memory 子模块最大 134 行；新增 4 条行为基线测试锁定 post-tool-call、thought、纯文本、历史工具保留语义。下一站：F1.1 `AgentSpec.contextPolicy` schema 扩展 + `defineContextPolicy()` helper。
- **2026-05-12 F1.1 完成**：`AgentSpec.contextPolicy` schema 已扩展为 10 大分组，新增 `defineContextPolicy()` helper 与 contract tests；下一站：F1.2 `agentSpecAdapter.ts` 完整映射 + F1.3 `mergeContextPolicy()` fallback 合并。
- **2026-05-12 F1.2/F1.3 完成**：`agentSpecAdapter.ts` 完整映射 + `mergeContextPolicy()` fallback 合并器完成；下一站：F1.4 `MustKeepPolicy` 装配链路。
- **2026-05-12 F1.4/F1.5 完成**：`mustKeep` 与 `workingMemory` 两组 contextPolicy 已完成运行时接线；host fallback policy 已接入默认 provider registry；下一站：F1.6 checkpoint 策略参数化。
- **2026-05-12 F1.6 完成**：`checkpoint.keepPairsBefore` / `checkpoint.triggerToolName` 已从 AgentSpec 透传到 `CheckpointSummarizationProvider`；`keepPairsBefore: 0` 语义已被测试锁定；下一站：F1.7 token estimation 配置上提。
- **2026-05-12 F1.7 完成**：`tokenEstimation.encoding` / `avgCharsPerToken` / `toolCallOverhead` 已进入 `ContextManagerBase` 统一 token 估算口径；新增 `TokenCalculator` 与 base manager 测试锁定字段生效；下一站：F1.8 `reasoningRetention.keepLatestThoughts` 接线。
- **2026-05-12 F1.8 完成**：`reasoningRetention.keepLatestThoughts` 已通过 `contextPolicy -> contextBuilderConfig -> AgentWorkingMemoryProvider` 生效；下一站：F1.9 Summarization 注册 agent + failure behavior。
- **2026-05-12 F1.9 完成**：自动摘要改为 `summarization.agentId` 引用 host 注册的无工具摘要 agent/chat；host 可默认走 `history_compression` 这类注册项，unknown agentId 会在装配期报错；`failureBehavior` 已运行时生效。下一站：F1.10 SystemReminder 注册表与 runtime 工具名统一。
- **2026-05-12 F1.10 完成**：SystemReminder 注册表架构落地；host 可使用 `contextPolicy.systemReminder.enabledRuleIds`；checkpoint 工具名完成 runtime 统一。下一站：F1.11 ContextTrace 最小观测闭环。
- **2026-05-12 F1.11 完成**：`ContextTraceCollector` 接入 provider pipeline 与 `ContextBuildResult.contextTrace`；默认关闭，开启后可解释 effective policy、provider token delta、message keep/drop；`maxTraceEvents` 已限流。同步收口无条件 summary debug 输出，并修复 `ContextManagerBase.debugMode` 被硬设为 true 的老问题。下一站：F1.12 文档总收口。
- **2026-05-12 F1.12 完成**：接入文档总收口完成，`context-engineering` / `context-fences` / `tool-history` / integration README 均同步到 1F 当前实现；下一站：F1.13 testkit 不变量补充。
- **2026-05-12 F1.13 完成**：testkit 补齐 `validateContextPolicyInvariants()` / `assertContextPolicyInvariants()` 与 11 条 contextPolicy 不变量；下一站：1F release gate 核验（兼容 / pack / 外部 host）。
- **2026-05-13 1C v0 落地**：用户拍板 CLI v0 只做 `init/run/doctor`，`replay/inspect` 延后到 G-3；不新增 provider/store starter 包。`defineAgent` / `runAgent` / `defineConfig` + `@linnlabs/linnkit/quickstart` 子入口 + `linnkit` bin 已完成，quickstart 模板为自包含 demo host（OpenAI-compatible fetch adapter + memory runtime）。0.7.0 作为 Phase 1C DX minor，生产接入仍以 `docs/integration/*` 为准。
- **2026-08-25 自动 compaction 收敛**：1F 的专用 Summary 与主动 checkpoint 主链由统一 Graph tick compaction 替代；旧 policy、工具、专用 Agent/模型选择、step-reset 和 Renderer consumer 直接删除。本文继续作为历史规划档案，不承担当前接入规范。
