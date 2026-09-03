# 00 · Engine Scope Audit（边界审视与方法论修正）

> **状态**：✅ 审视完成 + §1.4 "engine 留接口、不做工具、信息丰富"原则已贯穿到 8 份 topic 决策定稿  
> **创建日期**：2026-04-21  
> **最近更新**：2026-04-21（§1.4 新增 + 8 份 topic 全部决策定稿）  
> **触发**：用户对 memory 边界提出反思——"agent 和 memory 是不是分开的，因为 linnya 和 linnsec 的记忆体系显然是不一样的"。回顾发现前 4 份外部项目调研后，我把"调研到的设计 → engine 升级候选"几乎当成了默认动作，违背了 `00-vision-and-split.md §3.2` 既有的判断纪律。本文档把这次修正沉淀为可复用的方法论 + 把 8 个原 engine topic 重新审视一遍。  
> **2026-04-21 第二轮强化**：用户进一步提出 "linnkit 留接口、不做工具" 正向原则——形成 §1.4。该原则与 §1.1 Q1-Q4 配套使用：**Q1-Q4 是否决性纪律**（没过门槛绝不升级 engine），**§1.4 是正向原则**（通过门槛后留出信息丰富的接口）。8 份 topic 已全部按此双原则定稿。

---

## 0. 为什么有这份文档

### 0.1 问题症状

外部项目调研推进过程中（OpenClaw / Claude Code / Codex / Hermes），**调研笔记越积越多 → engine topic 表的"已有外部证据"列越来越满 → 隐含假设"engine 升级是默认动作"**。

但实际情况是：

- Hermes 在 memory 这块**做了 8 个 backend + 完整 plugin 体系**——其中 `MemoryProvider` 抽象 + `on_pre_compress` hook 是**协议**层面的发现，但 8 个 backend 全是**产品层**实现
- Codex 的 `AgentPath` / `ThreadStatus` / `ContextManager.reference_context_item` 都是**产品工程**而非 agent 内核协议
- CC 的 Dream / Skills / Plan-Edit Tool 全部是**产品决策**

如果不做边界过滤，**engine 会膨胀成"另一个 Hermes/Codex"**——失去"为多消费者通用平台"的意义。

### 0.2 修正

- 把 `00-vision-and-split.md §3.2` 的 4 条判断标准**升级为强制流程**：每条调研发现先归入 secretary（产品层）候选；只有同时满足"协议而非实现"+"≥2 消费者真实受益"+"engine 不加 hook 就没法接"三个条件，才升级为 engine 候选
- 把 8 个原 engine topic **逐项重过一遍**，缩小 / 砍掉 / 重命名 / 新增

---

## 1. 决策原则（强化版）

### 1.1 Engine 升级判断流程（强制顺序）

每个调研发现 / 升级提案，按以下顺序回答 4 个问题，**任一答 No 直接 fall through 到下一层**：

```
调研发现 / 升级提案
        │
        ▼
Q1: 是"协议"还是"实现"？
        │
        ├── 实现 ──▶ 归 secretary（产品层），engine 不动
        │
        └── 协议 ──▶ 继续
                        │
                        ▼
                    Q2: ≥2 个真实消费者都需要 engine 提供这个协议？
                    （linnya + linnsec / linnya + 未来产品 / linnsec + 桌面）
                        │
                        ├── 否 ──▶ 归对应单一产品层
                        │
                        └── 是 ──▶ 继续
                                        │
                                        ▼
                                    Q3: engine 不加这个协议就没法接？
                                    （vs 产品自己 wrap 一层就够）
                                        │
                                        ├── 否（产品层能 wrap）──▶ 暂不升级，留待真出问题
                                        │
                                        └── 是 ──▶ 继续
                                                        │
                                                        ▼
                                                    Q4: 不破坏 Linnya 现状？
                                                        │
                                                        ├── 否 ──▶ 重新设计协议或推迟
                                                        │
                                                        └── 是 ──▶ ✅ engine 升级候选
```

### 1.2 三个常见误区（避免）

**误区 1：调研发现 = engine 升级候选**

错误示范：Hermes 有 `on_pre_compress` 钩子 → engine/03 加 memory port

正确判断：`on_pre_compress` 是**协议层发现**，但 Q2"≥2 消费者真实受益"只有在两个产品都已经有自己的 memory 实现并发现压缩前需要 hook 时才成立。**当前 linnya 和 linnsec 都还没各自的 memory 实现**——提前固化协议是过早抽象。

**误区 2：把别人的产品决策当 engine 范畴**

错误示范：Hermes 的 session_key 模板 `agent:main:{platform}:{chat_type}:{chat_id}` → engine/02 加 session-key 协议

正确判断：`platform` `chat_type` 是**产品语义**（IM 平台、群/私聊概念），engine 不该理解。这是 secretary/02-gateway-daemon 的设计。engine 只需要知道"`conversationId` 是个 opaque string"。

**误区 3：堆砌"已有外部证据"列代替判断**

错误示范：在 engine README 表里给某个 topic 列"CC ⭐ / Codex ⭐⭐ / Hermes ⭐⭐⭐"——好像证据多就该升级

正确判断：**证据是判断的输入，不是判断本身**。Hermes 8 后端再多也是产品层证据，不能推出 engine 该加什么协议。

### 1.3 触发回归条件（什么时候回来重做）

每个被判定为"暂不升级"或"砍掉"的 engine topic，必须明确写出**触发回归的条件**：

- "当 linnsec 第一阶段产品跑起来发现 X 必须 engine 协议层支持时，回来评估"
- "当 linnya 桌面新功能也需要 X 时，回来评估"
- "当出现第三个 engine 消费者时，整体回看"

否则等于挂起遗忘。

### 1.4 "engine 留接口，不做工具"原则（2026-04-21 用户补充）

> 原话："留个接口，比如说允许外部的什么东西、比如父 Agent 去查询子 agent，或者说去查询任意一个 agent 的运行状态，留个接口，未来的工具还是 linnsec 自己开发……linnkit 有这个功能，但是不做工具，具体工具由那些应用层去开发"

#### 与 §1.1 Q1-Q4 的关系

这是对 §1.1 的**正向补充**，不是替代：

- §1.1 Q1-Q4 是**否决性原则**——"能不进 engine 就不进"（避免膨胀）
- §1.4 是**主动留接口原则**——对**已经判定为属于 engine 范畴**的能力，要把"能力（capability/protocol/hook）"留够，但不实现"具体工具"

两条原则共同执行后，engine 范围呈现"**能力面广、工具面窄**"的特征——是**平台**而非**应用**。

#### 三层切分

每个 engine topic 在判断时，都要把"能力"和"工具"切开：

| 层 | 谁负责 | 例子 |
|----|-------|------|
| **能力层（Capability / Protocol / Hook）** | engine（linnkit） | `RunHandle.peek(runId)` 协议；`Checkpointer` 接口；`ToolRuntimePort` 注入点；`LlmProviderPort` 抽象；`abortSignal` 链路；事件总线 schema |
| **实现层（Adapter / Backend）** | 产品层（host adapter） | `MemoryRunRegistryStore` / `SqliteCheckpointer` / `LinnyaLlmProviderFactory` / `OpenAIAdapter` |
| **工具层（Tool / UI / Workflow）** | 产品层（应用代码） | "查询子 agent 进展"工具 / IM 弹按钮 / CLI `agent ps` 命令 / 任务管理面板 / cron 调度器 |

**engine 只做最上一层**。中间和下面两层都是产品层。

#### 实操判断

调研到一个能力时，先问自己 3 个子问题：

1. **能力（"能不能做到")** → 如果属于 engine 范畴，**留接口**
2. **实现（"具体怎么做"）** → 一律归产品层 host adapter
3. **工具（"用户怎么调用"）** → 一律归产品层应用代码

举例（engine/01 RunHandle）：
- ✅ engine 留：`spawnDetached(opts) → runId` / `peek(runId) → status` / `cancel(runId)` / `list() → runId[]` 等协议
- ❌ engine 不做：detached run 持久化后端（→ host 的 `RunRegistryStore` 实现）/ "查进展工具"（→ linnsec 自己写 `query_run_status` tool）/ 任务管理 UI / cron 调度

举例（engine/06 Checkpointer）：
- ✅ engine 留：`Checkpointer.save / load / list / delete` 协议
- ❌ engine 不做：SQLite / Postgres / 文件后端实现 / 持久化数据迁移工具

#### 这条原则会让某些 §1.1 判定"过紧"的 topic 重新放进来

之前 audit 用 Q1-Q4 时偏保守，把"能力"也按"暂不升级"处理（理由 = 没有 ≥2 消费者真实痛点）。按 §1.4 重审：**只要能力本身明确属于 engine 范畴，就应当留接口**——不必等"两个产品都痛"才动。

**预期影响**：engine/01（RunHandle 协议）从"§5 定稿候选 = 方案 A 不留接口"修正为"方案 B 留 RunHandle 协议、信息丰富、不做实现/不做工具"。其他 topic 在 M3 阶段（02 / 06 / 08 撰写）也按此原则审视。

#### 接口设计：信息丰富 ≠ 工具丰富

> 用户补充（2026-04-21）："接口可以完善一些，减少工具开发的难度。比如说返回的信息详细一些之类的，后续上层自己选择该怎么开发"

**误读**：以为"留接口"= "minimal port，越小越好"。

**正读**：留接口 = "**capability 完备 + 信息丰富 + 实现灵活**"。具体细则：

| 维度 | 错误做法（minimal-为-minimal） | 正确做法（信息丰富） |
|------|--------------------------|--------------------|
| **返回信息** | `peek(runId) → "running" \| "done"` | `peek(runId) → { status, currentNode, lastEventAt, pendingInteractionSpec, recentEvents, errorIfAny, ... }` 让上层有足够信息组装任意 UI / 工具 |
| **过滤 / 查询** | `list() → runId[]` | `list({ status?, parentRunId?, after?, limit? }) → RunSummary[]` 让上层不用自己缓存全集再过滤 |
| **事件流** | 只有 `wait()` 一次性等结果 | 提供 `wait()` + `subscribe(): AsyncIterable<RuntimeEvent>` 让上层可做实时进度 |
| **错误信息** | `{ ok: false }` | `{ ok: false, errorCode, errorMessage, recoverable, retryAfterMs?, hint? }` |
| **元数据** | 没有 | 每个返回结构带 `createdAt` / `updatedAt` / `originatorAgentId` / `metadata: Record<string, unknown>` 等 |

**判断标准**："上层做工具时是否还要 wrap engine 接口才能用？"
- 如果是 → 接口太薄，engine 该补
- 如果上层直接用就够 → 接口刚刚好

**反向边界**（什么时候停止加信息）：
- ❌ 不加产品语义字段（如 `platform: "wechat" | "telegram"`、`chatType: "group" | "private"`）—— 这是产品层
- ❌ 不加"定制化 UI 友好"字段（如 `displayLabel: "正在搜索..."`）—— 这是工具层
- ❌ 不内置默认 UI / 默认工具实现 —— 那是工具层

**举例（engine/01 RunHandle 的 PeekResult 应当包含）**：

```typescript
type PeekRunResult = {
  runId: string;
  parentRunId?: string;
  status: 'pending' | 'running' | 'awaiting_user' | 'completed' | 'failed' | 'cancelled';
  currentNode?: 'llm' | 'tool' | 'wait_user' | 'answer' | string;
  startedAt: number;
  updatedAt: number;
  pendingInteractionSpec?: WaitUserSpec;
  recentEvents?: RuntimeEvent[];
  iterationsUsed?: number;
  iterationBudget?: number;
  errorIfAny?: { errorCode: string; message: string; recoverable: boolean };
  metadata?: Record<string, unknown>;
};
```

→ linnya 桌面用它做"任务面板卡片"；linnsec 用它做 IM "查进展"按钮；CLI 用它做 `agent ps` 表格——**同一个接口，不同工具**，engine 不关心 UI 怎么呈现。

---

## 2. Case study：Memory 为什么不进 engine

### 2.1 用 Q1-Q4 流程过 memory

**Q1：协议还是实现？**

混合：
- **实现**部分：8 个 backend / vector store / embedding model / MEMORY.md 文件格式 / consolidation prompt → 显然产品层
- **协议**部分：`MemoryProvider` 抽象 / `on_pre_compress` hook / context pipeline 的 hook 点

只有协议部分进入 Q2。

**Q2：≥2 个真实消费者都需要 engine 提供这个协议？**

| 消费者 | 当前状态 | 是否需要 engine 提供协议 |
|--------|---------|-----------------------|
| Linnya 桌面 | 已有自己的 kb_search / 文档系统 / 笔记 / 知识库 | ❌ 当前是产品层独立组件，没有"插入 agent context pipeline"的诉求；将来即使要插，也可以在 host adapter 层做 |
| linnsec 秘书 | 还没开始开发 | ❓ 假设性需求 |

**两个真实消费者中，linnya 当前没有 engine 协议层的真实需求；linnsec 是假设性的**——Q2 不通过。

**Q3 / Q4 不必继续**。

### 2.2 结论

- **engine 当前不做任何 memory 相关工作**
- **memory 调研结论（Hermes 8 后端 / on_pre_compress / Codex 2-phase pipeline / CC Dream）整体归档为 secretary/06 输入**
- **触发回归条件**：
  - 当 linnsec 第一阶段实现自己的 memory backend，发现"产品层 wrap 一层 host adapter 接进 context pipeline"做不到 → 回来评估 engine 加 hook
  - 或当 linnya 也想加跨 session 长期记忆，发现 host adapter 接入有真实工程问题 → 回来评估
  - 或当出现"linnya 和 linnsec 各自实现的 memory hook 在结构上 90% 重复"的迹象 → 回来抽象

### 2.3 为什么"先不做"是对的（不是偷懒）

1. **过早抽象的代价**：engine 协议一旦固化，未来两个产品的真实需求出现后，发现协议形状错了，要么破坏现状，要么忍痛兼容
2. **真实需求缺席**：当前两个产品都没有真实 memory 实现，所谓"hook 点"都是基于 Hermes/CC/Codex 的别人产品决策推断出来的——这是别人的需求，不是我们的
3. **engine 抽包优先级**：当前最迫切的是完成 [`engine/07`](./07-public-api-and-package-boundary.md) 的 Phase D（准备好可抽）+ Phase E（物理 move 到 `packages/linnkit/`），不是新加协议
4. **secretary/06 不会丢调研价值**：Hermes 8 后端 + on_pre_compress + Codex 2-phase 全部沉淀在 `99-research-notes/*.md` 和 `secretary/06-memory-backends.md`（待写）里，linnsec 开发时可以直接用

---

## 3. 8 个原 engine topic 重新审视

下表把每个 topic 用 Q1-Q4 重新过一遍，给出**保留 / 缩小 / 砍掉 / 重命名 / 新增**结论。

| 编号 | 原 Topic | Q1 协议? | Q2 ≥2 消费者真实需求? | Q3 engine 不加就没法接? | Q4 不破坏 Linnya? | 决策 |
|------|----------|---------|---------------------|----------------------|----------------|------|
| 01 | Async runs and run handles | ✅ engine 只加 helper + IterationBudget | ✅ linnya 桌面 + linnsec 都需要 budget tree | ✅ IterationBudget 必须在 kernel | ✅ | **✅ 保留**，定稿候选 |
| 02 | Session and tenancy | ⚠️ session_id 协议属 engine；session_key 模板属产品 | engine 协议部分 ❌ 现状已够稳；产品部分 ✅ 但归 secretary | - | - | **⚠️ 缩小**：engine 只问 conversationId 协议是否需要演进；session_key 模板/多通道路由完全归 `secretary/02` 和新 `secretary/0X-session-key` |
| 03 | Memory port | 见 §2 | ❌ | - | - | **❌ 暂不升级**，调研归档 secretary/06 |
| 04 | Long-running tool / wait_external | ✅ graph 暂停/恢复确实是 kernel 机制 | ⚠️ 当前两个产品都没真实需求；三个外部项目都"无内核暂停"| ❌ wait_user 已存在，wait_external 可以等真实需求 | ✅ | **⚠️ 暂不升级**，触发条件：linnsec 出现"工具 spawn 后等外部回调几小时再继续"的真实场景 |
| 05 | External agent tool protocol | ❌ 调外部 agent = 一种特化 tool，engine tool runtime 已够 | - | ❌ | - | **❌ 砍掉 engine topic**，整体移到 `secretary/11-external-agent-tools` |
| 06 | Checkpointer and persistence | ✅ Checkpointer / EventStore 接口属 engine 协议；SQLite/FTS5/JSONL 后端属产品 | ✅ 两边都需要可插拔 checkpointer | ⚠️ 当前接口已存在，需评估是否够通用 | ✅ | **⚠️ 缩小**：engine 只问"协议是否够通用"，不引入具体后端；具体后端**全归产品层** |
| 07 | Public API and package boundary | ✅ 这是 engine 自己的元任务 | ✅ 抽包后所有消费者都要用 | ✅ 必须 engine 自己做 | ✅ | **✅ 保留**（最高优先级，Phase D 收尾必须） |
| 08 | Cross-cutting concerns | ✅ abort / telemetry / error model 都是 engine 协议 | ✅ 都通用 | ✅ | ✅ | **✅ 保留并拆细**为 abort port / telemetry port / error model 三件 |

### 3.1 拆掉 topic 05 的具体理由

"调用外部 agent (Cursor/Codex/CC/ChatGPT)" 当前看上去像个 engine 级别的事，因为我们之前调研发现 CC + Codex + Hermes 都做了 MCP 双向、ACP server 等"集成层"。

但用 Q1-Q4 过一遍：

- **Q1 协议？** ❌ 这是"另一种 tool"，engine `runtime-kernel/tools/*` 已经定义了 ToolPort + ToolExecutionContext。**调外部 agent 就是写一个新的 tool 实现**——不需要 engine 知道"这个 tool 内部其实是个 ACP client"
- **Q3 engine 不加就没法接？** ❌ 完全可以在 secretary 产品层写 `cursorAgentTool` / `codexAgentTool` / `chatgptWebTool` 等，注册到 ToolRegistry 即可

**砍掉理由清晰**。secretary/11 已经在路线图里，自然消化。

### 3.2 缩小 topic 02 / 03 / 06 的统一模式

这三个 topic 都犯了同样的错：**把"产品层一定会做"等同于"engine 协议层要做"**。

正确的处理方式：
- engine 只问"现有协议是否够稳"
- 产品层的具体设计**完整下放**到 secretary 对应 topic

---

## 4. 新增 engine 候选（之前 8 topic 漏掉）

回看 4 个项目调研，**真正满足 Q1-Q4 全部 4 条**的、之前没列的候选：

### 4.1 Multi-provider LLM abstraction（**用户已确认要升级**）

| 维度 | 判断 |
|------|------|
| Q1 协议? | ✅ Provider 抽象 / streaming 规范化 / model resolver 都是协议层 |
| Q2 ≥2 消费者真实需求? | ✅ **强需求**：linnya 桌面用户已有"配 OpenAI/Anthropic/Gemini/本地"的诉求；linnsec 秘书的多 IM 场景下，不同任务可能用不同模型（cron 摘要用便宜模型 / 用户对话用强模型 / 长文用大上下文模型） |
| Q3 engine 不加就没法接? | ✅ **是**——provider 抽象在 `runtime-kernel/llm/*`，是 graph node 直接调用的部分；产品层无法 wrap |
| Q4 不破坏 Linnya? | ✅ 当前 caller / model resolver / streaming normalization 已有骨架，只是泛化深度不够 |

**用户原话**："因为每一个都需要配置 api 啥的"——这是**真实痛点**：每多一个 provider，配置面、密钥管理、能力差异（streaming 格式 / 工具 schema / 缓存命中）都要 engine 统一抽象，否则两个产品各自写一遍。

**核心需要回答的问题**（待 `engine/03-multi-provider-llm-abstraction.md` 详写）：
- 当前 `runtime-kernel/llm/*` 协议形状是否够？需要哪些泛化？
- Provider 配置（API key / endpoint / 模型列表）的 host 接入面如何稳定？
- Streaming 规范化是否覆盖所有主流提供商（OpenAI / Anthropic / Gemini / OpenRouter / Bedrock / Ollama / 本地）？
- Tool schema 差异（OpenAI tools vs Anthropic tools vs Gemini function calling）的统一？
- 模型能力声明（context window / 是否支持工具 / 是否支持 streaming / 是否支持 prompt cache / 多模态）的 metadata port？

→ 列入 engine 升级候选，编号 **engine/03-multi-provider-llm-abstraction.md**（替代原 memory port 占用的编号）

**2026-04-21 后续定稿**（见 `engine/03-multi-provider-llm-abstraction.md` §4 / §5.1）：

- **物理路线拍板**：走**路 Y**——engine 只出 `LlmProviderPort` 接口 + `LlmProviderFactoryLike` 注入契约；具体 adapter（gpt/gemini/claude/ollama …）留在 `src/infra/adapters/llm/`，由 host 装配时注入。engine 包不带任何第三方 LLM SDK 依赖
- **本期实施 scope 极小**：仅做"反向依赖解耦"——`LlmCaller` 移除对 `infra/adapters/llm` 的 import，改走注入。capability metadata / pickModelByRequirements / ToolSchemaTranslator / ProviderConfig push 事件等**全部不在本期**
- **触发条件已明确**：方案 B（capability-aware picker）等 linnsec cron 选模型场景出现；方案 C / 路 Y+（adapter 独立 package）等出现第三个消费者或重复率 ≥ 70% 时再评估，且**优先调研 LiteLLM / Vercel AI SDK / OpenAI Agents SDK 等成熟方案**而非自建
- **关联硬约定**：linnsec 用户**可以**配置自己的模型（一个 url + api key 即可），但 linnsec **agent 自身不能**通过工具改自己的驱动模型——见 `secretary/README.md` §2 第 5 条

### 4.2 Permission / Approval port

| 维度 | 判断 |
|------|------|
| Q1 协议? | ✅ "工具调用需要审批"是协议层 |
| Q2 ≥2 消费者真实需求? | ✅ linnya 桌面 = 对话框确认；linnsec = IM 消息按钮 |
| Q3 engine 不加就没法接? | ❌ **不需要新协议**：当前 wait_user + `control.requireUser=true` 已能表达"暂停等用户"；产品层可用"包装工具" pattern：`confirmableTool(realTool, level)` wrapper 自己先返回 `requireUser=true`，用户批准后下一轮 LLM 自然再调真工具。engine 一行不用改 |
| Q4 不破坏 Linnya? | ✅ |

**2026-04-21 评估结论**：**❌ 暂不升级**——engine 不新增 permission port。审批语义在产品层用 wrapper pattern 实现，engine 现有 `wait_user` + `control.requireUser` + `control.terminateRun` 三件套已经够用。

**触发回归条件**：
- 当 linnya 和 linnsec 各自实现 `confirmableTool` wrapper、代码重复 ≥ 70%（信号：两个产品的危险等级判定 / 自动批准策略 / 审批 UI 协议都长得几乎一样）
- 或当 linnsec bash 能力开放后，发现 wrapper pattern 撑不住"先问后做 + 危险等级"两件事的组合复杂度
- 或当出现第三个 engine 消费者也需要审批

→ 满足任一条件，回评估是否新增 `engine/09-permission-port.md`；当前 09 编号**保留占位**。

### 4.3 Tool execution policy

| 维度 | 判断 |
|------|------|
| Q1 协议? | ✅ 并行策略 / 超时 / 取消都是协议层 |
| Q2 ≥2 消费者真实需求? | ✅ **linnya 桌面已有真实痛点**：用户问"同时查 KB 和网页"时，LLM 一次返回多 tool_call 但 engine 串行执行，体验延迟显著；linnsec 第一阶段产品必然继承 |
| Q3 engine 不加就没法接? | ✅ `pendingToolCalls` 数组在 LLM 解码后就在 toolNode 手里，产品层 wrap 不到 |
| Q4 不破坏 Linnya? | ✅ 设计为"默认串行（向后兼容）+ 工具显式 `parallelSafe=true` 才并行"，对所有现有工具行为 0 影响 |

**2026-04-21 评估结论**：**✅ 升级**，但 **scope 大幅缩小为"仅并行执行协议"**。超时 / 优先级 / 依赖图等**全部不做**——99% 场景"全部并行 / 全部串行 / 部分并行"够用，更复杂的等真实需求出现再单开 topic。

→ 列入 engine 升级候选，编号 **engine/10-tool-parallel-execution.md**（已起草）。

**已审计现状**（来自 `engine/10` §2）：
- 串行执行的关键代码：`toolNode.ts:96` 取 `calls[0]` + `:217-222` 递归 route
- 已有协议骨架：`abortSignal` / `tool_call_id` / `idempotency` 三件套已支持并行场景
- 缺：`BaseTool.parallelSafe` 字段 + toolNode batch 提取 + 并行冲突解决策略（terminateRun > requireUser > 成功；protocolFuse +1 不 +N）

### 4.4 IterationBudget tree（已纳入 01）

不再单列，作为 `engine/01-async-runs-and-handles.md` §5 的实施项之一。

### 4.5 InstructionsLoader（AGENTS.md / SOUL.md / SKILL.md 渐进披露协议）

| 维度 | 判断 |
|------|------|
| Q1 协议? | ⚠️ frontmatter 解析 + 渐进披露逻辑，是协议还是实现？模糊 |
| Q2 ≥2 消费者真实需求? | ⚠️ Linnya 桌面的"指令文件"和 linnsec 的"全局秘书人格"在结构上是不是一回事？不确定 |

→ **不列入候选**，先放产品层各自实现，等出现"两个产品的 InstructionsLoader 实际重复 90% 代码"的信号再回收。

---

## 5. 修订后的 engine topic 表

| 编号 | Topic | 状态 | 与之前差异 |
|------|-------|------|-----------|
| 00 | **Engine scope audit**（本文档） | ✅ 已完成（含 §1.4 "engine 留接口、不做工具、信息丰富"原则）| **新增**——固化方法论 |
| 01 | Async runs and run handles | ✅ 决策定稿（**方案 B**：engine 留 RunHandle 协议、信息丰富、不做实现/不做工具）| 2026-04-21 用户按 §1.4 新原则**否决原方案 A**改为方案 B |
| 02 | Session and tenancy | ✅ 决策定稿（conversationId opaque + AgentInvocationRequest 加 4 个可选挂载字段）| scope 缩小后定稿 |
| 03 | **Multi-provider LLM abstraction**（用户确认升级） | ✅ 决策定稿（Road Y）| **替代**原 memory port |
| ~~03-old~~ | ~~Memory port~~ | ❌ 暂不升级 | 调研归档 secretary/06；触发条件见 §2 |
| 04 | Long-running tool / wait_external | ⚠️ 暂不升级 | 触发条件：linnsec 出现真实场景 |
| ~~05~~ | ~~External agent tool protocol~~ | ❌ 砍掉 | 整体移到 `secretary/11` |
| 06 | Checkpointer and persistence | ✅ 决策定稿（三个独立 port：Checkpointer 扩展 + EventStore 新增 + RunRegistryStore 新增）| scope 缩小后又按 §1.4 新原则展开为三件 |
| 07 | Public API and package boundary (Phase D + **Phase E**) | ✅ 决策定稿 | **scope = D-1~D-5 + E1~E8**；Phase E 真抽包是 linnsec 正式产品开发硬前置；package name = `linnkit`；详见 `engine/07-public-api-and-package-boundary.md` |
| 08 | Cross-cutting concerns | ✅ 决策定稿（abort 写契约不加 port + telemetry 新增 TelemetryPort + error model 扩展信息） | 拆三件分别评估完成 |
| 09 | ~~Permission / Approval port~~ | ❌ **暂不升级** | 评估结论：wait_user + control.requireUser + control.terminateRun 三件套已够用；产品层用 wrapper pattern；触发条件见 §8 |
| 10 | **Tool parallel execution（仅并行执行）** | ✅ 决策定稿 | **scope 大幅缩小**：默认串行 + 工具 opt-in `parallelSafe` + 前缀连续 batch；详见 `engine/10-tool-parallel-execution.md` |

**总结**（2026-04-21 三轮修订 + §1.4 新原则贯穿后）：
- 删除 1 个（external agent → 移走）
- **§1.4 新原则的影响**：原本"⚠️ 缩小研究"的 02 / 06 / 08 + "⚠️ 待定稿"的 01 全部在 §1.4 原则下提升 scope，定稿为"engine 留接口、信息丰富、不做工具/实现"
- 暂不升级 3 个（原 03 memory / 04 long-running / 09 permission）
- 新增 2 个确认（03 multi-provider LLM / 10 tool parallel execution）
- Phase E 加入 07：linnsec 正式产品开发前置 = 真抽包完成

**净结果**：engine 升级范围明确——**8 份 topic 文档全部决策定稿**（00 元 + 01 / 02 / 03 / 06 / 07 / 08 / 10），可进入 M4 实施。

**当前（截至 2026-04-21）topic 文档与决策状态**：

| 文档 | 决策 | 实施 |
|------|------|------|
| 00 audit | ✅ 完成（元文档；含 §1.4 新原则） | n/a |
| 01 async runs | ✅ 定稿（方案 B + RunHandle 信息丰富设计） | 等候 |
| 02 session-and-tenancy | ✅ 定稿（4 个可选挂载字段） | 等候 |
| 03 multi-provider | ✅ 定稿（Road Y） | 等候 |
| 06 checkpointer | ✅ 定稿（三个独立 port） | 等候 |
| 07 phase D + E | ✅ 定稿（D-1~D-5 + E1~E8；linnsec 启动硬前置） | 等候 |
| 08 cross-cutting | ✅ 定稿（abort/telemetry/error 三件） | 等候 |
| 10 tool parallel | ✅ 定稿（parallelSafe 前缀连续 batch） | 等候 |

→ **8 份决策全部锁定**，可立即进入 M4 实施 + M5 Phase E 真抽包。

---

## 6. 调研存量的归档去向

前 4 份调研（OpenClaw / CC / Codex / Hermes）发现的全部产品层启发，**整体归档去向**：

| 调研发现 | 原归类（错） | 新归类 |
|---------|------------|-------|
| Hermes 8 memory 后端 | engine/03 | **secretary/06**（核心参考） |
| Hermes on_pre_compress 钩子 | engine/03 | **secretary/06**（注明：未来如果 secretary 实现发现需要 engine hook 才能注入，再回 engine 评估）|
| Hermes session_key 模板 | engine/02 | **secretary/02**（原本就在）+ **新建 secretary/0X-session-key** |
| Hermes 5 层授权 + 8 位配对码 | secretary/04 | **secretary/04**（保持） |
| Hermes cron 三件套 | secretary/05 | **secretary/05**（保持） |
| Hermes 17+ 渠道适配器 | secretary/03 | **secretary/03**（保持） |
| Hermes MCP 双向 + ACP server | engine/05 + secretary/11 | **secretary/11**（合并，engine/05 砍掉） |
| Hermes Prompt Caching 宪法 | engine/08 | **engine/08**（保持，但定位为"工程纪律"而非"协议升级"） |
| Hermes IterationBudget tree | engine/01 | **engine/01**（保持，已纳入） |
| Codex AgentPath / ThreadStatus | engine/02 + engine/01 | **secretary/02**（产品层）+ **engine/01**（部分作为 TaskRecord 设计参考） |
| Codex Guardian + Execpolicy | engine/08 + secretary/09 | **secretary/09**（产品层；engine 不抄 DSL） |
| Codex 2-phase memory pipeline | engine/03 | **secretary/06** |
| Codex Memory Citation 协议 | engine/03 | **secretary/06** |
| Codex ContextManager.reference_context_item diff 注入 | engine/03 | **secretary/06**（如果将来发现是 engine 协议层，再回评估） |
| Codex AGENTS.md hierarchical | engine/03 / engine/07 | **secretary/07**（产品层 InstructionsLoader） |
| Codex JSON-RPC Lite + app-server-protocol crate | engine/07 | **secretary/02**（daemon 协议是产品层） |
| Codex EventPersistenceMode | engine/06 | **secretary/02 / secretary/06** |
| Codex execpolicy DSL | engine/08 | **secretary/09**（产品层） |
| CC Dream feature | engine/03 | **secretary/06** |
| CC Skills + SKILL.md | engine/07 | **secretary/07** |
| CC Plan-Edit Tool | engine/05 | **secretary/11** |
| CC supervisor+worker | engine/01 | **secretary/02** |
| CC `<task-notification>` XML | engine/01 | **engine/01**（保持，作为子代理通知协议参考） |
| OpenClaw ACP 协议 | engine/05 | **secretary/11** |
| OpenClaw Node protocol | engine/0X | **secretary/08** |

**核心修正**：约 80% 的调研发现归 secretary（产品层），只有约 20% 真正属于 engine 协议。这与最初按"engine 8 topic + secretary 13 topic"的初步划分相比，**engine 实际占比远小于初稿**。

---

## 7. 工作纪律修订（更新到 docs/README.md §4）

在 `docs/README.md §4 工作方法` 现有 6 条之外**新增第 7 条**：

> **7. 调研发现 → engine/secretary 分流的强制流程**：  
> 任何外部项目调研产生的设计点，**默认归类为 secretary 候选**。只有当同时满足 §1.1 的 Q1-Q4 四条标准时，才能升级为 engine 候选。  
> 在 `engine/README.md` topic 表的"已有外部证据"列里，**只列 engine 协议层证据**（如 Hermes `on_pre_compress` 钩子的位置），**不列产品层实现证据**（如"Hermes 8 后端"）。后者全部归 `secretary/<NN>` 对应 topic 的"已有外部证据"列。

（具体的 docs/README.md 编辑作为 audit-vision-link 任务执行）

---

## 8. 触发回归条件（明确写出，避免遗忘）

下列已"暂不升级"或"砍掉"的项，将来一旦出现这些信号，**主动回头评估**：

| 已暂搁 / 砍掉的项 | 触发回归条件 |
|------------------|------------|
| Memory port | linnsec 第一阶段实现自己的 memory backend，发现"产品层 wrap 一层 host adapter 接进 context pipeline"做不到 / linnya 想加跨 session 长期记忆且发现 host adapter 接入有真实工程问题 / 两个产品各自实现的 memory hook 在结构上 90% 重复 |
| Long-running tool / wait_external | linnsec 出现"工具 spawn 后等外部回调几小时再继续"的真实场景，且现有 wait_user 协议确实表达不了 |
| External agent tool（原 05） | 出现"linnya 和 linnsec 各自实现 cursorAgentTool / codexAgentTool 时代码重复 ≥ 70%" |
| InstructionsLoader | 两个产品的 InstructionsLoader 出现 90% 代码重复 / frontmatter 解析格式发现需要统一 |
| Session-key 协议 | engine 层确实需要理解 platform / chat_type 维度（极不可能） |
| **Permission / Approval port（09，2026-04-21 暂搁）** | 当 linnya 和 linnsec 各自实现 `confirmableTool` wrapper、代码重复 ≥ 70%（信号：危险等级判定 / 自动批准策略 / 审批 UI 协议都长得几乎一样）/ 或当 linnsec bash 能力开放后 wrapper pattern 撑不住"先问后做 + 危险等级"的组合复杂度 / 或出现第三个 engine 消费者也需要审批 |
| Tool timeout / priority / DAG（engine/10 范围外） | 出现"某个工具卡死、abort 不响应"（→ 加超时）/ 出现"多 batch 内需要按优先级或依赖图调度"（→ 加 DAG）—— 当前 engine/10 仅做并行，其他全部暂搁 |

---

## 9. 这次审视的元教训

这是一次**需要钉死的方法论**：

1. **调研推进要分两步**：第一步只产 99-research-notes/<project>.md（事实记录）；第二步再用 §1.1 流程过滤进 topic 表。**不要在调研后直接更新 topic 表的"已有外部证据"列**——这会让"证据多 = 该升级"成为隐含假设
2. **engine 升级是"减法默认"**：默认不升级 / 默认归产品层 / 只有跨过 4 条门槛才升级
3. **prefer 推迟决策 over 提前抽象**：协议固化的成本远高于"产品层先各自做，未来发现重复再回收"
4. **多看 docs/00-vision-and-split.md**：这份文档已经写得很清楚，我前面的偏差源于"忘了回看"——这是流程问题，不是文档问题

**这次审视的成果就是：**这份文档本身 + 修订后的 engine README + 修订后的 secretary README + 一个验证 topic（engine/03 multi-provider）。
