# 01 · 与同类 Agent 框架/内核对比

> 本文做两件事：(a) 把 linnkit 放在 **TS / JS 生态的 Agent 框架** 里横向对比；(b) 把 linnkit 跟**几款产品的 Agent 内核**纵向对比，看我们应该学什么、不该抄什么。
>
> 详细外部调研笔记在 [`../99-research-notes/`](../99-research-notes/)。本文只摘"对 linnkit 的启发"。
>
> **2026-05-13 更新**：按 0.5.0 已发布基线 + 当前 0.6.0 候选源码重评。`AgentSpec` / `RunSupervisor` / `RunHandle` / `AuditEnvelope` / contextPolicy 细粒度配置 / testkit run invariants 已经落地，本文不再把它们描述为待做项。0.6.0 仍需文档审阅后再发布。
>
> **2026-08-25 上下文口径校准**：旧 Summary Provider 与主动 Context Checkpoint 已退役；当前为 Context Manager 纯计划 / 重建 + Graph 使用当前模型自动压缩，`history_summary` 是唯一 durable 摘要事实。

---

## 1. 横向：和 Agent 框架对比

| 框架 | 主张 | 心智门槛 | 事件治理 | child-run | wait_user | 多 agent | 适用场景 |
|---|---|---|---|---|---|---|---|
| **Vercel AI SDK** | `streamText/generateText + tool` | 极低 | ❌ 无（透传 LLM SDK） | ❌ | ❌ | ❌ | 单轮 / 简单工具调用原型 |
| **OpenAI Agents SDK** | `Agent + Runner.run + Handoff` | 低 | ⚠️ 弱（trace API 黑盒） | ⚠️ Handoff 是单向 | ❌ | ✅（Handoff） | 简单 agent + 角色切换 |
| **Mastra** | `Workflow + Agent + Tool + Memory` | 中 | ⚠️ 中（DevTool 强但封装） | ⚠️ workflow step | ❌ | ⚠️ workflow 编排 | 工作流密集型应用 |
| **LangGraph (TS)** | `StateGraph + nodes + edges + interrupts + checkpointer` | **高** | ✅ 强（state diff） | ✅ subgraph | ✅ interrupt | ✅ 通过 graph 拼 | 复杂编排、需要可视化拓扑 |
| **CrewAI** | `Crew + Agent(role,goal,backstory) + Task` | 中 | ❌ 无 | ✅ delegate | ❌ | ✅ 角色协作 | "多 agent 协作"营销叙事 |
| **AutoGen** | `ConversableAgent + GroupChat` | 中 | ⚠️ 中 | ✅ chat | ⚠️ 间接 | ✅ group chat | 研究 / 多 agent 对话 |
| **linnkit** | **固定 graph + AgentSpec + RunSupervisor + 上下文工程** | **中** | ✅✅ **三层模型 + 四维 eventGovernance + AuditEnvelope** | ✅ child-run + detached run | ✅ **协议级 wait_user** | ⚠️ child-run / detached 已有，mesh 待 N-2 | 长期维护的 agent 应用、跨产品复用内核 |

### 1.1 一句话对位

- **比 Vercel AI SDK 重**：linnkit 给你 graph engine + event governance + context-manager；做了原型不会卡在"接下来怎么扩展"。
- **比 LangGraph 轻**：linnkit 不让你画图，graph 是隐式的固定 5 节点；上手不需要理解 StateGraph。
- **比 OpenAI Agents SDK 白盒**：linnkit 的事件治理、上下文策略、run 状态、审计 envelope 都是可接管协议，不绑定单一模型平台。
- **比 Mastra 内核优先**：Mastra 把 workflow 当一等对象，linnkit 把 agent + run 生命周期当一等对象（`AgentSpec` + `RunSupervisor` 已落地）。
- **比 CrewAI / AutoGen 工程化**：linnkit 的多 agent 走的是协议层（[`04 N-2 AgentMessageBus`](./04-protocol-roadmap.md#n-2-agentmessagebus-portagent-to-agent-异步消息-p1)），不是把"角色 / 目标 / 背景故事"硬塞进框架。

### 1.2 LangGraph 为什么"被吐槽太重"，linnkit 怎么避开

LangGraph 的 4 个高频吐槽：

| 吐槽 | 根因 | linnkit 的对策 |
|---|---|---|
| "写一个 agent 要先理解 StateGraph、Edge、Conditional Edge" | graph-first 心智 | linnkit 的 graph 是**隐式固定形状**，写 agent = 注册 prompt + tools，不碰 graph |
| "checkpointer + interrupt + state 三件套耦合很深" | LangGraph 把 state 治理塞进 graph engine | linnkit 把 `Checkpointer`（执行恢复）和自动上下文压缩**严格切开**；压缩不使用 checkpoint tool、marker 或 step reset（详见 [`integration/glossary.md §1`](../integration/glossary.md)） |
| "想看一眼 prompt 是什么样很难" | 多层 prompt template + state injection | linnkit 的 context build、最终 Prompt 计量与自动压缩阶段均可观测；DevTools（[`06`](./06-developer-experience-roadmap.md)）会把 prompt diff 直接暴露 |
| "subgraph 调用方式不直观" | StateGraph 之间互相 invoke | linnkit 的 child-run 是**单一原语**，未来 N-2 AgentMessageBus 是 actor 风格，不需要拼 graph |

**linnkit 的取舍**：放弃"任意拓扑可编排"换"上手成本低 + 不变量稳"。如果你真的需要任意 graph，请用 LangGraph；如果你做的是 90% 形态相同的对话型 agent，linnkit 更顺手。

---

## 2. 纵向：和产品的 Agent 内核对比

下表对比 4 个公开/半公开的 agent 产品内核。注意：这些是**产品**，linnkit 是**框架**——我们只比"内核 / kernel layer"，不比产品力。

| 维度 | linnkit | Claude Code | Codex CLI | Hermes Agent | OpenClaw |
|---|---|---|---|---|---|
| **主循环形态** | 固定 5 节点 graph + tick pipeline | `async generator + while(true)` | 双循环（Op channel + stream loop） | 同步 `while + IterationBudget` | PI 嵌入 ReAct loop |
| **child / sub-agent** | child-run（父子单向） | `runAgent` + `task-notification` XML 注入 | `agent_tool`（同步）+ `agent_job_tool`（异步） + AgentPath | `delegate_task`（深度限制） | `sessions_spawn`（异步） |
| **暂停 / interrupt** | ✅ `wait_user` 协议级；冷 `pause/resume` 待真实需求 | ⚠️ 弱（permission ask） | ✅ pending review | ✅ wait | ✅ wait |
| **持久化** | `Checkpointer` + `EventStore` + `RunRegistryStore` 三类 port | 文件（Markdown + YAML） | SQLite | SQLite + WAL + FTS5 | SQLite |
| **上下文工程** | Must-Keep + working memory + 完整工具组 + `replacementSourceIds` + Graph 自动 compaction + AgentSpec contextPolicy | 三层注入 + `defer_loading` | `ContextManager.reference_context_item` + diff 注入 | `on_pre_compress` 钩子 + 8 backend | 文件 + vector |
| **Memory** | ⚠️ 暂无（待 N-4） | 文件式 Markdown | 2-phase pipeline + Memory Citation 协议 | 8 backend + consolidate | 文件 + vector |
| **Permission / Sandbox** | ❌（待 N-5） | permission modes | Execpolicy DSL + Guardian 小 LLM + 三平台沙箱 | 5 层授权链 | ❌ |
| **多通道** | ❌（host 责任） | ❌（CLI only） | ⚠️（CLI + IDE） | ✅ 17+ IM 通道 | ✅ 多通道 |
| **跨进程 / cluster** | ❌（待 N-6） | ❌ | ⚠️ app-server daemon | ⚠️ in-process | ❌ |
| **事件治理** | ✅✅ 三层模型 + 四维 governance | ⚠️ 流式但治理弱 | ✅ Op channel | ⚠️ 中 | ⚠️ 中 |
| **可审计** | ✅ AuditEnvelope + AuditPort + EventStore sink | ❌ | ⚠️ Guardian 决策可审 | ⚠️ 中 | ❌ |
| **测试不变量** | ✅ run-harness + 15 条 run invariants + failure injection | ⚠️ 产品内测 | ✅ Rust 测试强 | ⚠️ 中 | ⚠️ 中 |
| **工程纪律** | ✅✅✅ AST guard + no-host-leakage + package export snapshot | ✅✅ 严格但闭源 | ✅✅ Rust + 强类型 | ✅ 中 | ⚠️ AI 辅助 10 天写出，质量不一 |

### 2.1 我们要学的（按 ROI 排序）

| 来源 | 设计点 | linnkit 对应方向 |
|---|---|---|
| **Codex** | `AgentPath` 用一个字段编码"父-子-孙"agent 树 | `RunRecord.parentRunId` / telemetry `parentRunId` 已覆盖成本口径；`runTree` 等到 N-3 后段真实需求 |
| **Codex** | `reference_context_item` + diff 注入降 token 消耗 | `replacementSourceIds` 已经做对了，下一步是**diff-based 重渲染**（详见 [`03 §1.2`](./03-target-evolution-axes.md)） |
| **Codex** | Memory Citation 协议——memory 写入要带"我从哪条事件提取的" | N-4 MemoryPort 必须强制 citation 字段（[`04 N-4`](./04-protocol-roadmap.md#n-4-memoryport--knowledgeport产品中性的记忆抽象-p1)） |
| **Codex** | Guardian 小 LLM 做自动批准 | N-5 PermissionPort 留 `ask` 决策给宿主，宿主可以接 Guardian-style 决策器 |
| **Claude Code** | Task 抽象统一 UI 在场 / 生命周期 | `RunHandle` 已覆盖 cancel / observe / cost / meta；UI 在场语义仍归 host metadata |
| **Claude Code** | `ToolSearchTool` + `defer_loading` | 框架级通用工具：`skills_list` / `skills_load`（[`05 §6`](./05-builtin-tools-protocol.md)） |
| **Hermes** | `IterationBudget` 树形预算 + refund | `RunHandle.cost().childrenTotal` 已覆盖父子成本，quota/refund 属 G-2 |
| **Hermes** | `on_pre_compress` 钩子位置 | context preprocessor + `contextPolicy` 已协议化；函数式任意 hook 仍不进 AgentSpec |
| **Hermes** | `session_key = agent:main:{platform}:{chat_type}:{chat_id}` | session_key template 要进 ports（[`04 §4 路线图`](./04-protocol-roadmap.md)） |
| **OpenClaw** | session-key 用单字符串编码所有路由维度 | 同上，借鉴格式但更结构化 |
| **LangGraph** | `interrupt()` 是 graph engine 的一等概念 | linnkit 已把 `wait_user` 状态写入 RunRegistry；后续只补 `wait_external` 泛化 |
| **OpenAI Agents SDK** | `Agent` 是一等对象，可以序列化 | `AgentSpec` 已落地，下一步是 Quickstart/CLI 把使用门槛压低 |
| **Mastra** | DevTools 是产品力的关键 | DX 路线图（[`06`](./06-developer-experience-roadmap.md)）把 DevTools Web 列为 P1 |

### 2.2 我们要明确不抄的

| 来源 | 设计点 | 不抄的原因 |
|---|---|---|
| Claude Code | 文件式 memory（Markdown + YAML） | **产品决策**，不进框架；linnkit 出 `MemoryPort`，宿主自己选 backend |
| Codex | Execpolicy DSL（Starlark） | **产品决策**，不进框架；linnkit 出 `PermissionPort`，宿主自己写规则 |
| Codex | Seatbelt / bubblewrap / 三平台沙箱 | **产品决策**，不进框架；linnkit 出 `SandboxPort`，宿主自己实现 |
| Hermes | 17 个 IM 通道适配器 | **产品决策**（归"接 IM 的常驻 daemon"类产品） |
| Hermes | 8 个 memory backend 全部内置 | **产品决策**；linnkit 给一个 port + 1-2 个参考实现，剩下让宿主接 |
| OpenClaw | ACP 协议 client | **产品决策**（如果未来要做 IDE 接入，归独立 product） |
| CrewAI | `role` / `goal` / `backstory` 字段在框架里 | **角色不应该是协议层概念**——它应该是 `AgentSpec.metadata` 里宿主自定义字段 |
| LangGraph | StateGraph 让用户画图 | **过设计**（详见 §1.2） |

### 2.3 一张表总结：linnkit 在内核层独有的 6 件事

| 设计点 | 我们 | 同类有谁 |
|---|---|---|
| **eventGovernance 四维**（persist / replayToUi / enterAgentContext / realtimeChannel） | ✅ 产品中性 | 全无（其他框架要么没事件治理，要么把它锁在产品里） |
| **`replacementSourceIds` 数据契约** 跨模块通用 | ✅ 产品中性 | Codex 类似但锁在 ContextManager 内部 |
| **执行控制 checkpointer ⊥ 上下文摘要 marker 严格切分** | ✅ 产品中性 | LangGraph 没切；其他没明确切 |
| **`wait_user` 协议级暂停**（不是前端 patch） | ✅ 协议层 | LangGraph 的 interrupt 类似，但它是 graph 层概念；linnkit 在 control flag 层 |
| **`AgentSpec.contextPolicy` 细粒度上下文配置** | ✅ 预算 / 工具历史 / 摘要 / must-keep / checkpoint / tool output / provider replay 等逐步开放 | 同类通常只给 prompt/memory 粗粒度旋钮 |
| **RunSupervisor + AuditEnvelope + testkit invariants 一起设计** | ✅ 生命周期、审计、测试三件事互相校验 | 多数框架把 runtime、trace、test harness 分散在不同产品层 |

### 2.4 更新后的定位

linnkit 现在不再只是"带 context-manager 的 graph runtime"。更准确的定位是：

> 一个 TypeScript Agent framework kernel：固定主循环、强事件治理、强上下文工程、run 生命周期可管理、审计事实表可落地、测试不变量可复用；平台能力（IM、多租户、沙箱、memory backend、UI）仍交给 host。

它最该继续补的不是任意图编排，而是三类能力：

1. **外部 DX**：quickstart、CLI、示例 host、配置校验，把接入路径从"读 17 篇文档"压到"5 分钟跑起"。
2. **可视化与回放**：Replay SDK、PromptTrace、DevTools Web，把已经存在的事件和 context trace 变成开发者能看的东西。
3. **产品中性 ports**：MemoryPort、PermissionPort、SandboxPort、RedactionPort，让不同 host 能接自己的后端，而不是让 linnkit 变平台。

---

## 3. 引用与延伸阅读

- 各产品调研原文：[`../99-research-notes/`](../99-research-notes/)
- linnkit 当前评分：[`02-current-state-evaluation.md`](./02-current-state-evaluation.md)
- 协议层路线图：[`04-protocol-roadmap.md`](./04-protocol-roadmap.md)
