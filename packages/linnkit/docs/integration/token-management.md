# Token Management · token 口径、估算、账本与校准

> **What** · linnkit 里所有 token 数字的口径地图：上下文预算估算、remote preflight count、provider response usage、context component ledger、cost 与 calibration。
> **When to read** · 你要接自定义 tokenizer / remote count；要做成本统计；看到 `tokenUsage.used`、`ContextTrace.finalTokens`、`canonicalUsage` 不知道该信哪个；要排查上下文为什么被裁。
> **Prerequisites** · [`context-engineering.md`](./context-engineering.md) · [`telemetry.md`](./telemetry.md) · [`llm-provider.md`](./llm-provider.md)。
> **Key exports** · `TokenizerPort` / `TokenCounterPort` from `@linnlabs/linnkit/ports` · `CanonicalLlmUsage` / `TokenRoute` / `TokenLedgerEntry` / `ContextBuildTokenEstimate` / `ContextUsageSnapshot` from `@linnlabs/linnkit/contracts`。
> **Related** · [`context-engineering.md §9`](./context-engineering.md#9-token-预算与估算) · [`telemetry.md`](./telemetry.md) · [`run-supervisor.md`](./run-supervisor.md)

## 1. 先记住一句话

linnkit 不做一个大而全的 `TokenManager`。统一的是**合同、来源标记、telemetry 与账本机制**；具体 provider 怎么 count、价格怎么算、样本存哪里，仍由 host 负责。

原因很简单：不同 token 数字不是同一件事。预算估算回答“这一轮还能塞多少上下文”，provider usage 回答“这次 LLM 实际用了多少”，component ledger 回答“上下文里各模块占多少”，cost 回答“这些 actual usage 按 host 价格表值多少钱”。这些口径如果硬塞成一个 `totalTokens`，后续一定会误用。

## 2. 五种常见 token 数字

| 口径 | 来源 | 是否驱动本轮裁剪 | 是否用于计费 | 常见字段 |
|---|---|---:|---:|---|
| 构建期本地估算 | `TokenizerPort` + calibration | 是 | 否 | `ContextTrace.finalTokens`、`ContextBuildTokenEstimate.finalTokens`、`message-decision.tokens` |
| 发送前 remote count | `TokenCounterPort`，按 `TokenRoute` 调 provider / gateway | 否，本轮裁剪已结束 | 否 | `ContextTrace.remoteTokenCount`、`ContextBuildResult.tokenUsage` |
| provider 响应 usage | canonical stream 的 `usage` 事件 | 否，调用已经完成 | 是，且只在 `confidence:'actual'` 时可进真实 cost / calibration | `TelemetryEvent.kind='llm_call'`、`CanonicalLlmUsage`、`TokenLedgerEntry.kind='llm-usage'` |
| context component 分项 | context build 结束后按最终 states 聚合 | 否，是观测账本 | 否 | `ContextTrace.tokenComponents`、`context_build.tokenComponents`、`TokenLedgerEntry.kind='context-component'` |
| 最近成功 Prompt 快照 | Graph 在 reminder 后按最终 messages + tools 测量，成功 attempt 才提交 | 否 | 否 | `ContextUsageSnapshot`、Graph checkpoint `contextUsage` |

所有新接入 telemetry / ledger / usage 合同的 token 数字都应该带 `source` 和 `confidence`。不要只看数字大小，还要看它从哪里来。

`CanonicalInferencePort` 只允许 Provider 确实上报 usage 时产生 `usage` event，且必须是 `source:'provider-response-usage'`、`confidence:'actual'`。Provider 未上报与“真实值恰好为 0”是两个不同事实；前者必须省略事件，不能初始化全 0 后冒充 actual。

## 3. 一轮请求的数据流

```text
AgentSpec.contextPolicy
  └─ tokenEstimation / budget / trace 配置
     ▼
ContextManagerBase
  ├─ TokenizerPort 估算每条 AiMessage
  ├─ calibration 用上一轮 actual 样本修正估算
  └─ ContextProvider 根据估算 token 做裁剪、摘要触发、工具历史截断
     ▼
Context Manager messages 已确定
  ├─ 可选 TokenCounterPort 做 remote count
  ├─ ContextTrace 记录 finalTokens / remoteTokenCount / tokenComponents
  └─ buildContextStage 发 context_build telemetry
     ▼
Graph apply_system_reminder → measure_prompt_usage → admit_prompt_capacity
  ├─ 同一个 TokenizerPort 估算 System / Conversation / Tool definitions 权重
  ├─ remote count 同时接收最终 messages 与 prepared tools
  ├─ 每个 fallback attempt 按 active route 重测、重新接纳
  └─ 超输入预算时在 Provider 前拒绝；只有成功 attempt 提交 ContextUsageSnapshot
     ▼
LLM 调用完成
  ├─ LlmNode 通过 RuntimeEventSink 发布 ephemeral context_usage_snapshot
  ├─ canonical stream 产生 actual usage
  ├─ llm_call telemetry 写入 usage ledger / run cost
  ├─ host calibration collector 把 context_build local estimate 与 llm_call actual usage 配对
  └─ execution settlement 用最新快照发布 durable run_execution_metrics
     ▼
下一轮 context build 读取样本，calibration 生效
```

这里有一个刻意设计的边界：**remote count 在裁剪之后调用，只记录更准的发送前测量，不重跑本轮裁剪**。Context Manager 内的 remote count 解释 messages 构建结果；Graph 的最终 remote count 则覆盖 reminder 后 messages + tools，并形成产品可持久化快照。如果要让 remote count 影响后续裁剪，仍需通过 calibration 在下一轮生效。

但 Graph 会用这份最终测量做当前 attempt 的容量门禁：`used_tokens <= input_budget_tokens` 才能调 Provider；严格超出时抛 `llm.prompt.input_budget_exceeded`。这不是第二轮裁剪，而是副作用前的 fail-closed admission。被拒绝的候选可进入 typed error metadata 用于诊断，但不得冒充成功 `ContextUsageSnapshot`。

`context_usage_snapshot` 的发布频率是“每次成功 LLM Prompt 一条”，不是“每个工具一条”。一个 Prompt 可以决定批量工具调用；
工具执行不改变已经提交的 Prompt，只有工具结果进入 history 后发生的下一次成功 LLM 调用才会产生新快照。临时事件不落
EventStore，Host 需要历史恢复时应持久化 execution 最终 `run_execution_metrics.context_usage`。完整生命周期见
[`realtime.md`](./realtime.md)。

## 4. `ContextBuildResult.tokenUsage` 怎么读

`ContextBuildResult.tokenUsage.used` 是“本次最终上下文的展示用 token 数”。它现在会同时带：

| 字段 | 含义 |
|---|---|
| `used` | 如果 remote count 成功 applied，就是 remote count 的输入 token；否则是本地校准估算 |
| `remaining` | `totalBudget - used` |
| `messageBudget` | 本轮 Context Manager 实际用于 messages 裁剪的预算 |
| `inputBudget` | 模型有效窗口扣除输出上限后的完整 Prompt 输入预算 |
| `toolDefinitionTokens` | 在 messages 之前预留的 prepared Tool definitions 本地估算 |
| `source` | `local-estimate` / `provider-preflight-count` / `host-supplied` / `test-fixture` 等 |
| `confidence` | `estimate` / `provider-estimate` / `actual` |

`ContextBuildResult.tokenUsage` 只属于 Context Manager messages，不再在 `AgentProcessingResult.metadata` 复制第二份。调试裁剪决策时，优先看 `ContextTrace.finalTokens` 和 `message-decision.tokens`。调试整个 provider Prompt 时，看 Graph 的 `ContextUsageSnapshot`；它的三项归因之和严格等于 `used_tokens`，但仍是 normalized local attribution，不是 provider 计费分项。做成本统计时只看 `llm_call.canonicalUsage` 与 usage ledger。

## 5. host 需要实现什么

| 能力 | 是否必须 | host 责任 |
|---|---:|---|
| `TokenizerPort` | 可选 | 默认 tokenizer 不够准时注入；必须包含 message overhead、tool call arguments、tool_call_id 等开销层级 |
| `TokenCounterPort` | 可选 | 按 `TokenRoute` 调正确 endpoint；禁止只看 modelId 绕去官方 endpoint |
| `canonicalUsage` | 强烈建议 | 在 LLM adapter 里把 provider usage 归一化成 `CanonicalLlmUsage`；unknown 时宁可不返回，不要伪造 0 |
| `TokenRoute` | 建议 | 在 model catalog 声明不透明 capabilityId、baseURL、modelId、endpointModelId、capabilities，让 remote count / calibration 按 route 隔离 |
| pricing / cost | 需要成本统计时 | host 解析价格、币种、阶梯、套餐；linnkit 只提供薄的 `computeCost(usage, pricing)` |
| telemetry collector | 需要回灌或成本统计时 | 消费 `context_build` 与 `llm_call`，写 run cost、calibration 样本、长期用量表 |

## 6. 不要做什么

- 不要把 `ContextTrace.finalTokens` 当 provider actual usage。
- 不要把 `ContextBuildResult.tokenUsage.used` 当计费数字，除非它的来源和可信度正好符合你的业务要求。
- 不要在 context-manager 的功能代码里直接调用 `TokenCalculator`。预算口径必须走 `TokenizerPort`，这样 host 自定义 tokenizer 与 calibration 才不会失效。
- 不要把 provider family 的 usage 字段映射写进 linnkit core。Anthropic / Gemini / OpenRouter 等差异属于 host adapter。
- 不要只用 model name 做 remote count。中转站、私有 baseURL、同名 endpoint model 的 token 能力可能不同，必须看 `TokenRoute`。

## 7. 最小验证建议

接入自定义 tokenizer 后，至少写一个测试断言：

- `ContextTrace.events[*].kind='message-decision'` 的 `tokens` 来自你的 tokenizer。
- `ContextTrace.finalTokens` 等于最终 messages 按你的 tokenizer 的合计。
- 如果启用 remote count，`ContextTrace.remoteTokenCount.applied=true` 且 `ContextBuildResult.tokenUsage.source/confidence` 反映 remote count 返回值。
- 如果启用 calibration，先跑足够 actual usage 样本，再断言下一轮 `ContextTrace.tokenCalibration.applied=true` 且 `deltaTokens` 非 0。
