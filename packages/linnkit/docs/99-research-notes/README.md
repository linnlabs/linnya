# 99 · 外部参考项目调研笔记

本子目录是各外部参考项目的**原始调研笔记**，不是决策文档。

---

## 1. 笔记 vs 主文档关系

```
┌─────────────────────────────────┐
│  99-research-notes/<project>.md │  ← 完整、原始、可能很长
│  - 项目架构总览                   │
│  - 关键模块拆解                   │
│  - 文件路径与代码片段             │
│  - 我们的判断与吐槽               │
└──────────────┬──────────────────┘
               │ 摘录"对我们有启发的部分"
               ▼
┌─────────────────────────────────┐
│  engine/<NN>-<topic>.md         │  ← 短、精炼、聚焦决策
│    §3.X <project>               │
│  secretary/<NN>-<topic>.md      │
│    §3.X <project>               │
└─────────────────────────────────┘
```

**原则**：

- 笔记可以长，可以乱，可以含主观判断（包括吐槽）
- 主文档（engine / secretary topic）只摘录精华，不展开实现细节
- 同一项目的同一发现可能被多个 topic 引用——以**笔记**为权威源

---

## 2. 项目清单（**纵向**——单项目深度笔记）


| 项目                              | 用途              | 质量评估                                               | 调研状态   | 笔记               |
| ------------------------------- | --------------- | -------------------------------------------------- | ------ | ---------------- |
| **OpenClaw**                    | 同类秘书产品          | ⚠️ AI 辅助快速产出，含大量低质量代码与多套并存 runtime；**只取设计意图，不抄实现** | ✅ 已调研  | `openclaw.md`    |
| **Claude Code (Anthropic CLI)** | 极优秀 agent 产品    | ⭐⭐ 优秀，工程质量极高；可同时学习架构与实现细节（部分模块除外）                  | ✅ 已调研  | `claude-code.md` |
| **Codex (OpenAI CLI)**          | 极优秀 agent 产品    | ⭐⭐ 优秀，模块化纪律极强（<500 LoC/模块），crate-per-concern；可同时学习架构与实现细节 | ✅ 已调研  | `codex.md`       |
| **Hermes Agent (NousResearch)** | 同类秘书产品（多 IM/cron/RL） | ⚠️ **「文档优先 + 巨型实现」契约**——AGENTS.md 25KB+完整文档站+~3000 测试，但 1.27 万行单文件比 OpenClaw 更夸张；**产品功能广度 = 当前开源最广**（17+ IM 渠道 / 8 memory 后端 / MCP 双向 / ACP server），**架构借鉴反例多于正例** | ✅ 已调研  | `hermes.md`     |

---

## 2b. 主题清单（**横向**——多项目源码对比）

> 当 secretary topic 的某条决策需要看"4 家分别怎么做"时，产出**主题型笔记**而不是改写每个项目笔记。
> **强制纪律**：主题型笔记的所有结论**必须带 file:line 引用源码**——派 subagent 调研时禁止只读纵向笔记或 WebSearch（教训详见 `topic-sub-agent-multi-turn.md` §0）。

| 主题 | 涉及项目 | 触发文档 | 笔记 |
|------|----------|---------|------|
| **子 agent 多轮父子交互** | CC + Codex + Hermes + OpenClaw | `linnsy/01b-product-scenarios.md` §5.5 | [`topic-sub-agent-multi-turn.md`](./topic-sub-agent-multi-turn.md) |
| **资源监控 / 卡死处置 / 紧急消息穿透** | CC + Codex + Hermes + OpenClaw | `linnsy/01b-product-scenarios.md` §5.4 | [`topic-resource-monitoring-and-notifications.md`](./topic-resource-monitoring-and-notifications.md) |
| **多 AI 分工 + 精细上下文管理** | CC + Codex + Hermes + OpenClaw | `linnsy/05-multi-ai-and-context-strategy.md`（§5.6 衍生长文） | [`topic-multi-ai-and-context-strategy.md`](./topic-multi-ai-and-context-strategy.md) |
| **2026 主流 Agent 框架横向对比** | linnkit + LangGraph + LangChain + OpenAI Agents SDK + Vercel AI SDK + Mastra + DeerFlow + CrewAI + AutoGen + LlamaIndex + CC/Codex/Hermes | 用户要求评估 linnkit 优缺点与潜力 | [`topic-agent-framework-comparison-2026.md`](./topic-agent-framework-comparison-2026.md) |
| **Behavior Control Loop（监测-反馈循环 / 伞名 Agent Behavior Engineering）** | linnkit runtime-kernel/context-manager + Linnya benchmark + Life-Harness/HarnessBridge/TrajAD/ProbGuard/AgentPRM/DataPRM/AgentSpec/C-Trace/ABC/SmartSearch/TRACE/AgentPro/AgentTraces-to-Trust + harness-engineering 工程实践 | 用户提出"监测-反馈"循环设想：不靠昂贵 AI 监测 Agent 行为并在合适处反馈 | [`topic-behavior-engineering.md`](./topic-behavior-engineering.md) |


---

## 3. 单项目笔记的统一结构

```markdown
# <Project Name>

> 调研日期：YYYY-MM-DD  
> 调研深度：浅 / 中 / 深  
> 质量评估：一句话总评  
> 借鉴边界：⚠️ 仅意图借鉴 / ✅ 可学习架构 / ⭐ 可学习实现细节

## 1. 项目定位
## 2. 顶层目录与代码组织
## 3. 核心架构主线
## 4. 关键模块拆解
   3.1 <模块>
       - 文件路径
       - 代码片段（短）
       - 解决什么问题
       - 我们能学什么 / 不学什么
## 5. 工程化质量评估
## 6. 对我们的启发清单（按 topic 归档）
   - engine/01-...：xxx
   - secretary/03-...：xxx
## 7. 我们不打算抄的部分（避免后人误抄）
## 8. 后续深挖待办（如果需要回来再读）
```

---

## 4. 状态

- 本目录会随每个项目的研究推进持续更新
- 项目研究的触发节奏：每个 engine / secretary topic 开工时，**主动**回头查相关项目笔记是否覆盖了对应模块；如果没覆盖或覆盖不深，**回到对应项目深挖一次再继续 topic**
- **主题型笔记纪律**（2026-04-23 教训确立）：横向对比某个产品决策时，必须**直接读源码** + **带 file:line 引用** + **subagent 派发指令明确禁止只读笔记/WebSearch**——避免"在二手解读上转圈"
