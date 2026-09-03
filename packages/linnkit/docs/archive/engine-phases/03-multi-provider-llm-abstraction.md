# 03 · Multi-provider LLM 抽象升级

> **状态**：✅ 决策定稿（Road Y）；**§7.1 T1 / T3 实质上已等价完成**（命名为 `AgentAiEngine` 而非 `LlmProviderPort`），T2 / T4 / T5 / T6 待按需推进  
> **日期**：2026-04-21（§6 全 6 题逐项定稿）；2026-04-22（§7.1 落地状态对齐）  
> **触发**：用户在 audit 反馈中明确："multi-provider 确实未来需要升级抽取到 agent 里。因为每一个都需要配置 api 啥的"  
> **前置**：
> - `[00-engine-scope-audit.md` §4.1](./00-engine-scope-audit.md) Q1-Q4 边界判定
> - `[00-engine-scope-audit.md` §1.4](./00-engine-scope-audit.md) "engine 留接口、不做工具、信息丰富"原则——本 topic 是该原则的**典型样板**：engine 留 `AgentAiEngine` (≡ `LlmProviderPort`) 注入契约，不内置任何 provider 实现 / UI / 模型选择策略

> ## ⚡ 实施进度更新（2026-04-22 复盘）
>
> 复盘 `src/agent/runtime-kernel/llm/caller.ts` + `src/agent/ports/ai-engine.ts` 后发现：方案 A 的核心目标（**反向依赖解耦**）**事实上已经完成**，只是命名与本文档原稿（`LlmProviderPort` / `LlmProviderFactoryLike`）不一致——实现使用了 `AgentAiEngine` 作为契约名。
>
> **证据**：
>
> | 任务 | 状态 | 证据 |
> |------|------|------|
> | T1 定义 port 接口 | ✅ 等价完成 | [`src/agent/ports/ai-engine.ts`](../../../../../src/agent/ports/ai-engine.ts) 定义 `AgentAiEngine`，含 `chatCompletion` + `chatCompletionStream`（即本文档 §4 方案 A.1 的两方法形态） |
> | T2 定义 Factory 注入契约 | ⚠️ 部分等价 | 当前 `LlmCaller` 直接注入 `aiEngine: AgentAiEngine` 单实例（非 `getProvider(modelId)` factory 形态）；§6 Q6 决策的"per modelId 实例"粒度未单独抽 factory，host 端通过单一 engine 内部 `createAdapter(modelId, ...)` 实现 per-modelId 路由。是否值得抽出独立 factory 留作 §7.1 T4 评估 |
> | T3 LlmCaller 移除对 infra 的反向 import | ✅ 完成 | `grep "from .*infra/adapters/llm" src/agent/` = **0 命中**；`caller.ts:38` 已经走 `aiEngine: AgentAiEngine` 注入 |
> | T4 LinnyaLlmProviderFactory（host wrapper） | ✅ 等价完成 | `src/core/aiEngine.ts` (`AIEngineImpl`) 即为 host 实现，内部调 `createAdapter(provider, config)`，由 `graphRuntimeFactory.ts` 装配时注入 |
> | T5 装配点注入 | ✅ 完成 | `src/app-hosts/linnya/adapters/runtime-assembly/graphRuntimeFactory.ts` 实例化 `LlmCaller({ aiEngine: defaultAiEngine })` |
> | T6 linnsec stub 验证 | ⏸ 待 linnsec scaffold 时验证 | 不阻塞当前抽包 |
>
> **命名对齐结论**：保留 `AgentAiEngine` 为正式名（D-1 已经决定），不再另起 `LlmProviderPort`；本文档下文出现 `LlmProviderPort` / `LlmProviderFactoryLike` 处请等价理解为 `AgentAiEngine`。命名层面的统一行动是单点改名（不阻塞抽包），可与 D-2 / D-3 同期推进。
>
> **§7.1 剩余真活**（命名 / 装配 / 拆分层面）：
>
> - T2-followup：是否值得把 `getProvider(modelId)` 单独抽 factory 形态（vs 当前 `engine.createAdapter(modelId)` 内嵌路由）—— 推迟到 Phase E 之后再评估
> - 本文档 §3 "host 端 `src/core/aiEngine.ts` 仍混合 chat + embed/rerank/transcribe/textToImage" 的物理拆分（与 §6 Q1 的 "embed/rerank 不入 engine" 决策一致，拆分目的是让 host 端 chat 子集干净；不阻塞抽包）—— 推迟到 D-3 接入指南时一并梳理
> - T6：linnsec scaffold 时验证

---

## 0. Q1-Q4 边界判定（先过门槛）

按 `00-engine-scope-audit.md` §1.1 流程：


| 维度                    | 判断    | 证据                                                                                                                                            |
| --------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Q1 协议还是实现？**        | ✅ 协议  | Provider 接口形状 / streaming 事件归一化 / tool schema 翻译 / capability metadata 都属协议；具体 GPT/Gemini/Claude/Ollama 实现属产品层（已在 `src/infra/adapters/llm/`）  |
| **Q2 ≥2 消费者真实需求？**    | ✅ 强需求 | **linnya 桌面**：用户已有"配 OpenAI/Anthropic/Gemini/OpenRouter/Kimi/本地 Ollama" 的诉求；**linnsec 秘书**：多 IM 场景下不同任务用不同模型（cron 摘要用便宜模型、用户对话用强模型、长文用大上下文模型） |
| **Q3 engine 不加就没法接？** | ✅ 是   | LLM 调用在 graph node 主链路（`runtime-kernel/llm/caller.ts` + `runtime-kernel/llm/streaming/`*）；产品层无法 wrap，必须 engine 提供协议                           |
| **Q4 不破坏 Linnya？**    | ✅ 是   | `runtime-kernel/llm/`* + `infra/adapters/llm/*` 已有骨架，本 topic 以"泛化 + 收口"为主，不做颠覆性重构                                                             |


**结论**：**通过 4 条门槛，确认进入 engine 升级范围**。

---

## 1. 问题与场景

### 1.1 用户场景

#### S1：Linnya 桌面新增一个 OpenRouter 上的 Claude 模型

当前体验：用户从设置面板加一条 model 配置（provider / api_base / api_key / model_name），保存后能在 chat 下拉选到。**已经能用**——但下面是它隐藏的工程负担：

- `AdapterFactory` 用启发式判断（包含 `gemini` / `gpt-5` / `paddleocr` / `kimi` 字符串）选择 adapter
- 新增一个 provider 系列模型（如 Mistral / DeepSeek / Qwen 系列），如果它的 quirk 不命中现有启发式，会落到 `OpenAIAdapter` 通用兼容路径——多数能跑
- 但**有 quirk 的模型**（OpenRouter+Gemini 的 `thought_signature` 必须原样回传 / Moonshot Kimi 的 XML tool call / OpenRouter location 头），需要新增 policy 文件，**这套已经做得不错**（policy 收敛在 `runtime-kernel/llm/policies/`*）

#### S2：linnsec daemon 给 cron 任务选模型

需求：`cron("0 7 * * *", "总结昨晚 12 个 IM 群消息")` 这种任务希望用便宜的模型（比如 GPT-4.1-mini / Gemini Flash），而不是用户当前主对话的强模型。

当前缺口：

- 没有"按 capability + cost + latency 选模型"的 engine 协议
- linnya 的 `ModelResolver` 只有"主对话默认模型 / fallback 模型"两档
- linnsec 不能依赖 linnya 的 `model-registry` 配置（两个产品独立部署，配置可能完全不同）

#### S3：用户切换 provider key（轮换 / 失效 / 限流）

需求：

- key 轮换：用户更新了 OpenAI key，希望 engine 立刻用新 key 而不必重启
- 限流降级：`cloud_quota_fallback_model_id` 已经处理了"同 run 内云端限额"，但产品层希望声明更通用的 fallback 链
- 临时 disable：某个 provider 暂时关掉，engine 不再选它

当前缺口：engine 层没有 "Provider 配置变更事件" 的 port——配置在 host 改完，engine 内 caller 是否实时生效依赖具体注入实现。

### 1.2 不解决什么

- **不解决**：具体 provider 的 line protocol 实现（GPT/Gemini/Claude/Ollama 的 chunk parsing 等）——这些是 host-infra 范畴
- **不解决**：UI 层"模型管理面板"——这是 linnya/linnsec 各自的产品决策
- **不解决**：API key 加密落盘 / keyring 集成——产品层
- **不解决**：用户级别的 cost tracking / billing——产品层
- **不解决**：Embedding / Rerank / OCR / Transcribe 等非 chat 能力的协议化——这些不在 engine 协议范围内（用户已确认"engine 是 agent 框架，只关心 chat"），保留在产品层 host adapter 内即可
- **不解决**：linnsec agent 自身的"模型自换"能力——linnsec 的硬约束是"用户可以配模型，但 agent 不能通过工具改自己驱动的模型"（见 `[../secretary/README.md` §2](../secretary/README.md)）。本 topic 只暴露"按需求挑模型"的协议给 host，host 怎么用是产品决策
- **不解决**：跨 provider 适配器的独立 npm 包（"Y+"路线）——本 topic 走"路 Y"（engine 出接口、host 实现），adapter 仍留在 `src/infra/adapters/llm/`；将来如果两个产品都需要打成可分发的 adapter 包，**先评估直接采用 LiteLLM / Vercel AI SDK / OpenAI Agents SDK 等成熟开源方案**，而非自己重造

---

## 2. 当前 Linnya 现状

### 2.1 模块分布

LLM 相关代码当前分散在两处：

```
src/agent/runtime-kernel/llm/        ← engine 内（"LLM 调用层"）
├── caller.ts                          # LlmCaller 核心调用器
├── caller.types.ts                    # 对外类型（ToolCall / ToolCallChunk / LlmCallOptions ...）
├── modelResolver.ts                   # ModelResolver（解析默认 / fallback）
├── modelCatalog.ts                    # ModelCatalogLike 协议 + empty 实现
├── policies/                          # ✅ 通用策略引擎层（不内置厂商策略）
│   └── policyEngine.ts / defaultPolicyEngine.ts / types.ts
├── streaming/                         # 流式聚合
│   ├── toolCallStreamAccumulator.ts
│   ├── thoughtStreamSegmenter.ts
│   └── markdownHeadingNormalizer.ts
├── toolCallUtils.ts
├── index.ts
└── README.md                          # ✅ 已有 Adapter vs Policy 双层职责说明

src/infra/adapters/llm/              ← engine 外（"LLM line protocol 适配层"）
├── adapter-factory.ts                 # AdapterFactory.create(provider, config)
├── types.ts                           # BaseLLMAdapter / ProviderAdapter / ChatMessage / ...
├── clients/llm-http-client.ts         # HTTP 层（fetch + SSE）
├── gpt.ts / gemini.ts / claude.ts / openrouter.ts / ollama.ts
├── anthropic-compat.ts / claude-converters.ts
├── smart-tool-adapter.ts              # XML tool call 兼容（Kimi 等）
├── paddleocr.ts                       # PaddleOCR-VL
└── mock/mock-llm.ts
```

### 2.2 现有协议形态

#### 2.2.1 Engine 内的协议

`LlmCaller` 接口（`caller.ts`）：

- `call(modelId, messages, options)` 非流式
- `callStream(modelId, messages, options, eventHandler, signal)` 流式
- `callWithRetries(modelId, messages, options, eventHandler)` 带智能重试

`ModelResolverLike` 接口：

- `resolveModelId(requestedModelId?)` → 解析为具体 modelId（默认 chat 模型）
- `pickFallbackChatModel(excluded)` → 选 fallback chat 模型

`ModelCatalogLike` 接口（最小元数据查询协议）：

- `getModelById(id)` / `getModelsByCapability(cap)` / `getModelsByUIVisibility(visibility)`
- 真实实现注入：当前 Linnya 的实现在 `src/app-hosts/linnya/adapters/runtime-assembly/modelCatalog.ts`

`PolicyEngine` 接口：

- `applyBeforeRequest({modelId, apiBase, requestModelName, endpoint, requestData, headers})` → 修补请求
- `applyAfterResponse({...})` → 修补响应

#### 2.2.2 Engine 外的协议

`BaseLLMAdapter` 接口（`infra/adapters/llm/types.ts:124-186`）：

- `setModelConfig(config)`
- `chatCompletion(messages, params)` 非流式
- `chatCompletionStream(messages, params, onContent, onError)` 流式
- `embedDocuments(texts, params)` / `embedQuery(query, params)`
- `rerank(query, documents, params)` / `transcribe(audio, ...)`

`AdapterFactory.create(provider, config)`（`adapter-factory.ts:232-334`）：

- 启发式：包含字符串 / api_base 模式 → 选 adapter
- 已经走"集成注册表" `resolveLLMAdapter`，可被 host 扩展

### 2.3 现状评估（结合 §0 Q1-Q4 维度）


| 现状                                                                                                      | 评估                                                                 |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Engine 内 `LlmCaller` + `ModelResolver` + `ModelCatalogLike` 已成型                                         | ✅ 协议骨架在                                                            |
| Policy 层已收敛（`runtime-kernel/llm/policies/*`）                                                            | ✅ 协议而非实现                                                           |
| Streaming aggregator 已收敛（`runtime-kernel/llm/streaming/*`）                                              | ✅ 协议层                                                              |
| Tool call schema：当前以 OpenAI tool_calls 兼容形态为内部边界（`caller.types.ts` 注释 §80-82）                           | ⚠️ Tool schema 翻译未协议化（Anthropic / Gemini 形态在 adapter 内手工转）         |
| `BaseLLMAdapter` 接口在 `infra/`（engine 外）                                                                 | ⚠️ 这是不是要提到 engine？需要权衡                                             |
| `AdapterFactory` 用字符串启发式选 adapter                                                                       | ⚠️ 不是协议问题但有可读性问题                                                   |
| Capability metadata（context window / supports tools / supports streaming / supports cache / multimodal） | ❌ `ModelCatalogLike` 当前只有 capability 标签集，没有结构化 capability metadata |
| Provider 配置变更事件（key 轮换 / 启停）                                                                            | ❌ 无 engine 协议                                                      |
| 不同 capability tier 的"按需选模型"（cost / latency / context window）                                            | ❌ 无 engine 协议（只有 default / fallback 两档）                            |
| Tool schema 翻译（OpenAI tools ↔ Anthropic tools ↔ Gemini function calling）                                | ⚠️ 当前在每个 adapter 内分别处理，未抽象为协议                                      |
| 流式事件归一化（reasoning_details / thought_signature / tool_call delta）                                        | ⚠️ 各 adapter 内处理 + caller 内处理，归一化口径不完全一致                           |


**总结**：现状骨架已经远超"零 multi-provider 抽象"的状态——但**协议密度不够 + 部分跨 adapter 的口径不统一 + capability metadata 缺失 + 配置面变更协议缺失**。

---

## 3. 各参考项目做法（重点摘要，详见 `99-research-notes/`）

### 3.1 OpenClaw

无明显多 provider 工程化（其 LLM 调用更多走 hosted endpoint）。**不作正面参考**。

### 3.2 Codex

参考价值：⭐⭐⭐

- `client_common` crate（Rust）：把所有 provider 共有的"chat / stream / tool / cache"抽象在一处
- 支持 OpenAI Responses API + Chat Completions API + Anthropic Messages 多种端点形态，由 `model_family` 和 `wire_api` 描述
- `ModelFamily` + `ModelInfo`：声明 context window / 是否支持 reasoning / 是否支持 cache / 是否支持工具 / output token cap 等结构化 metadata
- ZDR (Zero Data Retention) 等组织级开关也在 ModelInfo metadata 里声明
- 关键设计：**"我能给你什么"放在 model metadata；"调用怎么发"放在 wire adapter；"调用怎么编排"放在 caller**——三层分明
- 详见 `[../99-research-notes/codex.md](../99-research-notes/codex.md)`

### 3.3 Claude Code

参考价值：⭐⭐

- 主路径专注 Anthropic Messages API（自家产品，model 收敛性高）
- 但仍支持 Bedrock / Vertex 部署，靠 hosting metadata + URL 模板 + auth 方式区分
- `normalizeMessagesForAPI`：连续 assistant 合并 / content + tool_calls 合并——Linnya 的 `mergeConsecutiveMessages` 实际就是抄这个的（adapter-factory.ts:65 已有注释致敬）
- 工具 schema：Anthropic 原生 `tool_use` block 形态，没做跨 provider 翻译（不需要）
- 详见 `[../99-research-notes/claude-code.md](../99-research-notes/claude-code.md)`

### 3.4 Hermes Agent

参考价值：⭐⭐⭐

- Python 实现，通过 LiteLLM 间接覆盖 10+ 家 provider（OpenAI / Anthropic / Google / Cohere / Mistral / Groq / Together / OpenRouter / Bedrock / Vertex / 本地 vLLM 等）
- 但 LiteLLM 是个**反例**：把所有差异塞进一个巨型库，在自家代码里再绕回 OpenAI 兼容形态——增加了一层"别人的 normalization"，调试难度高
- Hermes 自家则在 `model_clients/` 下做了一层 wrapper，对 LiteLLM 的输出做二次归一化
- **真正值得参考的**：
  - **配置层**：`HERMES_HOME` profile 隔离 → 不同实例独立的 model 配置（多 instance 友好）
  - **AGENTS.md 模型偏好声明**：Skill / Cron 可以在 frontmatter 里声明"我希望用什么级别的模型"（不绑定具体 modelId，绑定能力等级）
  - **Tool schema 触发 prompt cache**：通过把 SKILL 内容注入 user message 而非 system prompt，把 prompt cache 命中条件协议化
- 详见 `[../99-research-notes/hermes.md](../99-research-notes/hermes.md)`

### 3.5 启发摘要（按本 topic 范围）


| 启发点                                               | 来源     | 是否进入 engine                                            |
| ------------------------------------------------- | ------ | ------------------------------------------------------ |
| `ModelInfo`/`ModelFamily` 结构化 capability metadata | Codex  | ✅ engine                                               |
| wire adapter / caller / model metadata 三层分明       | Codex  | ✅ engine（已部分对齐，需深化）                                    |
| 连续同角色消息合并归一化                                      | CC     | ✅ engine（当前在 adapter 层，可上提到 engine 边界）                 |
| LiteLLM 巨型库反例                                     | Hermes | ⚠️ 反面警示——不要为了"支持 10+ provider"引入一层不可控的 normalization 库 |
| Profile/instance 隔离                               | Hermes | ❌ 产品层（host 装配）                                         |
| Skill/Cron 模型偏好声明                                 | Hermes | ❌ 产品层（与 InstructionsLoader 一起归 secretary/07）           |


---

## 4. 候选方案

> **路线先收敛**：在讨论细方案前，先回答"engine 和 adapter 的物理边界放在哪"。
>
>
> | 路线                  | engine 包包含                                                                | host 包（linnya/linnsec）包含                                               | 评价                                                                                                      |
> | ------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
> | **路 X**             | `LlmCaller` + `AdapterFactory` + 全部具体 adapter（gpt/gemini/claude/ollama …） | 几乎啥都不要做                                                                | engine 包变臃肿，把 GPT/Gemini/Claude 等供应商更新都拽进 engine 版本节奏；Embedding / Rerank / Transcribe 等非 chat 能力被迫一起拖进来 |
> | **✅ 路 Y（拍板）**       | `LlmCaller` + 协议接口 `LlmProviderPort`                                      | `AdapterFactory` + 全部具体 adapter，并实现 `LlmProviderPort`，在装配时注入给 engine   | engine 内核保持 lean、无第三方 SDK 依赖；adapter 跟 host 一起迭代；linnsec 可以选择"复用 linnya 同一套 adapter"或"自带极简 adapter"     |
> | 路 Z                 | 路 Y + engine 自带一个最小 OpenAI 兼容 fallback adapter                            | host 仍可注入                                                              | 多一个"兜底"，但风险是 fallback 跟 host 真实 adapter 行为不一致，反而增加测试矩阵                                                  |
> | **路 Y+（未来选项，本期不做）** | 同路 Y                                                                      | adapter 抽成独立 package（`@linn/llm-adapters`），可被 linnya / linnsec / 第三方共用 | 真要做时**先评估直接采用 LiteLLM / Vercel AI SDK / OpenAI Agents SDK 等成熟开源**，而非自己重造一份"统一各家 API"的轮子                 |
>
>
> **拍板：走路 Y**。理由：engine 内聚（只管 graph + caller + 协议）、对 host 解耦（adapter 跟随 host 迭代）、与 Linnya 现有 `ModelCatalogLike` 注入风格完全一致、linnsec 接入只需写一个能 `chatCompletion` / `chatCompletionStream` 的 adapter（甚至可以直接复用 linnya 的 `AdapterFactory`）。

下面三个方案都在路 Y 内部，按"做多少"分级。

### 方案 A（必做底线）：**LlmProviderPort 最小协议 + 反向依赖解耦**

**做什么**：

1. 在 `runtime-kernel/llm/provider/types.ts` 定义 `LlmProviderPort` 接口，**只含两个方法**（用户已确认 §6 Q1：B）：
  ```ts
   interface LlmProviderPort {
     chatCompletion(messages, params): Promise<LlmResponseContent>;
     chatCompletionStream(messages, params, onChunk, onError, signal?): Promise<void>;
   }
  ```
2. 在 `runtime-kernel/llm/provider/factory.ts` 定义 `LlmProviderFactoryLike`（注入契约）：
  ```ts
   interface LlmProviderFactoryLike {
     getProvider(modelId: string): Promise<LlmProviderPort>;
   }
  ```
   形状对齐现有 `ModelCatalogLike` 注入模式（`runtime-kernel/llm/modelCatalog.ts`）。
3. `LlmCaller` 构造函数新增依赖 `LlmProviderFactoryLike`，**移除对 `src/infra/adapters/llm/`* 的所有 import**（消除 engine → infra 的反向依赖）。
4. host 侧（当前是 `src/app-hosts/linnya/adapters/runtime-assembly/`*）写一个 `LinnyaLlmProviderFactory`，内部 wrap 现有 `AdapterFactory.create(provider, config)`，把返回的 adapter 适配成 `LlmProviderPort`（adapter 已有 `chatCompletion` / `chatCompletionStream` 方法，wrap 是平移，**不需要改 adapter**）。
5. **不动**：streaming 聚合（`runtime-kernel/llm/streaming/`*）/ policy 层（`runtime-kernel/llm/policies/*`）/ ModelResolver / ModelCatalog（这些已经在 engine，无需迁移）。

**为什么是底线**：

- 这是路 Y 的最小可行实现；不做这一步，engine 永远没法独立成 package
- 解决 §1 S1 真实痛点（"engine 不知道自己在用谁的 adapter"，存在 `engine → infra` 反向 import 是当前架构债）
- 1-2 个 PR 工作量

### 方案 B（中期增强）：**A + capability-aware model picker**

在 A 之上加（仅当 §1 S2 cron 选模型场景真出现时再做）：

1. 扩展 `ModelInfo` 结构化字段（`contextWindow / supportsTools / supportsStreaming / supportsPromptCache / supportsMultimodal / costTier`）——**沉淀到 `ModelCatalogLike.getModelInfo(id)` 协议**，linnya `model-registry` 已有部分 tag，做结构化迁移
2. `ModelResolver.pickModelByRequirements({minContextWindow?, requiresTools?, costTier?})` —— 用户已确认 §6 Q5：A（找不到直接抛错）
3. linnsec cron / linnya deep_search 子 agent 都可受益

### 方案 C（远期增强 / 暂不做）：**A + B + ToolSchemaTranslator + ProviderConfig 通知**

1. `ToolSchemaTranslator` 协议（OpenAI ↔ Anthropic ↔ Gemini）—— 用户已确认 §6 Q2：A（保持 OpenAI 内部基准），当前在 adapter 内分别转已经够用，**强信号出现前不动**
2. `ProviderConfigPort.onConfigChange` —— 用户已确认 §6 Q4：B（pull 模式即可），所以本项也**不做**（caller 每次问 catalog 拿最新配置即可）

→ §1 S3 key 轮换场景靠 pull 模式自然解决，不需要 push 协议。

### 砍掉的方案（原 C "整体迁入 engine"）

把 `BaseLLMAdapter` 整体迁入 engine 已被否决——用户已确认 §6 Q1：embed / rerank / transcribe **不是 engine 协议范畴**（"engine 是 agent 框架"）。这些能力留在 `src/infra/adapters/llm/types.ts` 的 `BaseLLMAdapter` 内即可，host 自己用。

---

## 5. 当前倾向

### 5.1 拍板小结

- **物理路线**：路 Y（engine 出接口 + host 注入）—— 用户已拍板
- **本期实施**：方案 A（LlmProviderPort 最小协议 + 反向依赖解耦）
- **方案 B 触发条件**：linnsec 第一阶段出现"cron 自动选便宜模型"的真实场景，或 linnya deep_search 子 agent 出现"按需求挑模型"的真实工程问题
- **方案 C / 路 Y+ 触发条件**：见 §5.3

### 5.2 实施分步（仅方案 A）


| Step | 内容                                                                              | 文件                                                                         | 风险               |
| ---- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------- |
| 1    | 定义 `LlmProviderPort` 接口 + 单元测试                                                  | `runtime-kernel/llm/provider/types.ts`（新建）                                 | 低（纯类型）           |
| 2    | 定义 `LlmProviderFactoryLike` 注入契约                                                | `runtime-kernel/llm/provider/factory.ts`（新建）                               | 低                |
| 3    | `LlmCaller` 构造函数加依赖 + 移除对 `infra/adapters/llm` 的反向 import                       | `runtime-kernel/llm/caller.ts`                                             | 中（核心调用路径，需要回归测试） |
| 4    | 写 `LinnyaLlmProviderFactory`（host 侧 adapter wrapper）                            | `src/app-hosts/linnya/adapters/runtime-assembly/llmProviderFactory.ts`（新建） | 低（纯包装）           |
| 5    | 装配点把 `LinnyaLlmProviderFactory` 注入给 `LlmCaller`                                 | `src/app-hosts/linnya/runtime-bootstrap.ts`（或现有装配处）                        | 低                |
| 6    | linnsec scaffold 时验证：写个 stub `LlmProviderPort`（直接调 OpenAI），跑通 hello-world graph | `secretary/<scaffold>`                                                     | 验证项              |


**Step 1-3 是 engine 内的事；Step 4-5 是 linnya host 内的事；Step 6 是 linnsec 接入验证**。整体在 Phase D 抽包之前完成。

### 5.3 Future note：路 Y+（adapter 独立 package）

**如果**将来出现以下任一信号，**回头评估**做路 Y+：

- linnya 和 linnsec 各自维护一份 adapter，发现重复率 ≥ 70%
- 出现第三个 engine 消费者（比如 CLI 工具 / VSCode 插件）也想用 adapter
- adapter 升级节奏需要独立于 host 发布

**评估时的硬约定**：**优先调研直接采用现成开源方案**，而非自己重写：

- [LiteLLM](https://github.com/BerriAI/litellm)：Python，但有完整能力矩阵参考
- [Vercel AI SDK](https://github.com/vercel/ai)：TS，社区成熟
- [OpenAI Agents SDK](https://github.com/openai/openai-agents-python) / [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-typescript)：官方
- 自有 `infra/adapters/llm/`*：现成代码

只有当成熟方案确实**不能覆盖 80% 场景**时，才考虑自建 `@linn/llm-adapters` 包。这条记入 Hermes 反例教训（见 §3.4：LiteLLM 巨型库带来的二次归一化负担也要权衡）。

---

## 6. 待决策问题（已逐项定稿）


| #      | 问题                                                            | 决策                                                                     | 理由                                                                                                                                                    |
| ------ | ------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1     | `BaseLLMAdapter` 中的 embed / rerank / transcribe 形态归不归 engine？ | **B：只 chat + chatStream 归 engine**                                     | 用户："Q1 肯定不管这些非聊天 AI 能力啊，engine 就是一个 agent 框架"                                                                                                         |
| Q2     | `ToolSpec` 统一形态以哪个 provider 为基准？                              | **A：OpenAI tools 为内部基准（保持现状）**                                         | 用户："Q2 对，保持现状即可"；当前 `caller.types.ts` 已经按 OpenAI 形态作为内部边界                                                                                             |
| ~~Q3~~ | ~~Capability metadata 枚举 vs 结构化~~                             | **撤掉**：当前没有这个工程问题                                                      | 用户："Q3 粗，但是我不确定这个问题为什么会提出了，现在我没遇到过这个问题"。capability tier 等到方案 B 真启动时再说                                                                                 |
| Q4     | Provider 配置变更协议是 push 还是 pull？                                | **B：pull（caller 每次问 catalog 拿最新 config）**                              | 用户："linnya 现在是有 adapter，我们有 model registry 模块"——`model-registry` 本身就支持热更新，`AdapterFactory.create(provider, config)` 每次 call 时拿最新 config 即可，无需 push 事件 |
| Q5     | `pickModelByRequirements` 选不到时的行为？                            | **A：抛错由调用方处理**                                                         | 用户：A；linnsec 不会让 agent 自换模型（"老板的秘书"定位），所以选不到就是配置问题，应当显式失败                                                                                             |
| Q6     | `LlmProviderPort` 是单实例（per provider）还是 per modelId？           | **B：per modelId 实例（与现状 `AdapterFactory.create(provider, config)` 一致）** | 用户："Q6，你还是参考我们的 linnya 的适配器模式吧"；现有 `AdapterFactory.create()` 就是 per modelId 创建 adapter，注入契约对齐这个粒度                                                     |


**关联硬约定**（在 `[../secretary/README.md` §2](../secretary/README.md) 落实）：linnsec 用户**可以**配置自己的模型（一个 url + api key 即可，类似 linnya 设置面板），但 linnsec **agent 自身不能**通过工具链改自己的驱动模型。本 topic 只暴露"按需求挑模型"的协议给 host，host 怎么用是产品决策。

---

## 7. 落地任务

### 7.1 方案 A 任务清单（本期落地）

> 见文档头部"实施进度更新（2026-04-22）"表：T1 / T3 / T4 / T5 已等价完成（命名为 `AgentAiEngine` 而非 `LlmProviderPort`）；T2 / T6 状态在下方表格逐项标注。

- [x] T1：定义 LLM provider 接口（**已完成**：`src/agent/ports/ai-engine.ts` 的 `AgentAiEngine` 即为本文设想的 `LlmProviderPort`）
- [~] T2：定义 `LlmProviderFactoryLike` 注入契约（**部分完成**：`LlmCaller` 走 `aiEngine: AgentAiEngine` 单实例注入，per-modelId 路由由 `AgentAiEngine` 内部完成；是否单独抽 `getProvider(modelId)` factory 推迟评估）
- [x] T3：`LlmCaller` 构造函数加依赖；移除对 infra 的反向 import（**已完成**：`grep "from .*infra/adapters/llm" src/agent/` = 0 命中）
- [x] T4：写 host 侧 LLM engine 实现（**已等价完成**：`src/core/aiEngine.ts` `AIEngineImpl` 即为 host 实现）
- [x] T5：装配点把 engine 注入 `LlmCaller`（**已完成**：`graphRuntimeFactory.ts`）
- [ ] T6：linnsec scaffold 时写一个 stub `AgentAiEngine` 实现，跑通 hello-world graph，验证抽包契约

### 7.2 方案 B 任务清单（触发后再启动，不列细任务）

仅占位：`ModelInfo` 结构化字段 / `getModelInfo(id)` 协议 / `pickModelByRequirements` 实现 / linnya `model-registry` 数据迁移。

### 7.3 方案 C / 路 Y+（远期，触发条件见 §5.3）

不列细任务。

---

## 8. 状态

- §0 边界判定通过 Q1-Q4
- §1 用户场景明确
- §2 现状盘点完成（结合实际代码 + 文件路径）
- §3 参考项目启发汇总
- §4 候选方案 + 物理路线（路 Y 拍板）
- §5 当前倾向（方案 A 本期实施 + B/C 触发条件 + Y+ future note）
- §6 6 个待决策问题已逐项定稿
- §7 方案 A 落地任务展开（T1-T6）
- ✅ §7.1 T1 / T3 / T4 / T5 等价完成（命名为 `AgentAiEngine`），T2 部分完成，T6 待 linnsec scaffold 时验证（详见文档头部"实施进度更新"段）
- ⏸ 命名层面是否把 `AgentAiEngine` 改名为 `LlmProviderPort`：D-1 阶段已决定 **保留 `AgentAiEngine`**；本文档下文的 `LlmProviderPort` 视为同义指代

**下一步**：本文档结案。剩余的"是否单独抽 `getProvider(modelId)` factory"、"是否物理拆分 `src/core/aiEngine.ts` 中的 chat 子集"两件事不阻塞抽包，推迟到 D-3 接入指南或 Phase E 之后再评估。

---

## 9. 这份文档作为方法论验证的反思

这是 audit 之后产出的第一份 topic 文档，用来验证 `[00-engine-scope-audit.md](./00-engine-scope-audit.md)` §1.1 流程的可操作性。验证结果：

- **§0 Q1-Q4 走起来很顺**：4 条门槛各自有明确证据，不需要硬凑
- **§1 用户场景帮助锚定 scope**：写完 S1/S2/S3 后，明确了"不解决什么"——这是没有 audit 流程时容易遗漏的部分
- **§2 现状盘点必须看真实代码 + 文件路径**：没有这一节，§4 的方案讨论容易飘
- **§3 参考项目启发汇总要小**：直接引用 `99-research-notes/<project>.md`，本文档只摘"对本 topic 有用的"，避免污染
- **§4 候选方案先收敛物理路线（X/Y/Z/Y+），再分级 A/B/C**：避免"一上来就最优解"的过度设计；也避免"路线和细方案混着讨论"
- **§5 当前倾向必须配套触发条件**：不是"暂不做"，而是"满足 X 信号才做"
- **§6 待决策问题集中列 + 决策理由 inline**：避免决策散落到 §4/§5 的字里行间，回看时能直接看到"为什么这么定"
- **元教训**：这份文档前两版有"想给 engine 加配置变更事件 / 给 caller 加 capability metadata"的过度设计倾向，被用户拉回——**linnya 现状已经解决了这些问题**（model-registry pull 即可），engine 的工作只是"把反向依赖解掉"，scope 极小

**这是后续所有 engine topic 文档应遵循的标准模板**（比 `engine/README.md` §3 的简版模板更扎实，建议把该模板更新为本文档的 8 节结构）。
