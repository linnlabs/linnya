# 13 · Token Management / Usage Ledger 升级计划

> **历史计划 / 压缩链路已替代（2026-08-25）**：本文保留 `0.10–0.23` token ledger 的分批建设记录，不再作为自动上下文压缩或内部 LLM usage 的当前合同。§7 及全文中的 `SummarizationProvider`、`AISummaryGenerator`、`GenerateResponse`、`InternalLlmCallUsage` 和 build-result sidecar 描述均为历史实现；这些路径已删除。当前由 Graph 使用 run 已锁定的主模型执行压缩，并直接记录 `llm_call(phase='context-internal')` 与 `context_compaction` telemetry，Context Manager 不执行模型调用。当前合同见 [Context Engineering](../integration/context-engineering.md)、[Telemetry](../integration/telemetry.md) 与 [Graph Engine README](../../src/runtime-kernel/graph-engine/README.md)。除本提示外，正文保持历史原貌。
>
> **状态**：批 1–5（C1–C22）已落地合并（linnkit `0.10 → 0.21`），批 7（C23–C27）已落地（linnkit `0.22 → 0.23`）——**核心引擎完成，真实回灌闭环已生产接通并经端到端测试验证，执行期截断与内部 LLM 调用 usage 已接入统一账本**；批 6 规划中（仅目标 + 简案，真做前再详细调研）。
>
> **一句话**：把 token 从“上下文里零散估算 + telemetry 里松散记 usage”升级为一套统一、可观测、provider/route-aware、可计费统计、并能把真实用量回灌到上下文工程决策的 token 管理协议（纯文本先行，多模态后置）。
>
> **实现分布**：linnkit 拥有机制 / 协议 / 编排；host（linnya 的 `infra/adapters/llm`、`model-registry`、`app-hosts/linnya/adapters/runtime`）拥有具体计算与业务数据。框架改动在 `packages/linnkit`（本 worktree，源码别名即时生效）；host 改动回 linnya 主干。

---

## 0. 背景（要解决的问题）

linnkit 已有成熟上下文工程机制（`contextPolicy.budget` 预算、`TokenizerPort` 可替换 tokenizer、`ContextTrace` 记录裁剪决策、`TelemetryPort` 记录 usage）。但 token 语义此前是散的：

- 预算估算、provider 真实 usage、上下文快照、账单 token 没有统一账本。
- provider usage 在 host adapter 各自处理，终点只收敛成松散的 OpenAI 三字段；`cached_tokens` / `reasoning_tokens` / Anthropic / Gemini 专有字段在框架内零解析。Claude 转换还曾**直接丢 usage**（已于 C3 修）。
- 同一 model 经不同 gateway（官方 / OpenRouter / 硅基流动）token 计算能力不同，但此前没把“route”建模成显式概念。
- 真实 usage 只进 telemetry，**没有回灌上下文工程**：预算决策拿不到“上一轮真实用了多少”。
- 多模态：`AiMessage.content` 仍是纯 string，消息协议载不动图片 parts，故多模态后置。

目标不是继续堆 `TokenizerPort`，而是新增一条 token accounting 主线，把估算、真实用量、计费、统计、以及对上下文工程的回灌连起来。

---

## 1. 定位与设计目标

### 1.0 三层切分（核心边界，长期不变）

“统一”指统一的**合同 + 机制 + 编排**，不是把具体计算吃进框架：

| 层 | 内容 | 归属 |
|---|---|---|
| 机制 / 协议 / 编排 | `CanonicalLlmUsage`/`TokenRoute`/`source`/`confidence`、账本、component 分项、回灌闭环、run 聚合、`CostBreakdown` 结构 | **linnkit** |
| 具体计算 | provider usage 字段映射、tokenizer 实现、remote count 调用 | **port 适配（host）** |
| 业务数据 / 策略 | 价格数值、币种、阶梯、配额、租户 | **host** |

两条决策：
- **cost 计算器走方案 1（薄而纯）**：linnkit 提供 `computeCost(usage, pricing) → CostBreakdown`，只做 `usage × 有效单价 → 分项成本`；阶梯 / 币种 / 配额 / cloud 服务端计费一律不碰。
- **不做 `TokenManager` 上帝对象**：靠 `contracts/` 共享类型 + 窄模块协作；token 跨 context-manager 与 runtime-kernel 两层，统一类型放 `contracts/`，保持 runtime-kernel 不反向依赖 context-manager。

### 1.1 北极星目标

1. 统一 token 语义：区分预算估算 / provider count / response usage / billing usage / context snapshot。
2. route-aware：token 计算绑当前调用路由，不只绑模型名。
3. 统一 usage 归一化：收敛 cache / reasoning / input / output / total 差异，保留 rawUsage 供审计。
4. 上下文模块可解释：每个组件能记录 token 来源 / 估算方法 / 保留裁剪结果，`ContextTrace` 引用账本而非自维护孤立数字。
5. 计费统计可接：框架给结构和事件，不内置价格表；host catalog 提供价格。
6. **闭环回灌（核心）**：真实 usage / preflight count 反过来校准下一轮预算与估算，让构建决策更准——不只是“记录”。
7. 预留多模态（后置，不提前固化合同）。

### 1.2 不做（长期护栏）

- 不在 linnkit 内置 provider SDK、不持有 API key、不内置实时价格表。
- 不把 remote count 当必需依赖。
- 不在框架内置 provider-family normalizer（Anthropic / Gemini 专有字段映射属 host adapter；框架只留 OpenAI-compat 默认）。
- 不把多租户配额 / 套餐 / billing policy 放进框架——这是 host 产品策略，**永不进框架**。
- 不用一个 `totalTokens` 同时表达上下文占用、累计消耗与账单费用。

---

## 2. 外部调研结论（OpenClaw / Hermes / opencode / LangChain）

共识：**没人做“统一精确本地 tokenizer”，都用分层策略**——本地估算优先 → 必要时 remote count → 最终以 response usage 为准，每层标可信度。各 provider count 能力差异极大（下表），这正是不能统一精确本地算的根因，也是 `TokenCounterPort` 做成可选 + route-aware 的理由。

| Provider | 官方 token 能力 | 建议策略 |
|---|---|---|
| OpenAI | tiktoken 本地包 | 本地精确估算优先 |
| Claude / Anthropic | Messages `count_tokens`（官方说仍可能 estimate） | 远程 count 优先，本地近似 |
| Gemini | `count_tokens` API + 响应 `usage_metadata` | 远程优先，多模态不能本地拍脑袋 |
| DeepSeek | `deepseek_tokenizer.zip` demo；以返回 usage 为准 | 本地 demo 或远程后验 usage |
| GLM / Z.AI | `/paas/v4/tokenizer`（prompt/image/video/total） | provider remote tokenizer |
| MiniMax | `/v1/responses/input_tokens`；Anthropic-compatible 也有 count | remote tokenizer（含 tools） |
| Kimi / Moonshot | `/v1/tokenizers/estimate-token-count` | remote tokenizer |

直接推论：**route 比 provider 名更关键**（中转站通常只有 response usage），“是否能 count、用哪个 endpoint”绑 `TokenRoute` 由 host catalog 声明，框架绝不内置 `provider → endpoint` 映射。账本必须保留 `source` / `confidence`，不假装所有数字等精度。

---

## 3. 已落地能力地图（批 1–3，C1–C12）

> 以下能力已实现并合并，**代码即事实来源**；本节只留“是什么 + 在哪 + 关键点”，详细类型见代码与 `CHANGELOG.md`。

| 能力 | 合同 / 实现位置 | 关键点 |
|---|---|---|
| Canonical usage 语义 | `contracts/token-usage.ts`（`CanonicalLlmUsage` / `TokenRoute` / `TokenCountSource` / `TokenCountConfidence`） | `inputTokens` 不含 cache；`source`+`confidence` 必标；`rawUsage` 留审计；多模态字段不固化 |
| Usage 归一化 | 框架 OpenAI-compat 默认 `shared/llmTelemetryContext.ts`；family normalizer 在 host `infra/adapters/llm/usage-normalizers.ts` | **Anthropic 不减 cache、OpenAI/Gemini prompt 含 cache 故减**；按 adapter 分发不靠模型名；unknown → `undefined` 不伪造 0 |
| Token 账本 + 聚合 | `runtime-kernel/token-accounting/`（`contracts/token-accounting.ts`） | 纯函数；父子 `own`/`children` 不重复计；reasoning/cache 只 sum 上报项；total 缺一即 undefined |
| 计费 | `computeCost` in `runtime-kernel/token-accounting/`；价格字段 host `model-registry/contracts.ts` | 缺价 → `status:'unknown'` 不按 0；阶梯 / 币种 host 先解析成有效单价；`unit:'per_1m_tokens'` 显式 |
| Run 成本聚合 | host `app-hosts/linnya/adapters/token-accounting/collectors/linnyaRunCostCollector.ts` | 任一 actual 缺价 → 整 run cost unknown（全有或全无）；`RunCost.tokenUsage` 为聚合载体，单值 `canonicalUsage` 已删 |
| 本地估算校准（机制） | `context-manager/shared/token-calibration.ts` + `contextPolicy.tokenEstimation.calibration` | opt-in、按 route、只用 `confidence:'actual'`、系数有上限；`estimateTokens` 返回校准值 → 真实参与预算/截断 |
| Route-aware 远程计数 | 端口 `ports/token-counter.ts`；host 实现 `app-hosts/linnya/adapters/token-accounting/` | 四重门禁（policy/counter/route/`supportsRemoteTokenCount`）；按 `route.capabilityId+baseURL` 选择 Host 已注册 count surface，中转 route 不误调厂商官网；失败行为可配 |

关键边界原则（所有后续批次继续遵守）：

- **route 优先于 model name**；每个数字带 `source`+`confidence`，不假装等精度。
- **family normalizer 在 host adapter**，框架只留 OpenAI-compat 默认；不认识的 usage 返回 `undefined`。
- **`computeCost` 薄而纯**；缺价 unknown；价格 / 阶梯 / 币种 / 配额 / cloud 计费不进框架（cloud 走 linnyai proxy 服务端计费，`computeCost` 只对 byok 有意义）。
- **放置纪律**：账本 / canonical / 价格等类型放 `contracts/`（browser-safe，前端可展示）；Node 纯逻辑放 `runtime-kernel/token-accounting/`，不反向依赖 context-manager，不把 Node 依赖拖进 `runtime-kernel/events` slim seam。

> 当前 token 已能：准确归一化、记账、计费、按 run 聚合、按 route 远程计数、**真实回灌上下文工程（批 4 已闭环）**。剩下分模块产出与用量报表（批 5/6）尚未做。

---

## 4. 批 4 · 闭环回灌（C13–C16，已完成）

token 管理的最终目的不是“记账”，而是让**下一轮上下文构建更准**。批 4 把真实 usage → 校准 → 下一轮预算的回灌**端到端闭上并生产接通**。

**闭环路径（生产运行时真实生效）**：
- **写入**：`SqliteTelemetryAdapter.emit` 把 `context_build`（构建期本地估算）与 `llm_call`（响应后 actual usage）都喂给 `LinnyaTokenCalibrationCollector`，按 `turnId??runId` 配对成 `TokenUsageCalibrationSample`，按 route 环形存储。
- **读取**：`createDefaultLlmNode → GraphAgentExecutor → defaultGraphExecutorContextBuilder` 的 `resolveTokenCalibration` 用同一 collector 实例 `getSamples(route)`，喂回 `calibrateTokenEstimate`；`estimateTokens` 返回校准值，真实改变预算/截断。
- 两侧用 `agentRuntimeSingletons` 的同一个 collector 单例。第 4 轮起（默认 `minSamples:3`）校准生效。

校准原则（避免做成玄学）：只校准不强改（上限仍由 `contextPolicy.budget` 决定）、按 route、只采纳 `actual`、`ContextTrace` 可审计、默认 opt-in、`minCoefficient` 默认 1（向下校准默认关，防欠预算）。

> remote count 在**截断之后**调用，只产精确测量 + 喂样本，**不参与本轮内截断**（跨轮经 calibration 生效）——这是有意设计。

| # | 层 | 内容 | 依赖 | 验证 |
|---|---|---|---|---|
| C13 | linnkit | 暴露“构建期估算”供配对：context build 结果 / 新 `context_build` telemetry 事件带 `{scope(turnId/runId), route, localEstimateTokens, calibratedEstimateTokens, finalTokens}`；顺手收两个审计 follow-up：①calibration 加 `minCoefficient` 下限（防噪声样本欠预算）②导出 C7 内部 `addLedgerAggregate`/`addUsageTotals` 供 host 复用 | C7,C10,C11 | 单测：事件/结果带 estimate；`minCoefficient` 钳制；合并函数可导出；bump minor |
| C14 | host | 新增 `LinnyaTokenCalibrationCollector`（telemetry 驱动、单一职责）：`context_build` 暂存 `turnId→{route, localEstimate}`，`llm_call` 取 `actualInputTokens = input + cacheRead + cacheWrite`（用 `actualInputTokensForCalibration`）配对成样本，按 route 写入有上限环形存储；提供 `getSamples(route)` | C13 | host 测试：配对正确、按 route 隔离、容量上限、缺一不成样本 |
| C15 | host | 接上闭环：`graphRuntimeFactory` 把 telemetry 扇出到 `runCostCollector` 与新 collector（必要时补纯转发 fan-out port）；`defaultGraphExecutorContextBuilder` 实现 `resolveTokenCalibration`（按 `model.token_route` 取样本返回 `{route, samples}`） | C14 | host 测试：resolveTokenCalibration 真返回样本 |
| C16 | host | 端到端验证 + 开关：第一轮真实 usage 系统性偏离本地估算 → 第二轮 build 应用系数 → 预算/截断/摘要阈值行为可观测变化；目标 profile 打开 `calibration.enabled` | C15 | e2e：第二轮 `tokenCalibration.applied=true` 且 `deltaTokens≠0`，截断结果随之变化 |

**闭环“真闭上”硬标准（C16 必须断言）**：关闭 = 现状基线不漂；开启且样本足够时 `applied===true`、`coefficient∈[min,max]`、`deltaTokens≠0`，且**截断/摘要触发确实因系数改变**——这才是“对上下文工程产生真实影响”的证据，而非仅 trace 字段。

> 不在批 4：remote count 本轮内重驱截断；样本跨会话持久化（v1 先进程内内存）；多模态。

---

## 5. 批 5 · 分模块 token 产出 + 执行期截断记账衔接（Phase F）

> **状态**：已落地（C17–C22）。执行期工具 observation 截断现在会保存字符计量；下一轮 context build 会产出 `ContextTokenComponent[]`，工具组件可标记 `truncatedAtExecution` 并反推 `originalTokensEstimate/droppedTokensEstimate`；`context_build` telemetry 同步携带 component 与 `context-component` 账本条目，host run cost collector 已消费该账本。

**目标**：两件事一起做实——
1. **分模块产出**：context build 产出“每个上下文组件占多少 token”的结构化分项，写入 `ContextTrace.tokenComponents` 与账本，做“分模块用量面板”后端。
2. **执行期↔build 期衔接 + 统一**：把执行期工具输出截断（现在只产字符 preview + 落盘、不产 token、不进账本）接进同一套 token 账本，让“工具原本多大、执行期截掉多少 token、当前上下文里还占多少”在统一口径下可观测。

本批只做数据 + 后端，不做前端。

**现状缺口**：
- `ContextTokenComponent` 合同（C7）在，但构建管线**没产出**——`ContextTraceCollector` 无 `recordTokenComponents`、`build()` 不填，`ContextTrace.tokenComponents` 恒空；`createContextComponentLedgerEntry` 只在测试用。
- 执行期 `applyObservationGovernance` 按 `maxChars/maxLines` 截断后只写 preview + blob_id，**不产任何 token、无 telemetry、不进账本**（`runtime-kernel/graph-engine/nodes/toolNode.observationGovernance.ts`）。
- 工具 output 的尺寸治理已收敛到执行期 `observationGovernance`；build 期不再用 `MAX_TOOL_PAIR_TOKENS` 做二次截断，只负责基于 preview 估算 token 并产出账本组件。

**设计决策（已定，避免过度设计）**：
- **闸门单位保留字符**（方案 A）：执行期仍按 `maxChars/maxLines` 快速截断，热路径不跑 tokenizer（性能）。统一落在**记账/观测层**而非闸门单位。
- **token 估算统一在 build 期做**：执行期只产出字符计量（`originalChars/previewChars`）写进 `tool_output` 消息 metadata 作载体；token 换算交给 build 期既有 `estimateTokens`（有 tokenizer + route + 校准），口径与其它 component 一致，也绕开“ToolNode 是否有 tokenizer”。
- **诚实标注**：执行期截掉的原文已落盘、build 期看不到原文，`droppedTokensEstimate` 按字符比例反推（`source='local-estimate'`），字段与文档明确“非精算”。
- **归类先粗粒度**：按现有 provider 阶段 + message role + fence 类型映射到 `ContextTokenComponentKind`，不新造分类、不拆 system-prompt 子项（细粒度留后续）。

**衔接数据流**：
```text
执行期: 截断 → ObservationPreviewResult{originalChars,previewChars} → 写入 tool_output.metadata.observationTruncation
build期: 遍历 final states → 按 kind 归类聚合 token
        → tool 组件读 metadata.observationTruncation，用 estimateTokens 反推 originalTokensEstimate / droppedTokensEstimate，标 truncatedAtExecution
        → ContextTrace.tokenComponents + context-component 账本条目 + context_build telemetry
```

| # | 层 | 内容 | 依赖 | 验证 |
|---|---|---|---|---|
| C17 | linnkit | ✅ 执行期截断产出字符计量并搬运：`ObservationPreviewResult`(truncated 分支) 加可选 `originalChars/previewChars/originalLines/previewLines`；新增 `ObservationTruncationMeta` 合同；`applyObservationGovernance` 把计量写进 `tool_output.metadata`（执行期不算 token）| C7 | 单测：截断时 metadata 带计量、未截断不带；bump minor |
| C18 | linnkit | ✅ `ContextTokenComponent` 加可选执行期截断分项 `truncatedAtExecution?/originalTokensEstimate?/droppedTokensEstimate?`（复用 `kind:'tool'`，不新增枚举）| C7 | schema 测试；bump minor |
| C19 | linnkit | ✅ 分模块聚合核心：纯函数 final states→`ContextTokenComponent[]`（归类+kept），tool 组件读 `observationTruncation` 用 build 期 `estimateTokens` 按字符比例估 original/dropped；`ContextTraceCollector.recordTokenComponents` + `build()` 产出；buildContext 收尾调用 | C17,C18 | 单测：各 kind 归类正确、含截断工具产出 dropped 估算、kept/dropped 分开；bump minor |
| C20 | linnkit | ✅ component 进账本/telemetry：接 `createContextComponentLedgerEntry`，`context_build` 事件（C13）带 components + `ContextComponentTokenLedgerEntry` | C19 | 单测：账本条目/事件带 component 分项 |
| C21 | host | ✅ host 落地：`ObservationPreviewPort` 实现回传 `originalChars/previewChars`；telemetry adapter 消费 component（落 ledger / 透传给批 6 持久化）| C20 | host 测试：截断回传计量、adapter 收到 component |
| C22 | host | ✅ 端到端 + 文档：构造触发执行期截断的工具 → 断言 build component 带 `truncatedAtExecution` + `droppedTokensEstimate>0`；更新本计划说明两层截断的 token 衔接 | C21 | e2e 绿 + 文档同步 |

**“衔接真接上”硬标准（C22 必须断言）**：一次会触发执行期字符截断的工具调用，下一轮 build 的 `ContextTrace.tokenComponents` 里能找到该工具组件，且 `truncatedAtExecution===true`、`droppedTokensEstimate>0`、当前占用 token = preview 估算——证明“执行期省下的”和“build 期还占的”在同一 token 账本里对得上，而非两套孤立数字。

**边界**：分模块 = 本地估算口径，与计费用的 provider `actual` 是两套数（多数 provider 不给分项），trace/账本都标 `source` 以免混用；闸门单位不改（仍字符），本批只统一记账，不统一阈值单位（若日后要 token 闸门是另一批）。

---

## 6. 规划：批 6 · 用量账本持久化 + 报表后端（Phase G，仅目标+简案）

**目标**：把 token 用量（run/turn 级 canonical usage + cost +（批 5 后）component 分项）持久化为**可查询的时序数据**，提供按天/周/累计、峰值、连续天数等聚合，做“累计用量仪表盘”的**后端**。本批只做数据 + 后端，credits 映射作为查询层折算。

**现状缺口**：`runCostCollector` 是单 run 内存态；没有跨 run/会话/天的持久化与聚合（C9 只碰了 telemetry sqlite contract test）。

**简案**：
- linnkit：扩展**纯聚合函数**（按时间桶 / 按 route / 按 model 求和、峰值），保持账本条目为稳定可持久化 DTO（`TokenLedgerEntry` 已是 contract）；框架**不持有存储**。
- host：新增 usage 持久化表（复用 telemetry sqlite 基础）；在 telemetry sink / `runCostCollector` 落库 canonical usage + cost +（批 5）component；查询层做 daily/weekly/cumulative + peak + streak + credits 折算（`rate × token/cost`）。
- 边界：credits / streak / 最长任务等是 host 报表逻辑，**不进 linnkit**；linnkit 只提供 usage/cost 事实与纯聚合函数。

**粗 commit（真做时再细化）**：
- G1 linnkit：时间桶 / 多维纯聚合函数 + 稳定可持久化 DTO。
- G2 host：usage 持久化表 + 写入（telemetry sink 落库）。
- G3 host：报表查询后端（daily/weekly/total、peak、streak、credits 折算）。

**依赖**：component 维度依赖批 5；usage/cost 维度不依赖批 5，可先做。

---

## 7. 批 7 · 内部 LLM 调用 usage 纳入账本（Phase H，已落地）

> **状态**：✅ 已落地（C23–C27）。最终方案采用"usage 沿 ProviderResult/context build result sidecar 冒泡，由 `buildContextStage` 发 `phase:'context-internal'` 的标准 `llm_call` telemetry"；摘要 cost 计入触发它的主 run，calibration 默认排除内部调用样本。
>
> **一句话**：context pipeline **内部**触发的 LLM 调用（当前是历史摘要 `history_compression`，未来可能有更多内部 LLM 步骤）目前 usage 完全不进账本。本批给"内部 LLM 调用"补一条统一的 usage 上报通道，复用批 4 的 telemetry→collector 闭环，让其成本可计、可观测、归属正确。

**背景（缺口实锤，记录 0.22 实施前状态）**：当时摘要走 `SummarizationProvider`（context build 内）→ host generate hook → `llmCaller.call → callPlainCompletion → aiEngine.chatCompletion`。`aiEngine` 已返回 `canonicalUsage`，但在三处连续丢失。0.27 已把通用 generate hook 收窄并改名为 `generateSummary`，host 实现也改为 `createRegisteredSummaryGenerationFunction`；下列旧名称仅用于解释当时的缺口：

1. **契约层**：generate hook 的返回类型 `GenerateResponse`（`context-manager/shared/contracts/chatLineMessage.ts`）只有 `generatedText`，hook 取完文本即丢 usage。
2. **记账层**：非流式 `callPlainCompletion`（`runtime-kernel/llm/usage-telemetry.ts`）不调 `recordLlmCallTelemetry`。
3. **中间件层**：唯一发 `llm_call` telemetry 的 `llmTelemetryMiddleware` 只包裹主 LLM tick stage；摘要在 build 阶段直连 aiEngine，绕过它。

结果：摘要烧的 input/output token 不进任何 run 的 `RunCost`、不进 calibration 样本。查 run 成本时摘要那一刀隐形；批 4 校准也拿不到这次真实 usage。注意 `buildContextStage` 现有的 `context_build.tokenEstimate` 是"压缩后 context 的本地估算"，与"摘要调用的 provider 实际用量"是两套数，不能互替。

**设计方向（推荐：usage 沿 ProviderResult 冒泡，由 buildContextStage 发事件）**：

- **不把摘要做成独立 run**（会自我触发摘要 → 递归，且语义不对，见 `14-governance-and-cleanup-plan.md` A2 的递归隔离复核）。摘要是 context build 管线内的原子步骤，正确做法是给它一条 usage 上报通道，而非升格为 run。
- usage 从 host generate hook 产出，沿 `ProviderResult` / summary event **冒泡回 `buildContextStage`**（该 stage 持有 `ctx.telemetry` + `scope{conversationId,runId,parentRunId,turnId}`），由它发一条标准 `llm_call` telemetry 事件，自然接入既有 `SqliteTelemetryAdapter → runCostCollector / calibration collector` 扇出（批 4 闭环）。这样 scope 天然正确、归属触发摘要的主 run，且**无需给 contextBuilder 额外注入 telemetry port**。
- 事件需带"阶段 / 用途"标记（如 `phase:'context-internal'` 或 `purpose:'summarization'`），与主调用区分——这关系到 calibration 样本纯度（摘要 route 同主调用但语义不同，默认不混入校准样本）。

**已定口径（落地后确认）**：

1. `canonicalUsage` 只走 `ProviderResult.internalLlmCalls` / `contextBuildResult.internalLlmCalls` sidecar，**不进入 RuntimeEvent / 模型上下文**；sidecar DTO 统一为 contracts 层 `InternalLlmCallUsage`，供 context-manager 与 runtime-kernel 共享，避免跨层重复定义。
2. `llm_call` telemetry 新增 `phase?: 'main' | 'context-internal'` 与 `purpose?: string`；内部摘要 usage 计入触发它的主 run `own`。
3. calibration 默认**排除** `phase:'context-internal'` 的内部调用样本，保主调用样本纯度。
4. 缺价 cost 规则不变（任一 actual 缺价 → 整 run cost unknown）。

**顺带清理（同批做掉）**：删除孤儿 `src/shared/utils/llmTelemetryContext.ts`——它是旧 OpenAI 三字段版，已被 linnkit canonical 版 `packages/linnkit/src/shared/llmTelemetryContext.ts`（含 `CanonicalLlmUsage` / cache·reasoning 拆分）取代。统一到 linnkit 版，消除重复实现与“改一份漏另一份”的风险。

| # | 层 | 内容 | 依赖 | 验证 |
|---|---|---|---|---|
| C23 | linnkit | ✅ `GenerateResponse` 加 `canonicalUsage?: CanonicalLlmUsage`；`AISummaryGenerator` 取 `response.canonicalUsage`，经 `ProviderResult` / context build result 带出摘要 usage（不丢）；后续审计将 `InternalLlmCallUsage` 上移到 contracts 作为单一事实源 | C1,C7 | `SummarizationProvider.test.ts` 覆盖 hook 返回 usage 时 provider sidecar 携带 canonical usage；contracts schema 测试覆盖 sidecar DTO；bump minor 至 0.22/0.23 |
| C24 | linnkit | ✅ `buildContextStage` 从 `contextBuildResult` 取内部调用 usage，用 `ctx.telemetry` 发标准 `llm_call` 事件（带 `scope{runId,turnId}` + `phase:'context-internal'` + `purpose`），与主调用区分 | C13,C23 | `buildContextStage.test.ts` 覆盖内部 usage 发出带 scope/标记的 `llm_call` 事件 |
| C25 | host | ✅ `runCostCollector` 消费该事件，把摘要 usage 计入对应 run 聚合；calibration 默认排除内部调用样本 | C24,C9,C14 | `runCostCollector.test.ts` / `tokenCalibrationCollector.test.ts` 覆盖摘要 usage 进 RunCost、归属 runId 正确、不污染 calibration |
| C26 | host | ✅ 删孤儿 `src/shared/utils/llmTelemetryContext.ts`，统一到 linnkit canonical 版 | — | 全仓无残留 import；typecheck / 测试绿 |
| C27 | host | ✅ 硬标准回归：有内部摘要调用的 run 比无摘要同构 run 多出摘要 input/output；telemetry 阶段/scope 由 C24 覆盖 | C25 | `runCostCollector.test.ts` 差值断言 + `buildContextStage.test.ts` telemetry scope/phase 断言 |

**"缺口真补上"硬标准（C27 必须断言）**：一次触发历史摘要的 run，其 `RunCost.tokenUsage` 比"无摘要同构 run"**多出摘要那次调用的 input/output token**，且 telemetry 里能定位到一条 `runId` 正确、带阶段标记的 `llm_call` 事件——证明内部 LLM 调用的成本进了同一账本、归属同一 run，而非隐形。

**边界**：

- 只补 usage 上报通道，**不改摘要的执行形态**（当前仍是 build 内 summary port 直连，不递归、不升格 run）。
- 通道对"所有 context pipeline 内部 LLM 调用"泛化，不为摘要写一次性特例。
- 内部调用 usage 入成本账本与是否入 calibration 样本是两件事，后者默认保守排除，避免污染批 4 校准。

---

## 8. 后置：多模态图片 token（Phase E）

> **状态：已转入独立提案**。多模态不是 token ledger 的子功能，而是消息、资源、Context Manager、模型能力、fallback、工具、provider、UI 和历史恢复的全链路升级。权威设计见 [`18-multimodal-context-lifecycle-proposal.md`](./18-multimodal-context-lifecycle-proposal.md)。

本计划继续拥有 token accounting 机制：图片 token 必须 route-aware，本地只能估算；provider 没返回图片分项时保持 unknown，不用总量差值硬猜。图片资源引用、输入要求和生命周期合同由 18 号提案定义。

---

## 9. 风险与取舍（存量 / 仍需关注）

| 风险 | 处理 |
|---|---|
| 回灌变玄学（系数无来源、不可审计） | 只用 actual、按 route、上下限钳制、ContextTrace 可见、默认 opt-in（批 4） |
| 分模块估算与 provider actual 不一致被混用 | component=本地估算口径，与计费 actual 分开，均标 `source`（批 5） |
| 持久化体积 / 性能 | 账本可按 audit/debug level 控制粒度；时序表按桶聚合而非逐条全留（批 6） |
| tiktoken 运行时是否真加载 | 默认 tokenizer 能用 tiktoken 就精算、否则退 `avgCharsPerToken`；**需实测 Electron 运行时是否在走字符兜底**，否则校准价值被低估 |
| 全盲 provider（永不返 usage 且无 remote count） | 只能裸本地估算且无法校准；优雅但不自纠，文档明确 |
| 估算被误当真实 / cost 被默认 0 | `source`+`confidence` 必填；缺价 cost unknown（已落地） |

---

## 10. 与现有文档的关系

- `12-tokenizer-port-plan.md`：历史档案（host 如何替换预算 tokenizer）。
- `context-engineering.md`：后续补 component breakdown、账本、真实 usage 回灌闭环；并修漂移（`ContextTrace` 实际类型在 `context-manager` 而非 `contracts`）。
- `llm-provider.md`：后续补“family normalization 在 host adapter、框架只留 OpenAI-compat 默认”与 route-aware count 责任。
- `telemetry.md`：后续补 canonical usage / cost breakdown 事件；修漂移（`scope.traceId` 当前不存在）。

---

## 11. 执行指南

### 11.1 约定

- 每个 commit 只做一件事、自带验证；合同未落地前不写依赖它的 host 代码。顺序铁律：**先 linnkit 合同，后 host 适配**。
- linnkit 是 `0.x`：任何新增 export / 改签名 → **bump minor**（非 patch）+ 更新 `CHANGELOG.md`。
- 放置纪律见 §3 末。

### 11.2 验证命令

| 目标 | 命令 |
|---|---|
| linnkit 类型检查 | `cd packages/linnkit && npm run typecheck` |
| linnkit 单测 / 不变量 | `npx vitest run packages/linnkit/src` |
| linnkit 打包冒烟 | `cd packages/linnkit && npm run build` |
| host 测试 | `node scripts/test-runner/run-vitest-with-electron.cjs run <路径>` |
| 全量（合并主干前） | `node scripts/test-runner/run-vitest-with-electron.cjs run` |

### 11.3 已完成 commit 记录（批 1–5、批 7）

| # | 层 | 内容 |
|---|---|---|
| C1 | linnkit | `CanonicalLlmUsage`/`TokenRoute`/`TokenCountSource`/`TokenCountConfidence` 合同 |
| C2 | linnkit | telemetry usage canonical 化 + 估算改走 `TokenizerPort` |
| C3 | host | 修 Claude 转换丢 usage |
| C4 | linnkit | `AiEngine` 接 `canonicalUsage` + 可选 `UsageNormalizer` + OpenAI-compat 默认补 cache 拆分 |
| C5 | host | 各 adapter 产出 `CanonicalLlmUsage`（family normalizer） |
| C6 | host | route 显式建模 + 价格字段（解析为有效单价） |
| C7 | linnkit | token ledger + run 聚合 + component 合同 + ContextTrace 扩展 |
| C8 | linnkit | `computeCost` + `CostBreakdown`/`TokenPricing` |
| C9 | host | `RunCostCollector` 聚合 + 填 cost（缺价 unknown）+ `RunCost` 收口 |
| C10 | linnkit | 校准机制（opt-in）接入 `estimateTokens` + ContextTrace 校准 trace |
| C11 | linnkit | `TokenCounterPort` 协议 + route-aware remote count hook |
| C12 | host | `app-hosts/linnya/adapters/token-accounting`：`LinnyaTokenCounter`（Anthropic/Gemini/Z.AI）+ 装配 |
| C13 | linnkit | 暴露构建期估算（`ContextBuildTokenEstimate` + `context_build` telemetry 事件）；`minCoefficient` 下限；导出合并函数 |
| C14 | host | `LinnyaTokenCalibrationCollector`：telemetry 驱动按 turn/route 配对样本、环形存储 |
| C15 | host | 接上闭环：telemetry 扇出馈送 collector + `resolveTokenCalibration` 取样本；singleton 装配 |
| C16 | host | 端到端验证（同输入关/开校准截断结果不同）+ 默认 policy 打开校准（`minSamples:3`/`minCoefficient:1`） |
| C17 | linnkit | 执行期 observation 截断字符/行计量 + `tool_output.metadata.observationTruncation` |
| C18 | linnkit | `ContextTokenComponent` 增加执行期截断估算字段 |
| C19 | linnkit | final states 产出 context token components + `ContextTrace.tokenComponents` |
| C20 | linnkit | `context_build` telemetry 携带 component 与 context-component ledger entry |
| C21 | host | ObservationPreviewPort 回传计量；telemetry/run cost collector 消费 component ledger |
| C22 | host | 端到端断言执行期截断工具在下一轮 build/账本里对齐 + 文档同步 |
| C23 | linnkit | `GenerateResponse.canonicalUsage` + internal LLM usage sidecar，摘要 provider 不再丢 usage |
| C24 | linnkit | `buildContextStage` 为 context-internal usage 发标准 `llm_call` telemetry，带 scope / phase / purpose |
| C25 | host | `RunCostCollector` 计入内部摘要 usage；`TokenCalibrationCollector` 默认排除内部调用样本 |
| C26 | host | 删除旧 `src/shared/utils/llmTelemetryContext.ts`，benchmark 文档统一引用 linnkit canonical 版 |
| C27 | host | 回归断言有摘要 run 比无摘要同构 run 多出摘要 token，且 telemetry scope/phase 可定位 |
| C23a | linnkit | 审计修正：`InternalLlmCallUsage` 上移到 contracts，context-manager / runtime-kernel / host adapter 统一 import，移除重复内联定义 |

> 批 6 见 §6。批 5 后验证：linnkit `100 files / 589 tests`、host C21 相关 `28 tests`、typecheck（v0.21.0）全绿。批 7 验证见 §7 表格与本批提交记录。

### 11.4 合并主干前收尾

- 全量测试绿；`CHANGELOG.md` 记录所有公开 API 变更与对应 minor bump。
- 同步 §10 列出的文档与两处漂移修正。
- 本计划文档作为主干基线。
