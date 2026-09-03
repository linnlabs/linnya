# 00 · 愿景与定位

> **一句话愿景**：linnkit 想成为 **TypeScript 生态里"工程纪律最强、可被多产品/多形态长期复用"的 Agent 内核框架**——既能跑桌面 app、又能跑常驻后台 daemon、未来还能拼装 multi-agent mesh，**用同一套内核**。

---

## 1. linnkit 是什么

linnkit 是一个 **Agent 框架**，不是 Agent 产品。

它给"想自己做 Agent 应用 / Agent 产品"的开发者提供 4 件最难做对的基础设施：

1. **可控的执行内核**（runtime-kernel）——一个跑过实战的固定形状 graph loop（user → llm → tool → answer / wait_user）+ tick pipeline + 节点协议；不要求用户去画图。
2. **可治理的事件模型**（event governance）——同一份事实通过 `persist / replayToUi / enterAgentContext / realtimeChannel` 四个维度向不同消费者投影；SSE、持久化、上下文准入、实时通道是**同一份事件**的不同视图。
3. **可复用的上下文工程**（context-manager + graph tick pipeline）——Context Manager 负责三阶段填充、working memory、完整工具组与纯 compaction 计划；Graph 用当前模型自动压缩、重建并在容量接纳后提交 `history_summary`。`replacementSourceIds` / `replacedMessageIds` 把净化、压缩和回放串成同一条可审计链路。
4. **可暂停可恢复的协议化交互**（wait_user / 未来 wait_external）——交互式工具通过 `control.requireUser=true` 触发协议级暂停，不是前端临时 patch。

**底色**：

- 根入口 + 6 个稳定子入口的公开面、Node-only / browser-safe 双形态、AST 级 boundary guard、10 条不变量规则、双层 testkit（context-harness + agent-harness）。
- 不绑死任何宿主、任何 LLM provider、任何持久化方案。
- 用 hexagonal architecture 把"宿主可决定的 / 框架自己决定的"硬切开。

---

## 2. linnkit 不是什么 / 不做什么

为了说清楚定位，**用排除法**比正面定义更清楚。

### 2.1 它不是 Agent 产品

linnkit **不内置任何业务工具**。你在 linnkit 里找不到：

- ❌ `bash` / `read_file` / `write_file` 等"代码工具"——这些归 Claude Code、Codex、Cursor 等产品
- ❌ `web_search` / `browser` / `crawl`——这些归调研类产品
- ❌ IM 通道（Telegram / Feishu / WeChat）——这些归"接 IM 的常驻 daemon"类产品
- ❌ 知识库 / RAG / 文档管理——这些归"知识工作平台"类产品

linnkit runtime 当前只拥有工具协议、执行生命周期和宿主注入 port，不把具体产品工具放进内核。未来若给稳定协议增加薄工具包装，也只能按 [`05`](./05-builtin-tools-protocol.md) 的门槛逐项评估，不能把候选清单写成已实现能力。

自动上下文压缩明确**不是工具**：Agent 看不到 `context_checkpoint`，也不负责判断何时释放历史；Context Manager 与 Graph pipeline 自动完成这件事。`todo`、child delegation、memory、skills 等若由具体产品提供，仍属于 Host/插件能力，除非未来另行满足框架级通用工具门槛。

### 2.2 它不是工作流引擎

linnkit **不要求你画图**。

- LangGraph 让你写 `graph.add_node(...) / add_edge(...)`——这是 graph-first 心智，对 90% 的 agent 应用是过设计。
- linnkit 的图是**固定 5 节点状态机**（user → llm → tool → answer / wait_user），写一个 agent 不需要理解 graph。
- 如果未来需要扩展节点（verify / critic / reflect / plan / vote / route），通过**节点注册 API** 加，不通过让用户画图加。

### 2.3 它不是"全平台 Agent 操作系统"

linnkit **不替宿主决定**：

- ❌ 不决定用什么 LLM provider（用户提供 `LlmProviderPort` 实现）
- ❌ 不决定持久化方案（用户提供 `Checkpointer` / `EventStore` 实现）
- ❌ 不决定 UI 渲染（用户拿 SSE 事件流自己渲染）
- ❌ 不决定权限策略（未来通过 `PermissionPort` 反向请求决策）
- ❌ 不决定沙箱方案（未来通过 `SandboxPort` 反向调用宿主能力）

---

## 3. 为什么要做 linnkit

### 3.1 现状的痛

TypeScript 生态里 agent 框架两极分化严重：

| 极端 | 代表 | 痛点 |
|---|---|---|
| **太轻** | Vercel AI SDK | `streamText + tool` 接口好看，但**没有 graph**、**没有 child-run**、**没有 wait_user**、**没有事件治理**——做完原型就走不下去 |
| **太重** | LangGraph (TS port) | StateGraph + checkpointer + interrupts 概念繁多，要求开发者**先理解图**才能写第一个 agent；很多人吐槽过设计 |
| **太产品** | OpenAI Agents SDK / CrewAI | `Agent + Handoff` 看起来简洁，但**事件治理、context engineering、可审计性是黑盒**；想魔改一个细节就掉到代码里 |

linnkit 的位置是 **"中间偏纪律"**：

- 比 Vercel AI SDK **重一档**——给你 graph loop / event governance / context-manager / wait_user 这些"长期主义"基础设施
- 比 LangGraph **轻一档**——graph 是隐式的固定形状，你不需要"画图"
- 比 OpenAI Agents SDK **白盒一档**——所有事件流、上下文窗口、prompt diff、tool call 全部可观测可审计

### 3.2 我们能赢的护城河

对比同类，linnkit 有 4 条别人短期内补不齐的设计：

1. **事件三层模型 + eventGovernance 四维**——SSE / 持久化 / 上下文准入 / 实时通道是同一份事实的不同投影。绝大多数对手做不到，因为他们的 event 是从 LLM SDK 透传出来的，不是自家事实表。
2. **`replacementSourceIds` 数据契约**——上下文压缩、摘要、净化、回放全链路用同一把 ID 串起来。Codex 的 `reference_context_item` 是同一思路但只在 ContextManager 内部，linnkit 把它做成跨模块协议。
3. **执行快照与上下文压缩严格分层**——`Checkpointer` 只恢复 Graph state / wait-user；自动 compaction 只改变下一次模型看到的上下文，并以 durable `history_summary` 留下事实。压缩不重置步数预算，也没有同名工具或 marker 旁路。
4. **interactive tool → `wait_user` 协议级暂停**——不是前端临时 patch。这条路通后，wait_external / wait_human / wait_subagent 都是同一条协议泛化，能横跨"桌面 UI / IM 回调 / cluster webhook"等不同形态。

详见 [`02 §2`](./02-current-state-evaluation.md) "做得好的 6 点"。

---

## 4. 目标用户

linnkit 假设它的接入方是**"想长期维护一个 agent 应用"的工程团队**，不是周末做原型的个人。

| 用户画像 | 是否适合 linnkit |
|---|---|
| 想 1 小时跑一个 demo 的人 | ❌ 用 Vercel AI SDK / OpenAI Agents SDK |
| 想画 graph 编排复杂工作流的团队 | ❌ 用 LangGraph |
| 想要"按角色分工的多 agent 协作框架"的团队 | ❌ 用 CrewAI / AutoGen |
| **想要一个稳定可控、可审计、可被多产品长期复用的内核**的团队 | ✅ linnkit |
| **想做"既有桌面 app 又有后台 daemon 又能未来上 cluster"的产品矩阵**的团队 | ✅ linnkit |

具体来说，linnkit 现阶段最适合 3 类场景：

1. **桌面知识工作 app**——需要 SSE 流式 UI / 持久化恢复 / 工具暂停等待用户
2. **后台 always-on agent daemon**——需要长 run 管理 / 子 run 树 / 多通道接入 / 跨进程事件
3. **多 agent mesh**（未来）——需要 agent-to-agent 协议、capability 协商、跨节点 RunSupervisor

---

## 5. 与消费者的关系

linnkit 是**框架**，所有装载它的产品都是**消费者**。

```text
   ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
   │  消费者 A           │  │  消费者 B            │  │  消费者 C+           │
   │  桌面知识工作台      │  │  常驻 IM 秘书 daemon │  │  (任何想做 agent     │
   │                     │  │                     │  │   的产品)            │
   └──────────┬──────────┘  └──────────┬──────────┘  └──────────┬──────────┘
              │                        │                        │
              └────────────────────────┴────────────────────────┘
                                       ↓
                        ┌─────────────────────────────────┐
                        │            linnkit              │
                        │  runtime-kernel + context-mgr   │
                        │  + 公开面入口 + AST guard       │
                        │  + (可选) 框架级通用工具         │
                        └─────────────────────────────────┘
```

**硬约定**：

- 任何 linnkit 升级，**必须**至少 ≥2 个消费者真实需要才能进协议层（详见 [`../archive/engine-phases/00-engine-scope-audit.md`](../archive/engine-phases/00-engine-scope-audit.md) §1.1 Q1-Q4 门槛）
- 通过门槛后，linnkit **必须**留出"信息丰富的接口"，让消费者做产品时不再 wrap linnkit
- 任何产品级实现（特定 IM 通道 / 特定知识库 / 特定 IDE 桥）**永远不进** linnkit
- linnkit 文档**不引用任何具体消费者的产品文档**——除非作为"已知用例"的简短举例

---

## 6. 与同类 Agent 框架/产品的位置

详见 [`01-peer-comparison.md`](./01-peer-comparison.md)，这里只给一句话：

| 对手 | linnkit 学什么 | linnkit 不学什么 |
|---|---|---|
| **LangGraph** | checkpointer 协议命名、interrupt 形态 | StateGraph 编排心智（太重） |
| **OpenAI Agents SDK** | Agent 一等对象、Handoff 简洁性 | event 透传 LLM SDK（无治理） |
| **Mastra** | DevTools / 工作流可视化 | 把 workflow 当一等对象（agent 才是） |
| **Vercel AI SDK** | API 简洁度、tool 注册形态 | 缺 graph / child-run / wait_user |
| **CrewAI / AutoGen** | role / 多 agent 心智 | 把"角色"当协议（应该是 AgentSpec 的字段） |
| **Claude Code** | Task 抽象、async generator 流式心智 | 文件式 memory（产品决策，不进框架） |
| **Codex** | AgentPath、Memory Citation、`reference_context_item` diff 注入 | Execpolicy DSL / Sandbox 实现（产品/host 决策） |
| **Hermes Agent** | `IterationBudget` / `on_pre_compress` 钩子位置 | 17 个 IM 通道 / 8 个 memory backend（产品决策） |
| **OpenClaw** | session-key 编码思路 | 同上（产品决策） |

---

## 7. 5 年后期望

如果路线图按 [`07`](./07-roi-ranked-priorities.md) 走完 Phase F / G / H：

- **Phase F 后**（约 2 个 sprint）：linnkit 是国内**少有的"既有 graph engine 又有 audit envelope 又有 CLI"** 的 TS agent 框架；30 行代码跑起 hello-agent。
- **Phase G 后**（约 1-2 个季度）：linnkit 支持 multi-agent mesh、内置 MemoryPort / PermissionPort、有 DevTools Web；后台 daemon 形态在框架层稳定可运行。
- **Phase H 后**（约 1 年）：linnkit 支持跨进程事件总线、分布式 Checkpointer、跨节点 RunSupervisor；可以装一个跨设备的 agent mesh。

**3 句口号收尾**：

- 不替你画图，但替你管 graph。
- 不替你接通道，但替你治事件。
- 不替你做工具，但替你定协议。
