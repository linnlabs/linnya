# Context Engineering · linnkit 的上下文工程总览

> **What** · 所有作用在 messages 上的机制总览 —— `contextPolicy` 10 大分组 + `ContextTrace` 可观测闭环 + `TokenizerPort` + 摘要 / 围栏 / 工具历史保留。
> **When to read** · 想精确控制每个 token；上下文超长被裁；要诊断"为什么这条消息被丢了"；自定义 tokenizer；做 token 预算选型。
> **Prerequisites** · [`agent-registration-guide.md`](./agent-registration-guide.md) ⭐（先理解 `AgentSpec.contextPolicy` 字段结构）。
> **Key exports** · `ContextTrace` from `@linnlabs/linnkit/contracts` · `TokenizerPort` from `@linnlabs/linnkit/ports` · `formatAgentLlmMessages` / `createMessageFormatter` from `@linnlabs/linnkit/context-manager`。
> **Related** · [`token-management.md`](./token-management.md) · [`context-fences.md`](./context-fences.md) ⭐ · [`tool-history.md`](./tool-history.md) · [`agent-registration-guide.md`](./agent-registration-guide.md) ⭐

> linnkit 的宗旨：**让上下文工程变成精细化、可自由配置、可观测、可审计的事**。
>
> 本文是一份**全机制速查表**：列出 linnkit 当前所有作用在"发给 LLM 的 messages"上的机制，**说人话**讲清楚它在做什么、什么时候触发、在哪里改它、当前可以配到什么粒度。
>
> 想看 fence 一等接入面的具体落地骨架，跳到 [`context-fences.md`](./context-fences.md)。
> 想看 context-manager 的代码层架构、三阶段 provider 与预处理器实现细节，读 [`src/context-manager/README.md`](../../src/context-manager/README.md)。

---

<a id="context-policy-source-of-truth"></a>

## 0.1 两类真相源：模型容量与 Agent 上下文策略

先回答最常见的问题：**模型能装多少，由 prepared model route 声明；Agent 是否主动少用，由 `AgentSpec.contextPolicy` 声明**。route 的 `context_window_tokens / max_output_tokens` 是容量真相源；自动压缩、工具历史、工具输出截断、must-keep、reasoning 保留、token 估算、system reminder、trace，以及可选容量 cap 的统一声明入口是 `AgentSpec.contextPolicy`（host 侧通常落在 `AgentDefinition.config.contextPolicy`），其类型真相源是 `AgentSpecContextPolicy`。

运行时只消费合并后的 effective policy：

```text
framework 默认
  < host fallback
    < 单个 agent 的 contextPolicy
      └─ mergeContextPolicy(...) 字段级合并
         └─ agentSpecAdapter 拆成运行时选项
```

这条链路的含义很直接：

| 你想改什么 | 改哪里 |
|------------|--------|
| 显式限制某个 agent 的总窗口 | 该 agent 的 `config.contextPolicy.budget.maxTokens` |
| 显式限制某个 agent 的单次输出 | 该 agent 的 `config.contextPolicy.budget.reservedForResponse` |
| 改所有 agent 的 host 默认策略 | host 的 `defaultContextPolicy` / context policy fallback |
| 改无模型 route 接入的 framework fallback | linnkit 的 prompt budget fallback / agent context builder 默认配置 |
| 验证最终到底生效了什么 | 看成功 Graph attempt 的 `ContextUsageSnapshot.input_budget_tokens / output_limit_tokens`；policy 合并来源再看 `ContextTrace.effectivePolicy` |

`agentSpecAdapter` 会把同一个 policy 拆给几类消费点：context builder 配置、preprocessor 选项、provider registry 选项、execution 选项，以及 system reminder。**这些是运行时分发点，不是新的配置真相源**。如果发现某个字段改了但某个消费点没响应，应该补 adapter 或装配链路；不要在消费点旁边再加一份局部预算常量。

边界也要说清楚：prepared model 的正式 inference route 是容量基线；`contextPolicy.budget.maxTokens` 与 `reservedForResponse` 只是 Agent 可选的显式上限，不是模型能力，也不是 provider 返回的真实计费 token。两项 policy 均未声明时，运行时直接使用 route 的 `context_window_tokens / max_output_tokens`；显式声明时分别取 `min(route, policy)`。`defineContextPolicy()` 和三层 merge 必须保留“未声明”，不能把 framework fallback 物化成 Agent cap。

Tool definitions 会先从有效输入预算扣除，剩余的 `messageBudgetTokens` 才交给 Context Manager；同一个 `outputLimitTokens` 会进入 Provider request。单独使用 Context Manager 而没有模型 route 时，framework 才使用 256K 总窗口和 16K 最大输出 fallback。生产 Graph host 仍必须装配 prepared model route，不能把 fallback 当成坏 catalog 的兼容路径。

相关入口：

- 定义 agent 与 `defineContextPolicy()`：[`agent-registration-guide.md §4`](./agent-registration-guide.md)
- 工具历史窗口：[`tool-history.md`](./tool-history.md)
- fence / must-keep 注入：[`context-fences.md`](./context-fences.md)
- 代码层实现说明：[`src/context-manager/README.md`](../../src/context-manager/README.md)

---

## 0. 一张总览图（一轮请求里发生了什么）

```text
host 发出 invoke request
  │
  ▼
[A] AgentMessageOrchestrator 装配
    ├─ contextPolicy.mustKeep（哪些消息绝不能被裁）
    ├─ FenceRegistry（host 注册了哪些围栏家族）
    └─ Preprocessor pipeline 按 request 重建
  │
  ▼
[B] Preprocessor Pipeline（按优先级跑）
    1. ToolHistoryCompressorPreprocessor   ─ 工具历史保留/删除（可选压缩）
    2. ToolReplayProtocolGuardPreprocessor ─ 工具回放协议守卫
    3. HistoryPurificationPreprocessor     ─ 历史净化（清孤儿 / 同 ID 去重）
    4. FenceLifetimePreprocessor           ─ 剥离旧轮 turn-only fence
  │
  ▼
[C] Context Manager 构建
    1. AgentCoreContextProvider          ─ 不可裁的核心层（system / user）
    2. AgentWorkingMemoryProvider        ─ 工作记忆按 P1-P3 优先级填到预算上限
    3. selectContextCompactionCandidate  ─ 纯计算最老可替换区段
    4. formatAgentLlmMessages            ─ 翻译成 provider-neutral wire messages
  │
  ▼
[D] applySystemReminderStage 注入
    根据 stepCount / phase / 工具调用次数等触发规则
    在最后一条 message 的 content 末尾追加普通 <system-reminder>...</system-reminder>
  │
  ▼
[E] measure_prompt_usage → compact_context
    reminder 后的最终 Prompt 达阈值时，用当前模型生成固定格式摘要
    内部请求逐条复用该 Prompt，再追加独立的末尾 compaction reminder 消息
    重建后只按同一规则重新生成普通 reminder 并计量
  │
  ▼
[F] admit_prompt_capacity → commit_context_compaction
    容量接纳后先 durable commit，再发 end → history_summary
  │
  ▼
[G] LLM provider
```

每个阶段都有独立的配置面。

---

## 1. 消息的三大角色与物理位置

linnkit 的内部消息（`AiMessage` union）最终都会按 LLM 协议的三个 role 出关：

| Role | 这里有什么 |
|------|-----------|
| `system` | `system_prompt`、`placement: 'after-system'` 的 fence（不常变化的固定上下文），例如长期规则、当前能力目录、用户偏好等 |
| `assistant` | LLM 自己产的 `final_answer` / `thought`（canonical reasoning）/ `tool_calls`；以及配对的 `tool_output`（在 Provider wire 上通常使用独立 tool role） |
| `user` | 用户的 `user_input`、`placement: 'before-current-user'` / `'after-current-user'` 的 fence（经常变化的高频上下文），例如用户上传的文件、当前时间等 |

普通 `<system-reminder>` 不是独立 `AiMessage`，也没有固定 role。它只在发送前追加到当时最后一条 wire message 的 `content` 末尾；最后一条可能是 user，也可能是 tool。压缩专用 Reminder 为了保留完整原消息前缀并避免落入 tool output，使用独立的末尾 user-role wire message。两者都不持久化，完整规则见 [§6 System Reminder](#system-reminder)。

当前轮 `llmRole: 'user'` 且 `placement` 指向当前请求附近的 fence，会先按 host 提供的 `formatter` 组装进同一条 `user_input`：

```text
<formatter(before-current-user fence)>   # 只有真实注入时才出现
<user_request>
用户原始请求
</user_request>
<formatter(after-current-user fence)>    # 只有真实注入时才出现
```

这里的 `<formatter(...)>` 不是字面输出；真正发给 LLM 的是 host 自己声明的 XML/tag，例如 `<document_context>`。未注入某类 fence 时，不会生成空标签或占位符。

host 也可以在持久化的 `user_input.content` 中预先写入结构化块，例如：

```xml
<local_time>2026-06-18 14:35:27</local_time>

<user_request>
用户原始请求
</user_request>
```

这种做法适合“每一轮发生时的历史事实”（例如本地时间）。UI 如需展示原始用户文本，应由 host 在自己的事件契约中保留原文字段；linnkit 只负责回放 `user_input.content` 给模型，不理解具体标签语义。

**重要不变量**：`tool_calls` 和 `tool_output` **必须成对出现**——任何一边丢了另一边就废了。这条不变量贯穿所有压缩 / 裁剪机制。

附件是消息内容的一部分，不建立独立的上下文生命周期：用户图片随所属 `user_input` 同进同退，工具结果图片随完整
`tool_calls + sibling tool_output` 工具组同进同退。自动压缩与 working memory 都只按既有消息/工具组规则
决定保留或退出，不根据附件种类增加永久保留窗口。活动上下文退出只影响后续模型输入，不删除 durable event、附件
引用或资源字节。

内部压缩请求只在完整主 Prompt 后增加一条纯文本控制消息，因此必须复用 Context Manager 为该 Prompt 生成的
`imageInputAdmissionEvidence` 完成相同的图片物化；不能重新估算，也不能把 durable 图片引用直接交给 Provider。
普通与压缩 Reminder 的瞬态文本增量、工具定义和调用输出预留由 Graph 的最终 Prompt 计量负责；摘要重建后则
使用重建结果新生成的图片证据，避免旧消息索引污染新的正式主调用。

---

## 2. Fence 围栏家族（高度可配置 ✅）

把任何"想塞给 LLM 的额外上下文"声明成一个家族（kind），告诉 linnkit"放哪、活多久、如何格式化"，linnkit 帮你按规则塞进 messages、按生命周期清掉。

**配置位置**：host 启动时调 `createFenceRegistry(descriptors)`，每条 `FenceDescriptor` 包含：

| 字段 | 含义 | 取值 |
|------|------|------|
| `kind` | 围栏家族名 | host 自定义 kebab-case |
| `llmRole` | 物理挂到哪个 role | `'system'` / `'user'` |
| `placement` | 物理位置 | `'after-system'` / `'before-current-user'` / `'after-current-user'` / `'after-last-tool-result'` |
| `lifetime` | 活多久 | `'turn-only'`（只本轮）/ `'persisted'`（进 history） |
| `mustKeep` | fence 的必保留意图 | `boolean`（当前尚未自动接入 MustKeepPolicy） |
| `maxBudgetFraction` | fence 的预算比例意图 | `(0, 1]`（当前只校验取值，尚未执行容量裁决） |
| `formatter` | 怎么把内容包装成 LLM 看到的字面 | host 提供函数 |

**当前边界**：placement、lifetime 与 formatter 已完整接线；descriptor 上的 `mustKeep` / `maxBudgetFraction` 还不是运行时硬约束。当前轮 fence 会先组装进 `system_prompt` / 最新 `user_input`，最终只受整份 Prompt 容量门禁约束。详细现状见 [`context-fences.md`](./context-fences.md)。

---

## 3. MustKeepPolicy（通过 `contextPolicy.mustKeep` 配置 ✅）

声明"哪些消息**永远不能**被工作记忆抽稀机制裁掉"——比如 `system_prompt`、最新的 `user_input`、某类 fence kind。

**配置位置**：优先写在 `AgentSpec.contextPolicy.mustKeep`。host 也可以提供 fallback policy，作为所有 agent 的默认值。

```ts
contextPolicy: {
  profileId: 'agent',
  mustKeep: {
    alwaysKeepTypes: ['system_prompt', 'user_input'],   // 按 AiMessage.type
    alwaysKeepFenceKinds: ['system-event'],              // 按 fence kind
    truncationRules: [
      // 想限量截断（不丢但只保留预算的 X%）
      { fenceKind: 'memory-context', maxBudgetFraction: 0.2, strategyName: 'memory-truncate' },
    ],
  },
}
```

**默认值**：`DEFAULT_MUST_KEEP_POLICY` 已经把 `system_prompt` / `user_input` 等核心 type 列进 alwaysKeepTypes。

**开放状态**：`AgentSpec.contextPolicy.mustKeep` 已完成运行时接线。host 可以提供 fallback policy，单个 agent 可以通过 spec 覆盖；例如 `additional-context` 这类产品语义应属于 host fallback，不写进 linnkit framework。

**组装边界**：以上按 `fenceKind` 匹配的规则只作用于仍保持独立 `context_injection` 身份的消息。当前轮 system/user fence 会在 Provider 阶段之前组装进 `system_prompt` / 最新 `user_input`，只留下 `assembledFenceKinds` 说明信息，因此当前实现无法再按单个 kind 执行 must-keep 或比例截断。

---

## 4. Preprocessor Pipeline（4 个内置预处理器）

这一层在"消息进 ContextProvider 之前"跑。按 priority 顺序执行；任何一个抛 fatal `ContextProviderError` 都会中断 pipeline。进入 ContextProvider 之后，默认策略是 fail-fast：普通异常和 `fatal:true` 的 `ContextProviderError` 都会中断，只有显式 `fatal:false` 的 `ContextProviderError` 才允许继续后续 provider。

### 4.1 ToolHistoryCompressorPreprocessor —— 工具历史保留（AgentSpec 高度可配置 ✅）

控制旧的 `tool_calls` + `tool_output` 配对如何进入上下文。三种选择窗口：`'per-run'`（默认，按 user_input 边界保留最近 K 个 run）/ `'per-pair'`（保留最近 N 个工具对）/ `'none'`（不做常规筛选）。未进入保留窗口的旧工具组默认按 `retentionMode: 'drop'` 整组删除；需要旧摘要线索时可显式设 `retentionMode: 'compress'`，兼容旧的 assistant 摘要行为。安全阀：`maxInteractionGroups` 硬上限 + `overflowStrategy`（`'keep-latest'` / `'fail-fast'`）。

这里有一个容易误解的边界：`compress` 只发生在 preprocessor 阶段，表示“旧 raw 工具组先被替换成自然语言摘要”；这些摘要后续在 working memory 里仍算历史工具交互，会继续受到 `maxInteractionGroups` 和 token budget 限制。也就是说，压缩摘要不是永久保留，只是给窗口外旧工具组一次以摘要形式进入最终 prompt 的机会；`drop` 则连这条摘要都不生成。

完整字段、默认值与选型对比见 [`tool-history.md`](./tool-history.md) ⭐。

### 4.2 ToolReplayProtocolGuardPreprocessor —— 工具回放协议守卫（无需配置，自动开启）

避免旧的工具组被 provider 误认为是结构化 replay。host 装配时已自动启用，不需要管。

**配置位置**：无；如果你完全自定义 pipeline 才需要手动 register。

**开放状态**：默认开启；属于协议级保护，没设计成可配置项。

### 4.3 HistoryPurificationPreprocessor —— 历史净化（无需配置）

清理孤儿 `tool_calls`（没有对应 `tool_output`）、同 ID 重复消息、空消息等异常状态。

**开放状态**：默认开启，无配置；这是数据卫生层。

### 4.4 FenceLifetimePreprocessor —— 旧轮 turn-only 剥离（自动跟 FenceRegistry 走）

上一轮注入的 `lifetime: 'turn-only'` 的 fence（比如临时引用文本、临时记忆片段），这一轮自动剥掉。当前轮 system/user side fence 会先由 `CurrentTurnMessageAssembler` 合并进本轮 `system_prompt` / `user_input`，因此不会因为 `placement: 'before-current-user'` 位于用户请求前而被误判成历史上下文。

**配置位置**：注册 fence 时通过 `lifetime` 字段控制；不需要单独配 preprocessor。

---

## 5. ContextProvider 填充与自动压缩准备

### 5.1 AgentCoreContextProvider —— 核心层（无需配置）

把 must-keep 的核心消息（system_prompt + 最新 user_input + alwaysKeep 的 fence）按物理 role 钉到 messages 数组里，**永不裁剪**。

**开放状态**：行为完全由 MustKeepPolicy 决定（见 §3）。

### 5.2 AgentWorkingMemoryProvider —— 工作记忆按优先级填充（AgentSpec 已运行时接线 ✅）

以本次输入总预算为基准划出工作记忆额度；扣掉核心层后，剩余工作记忆按优先级倒着塞进消息：

| 优先级 | 内容 |
|--------|------|
| **P1** | 最近的工具交互对（tool_calls + tool_output） |
| **P2** | 纯文本对话（final_answer + user 消息） |
| **P3** | 更早的工具交互（包括 `retentionMode: 'compress'` 生成的压缩摘要） |

压缩摘要虽然物理上是 `assistant.final_answer`，但不会按 P2 普通助手文本处理；它会在 P3 中和 raw 工具组共用历史工具交互预算。

**可配置字段**（写在 `AgentSpec.contextPolicy`）：

| 字段 | 默认 | 含义 | 开放状态 |
|------|------|------|---------|
| `budget.maxTokens` | 未声明（继承模型 route） | Agent 显式总窗口上限 | ✅ AgentSpec + runtime |
| `budget.reservedForResponse` | 未声明（继承模型 route） | Agent 显式输出上限，并预留同等输入空间 | ✅ AgentSpec + runtime |
| `budget.workingMemoryBudgetPercentage` | `0.70` | 工作记忆占可用预算的比例 | ✅ AgentSpec + runtime |
| `workingMemory.minToolInteractionsToKeep` | `2` | compressed 历史工具摘要的预算兜底组数 | ✅ AgentSpec + runtime |
| `workingMemory.maxRecentToolRuns` | `2` | 原始 tool_calls 形态保护的最近工具 turn 数 | ✅ AgentSpec + runtime |
| `workingMemory.maxRecentToolInteractions` | `2` | Deprecated alias，兼容旧配置；新配置请用 `maxRecentToolRuns` | ⚠️ 兼容保留 |
| `workingMemory.toolPairingSearchRange` | `10` | 搜工具配对的窗口范围 | ✅ AgentSpec + runtime |
| P1-P3 优先级数字 | `1/2/3` | 优先级编号 | ❌ 不开放|

<a id="automatic-context-compaction"></a>

### 5.3 自动上下文压缩 —— Context Manager 纯计划，Graph tick 执行（✅）

自动压缩对所有模型使用同一套语义，不注册工具，也不增加 Graph node。Context Manager 只负责确定性部分：

- 只从已经 materialize、真正进入本次主 Prompt 的消息中选择最老可替换区段；预处理来源历史仅用于展开替换闭包与递增摘要序号，不能虚报释放量。最新用户请求、must-keep、附件、不完整工具组与最近工具组不进入候选。
- 工具调用按 `assistant.tool_calls + sibling tool_output` 原子组选择，不能拆开。
- 对 `replacementSourceIds` 和旧摘要的 `replacedMessageIds` 计算来源闭包。
- 校验模型输出的固定摘要格式与 token 上限，创建尚未发布的 `history_summary` draft，并用 draft 重建上下文。

Graph tick pipeline 负责带副作用的完整事务：

```text
build_context → apply_system_reminder → measure_prompt_usage
  → compact_context（达到阈值时生成摘要并重建、重新计量）
  → admit_prompt_capacity
  → commit_context_compaction（durable commit → end → publisher fan-out）
  → execute_llm
```

System Reminder 与自动压缩的关系统一见 [§6](#system-reminder)。

重建后的最终实测 token 必须严格少于压缩前，否则按无收益结果拒绝提交。软阈值下压缩失败时，原 Prompt 仍在硬预算内即可继续；主 Prompt 已严格超限时，压缩失败必须阻止主模型调用。强制收尾 phase 只抑制软触发，硬超限仍先恢复容量，并原样保留收尾 phase 与 tool choice。压缩成功不会重置 `maxSteps` 或 `stepCount`。

`history_summary` 只有在重建 Prompt 已通过容量门禁后才提交。Graph 先调用 root/child 各自的 `RuntimeEventCommitPort(event, source)`；Host 必须在同一条有序 persistence 队列里完成 routing admission、落盘与 ack，但此时不做 realtime fan-out。成功后 Graph 才发送 `summarization_end`，再把同一 fact 交给既有 RuntimeEvent sink / publisher；persistence consumer 按 fact ID 去重，不能写第二份。durable commit 是不可回滚分界：提交失败必须形成 `start → error`，不得出现 end、`history_summary` 或主模型调用；提交成功后不得再上报压缩失败或 `summarization_error`。生产 Host 的 progress callback 必须 no-throw，transport 失败只记日志；非标准 event sink 的后续 fan-out 失败可以终止 execution，但不能删除或否认已经提交的摘要。

**可配置字段**：

| 字段 | 默认 | 含义 |
|------|------|------|
| `compaction.enabled` | `true` | 是否启用自动压缩 |
| `compaction.triggerRatio` | `0.80` | reminder 后最终 Prompt 达到该比例时软触发 |
| `compaction.targetRatio` | `0.50` | 候选计划期望释放到的水位 |
| `compaction.keepLatestToolGroups` | `2` | 不进入候选的最近完整工具组数量 |
| `compaction.maxOutputTokens` | `8192` | 内部摘要请求策略上限；最终取 `min(该值, route.max_output_tokens)` |
| `compaction.maxCompactionsPerRun` | `12` | 单个 run 真正到达 Provider 的压缩 attempt 上限；失败调用同样计入护栏 |

压缩请求复用当前模型、有序工具定义和普通 Reminder 已注入的完整 Prompt，保持每条原消息不变，再追加一条瞬态 user-role 消息承载专用 `<system-reminder>`。Provider adapter 只负责把 canonical cache anchor 映射到对应 wire 协议，不改变压缩算法。

修改这条主链时运行仓库级 `pnpm run test:context-compaction-gate`。该门禁覆盖 Context Manager 计划、Graph 同轮事务、root/child 隔离与取消、Host durable commit、Renderer live/reload、Provider wire 和审计投影，同时保证旧 checkpoint 工具、step reset 与专用摘要模型不会重新进入生产代码。

---

<a id="system-reminder"></a>

## 6. System Reminder（注册表 + AgentSpec 已接线 ✅，**有一项不开放**）

System Reminder 是统一的 `<system-reminder>...</system-reminder>` 瞬态控制协议。普通 tick 提醒与压缩专用控制共享标签和“不入历史”的生命周期，但注入位置不同。

先把最容易混淆的三件事分开：

| 对象 | 物理位置 / role | 生命周期 |
|------|-----------------|----------|
| 普通 tick Reminder `R / R′` | 拼入当时最后一条 wire message 的 `content`，没有独立 role | 仅当前 tick；触发压缩时随完整原 Prompt 进入内部请求 |
| 压缩专用 Reminder `C` | 完整原 Prompt 后新增的最后一条瞬态 `role=user` wire message | 仅当前内部压缩请求 |
| durable `history_summary` | 当前由 Context Manager 以 `role=system` 投放在后续主 Prompt | 持久化历史记忆，直到被下一代摘要替换 |

`history_summary` 是压缩结果，不是 System Reminder；不能因为它当前使用 `role=system`，就把压缩指令也实现成 system-role message。

**核心设计原则**（必须遵守）：

| 不变量 | 说明 |
|--------|------|
| ✅ 只对当前 tick 生效 | 不写入 history、不持久化、不产生 RuntimeEvent |
| ✅ 普通 Reminder 位置固定 | 最后一条 message 的 content 末尾，包裹在 `<system-reminder>` 标签 |
| ✅ 压缩 Reminder 位置固定 | 完整原 Prompt 后新增的最后一条 user-role wire message；不改写任何原消息 |
| ✅ 配置驱动 | 内置规则与 host extraRules 都通过 trigger + contentTemplate 注册表解释 |
| ✅ 两类 Reminder 分工固定 | 内部压缩请求保留已经注入的普通 Reminder，并在其后追加专用压缩 Reminder；重建正式主 Prompt 后，只使用同一份 request / history / executor state 重新生成普通 Reminder |
| ❌ **不能配置进短期对话历史** | "可以配置允许进入短期对话历史并持久化"——这条**当前不支持**，是反协议的：reminder 本质是"瞬态状态注入"，进 history 会污染缓存与回放语义。如果产品真有"持久化提示"需求，应该走 fence 通道（`lifetime: 'persisted'`），而不是 reminder |

自动压缩时实际存在三个请求形态：

```text
压缩前正式主调用：常规上下文 + System Reminder R
内部压缩请求：    上一行完整 Prompt + Compaction Reminder C
压缩后正式主调用：重建上下文 + System Reminder R′
```

`R` / `R′` 按普通规则拼入当时最后一条消息的 content。`C` 则包裹为同样的 `<system-reminder>` 标签，但作为完整原 Prompt 后新增的瞬态 `role=user` wire message；它不是 system-role message，也不进入 history。这样既让完整原 Prompt 成为逐条不变的缓存前缀，也避免最后一条原消息是 tool output 时，压缩指令被当作不可信工具数据。`C` 只用于本次内部压缩请求，要求模型停止原任务、禁止调用工具并仅输出固定格式 Checkpoint。

`R′` 不是从旧 Prompt 复制出来的文本。运行时会用相同的 `request`、`history`、`executorLocal` 和 reminder policy 重新执行一次注册规则；符合纯函数合同的规则应得到与 `R` 等价、通常逐字相同的内容，但它会被追加到**重建后**的最后一条 message。专用 `C` 不进入重建后的主调用。若原 phase 是强制收尾，phase 与 tool choice 也保持不变。随后整份 Prompt 必须重新计量并通过容量门禁。

模块维护者还必须阅读 [`runtime-kernel/system-reminder/README.md`](../../src/runtime-kernel/system-reminder/README.md)。那里规定 owner、文件职责、扩展方式与验证门禁；接入方不要绕过 Graph stage 手工拼接 Reminder。

**触发方式**：framework 内置 4 条规则，按顺序判定：

| 规则 ID | 触发条件 | 用途 |
|---------|---------|------|
| `max_steps_force_final_answer` | `phase === 'force_final_answer'` | LLM 已不足以再完成 `ToolNode → LLM` 闭环时提前收尾，禁用工具 |
| `last_steps_hint` | `remainingSteps <= threshold` | 剩余步数提示 |
| `tool_call_streak_every_ten` | 本轮工具调用次数 ≥ 10 且为 10 的倍数 | 工具循环过深告警 |
| `periodic_progress_reflection` | `stepCount` 是 30 的倍数 | 长程任务定期反思 |

`phase` 只在实际进入 LLM 节点时决定工具视图；步数策略不得覆盖 ToolNode 或删除已经接受的工具批次。
完整边界与 798→799→800 示例见 [Graph Engine §2.2](../../src/runtime-kernel/graph-engine/README.md#22-步数预算与收尾)。

**配置开放状态**：

| 项 | 开放状态 | 备注 |
|---|---------|------|
| 规则触发的阈值（10 / 30 等数字）| ✅ AgentSpec + runtime | `systemReminder.thresholds` 覆盖 |
| 规则文案 | ✅ 注册表 | 内置文案在 runtime template；host extraRules 通过 `contentTemplate` 引用 host 注册模板 |
| 是否启用某条规则（白名单/黑名单）| ✅ AgentSpec + runtime | `enabledRuleIds` 与 `disabledRuleIds` 二选一 |
| host 自定义新规则 | ✅ AgentSpec + runtime | `systemReminder.extraRules` 通过 trigger/template 注册表解释 |
| reminder 进 history（持久化）| 🔴 **不开放且不计划开放** | 见上面不变量第 4 条 |

**注册式扩展边界**：

- spec 只写 `extraRules: [{ id, trigger, contentTemplate, contentArgs }]`，不允许写函数。
- trigger 由 `SystemReminderRegistry.registerTriggerKind(kind, evaluator)` 注册。
- 文案由 `SystemReminderRegistry.registerContentTemplate(name, template)` 注册。
- 内置 4 条规则也走同一套解释链路，因此自定义规则、阈值覆盖、启用/禁用规则的行为一致。

---

## 7. Tool Output 截断与落盘（AgentSpec 阈值可配置 ✅）

工具返回结果太长会**两端各处理一次**——一次在执行期、一次在上下文构建期：

### 7.1 执行期落盘（ToolNode observationGovernance）

- 工具刚执行完，原始 observation 字符串如果超过阈值，就通过 host 提供的 `ObservationPreviewPort` **写一份完整副本到 ToolOutputStore / 本地文件 / 对象存储**，messages 里保留 preview，Host 返回的 durable 身份记录在 `tool_output.metadata.observationTruncation.blobId`
- 截断治理由 `AgentSpec.contextPolicy.toolOutput.observationGovernance` 控制；**存储后端、目录、文件命名规则由 host 的 `ObservationPreviewPort` 配置**，不进入 AgentSpec
- **开放状态**：阈值与启停已进 AgentSpec + runtime；落盘实现仍由 host 的 `ObservationPreviewPort` 决定

```ts
contextPolicy: {
  profileId: 'agent',
  toolOutput: {
    observationGovernance: {
      enabled: true,
      maxChars: 20_000,
      maxLines: 1_200,
    },
  },
}
```

接入方实现自己的 `ObservationPreviewPort`，把存储后端 / 路径 / bucket 等参数放在 host 配置里，再传给 `createDefaultGraphExecutor({ observationPreview })`。详细规范见 [`tools.md §6`](./tools.md#6-observationpreviewport配置超长-observation-存储路径)。

> **续读约束**：如果 host 自定义存储路径，host 提供的续读工具必须使用同一个 store。Linnkit 把 live 指针放在 `tool_output.metadata.observationTruncation.blobId`，不修改具体工具的 owner `data`；它不规定工具名、URI 或产品领域协议。

### 7.2 工具组保留与执行期 output 治理

工具历史进 working memory 时不再按单对 token 设置 `maxPairTokens`，也不再改写 `tool_calls.function.arguments` 或二次摘要 `tool_output`。构建期只做两件事：最近 2 个 turn 内的 raw 工具组整组原样保留，超出窗口的旧 raw 工具组整组 drop。

tool output 的唯一尺寸治理点是执行期 `toolOutput.observationGovernance`：超阈值 output 会落盘成 blob，并把进入上下文的 observation 替换为 preview。构建期只对这个 preview 做 token 估算与保留/丢弃决策。

这里的“raw 工具组原样保留”指 **context build 不再二次改写已经进入历史的消息**，不是绕过执行期 output 治理。默认情况下，工具执行完成时仍会先按 `maxChars: 20_000` / `maxLines: 1_200` 裁出 preview；因此 output 没有 build 期 token 上限，只有执行期字符/行阈值。

---

<a id="reasoning-retention"></a>

## 8. Canonical Reasoning 单一所有权

部分 LLM Provider 会返回可见 reasoning。Linnkit 对同一次 Assistant 产出建立两种投影：

- `thought` RuntimeEvent 负责流式 UI、历史展示与审计；它会持久化和实时发布，但**永不作为独立消息进入模型上下文**。
- `assistant_replay_parts` 负责模型回放，按 Provider 原始顺序保存 text、reasoning、tool call 及所属 continuation；这是 reasoning 的唯一模型侧 owner。

因此，Context 不再按文本相等做 thought 去重，也没有“最近保留 N 条 thought”的策略。一次 run 中已经进入 ordered replay 的全部 canonical reasoning 都随所属 Assistant 消息保留，直到该消息被正式 `history_summary` 压缩替换。这个统一规则适用于所有模型；不同 Provider 的差异只存在于 continuation codec，不产生另一套上下文算法。

Host 仍必须让 `assistant_part_end.text` 与该 part 已发送的 `thought_delta` 累积文本一致。这是双投影 conformance 要求，不是让 Runtime 通过文本匹配决定谁进入 Prompt。Provider continuation replay 则由 Host 的 `inference_route.continuation.tool_replay` 声明；required route 缺少 continuation 时直接失败，不降级、不补空字段。

---

## 9. Token 预算与估算

### 9.1 字段速查

| 字段 | 默认 | 含义 | 开放状态 |
|------|------|------|---------|
| `budget.maxTokens` | 未声明（继承模型 route） | Agent 显式总窗口上限 | ✅ AgentSpec |
| `budget.reservedForResponse` | 未声明（继承模型 route） | Agent 显式响应上限 | ✅ AgentSpec |
| `budget.workingMemoryBudgetPercentage` | `0.70` | 工作记忆占可用预算的比例 | ✅ AgentSpec |
| `tokenEstimation.encoding` | `'cl100k_base'` | 估算用的 tiktoken encoding 名 | ✅ AgentSpec + runtime |
| `tokenEstimation.avgCharsPerToken` | `2.0` | tiktoken 不可用或未配置 encoding 时的字符/token 兜底比 | ✅ AgentSpec + runtime |
| `tokenEstimation.toolCallOverhead` | `50` | 工具调用本身的额外开销估算 | ✅ AgentSpec + runtime |
| `tokenEstimation.calibration` | 默认关闭 | 用上一轮 actual usage 样本校准本地估算 | ✅ AgentSpec + runtime |
| `tokenEstimation.remoteCount` | 默认关闭 | final messages 确定后调用 provider/gateway preflight count | ✅ AgentSpec + runtime |

完整 token 口径地图见 [`token-management.md`](./token-management.md)：那里专门说明预算估算、remote count、provider usage、component ledger 与 cost/calibration 的区别。

#### 9.1.1 压缩后的最大预算一览

先看唯一的总上限：`effectiveWindowTokens` 取模型 route 总窗口与 Agent 显式 `maxTokens` 的较小值；`outputLimitTokens` 取 route 输出上限与 Agent 显式 `reservedForResponse` 的较小值；`inputBudgetTokens = effectiveWindowTokens - outputLimitTokens`。全部 messages（含 reminder 与图片估算）加上 prepared tool definitions，必须不超过 `inputBudgetTokens`。

`targetRatio = 0.50` 是压缩的**目标水位**，不是压缩后的硬上限。受保护内容过多时，压缩结果可以高于 50%，但只有不超过 `inputBudgetTokens` 才能提交并调用主模型；严格超限会得到 `CONTEXT_COMPACTION_REBUILD_OVER_BUDGET`，摘要不提交，主模型不调用。

| 对象 / `AiMessage.type` | 默认独立上限或保留量 | 最终预算口径 | 相关细则 |
|---|---:|---|---|
| **整份最终输入** | `inputBudgetTokens`（输入硬预算的 100%） | 唯一总硬上限；等于上限可接纳，超过即在 Provider 前拒绝 | [Token 管理](./token-management.md) |
| Prepared tool definitions | 无独立上限 | 先占用 `inputBudgetTokens`，剩余部分才是 `messageBudgetTokens` | [工具开发](./tool-development-guide.md) |
| `system_prompt` | 无独立上限；默认必保留 | 与其他内容共同受最终总门禁约束 | [Agent 注册](./agent-registration-guide.md) |
| `history_summary` | `min(8192 tokens, route.max_output_tokens)` | 这是摘要正文上限；只保留最新摘要，重建后的整份输入仍须通过总门禁 | [自动压缩 §5.3](#automatic-context-compaction) |
| `user_input` | Linnkit 无独立 token 上限；最新一条默认必保留 | Host 可以另设字符、字节或附件入口限制；这些限制不属于 Linnkit 固定合同 | [Context Fence](./context-fences.md) |
| `context_injection` / `context_before` / `context_after` / `document_fragment` / `task_request` | 当前没有 per-fence 硬上限 | `FenceDescriptor.maxBudgetFraction` 目前只校验声明，尚未形成运行时裁决；当前只受最终总门禁约束 | [Context Fence](./context-fences.md) |
| `thought` / canonical reasoning | `thought` 不进入模型输入；reasoning 与其他 Assistant 输出共享 `outputLimitTokens` | 全量 reasoning 通过所属 `assistant_replay_parts` 回放并计入消息 token，直到正式压缩替换 | [Reasoning 所有权 §8](#reasoning-retention) |
| `final_answer` / `tool_code` / `task_completion` | 无独立 token 上限 | 当前一次模型生成共享 `outputLimitTokens`；历史消息按工作记忆预算取舍 | [Token 管理](./token-management.md) |
| `tool_calls` | 与 thought / text 共享本次生成的 `outputLimitTokens`，没有第二份独立上限 | 普通 route 会把上限发给 Provider；ChatGPT Codex 订阅 route 按其客户端合同省略 wire 上限，只保留本地预算预留。进入历史后与全部 sibling `tool_output` 整组同进同退 | [Tool History](./tool-history.md) / [Provider catalog](../../../../docs/source-acquisition/provider-catalog.md) |
| `tool_output` | 默认在超过 20,000 字符或 1,200 行时落盘并替换为 preview | 这是执行期字符/行阈值，不是 token 上限；preview 仍受最终总门禁约束 | [Tools](./tools.md) |
| `user_input` / `tool_output` 的图片附件 | Linnkit 不固定数量、字节或分辨率上限 | Host 的 `LlmInputMaterializerPort` / route profile 负责 admission；图片 token 估算计入最终输入，附件随所属消息或完整工具组同进同退 | [图片输入](./llm-provider.md#5-图片输入) |
| `<system-reminder>` | 无独立 token 上限 | 普通 Reminder 拼入末条 content；压缩专用 Reminder 是独立末尾 wire 消息。两者都重新计量并接受同一总门禁 | [System Reminder §6](#system-reminder) |

以无模型 route 时的 framework fallback 为例：总窗口 256,000，输出预留 16,384，所以输入硬预算是 **239,616 tokens**；80% 软触发线约为 **191,693 tokens**，50% 目标水位是 **119,808 tokens**。即使目标不可达，已接纳结果也不会超过 239,616 tokens。

这里的“不超限”以当前生效的 `TokenizerPort` / remote count 口径为准。若 Host 只使用近似 tokenizer，Linnkit 能保证“不发送自己已经测得超限的请求”，但 Provider 的真实 tokenizer 仍可能得到不同计数；需要严格一致时应注入对应模型的 tokenizer 或启用 remote count，见下文 §9.2—§9.4。

### 9.2 谁来算 token？

> 本文档把"计算 token 的方法"统称为 **tokenizer**。这是一个**总称**——既包括 linnkit 内置的默认 tokenizer（基于 tiktoken + 字节比兜底），也包括 host 注入的任何自定义实现。所有运行期上下文预算决策都通过当前生效的 tokenizer 完成。

**linnkit 协议层既定事实**：

- linnkit **内置一个默认 tokenizer**（实现：`TokenCalculator` + `tiktoken@^1.0.22` 硬依赖）—— 只有 Host/AgentSpec 显式声明 `tokenEstimation.encoding` 时才调用对应 tiktoken encoding；未声明或 tiktoken 不可用时使用 `avgCharsPerToken` 粗估。Linnkit 不从模型名或 Provider 名猜 encoding。
- runtime 统一通过 `tokenizer.estimateMessage(...)` 估算 message token，预算判断会同时计入基础 message overhead、canonical replay 中的 text/reasoning、tool call 参数 token 与 `tokenEstimation.toolCallOverhead`。存在 `assistant_replay_parts` 时，它与真实 Provider 请求一致，是 Assistant 内容的唯一估算来源，不重复计算投影 `content`。如果 `encoding` 不可用，才回退到 `avgCharsPerToken`。
- `TokenizerPort` 的 `modelId` 参数只供 Host 自定义实现按显式 route 决策；内置 `DefaultTokenizerPort` 不解释它。需要 tiktoken 时必须声明准确 encoding，需要厂商 tokenizer 时由 Host 注入自己的 `TokenizerPort`。
- 这个 tokenizer **仅用于 budget 决策**（"还能塞多少消息"），**不用于**计费——计费 token 数由 provider 返回的 `usage` 字段决定，host 自己消费。
- linnkit **不发明跨 provider 统一 token 数协议**——每个 host / agent 决定自己用什么 tokenizer（默认内置 / 调三参数 / 完全替换）。
- 摘要触发、工具历史截断、`ContextTrace.message-decision.tokens` 都走同一套 `TokenizerPort` 口径；context-manager 内部不应绕过它直接调用 `TokenCalculator`。

### 9.3 何时该担心估算不准？

| 场景 | 估算精度 | 是否需要担心 |
|------|---------|------------|
| host 用 GPT-3.5/4 + 默认 `cl100k_base` | 几乎精确（OpenAI tiktoken 就是这个）| ❌ 不需要 |
| host 用 GPT-4o + `encoding: 'o200k_base'` | 几乎精确 | ❌ 不需要 |
| host 对非 tiktoken 模型显式使用 `cl100k_base` 近似 | ±10-30% 偏差 | ⚠️ 大多数场景**够用**（budget 有 `reservedForResponse` 安全垫）；如果你严格按真实计费做预算 → 需要担心 |
| host 主要场景是中文 / CJK，且未声明 encoding | 字符/token 粗估 | ⚠️ 按语料调 `avgCharsPerToken`，或注入真实 tokenizer |
| host 自动化复杂任务（步骤多、工具链长，单次 run 几十万 token）| 默认估算累积偏差可能放大 | ⚠️ 考虑注入 `TokenizerPort`（已可用） |
| host 严格按计费 token 数 = 预算 token 数（无安全垫）| 默认估算不够 | ❌ **必须**注入 `TokenizerPort`（已可用） |

### 9.4 用自定义 tokenizer 替换默认实现（`TokenizerPort` 注入）

`TokenizerPort` 是**所有 tokenizer 的协议接口**——linnkit 默认 tokenizer (`DefaultTokenizerPort`) 实现它，host 想替换默认实现时也实现它即可。

**何时该替换默认 tokenizer**：如果你需要**真实**的 Anthropic / Gemini tokenizer（不接受 OpenAI 编码近似），或者你接的是 linnkit 不认识的私有模型，就实现 `TokenizerPort` 注入到装配链路。

#### 9.4.1 接入点 · Context Manager 与 Graph 共用同一实例

Context Manager 负责 messages 裁剪；Graph 还要估算 prepared Tool definitions，并在 system reminder 后测量最终 Prompt。两层必须共用同一个 `TokenizerPort` 实例，不能各自维护估算常量。

| 装配入口 | 字段 | 适用场景 |
|---------|------|---------|
| `new AgentContextManager({ ..., tokenizer, tokenizerModelId })` | ✅ | host 直接装配 agent context manager |
| `new AgentMessageOrchestrator({ ..., tokenizer })` | ✅ | host 装配 orchestrator（orchestrator 透传给底层 context-manager）|
| `new GraphAgentExecutor({ ..., tokenizer })` | ✅ | prepared tools、最终 Prompt 三项归因与 fallback 容量 admission |

纯聊天 / 翻译 / 摘要这类单轮能力也注册为 tools-disabled agent，不再走独立 chat profile。

参考实现：`defaultGraphExecutorContextBuilder.ts` 已经把可选 `tokenizer` 依赖透传到 `AgentMessageOrchestrator` 装配，外部接入方可以照抄。

#### 9.4.2 完整示例

```ts
import type { TokenizerPort, LlmRequestMessage } from '@linnlabs/linnkit/ports';
import { agentOrchestration } from '@linnlabs/linnkit/context-manager';

class MyMultiProviderTokenizer implements TokenizerPort {
  estimateText(text: string, modelId?: string): number {
    if (modelId?.startsWith('claude-')) {
      return runClaudeTokenizer(text);   // host 自接 Anthropic 官方
    }
    if (modelId?.startsWith('gemini-')) {
      return runGeminiTokenizer(text);
    }
    return runTiktoken(text, 'o200k_base');
  }
  estimateMessage(message: LlmRequestMessage, modelId?: string): number {
    // 必须包含 message overhead + tool_call overhead + tool_call_id 层级
    // 否则 budget 决策会系统性低估
    // ...
  }
}

const orchestrator = new agentOrchestration.AgentMessageOrchestrator({
  tokenBudget,
  processing,
  taskResolver,
  providerRegistry,
  tokenizer: new MyMultiProviderTokenizer(),
});
```

如果你的 host 有自己的 `GraphExecutorContextBuilder`，应把同一个 tokenizer 同时传给 `AgentMessageOrchestrator` 与 `GraphAgentExecutor`。前者决定 messages 裁剪，后者决定 Tool definitions reserve、最终 Prompt 归因和 fallback candidate 容量；实例或模型路由不一致会造成系统性漂移。

#### 9.4.3 `tokenizerModelId` 字段

`ContextManagerBaseOptions` 还提供 `tokenizerModelId?: string`——host 在装配期声明"这个 context-manager 接的是哪个模型"，linnkit 内部会把它透传给 `tokenizer.estimateMessage(message, modelId)` / `tokenizer.estimateText(text, modelId)`。当 host 在多 agent 场景下用不同模型时，这个字段让自定义 tokenizer 能精准路由。

#### 9.4.4 与 `tokenEstimation` 三参数的关系

- **host 注入的自定义 tokenizer 优先级最高**：注入后，`tokenEstimation` 三参数不再影响预算决策。
- **`tokenEstimation` 仅服务"用默认 tokenizer"的 host**：它是 `DefaultTokenizerPort` 的配置点（调 encoding / 字节比 / 工具开销）。默认 tokenizer 仍响应 `tokenEstimation` config 的运行时更新。
- **同时配置不会冲突**：linnkit 内部维护 `hasCustomTokenizer` 标志，注入后即认定 host 完全接管 token 估算。

#### 9.4.5 C12 不变量 · 协议守门

`testkit/context-harness` 提供 `C12_HOST_TOKENIZER_DRIVES_BUDGET` 严格不变量：

- 校验 `message-decision.tokens` 必须等于 host 注入的 `TokenizerPort.estimateMessage(...)`
- 校验 `trace.finalTokens` 必须等于 host tokenizer 对 finalMessages 的总估算
- **只在测试上下文传入 tokenizer 时启用**——不打扰沿用默认 tokenizer 的旧测试

这条不变量是 host 集成自定义 tokenizer 后**最有价值**的回归测试守门——它能在协议层证明"host 的 tokenizer 真的在驱动 budget 决策"，而不是被默认实现静默兜底。

#### 9.4.6 testkit · `createMockTokenizerPort`

写测试时不需要自接真实 tokenizer。testkit 提供 `createMockTokenizerPort()`，让你能注入"每条 message 返回固定 N token"的 mock，方便验证 overflow / trimming / contextTrace 行为：

```ts
import { createMockTokenizerPort } from '@linnlabs/linnkit/testkit';

const mockTokenizer = createMockTokenizerPort({ tokensPerMessage: 100 });

// 注入到测试 harness，验证当总 token 超过 budget.maxTokens 时的 trimming 行为
```

### 9.5 边界提醒

- **tokenizer 是装配期一次性注入**——无论 host 注入还是用默认实现，运行时不支持热替换（避免 budget 决策因为 tokenizer 抖动而失真）。
- **replay 场景**：未来 Replay SDK 重演 run 时，host 需要重新注入对应的 tokenizer——这是 host 责任，不是 framework 协议负担。
- **自定义 tokenizer 必须保持与默认实现一致的"额外开销层级"**（message overhead / tool_call overhead / tool_call_id），否则 budget 决策会偏低、消息塞超。

---

## 10. 出关：`formatAgentLlmMessages`

把所有 AiMessage 翻译成最终 LLM 协议 wire 格式（具体调哪个 provider 这里无关）；fence 消息走 host 提供的 `formatter` 包成字面标签；`tool_calls` / `tool_output` 按 LLM 协议挂正确的 role。

**配置面**：
- fence formatter（host 决定围栏字面长什么样）
- LLM provider 自己的 codec（OpenAI Chat / Anthropic Messages / DeepSeek 等）—— 详见 [`llm-provider.md`](./llm-provider.md)

---

## 10.5 ContextTrace：解释这次上下文为什么长这样

`contextTrace` 是本次 context build 的机器可读旁路记录。它不进入 LLM messages、不落成历史事实，只跟随 `ContextBuildResult.contextTrace` 返回，用来解释 effective policy、每个 provider 的 token 增减、以及每条消息最终被保留还是裁掉。

**配置面**：

```ts
contextPolicy: {
  profileId: 'agent',
  contextTrace: {
    enabled: true,
    includeMessageIds: true,
    includeTokenBreakdown: true,
    maxTraceEvents: 200,
  },
}
```

**输出里会看到**：

- `effectivePolicy`：本次实际生效的 `contextPolicy`（已经合并 framework 默认、host fallback、agent spec）。
- `provider` 事件：每个 provider 执行前后保留消息数、token delta、剩余预算、命中的策略名。
- `message-decision` 事件：每条候选消息的 `keep/drop` 结果、阶段、token、原因；`includeMessageIds=false` 时不会带 message id。
- `remoteTokenCount`：如果启用 remote count，这里记录是否尝试、是否应用、provider/gateway 返回多少 token、与本地估算差多少。
- `tokenComponents`：按 system/user/assistant/tool/fence/history-summary 等组件聚合的本地估算分项，用于面板和账本；它不是 provider actual usage。
- `tokenCalibration`：本轮是否应用了校准系数、样本数量、系数和 delta。
- `overflowed`：trace 事件超过 `maxTraceEvents` 时为 `true`，防止观测数据反过来膨胀。
- GraphExecutor 会把 `contextTrace` 从 context builder 透传到 context audit record；runtime-kernel 只按 `unknown` 透传，不反向依赖 context-manager 类型。

`ContextTrace.remoteTokenCount` 只解释 Context Manager 构建结束时的 messages。真正提交给 provider 的最终口径由 Graph 的 `measure_prompt_usage` stage 在 system reminder 后重新测量，并同时带上 prepared tools。达到阈值时，`compact_context` 生成摘要、重建并重新计量；随后 `admit_prompt_capacity` 校验 `used_tokens <= input_budget_tokens`，`commit_context_compaction` 才提交已接纳的 `history_summary`。成功的 provider attempt 才会把严格 `ContextUsageSnapshot` 写入 tick output / engine checkpoint；超限被拒绝、调用失败或取消都不会提交候选快照。LlmNode 还会把该成功快照作为 ephemeral `context_usage_snapshot` 经已注入的 RuntimeEventSink 发布，不进入 Graph history；Host 若需要 reload，仍由 execution settlement 把最新快照写入 durable `run_execution_metrics`。事件治理与实时接入见 [`realtime.md`](./realtime.md)。

**边界**：ContextTrace 不是 DevTools，也不是 PromptTrace 可视化；它只提供最小可观测闭环。跨 run prompt diff、图形化时间线、长期审计落库属于阶段 2。

---

## 11. 当前开放面 vs 未开放面

### ✅ 已通过 AgentSpec 协议化开放，且 runtime 已接线

- `budget.maxTokens` / `reservedForResponse` / `workingMemoryBudgetPercentage`
- `toolHistory.{strategy, retentionMode, keepLatestToolPairs, keepLatestRuns, maxInteractionGroups, overflowStrategy}`
- `toolOutput.observationGovernance.{enabled, maxChars, maxLines}`
- `compaction.{enabled, triggerRatio, targetRatio, keepLatestToolGroups, maxOutputTokens, maxCompactionsPerRun}`
- `MustKeepPolicy.{alwaysKeepTypes, alwaysKeepFenceKinds, truncationRules}`
- `workingMemory.{maxRecentToolRuns, maxRecentToolInteractions(deprecated alias), minToolInteractionsToKeep, toolPairingSearchRange}`
- `tokenEstimation.{encoding, avgCharsPerToken, toolCallOverhead}`
- `systemReminder.{enabledRuleIds, disabledRuleIds, thresholds, extraRules}`
- `contextTrace.{enabled, includeMessageIds, includeTokenBreakdown, maxTraceEvents}`
- `defineContextPolicy()` 补齐 framework 行为默认值，但保留两个容量 cap 的 sparse 声明语义
- fence 注册（`FenceRegistry`，host 自由扩展）

### 🔴 当前不开放（未来可能开放）

- Preprocessor pipeline **顺序与白名单**（host 现在只能在默认 pipeline 之外追加，不能改默认顺序）

### 🚫 协议性不开放（不计划开放）

- system reminder **持久化进 history**（违反 reminder 协议本质——若需持久化请走 fence `lifetime: 'persisted'`）
- 默认 ContextProvider 顺序（核心 → 工作记忆）与 Graph tick 压缩事务顺序
- 工具历史填充的 P1-P3 优先级数字
- `tool_calls` / `tool_output` 配对不变量

---

## 12. 想动哪一层

| 你想做什么 | 应该动哪里 | 验证方式 |
|------------|------------|----------|
| 控制总预算 / 预留响应 token | `contextPolicy.budget` | `ContextTrace.effectivePolicy` + final token usage |
| 控制工具历史保留方式 | `contextPolicy.toolHistory` | `ContextTrace.message-decision` 中 tool_calls / tool_output 的 keep/drop |
| 控制自动压缩开关、触发水位、目标水位与摘要上限 | `contextPolicy.compaction` | `context_compaction` telemetry + `history_summary` + 压缩前后 Prompt usage |
| 必保留某类仍独立存在的 host fence | `contextPolicy.mustKeep.alwaysKeepFenceKinds` | fence 对应 message 的 decision 为 `kept_by_CORE_CONTEXT`；当前轮已组装 fence 不适用 |
| 调整工作记忆工具组数量 | `contextPolicy.workingMemory` | working-memory provider 后的 kept count / token delta |
| 验证 reasoning 回放是否完整且无重复 | RuntimeEvent lifecycle + `assistant_replay_parts` | `thought` 仅出现在 UI/审计，ordered replay 中的 reasoning 按原顺序进入 Provider 请求 |
| 控制工具 observation 执行期预览阈值 | `contextPolicy.toolOutput.observationGovernance` | `metadata.observationTruncation.blobId` 是否生成 + tool node 单测 |
| 声明 Provider 工具回放要求 | Host `inference_route.continuation.tool_replay` | required route 缺 continuation 时是否 fail-closed |
| 调整 token 估算口径 | `contextPolicy.tokenEstimation` | provider token delta 曲线变化 |
| 自定义 transient system reminder | `contextPolicy.systemReminder` + registry | `systemReminderHitRuleIds` + final LLM input |
| 看清最终 token 决策 | `contextPolicy.contextTrace.enabled=true` | `ContextBuildResult.contextTrace` |

---

## 13. 声明你的第一个 system reminder

SystemReminder 是**当前 tick 的瞬态提醒**，不会进入历史。内置规则可通过 `enabledRuleIds` / `disabledRuleIds` / `thresholds` 控制；host 自定义规则走 trigger/template 注册表。

```ts
contextPolicy: {
  profileId: 'agent',
  systemReminder: {
    enabledRuleIds: ['last_steps_hint', 'periodic_progress_reflection'],
    thresholds: {
      lastStepsHintThreshold: 2,
      periodicReflectionPeriod: 24,
    },
  },
}
```

自定义规则示意：

```ts
import { systemReminder } from '@linnlabs/linnkit/runtime-kernel';

systemReminder.defaultSystemReminderRegistry.registerContentTemplate(
  'memoryDensityWarning',
  (_ctx, args) => `请先整理 ${String(args.resourceName ?? 'memory')} 的关键信息，再继续调用工具。`,
);

contextPolicy: {
  profileId: 'agent',
  systemReminder: {
    extraRules: [
      {
        id: 'memory-density-warning',
        trigger: { kind: 'tool-call-streak', threshold: 5 },
        contentTemplate: 'memoryDensityWarning',
        contentArgs: { resourceName: 'memory_recall' },
      },
    ],
  },
}
```

**注意**：

- 不要把 reminder 持久化进 history；需要持久化提示时走 fence。
- spec 里只放 trigger/template ID 和可序列化参数，不放函数。
