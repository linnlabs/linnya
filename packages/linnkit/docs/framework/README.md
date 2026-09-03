# framework/ · linnkit 作为独立 Agent 框架的演进工作面

> 本目录是 linnkit **作为独立 Agent 框架** 的活文档区——回答"框架长什么样、要往哪走、为什么这么走"。
> 它接力 [`../archive/engine-phases/`](../archive/engine-phases/) 留下的早期抽包决策档案，向前指向后续的协议演进路线。

---

## 1. 这个目录回答什么问题

本目录回答 8 个问题：

1. **linnkit 是什么样一款框架？**——愿景、定位、它跟 LangGraph / Mastra / OpenAI Agents SDK 是什么关系（[00](./00-vision-and-positioning.md) / [01](./01-peer-comparison.md)）。
2. **现在它处于什么水平、卡在哪？**——客观打分、6 项已经做对的、7 类明显欠缺的（[02](./02-current-state-evaluation.md)）。
3. **要往哪 9 个方向走？**——通用 / 高级 / 易用 / 灵活 / 健壮 / 优雅 / 易审计 / 多 Agent / 集群（[03](./03-target-evolution-axes.md)）。
4. **接下来 1-2 个 sprint 具体做什么、为什么是它？**——6 条新协议层 + 4 条治理升级 + 几件框架级工具 + 5 项 DX，按 ROI 排序的优先级清单（[04](./04-protocol-roadmap.md) / [05](./05-builtin-tools-protocol.md) / [06](./06-developer-experience-roadmap.md) / [07](./07-roi-ranked-priorities.md)）。
5. **存量边界债怎么还？**——把当前 `context-manager/*` 漏到 framework 内的 host 产品语义剥出去，同时沉淀通用围栏家族注入机制（[08](./08-context-engineering-package-boundary.md) 设计 + [09](./09-context-engineering-package-boundary-plan.md) 实施计划）。
6. **2026 H1 升级具体怎么执行？**——已完成阶段的执行档案 + 决策史 + 隐患台账（[10](./10-history-and-decisions-2026.md)）；旧阶段计划（[11](./11-upgrade-plan-next.md)）。
7. **token 预算、usage、计费统计怎么统一？**——`TokenizerPort` 已落地档案（[12](./12-tokenizer-port-plan.md)）与下一阶段 token ledger 升级计划（[13](./13-token-management-ledger-plan.md)）。
8. **当前治理与下一站是什么？**——14 号是治理收官索引，15 号是质量治理账本，16 号是 benchmark 自动化入口。

> 多模态 Phase 1-6 的提案与 runbook 是实施期临时材料，不纳入本稳定导航。实施收口时，应先把仍有效的协议和接入规则迁移到正式文档，再统一删除临时材料；正式文档不得反向依赖临时计划。

---

## 2. 目录结构

```text
framework/
├── README.md                              # 本文件，工作面入口
├── 00-vision-and-positioning.md           # 愿景、目标用户、与同类框架的位置关系
├── 01-peer-comparison.md                  # 与 LangGraph/Mastra/OpenAI SDK/CC/Codex/Hermes/OpenClaw 内核对比
├── 02-current-state-evaluation.md         # 8 维度打分 + 6 项强项 + 7 类短板
├── 03-target-evolution-axes.md            # 9 个目标演进轴的展开
├── 04-protocol-roadmap.md                 # 6 条新协议层（N-1~N-6）+ 4 条治理升级（G-1~G-4）
├── 05-builtin-tools-protocol.md           # 框架级通用工具（优先级靠后）
├── 06-developer-experience-roadmap.md     # CLI / quickstart / DevTools / Test DSL / plugin 模板
├── 07-roi-ranked-priorities.md            # ROI 矩阵 + Phase F/G/H 时间表 + "立刻做什么"
├── 08-context-engineering-package-boundary.md   # 设计：剥离 host 语义 + 沉淀围栏家族通用机制
├── 09-context-engineering-package-boundary-plan.md  # 实施计划：Phase A/B/C 任务、依赖、回归矩阵
├── 10-history-and-decisions-2026.md             # 2026 H1 历史档案：已完成阶段 0/1A/1B + 已固化决策 + 隐患台账（追加历史不修改）
├── 11-upgrade-plan-next.md                      # 0.5.0 之后的未来计划：阶段 1F/1C/1D/1E/2/3
├── 12-tokenizer-port-plan.md                    # TokenizerPort 已落地档案：host 替换预算 tokenizer
├── 13-token-management-ledger-plan.md           # Token ledger / usage / cost / 多模态 token 升级计划
├── 14-governance-and-cleanup-plan.md            # 治理收官索引：已完成治理 / 迁移去向 / 剩余尾巴
├── 15-robustness-and-decoupling-audit.md        # 健壮性 / 解耦专项收官账本
└── 17-tool-pair-lifecycle-redesign.md           # 工具对生命周期重设计：input/output 分离、废除 pair-token 触发（已落地）
```

目录中可能暂存未列出的 Phase/runbook 文件；它们是当前实施工作面，不构成稳定信息架构。

---

## 3. 阅读顺序

### 第一次看 linnkit（30 分钟版）

1. `00-vision-and-positioning.md` —— 我们到底在做什么、不做什么
2. `02-current-state-evaluation.md` —— 客观看 linnkit 现在处于什么水平
3. `10-history-and-decisions-2026.md` —— 看 2026 H1 走过了什么、做了什么决策
4. `14-governance-and-cleanup-plan.md` / `15-robustness-and-decoupling-audit.md` —— 看当前治理结论与质量账本

### 在做架构决策前

1. `11-upgrade-plan-next.md §6` —— 必不做清单（防止压力推上来）
2. `10-history-and-decisions-2026.md §9` —— 已固化的设计决策（不可逆，除非显式开 ADR 推翻）
3. `10-history-and-decisions-2026.md §10` —— 已知隐患台账
4. `03-target-evolution-axes.md` —— 确认目标方向词在我们体系里的定义
5. `04-protocol-roadmap.md` —— 找到对应协议层的设计意图
6. `01-peer-comparison.md` —— 看同类框架是怎么做的、教训是什么

### 给框架加新东西前

1. 检查这件事在 `04-protocol-roadmap.md` / `05-builtin-tools-protocol.md` 里是不是已经规划过
2. 如果是新东西：先过 [`../archive/engine-phases/00-engine-scope-audit.md`](../archive/engine-phases/00-engine-scope-audit.md) §1.1 的 Q1-Q4 门槛
3. 再回到本目录开 `08-<topic>.md` 写设计

---

## 4. 与其他子目录的关系

| 子目录 | 状态 | 关系 |
|---|---|---|
| [`framework/`](./) （本目录） | 🟢 **活文档** | linnkit 框架演进工作面 |
| [`../99-research-notes/`](../99-research-notes/) | 🟢 **活文档** | 外部项目调研笔记池（Codex / CC / Hermes / OpenClaw），本目录的 01 引用它们 |
| [`../archive/engine-phases/`](../archive/engine-phases/) | 🔴 **已归档** | 早期抽包决策史料；按 [§5](#5-archived-engine-处置策略) 处置 |

> 任何接入方的产品文档**不在本目录**——接入方文档应当在自己的仓库里。

---

## 5. archived `engine/` 处置策略

`../archive/engine-phases/` 收录 24 份 `.md`，是早期把 linnkit 抽成独立 package 的决策档案。它们已经服务完使命，处置策略：

| 时机 | 动作 |
|---|---|
| **现在** | 已移入归档区；不再修改任何决策段落；不再加新 topic |
| 协议层 N-x 全部上线后 | 把里面**仍有效的不变量**（事件三层模型、eventGovernance 四维、replacementSourceIds、wait_user 协议、两类 checkpoint 严格区分）摘到 `framework/` 下成为正式协议参考 |
| 摘录完成 + 6 个月稳定 | 整目录**物理删除**，git 历史保留为唯一备份 |

> 任何今天还想改 `archive/engine-phases/*` 的需求 —— **回到本目录开新 topic** 处理；归档区只读。

---

## 6. 工作方法（继承自 [`../README.md §4`](../README.md)）

1. **一次研究一个 topic**，不并行。
2. 每个 topic 文档统一模板（问题 / 现状 / 同类框架做法 / 候选方案 / 倾向 / 落地任务 / 状态）。
3. 调研结论先写进 `../99-research-notes/<project>.md`，再把"对我们的启发"摘进对应 topic。
4. **任何往 framework 协议层加东西的请求，先过门槛**：
   - 协议而非实现
   - ≥2 个消费者的真实需求
   - framework 不加就没法接
   - 不破坏现有不变量
5. 写完一个 topic commit 一个，message 格式：`docs(linnkit): write framework/<topic-id> <短描述>`。

---

## 7. 当前阶段总览

> **历史档案**：[10-history-and-decisions-2026.md](./10-history-and-decisions-2026.md)——已完成阶段执行清单、完成判据、已固化决策、隐患台账、状态登记。
> **旧未来计划**：[11-upgrade-plan-next.md](./11-upgrade-plan-next.md)——0.5.0 之后阶段 1F / 1C / 1D / 1E / 2 / 3 任务清单（**注：本文立稿 2026-05，多数阶段已完成**）。
> **权威状态源（2026-08-09 发布校准）**：实际版本已达 **`0.28.0`**——版本变化以 [`CHANGELOG.md`](../../CHANGELOG.md) 为准；治理收官索引见 [`14-governance-and-cleanup-plan.md`](./14-governance-and-cleanup-plan.md)，质量治理收官见 [`15`](./15-robustness-and-decoupling-audit.md)。下表是阶段级历史台账，状态列已按真实代码校准。

| 阶段 | 内容 | 状态 |
|---|---|---|
| 0 | 建立 framework/ 目录骨架（00 ~ 07 八份初稿） | ✅ 完成 |
| **E**（边界整治 / 阶段 1A） | 剥离 host 产品语义 + 沉淀围栏家族注入机制（详见 [`08`](./08-context-engineering-package-boundary.md) / [`09`](./09-context-engineering-package-boundary-plan.md)） | ✅ 0.4.0 完成：通用 fence 机制、linnya host 注入迁移、chat namespace 冻结、framework legacy 字段清扫、no-host-leakage 守卫均已落地 |
| **F P0**（阶段 1B） | N-1 `AgentSpec` / N-3 `RunSupervisor`/`RunHandle` v2 / G-1 `AuditEnvelope`+`AuditPort` + testkit 15 不变量 + docs 重组 | ✅ **0.5.0 完成**：N-1 AgentSpec 与 host `contextPolicy` 装配；RunHandle/RunSupervisor 完整本体（含 `spawnDetached` / `waitForTerminal` / `drain` / `recoverOnBoot` / awaiting_user 联动）；AuditEnvelope + EventStore/File/Composite sink + 5 类决策；同步 child-run cost 父子聚合；INTEGRATION_GUIDE 拆分为 17 主题手册 |
| **F P1**（阶段 1F）| Context Engineering 协议化：`AgentSpec.contextPolicy` 12 大分组 / 35+ 字段；SystemReminder 与摘要注册 agent；装配级 ContextPolicy fallback；最小 `ContextTrace` 观测闭环 | ✅ **0.6.0 完成**：F1.0–F1.14 全闭环，release gate 已过（exports snapshot 已含 SystemReminder 符号） |
| F P2（阶段 1C / 1D / 1E） | `linnkit-cli` v0 + quickstart；chat execution mode 收敛 + 删 linnkitCompat；linnsy 适配 thin wrapper | ✅ / 🟦：**1C ✅ 0.7.0 完成**（init/run/doctor + quickstart helpers）；`linnkitCompat` 已从 src 删；旧 chat execution mode 已清理，当前前端 `chat` 命名只表示产品对话流；1E 属 linnsy host 工作 |
| G（阶段 2 · 性能/DX 子集） | Token Ledger / CostLedger / DevTools / Replay SDK / Test DSL / PermissionPort | 🟦 部分：**Token ledger 批 1–4 已落地（0.10→0.17）**；批 5/6 + CostLedger/DevTools/Replay/Test DSL/PermissionPort 仍排期（见 14 文档 D 类）|
| ~~G·业务层 port~~ | ~~`MemoryPort` / `KnowledgePort` / `PromptTrace`~~ | ❌ **已重新评估为不做**（本质是 host 业务层"工具+召回+fence"/ ContextTrace 已覆盖；详见 [`comparison §17.8`](../99-research-notes/topic-agent-framework-comparison-2026.md)，2026-06-22 复核维持）|
| H（阶段 3） | 跨进程 `EventBusPort` / 分布式 Checkpointer / Agent discovery / `wait_external` / cluster RunSupervisor / AgentMessageBus | 📋 按需触发，不预先承诺（详见 [`11 §5`](./11-upgrade-plan-next.md)） |
