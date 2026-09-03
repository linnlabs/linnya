# 主题调研 · Agent "监测-反馈"循环（Behavior Control Loop / Agent Behavior Engineering）

> - 调研日期：2026-06-22
> - **状态校准（2026-08-25）**：本文是当时的研究快照，不是当前 Runtime 合同。§2 中的 checkpoint step-reset、`absoluteMaxSteps`、`maxCheckpoints` 与 `budget-warning` 已删除；当前 Graph 只有单一 `maxSteps`，自动上下文压缩作为同一 tick 的 pipeline stage 运行。现行合同见 [`integration/context-engineering.md`](../integration/context-engineering.md) 与 [Graph Engine README](../../src/runtime-kernel/graph-engine/README.md)。
> - 调研范围：linnkit runtime-kernel（GraphExecutor / tick-pipeline / system-reminder / toolNode）+ context-manager；Linnya host 装配层与 benchmark；2026 年前沿论文与工程实践（Life-Harness / HarnessBridge / TrajAD / ProbGuard / AgentPRM / DataPRM）+ harness-engineering 博客（O'Reilly / amux / NVIDIA Elements）+ 评测实践（agentevals / Scorer Live Monitoring / Sampled Prompt Trace Eval / OTel GenAI eval 约定）。
> - 产出性质：**研究笔记 + 概念定稿**，不是落地设计文档。若进入协议改造，把结论摘到 `docs/framework/<topic>.md`，再在 `docs/integration/` 写接入面。
> - 触发来源：用户提出"监测-反馈"循环设想——如何在不依赖昂贵 AI 的前提下，对 Agent 行为做有效监测，并在合适的位置做合适的反馈，从而提升输出质量与深度。
> - 重要限制：外部论文以 arXiv 编号标注，未做复现；linnkit 结论均带 file:line 源码引用。
> - 2026-06-22 第二轮讨论增补：病理三分类（§3.5）、反馈四动作 + 第六组件 Arbiter（§3.5）、Signal substrate 定稿（§8）、任务分类用 capability flags（§12）、收缩版落地边界 + rollout 顺序（§13）。概念层已收敛，仍在讨论阶段，**未改代码**。
> - 2026-06-22 第三轮深读增补：命名分层收窄（伞=Behavior Engineering / 主线=Behavior Control Loop，§0）、第二批 8 篇前沿三组吸收（§4.5）、Provenance 拆结构性/语义性（§4.5）、闭环阻尼改写成 ABC hard/soft invariant + recovery window（§8）、Detector 形态定稿为 DetectorPort + 开放可扩展 Verdict（§8/§10）、补"不要误抄"四条（§11）。仍未改代码。

---

## 0. 一句话结论

用户提出的"监测-反馈"循环，在 2026 年已经是一个有名字、有论文、有工程共识的方向（学术叫 **runtime harness control / trajectory regulation**，工程叫 **sensors + grounded feedback**）。它的正确抽象不是"监工打分"，而是 **信息不对称矫正器**：

> Agent 每个 tick 看到的是被裁剪、被压缩、有损的视图；harness 手里握着完整无损的 trajectory + 廉价派生统计。**反馈的本质 = 把 Agent 结构上看不见的那一小片"全局事实"精准塞回它眼前。**

这条定义直接划出了"要不要 AI"的边界，并解释了为什么用户"不靠 AI 监测"的直觉**部分成立、部分被实测推翻**（见 §5、§6）。

**命名分层（2026-06-22 第三轮修正：早期把概念扩大成了一个学科，现在收回）**：

- **Agent Behavior Engineering（伞 / 学科名，允许宽）**：面向 AI agent 的工程方法，涵盖上下文、工具、权限、记忆、循环、评估、反馈、运行时控制——把 agent 行为从"模型输出"变成可设计、可验证、可治理的系统行为。这一层只是给本工作一个归属，不是本文件要交付的东西。
- **Behavior Control Loop（本文件主线 / 精确子系统）**：伞下我们真正在设计的那一个东西——`monitor → detect → feedback` 的运行时控制环。它才是有边界、有新意、要落地的核心。三者并列：context engineering 决定"给它看什么"，loop engineering 决定"它怎么行动"，**Behavior Control Loop 决定"外部系统如何把它的行动持续推向更好的结果"**。

注意：别让伞名（Behavior Engineering）把主线（Behavior Control Loop）稀释回口号。下文除 §4.5 谈学科归属外，"本系统"一律指 Behavior Control Loop。

---

## 1. 概念定稿：两个循环，一个底座

不要把它想成一个循环。它是**一个底座 + 两个频率不同的反馈出口**：

```text
                     ┌─────────────────────────────────────┐
   RuntimeEvent 流 ──▶│  Signal substrate（事件流派生量）      │  ← framework 提供
                     │  工具序列 / 参数hash / 成败 / 读入token │
                     │  累计 / 关键词集合 / 引用密度 / 距上次   │
                     │  taskstate_write 步数 ...              │
                     └───────────────┬─────────────────────┘
                                     │
                     ┌───────────────▼─────────────────────┐
                     │  Detector registry（host 注册）        │  ← 类比 FenceRegistry
                     │  detector: signals → {病理, 置信度, 证据}│
                     └───────────────┬─────────────────────┘
                                     │ 多个 detector verdict（同 tick 可能并发）
                     ┌───────────────▼─────────────────────┐
                     │  Arbiter / Feedback bus（第六组件）     │  ← 跨 detector 仲裁
                     │  去重 / 冷却 / severity 仲裁 / 每tick预算│
                     └───────┬───────────────────┬──────────┘
              高置信 / 确定性  │                   │  低置信 / 语义 / 越界
              ┌──────────────▼──────┐    ┌─────────▼─────────────┐
              │ 快循环 controller     │    │ 慢循环 evaluator        │
              │ 每 tick / 每动作      │    │ 采样 / 异步 / 离线       │
              │ 出口：reminder / 阻断 │    │ 出口：重做 / spec 修正   │
              │ / 重试 / phase 强制    │    │ / HITL / 注入下一轮      │
              └─────────────────────┘    └───────────────────────┘
```

**统一点**：两个循环读同一个 Signal substrate、注册到同一个 Detector registry。区别只在**反馈出口和频率**。快循环用廉价 detector 当场 steer；慢循环是快循环"升级"上来的——detector 报警但置信不足、或问题本质是语义的，才升级到 AI / 人。

这与 linnkit 既有哲学同构：framework 给"插槽"，host 给"内容"。参考 `FenceRegistry` 的边界设计（`packages/linnkit/docs/integration/context-fences.md` §10）。

### 词汇表（建议统一口径）

| 概念 | 定义 | linnkit 现有对应 |
|---|---|---|
| **Signal** | 从 RuntimeEvent 流派生的可计算量 | 目前散落在 system-reminder helpers（如 `countToolCallsInCurrentRequest`）|
| **Detector** | signals → Verdict；host 经 DetectorPort 实现，framework 守"纯函数 + 可序列化 + 自动审计"契约（§8） | 目前只有 5 条 system-reminder trigger，且只会数标量 |
| **Verdict** | detector 输出：{病理, 置信度, 证据, hard·soft, recoveryWindow ...}，**开放可扩展 record**（§4.5/§8） | **当前不存在** |
| **Feedback action** | 四种动作：Expose Fact / Constrain Next Step / Reject Action / Escalate（见 §3.5） | 目前只有 `<system-reminder>` 注入（≈Expose）+ `protocolFuse` 熔断（≈Reject）|
| **Arbiter / Feedback bus** | 跨 detector 去重 / 冷却 / severity 仲裁 / 每 tick 反馈预算（第六组件，§3.5） | **当前不存在** |
| **Placement** | 注入点（LLM 输出后 / 工具结果后 / final 前 / 发 LLM 前） | `buildDecisionStage` / `toolNode` / `applySystemReminderStage` |
| **Escalation** | 廉价 detector 触发昂贵 judge / 人 | **当前不存在** |

---

## 2. linnkit 现状：监测-反馈只做了"最廉价的一类信号"

linnkit 是双层循环：

- **外层** `GraphExecutor.runUntilYield`（`packages/linnkit/src/runtime-kernel/graph-engine/engine.ts` 173–389）：管步数 / phase / 路由 / checkpoint 重置。`absoluteMaxSteps = maxSteps * (maxCheckpoints + 1)`，phase 在 `force_final_answer` / `force_tools` / `running` 间流转（engine.ts 229–242）。
- **内层（当时基线）** tick-pipeline：`prepare_call → build_context → apply_system_reminder → execute_llm → build_decision`。当前 pipeline 已在 Reminder 与主调用之间加入 measure / compact / admit / commit，位置与 role 合同以文首链接的现行文档为准。

当前所有"监测-反馈"落点：

| 机制 | 监测信号 | 反馈方式 | 成本 | 源码 |
|---|---|---|---|---|
| system-reminder（5 条） | stepCount / phase / 剩余步数 / 工具调用**次数** / budget ratio | 末条 message 注入 `<system-reminder>` | 零 AI | `runtime-kernel/system-reminder/rules.ts` 14–39、`triggers.ts`、`apply.ts` 66–113 |
| protocolFuse | 连续 4 次 protocol error | 熔断 run | 零 AI | `graph-engine/nodes/toolNode.protocolFuse.ts` |
| 工具 error 回灌 | 工具执行失败 | error 作为 `tool_output` 进下一轮 | 零 AI | `toolNode.ts` 410–475 |
| observationGovernance | observation 字符 / 行数 | 截断 + 落盘 + preview 指针 | 零 AI | `toolNode.observationGovernance.ts` |
| 离线 Benchmark | case 声明的业务事实与人工审阅维度 | CLI 事实报告 + 人工审阅 | 可控 | `apps/linnya-benchmark/README.md` |

**关键缺口**：

1. in-loop 反馈（system-reminder）**只用计数类标量**，不看工具成败 / 是否连续重复同一工具 / 回答前是否调关键工具 / 上下文是否被乱读爆 / 搜索关键词糙不糙。
2. host 侧**零 `extraRules`**——协议支持，但 Linnya 只用 `enabledRuleIds` 选内置 5 条（`src/app-hosts/linnya/adapters/flow/agent-runner/executionPolicyAssembler.ts`）。
3. 旧 benchmark 的离线规则已随废弃体系删除；若要把离线信号用于实时反馈，必须从 RuntimeEvent 的稳定事实重新定义，不能复活旧评分器。
4. `contextTrace` 默认关闭（`DEFAULT_CONTEXT_POLICY.contextTrace.enabled: false`）。

**结论**：linnkit 已有 in-loop 反馈通道（system-reminder），但还没有经真实 case 校准的离线信号目录；新 Benchmark 只负责采样与审阅，是否升级为实时规则必须另行验证。

---

## 3. 病理分类：矫正所需是"可计算事实"还是"判断"

按"矫正这个病理需要的东西是【可计算事实】还是【语义判断】"重切用户的负面状态清单（这比"行为 vs 内容"更精确）：

| 负面状态 | 矫正所需 | 廉价可做？ |
|---|---|---|
| 连续调同一工具 / 参数几乎不变 | 跨 tick 参数 hash 序列（事实） | ✅ 纯计算 |
| 回答前没调关键查询工具 | 本 run 工具集合 ∌ {关键工具}（事实） | ✅ 纯计算 |
| 上下文太长还在乱读 | 累计读入 token / final_answer 未出现（事实） | ✅ 纯计算 |
| 工具失败率高 | tool_output.status 统计（事实） | ✅ 纯计算 |
| 调错工具 / 参数类型错 | schema 校验（已有 normalize/validate） | ✅ 已部分有 |
| 引用缺失 / 引用了没读过的源 | 引用标记 vs 事件流检索记录（事实，见 §7） | ✅ 纯计算（linnya 特有红利） |
| 搜索关键词太粗 / 重复检索 | 关键词长度 / 数量；语义相似度（proxy） | ⚠️ proxy，需校准；语义层需 embedding |
| 没按格式 / 语法错 | 结构 / 正则校验 | ✅ 表层可做，深层不行 |
| **深度不够 / 问题发现不全面** | **判断** | ❌ 必须语义模型 / 人 |
| 搜索"方法不当" | **判断**（vs 关键词粗是 proxy） | ❌ 必须语义模型 |
| 方向 / 规划错误 | **判断**（可用"距上次 taskstate_write 步数"做 proxy 触发） | ⚠️ proxy 触发，判断需语义模型 |

**比例**：约 6 成是纯可计算事实（快循环零 AI 全包），3 成是 proxy（能做但必须校准误报），1 成是纯判断（只能进慢循环）。**想用零 AI 快循环覆盖那 1 成，是和原理对着干。**

---

## 3.5 概念精化（2026-06-22 第二轮讨论）

§3 按"可计算 vs 判断"切。落到工程上还要再切两刀，并补一个早期漏掉的第六组件。

### 病理三分类（替代早期"两类"口径）

不要因为问题"出现在 final answer 上"就丢给慢循环。按**判据性质**分三类：

| 类 | 含义 | 例 | 循环 |
|---|---|---|---|
| **Process pathology** | 行为过程异常 | 重复等价搜索、连续空结果、读量大无产出、久未 checkpoint | 快 |
| **Contract violation** | 输出/协议契约异常 | JSON 非法、该中文出英文、缺 citation 字段、final 为空/过短、引用了不存在的 evidence id | 快（contract controller）|
| **Semantic quality pathology** | 语义质量异常 | 深度、全面性、洞察、方向 | 慢 |

关键：Contract violation 虽作用在最终内容上，但判据确定性，归快循环。前提是"契约"先成为机器可检验对象——见 §12（用 capability flags 从静态 AgentSpec 派生，不做 NL 实时分类）。

### "调错工具"必须拆成窄病理

不要写 `wrong_tool`。确定性的（快循环）：`tool_not_found` / `tool_args_schema_invalid` / `missing_required_arg` / `tool_not_allowed_in_phase` / `repeated_equivalent_call_no_change`。语义性的（需 contract 或慢循环）：本该查资料却写作、本该读全文却只搜标题、本该问用户却擅自继续。**原则：不要把语义判断伪装成确定性规则。**

### 反馈 = 四种动作（不只 reminder text）

| 动作 | 含义 | 机制 | linnkit 现成可复用 |
|---|---|---|---|
| **Expose Fact** | 把 agent 看不见的事实告诉它 | 注入文本 | system-reminder |
| **Constrain Next Step** | 限制下一步可用动作 | 改 available tools / tool_choice | **`prepareCallStage` 现有工具强制机制（force_final_answer / force_tools 即是）** |
| **Reject Action** | 阻断某个工具调用或 final | 动作闸门拦截 | `toolNode` protocolError/fuse + 新 pre-final 闸门 |
| **Escalate** | 交慢循环 / 人 / judge | 异步出口 | 无，新建 escalation port |

四种不是 severity 阶梯，是四种 kind，各绑不同 placement。**Reject 必须带"重试上限 N，超了 Escalate 或带标记放行"**——否则 reject→resubmit→reject 自造死循环（protocolFuse 连续 4 次熔断就是这个纪律）。

### 第六组件：Arbiter（Feedback bus）

§1 五概念漏了一个。cooldown / 去重 / 频率预算 **不是 detector 各自的属性，必须中心化**：同 tick 多个 detector 并发 fire 时需要

- 跨 detector 去重 / 冷却 / "每 tick 最多 1 条反馈"预算
- severity 仲裁：Reject > Constrain > Expose，高强度压低强度

这才是"误报灾难"真正的防线——precision 不只在单 detector，更在 Arbiter 的"宁缺毋滥"预算。Arbiter 是 framework 层一等组件，与 Signal substrate 并列。

---

## 4. 前沿对照：用户的设想已被两篇论文精确做出

### 4.1 Life-Harness（Harvard–MIT, arXiv 2605.22166）—— 最贴"零 AI 行为监测"

四层运行时；最后一层 **Trajectory Regulation Layer** 就是用户的"监测器"。核心原话：

> "Many agent failures are self-reinforcing... Such failures are often **detectable from trajectory-level patterns rather than deep semantic understanding**."

- 监测退化模式：重复同一动作、两状态间震荡、反复 search/click、预算耗尽——全是廉价确定性信号，对应 §3 第一类。
- 输出 `RegulateTrajectory(τ, a, o, b)` 是**分级**的：空 / 软恢复消息 / 重复失败警告 / 强纠偏指令——正是 §1 的分级反馈通道。
- 方法论：**先人工标注失败轨迹、归出 taxonomy，再给每类配固定 intervention**；harness 从训练轨迹"进化"出来后**冻结**用于评测。

### 4.2 HarnessBridge（UCLA, arXiv 2606.12882）—— 最贴"反馈结构 + 防误报纪律"

把 harness 形式化成**双向投影**：

- **observation projection**：原始 trajectory → agent 可见精简状态 = **linnkit 的 context-manager**。
- **action projection**：对 agent 提出的动作做 pass / reject，reject 时给反馈 = **用户要的监测-反馈，linnkit 当前完全没有这一半**。

反馈结构（建议直接采纳）：

> `ρ = (concern, evidence, suggestion)`；concern 说哪里不对，evidence 指出 trajectory 里支撑判断的**具体证据**，suggestion 给可执行方向。
> **"If Pact cannot provide trajectory-grounded evidence, it defaults to Pass."** —— 拿不出证据就放行。

强背书 linnkit：HarnessBridge 明确 **"does not destructively overwrite the interaction history; raw trajectory is always retained as the authoritative record"**——这就是 linnkit "RuntimeEvent 历史是权威事实、context-manager 只产视图"的设计（`packages/linnkit/src/context-manager/README.md`）。**linnkit 已把 observation projection 这一半做得成熟，缺的精确是 action projection 那一半。**

### 4.3 其它定位

- **TrajAD（arXiv 2602.06443）**：周期性 AI 监测 + check-and-act + **rollback-and-retry**（回滚到错误前状态重试，而非整任务重启）。前提是环境可回滚——linnya 多数场景**不可回滚**，此思想短期不直接适用。
- **ProbGuard**：用 DTMC + PAC 边界**预测**未来不安全状态，提前 steer。偏安全，思想是"预测式监测"，可作为长期方向。
- **AgentPRM（arXiv 2511.08325）/ Process Reward Models 综述（arXiv 2510.08049）**：agent step **没有"对错"**，应按 **promise（接近目标的概率）+ progress（已取得的进展）** 评。→ 慢循环评分维度别用对错二分，用"进展度"。
- **DataPRM（HF Daily Papers）**：通用 PRM **会把必要的试错探索误判成错误而惩罚掉**，且漏报 silent error。→ 对研究型 agent（需要大量探索）是直接警告。
- **harness-engineering 工程共识**：
  - "**Use computational sensors before inferential ones**"（Böckeler）——确定性优先，LLM 只在确定性够不到处补。印证用户直觉。
  - "**Success is silent; failures are verbose**"（HumanLayer）——通过则静默，失败才注入错误文本，反馈在常态下近乎免费。
  - **ratchet 原则**（Addy Osmani）+ **Hashimoto 规则**：harness 只收紧不放松；每条规则都必须能指回一次真实失败，否则删掉。

### 4.4 值得直接偷的三个思想

1. 反馈 schema 固定成 (concern, evidence, suggestion)，且"无证据则放行"。 这一条同时解决了"反馈要有信息量"和"防误报"两个问题。linnya 现在的 system-reminder 文案是泛泛的劝导（"请反思""请更新 taskstate"），没有 evidence 槽。改成强制带证据（"你最近 3 次 search 关键词 Jaccard=0.81，命中文档重合"），质量会质变。
2. 失败先建 taxonomy，每个 detector 都 trace 到一个被诊断过的真实失败。 Life-Harness 是先人工标注失败轨迹、归出四类，再给每类配固定 intervention。这跟 harness 工程圈现在的共识完全一致——O'Reilly/amux 那几篇反复强调的 ratchet 原则（harness 只收紧不放松） 和 Hashimoto 规则（AGENTS.md 里每一行都必须能指回一次具体的失败，否则删掉）。对你的意义：不要凭想象列 detector，要拿 linnya 现有的 benchmark 失败轨迹去归类，归出来几类就做几个 detector。 否则你会造一堆误报的"理想主义规则"。
3. 离线进化、冻结上线。 Life-Harness 用一个 coding agent 从训练轨迹里把 harness "进化"出来，然后冻结用于评测。这正是我上一轮"硬问题3：detector 必须能在历史 event log 上回放校准、达标才上线"的做法。你们的 benchmark event log 就是这个校准集。

## 4.5 第二批前沿吸收（2026-06-22 第三轮深读）

又读 8 篇，按 **直接吸 / 切一刀吸 / 警告** 三组归类。一句话总判断：这些论文各抓一半——AgentSpec / C-Trace / ABC / ProbGuard 抓快循环（偏安全合规）；SmartSearch / AgentPro / AgentPRM / TRACE 抓过程质量（偏慢循环 / PRM / MCTS）；From Agent Traces to Trust 最接近本系统 Signal substrate 的"事实底座"。没有一篇覆盖全图，正好印证 §1 的"两循环一底座"才是更完整的抽象。

### 直接吸

- **C-Trace（arXiv 2606.19242）· accepted trace / audit trace 分离**：linnkit 已有半套现成对应——RuntimeEvent 历史是权威事实，context 是可见视图，`AuditEnvelope` 不进 context / UI / SSE。落法：**所有 detector verdict（含被 Arbiter 压掉的）都 emit 成 AuditEnvelope；只有 Arbiter 放行的那条进 context**。这天然实现了"评测/审计看全量、agent 只看被接受的"。**明确不吸 redaction**——C-Trace 的 accepted trace 会"对 agent 隐藏部分事实"，方向与本系统（补盲区事实）正好相反，且属安全场景，linnya 不需要。
- **SmartSearch（arXiv 2601.04888）· query novelty(规则) vs intent necessity / retrieval relevance(模型)**：直接为快慢边界提供实证。`query_novelty`（这次搜的和之前是否换了词法/角度）→ T0 纯词法（linnya detector）；`retrieval_relevance`（搜到的东西是否真支撑当前意图）→ 语义判断 → 慢循环。等于把 §3 "关键词糙是 proxy、搜索方法不当是判断"那行做了切分背书。

### 切一刀吸

- **ABC / Agent Behavioral Contracts（arXiv 2602.22302）· hard/soft invariant + recovery window**：用它取代 §8 早期手搓的 cooldown / hysteresis。每个 detector 声明 `hard`（一次违反即 breach → 立即 Reject / Escalate）或 `soft`（容忍偏离，但须在 k 步内恢复）。搜索重复属 soft：连 2 次只记录、3 次提醒、提醒后 2 tick 仍重复才升强 nudge。**对齐纪律的关键**：recovery window 必须实现成"对事件前缀回看 k 步"的纯函数，**禁止做成隐藏累加器**——否则破坏 §8 纪律1 的 stateless-over-history / replay 纯度。
- **AgentSpec（arXiv 2503.18666）· trigger → predicate → enforce DSL**：吸它的 DSL 形状，但把 `enforce` 从"只阻断"拓宽成本系统的 FeedbackAction（expose / constrain / reject / escalate，§3.5）。**命名坑**：linnkit 已有 `AgentSpec`（agent 静态画像，在 `linnkit/contracts`），论文这个是运行时强制 DSL，**绝不能复用该名**。机制差异：论文 trigger 是 event 驱动(push)，本系统是在 placement 处对 event 前缀求值(pull)——二者等价（placement 即 trigger 点），但本系统的 predicate 能读 substrate 的跨 tick 统计，表达力更强。
- **From Agent Traces to Trust（arXiv 2606.04990）· Provenance**：拆成两半，**绝不合并**：
  - **结构性 provenance（现在 / T0 / event log 纯函数）**：TRIGGER / DEPEND_ON / derived-from / cited-by 这类边，全部能从事件流确定性重建。linnya 引用机制已经免费提供 `claim → evidence` 边。它直接喂 Signal substrate（`uncited_claim_count` 本质就是对这张图的查询）。
  - **语义性 provenance（以后 / 慢循环 / AI 标注后落 audit）**：SUPPORT / CONTRADICT / INVALIDATE——这些边本身就是 AI 判断。**把它塞进快循环 = 在 substrate 里偷藏一个 AI judge，零昂贵 AI 的论证当场崩**。
  - **定位**：provenance 不是独立的有状态层，而是"图形状的 signal"。只要结构边能由重放事件重建，它就和别的 signal 一样 stateless-over-history；语义边因为由 AI 产生、不可重放重建，才落成 audit annotation（归慢循环）。这样保住 replay 纯度。长期它是 linnya 研究型 agent 的"证据骨架"，写进愿景；T0 阶段只用结构边。
- **TRACE（arXiv 2606.07054）· 窗口聚合 + Triage → Inspect → Judge**：它就是本系统 escalation 架构的另一种说法——Triage = 廉价分诊（≈T0 决定要不要升级），Inspect / Judge = AI（慢循环）。附带一个要吸的扩展：substrate 要支持**窗口聚合 signal**（最近 k 步统计），因为"多个看似合理的步骤合起来没进展"在单步上看不出来，而窗口统计仍然是事件前缀的纯函数，不破坏纪律。

### 警告 / 未来配方（现在不吸）

- **ProbGuard（arXiv 2508.00500）· 预测式风险**：现在不上 DTMC / 概率模型（太重，个人开发者扛不动）。**不预留 `riskScore` 投机字段**（违反 ratchet / Hashimoto：没有指回真实失败的字段不许进协议）。改为把 **Verdict schema 设计成开放可扩展 record**——将来要加 risk 字段时是非破坏性扩展。当下 `confidence` 本就有，`recoveryWindow / cooldown`（来自 ABC）是真实需要，这两个进 schema；`riskScore` 不进。
- **AgentPro（ACL 2025）/ AgentPRM · MCTS / TD 标注 step quality**：这是"以后做 T1 / T1.5 时的数据标注配方"，现在用不上。将来训小检测器时，可用 rollout 在 benchmark trace 上自动标注 step 质量（呼应 §8 纪律3、§5 阶梯）。先记下，不动手。

---

## 5. 检测器实现阶梯（回应"小 LLM vs 向量化"的核心讨论）

用户的疑问：能理解语义的检测器，要么训练小 LLM，要么向量化把"分数"映射到高维空间。这里给出完整阶梯，关键区分是 **"能触发(fire/no-fire)" vs "能生成有依据的反馈(concern/evidence/suggestion)"**：

| 层 | 实现 | 成本 | 能力 | 能否产出 grounded 反馈 |
|---|---|---|---|---|
| **T0** | 确定性规则 / 计数 / hash（含引用派生事实，见 §7） | 免费 | 抓"明显坏"：死循环、重复、预算、没调关键工具、参数错、缺引用 | 否（但可配模板化 suggestion） |
| **T0.5** | embedding 余弦相似度 | 便宜（仅向量化） | 语义级**触发**：语义重复检索、答案对问题子维度的覆盖度 | 否，只给距离/标量 |
| **T1** | embedding 上的浅层 probe（线性/MLP 分类头 = 迷你 PRM） | 便宜，可 per-action | 学习型**标量**病理/质量分；需标注数据 | 否，只给分 |
| **T1.5** | 小型微调生成式 LLM（HarnessBridge 形态） | 中，可 per-action（小模型） | 生成 `(concern, evidence, suggestion)`，默认放行 | **是** |
| **T2** | 大模型 judge | 贵 | 深度 / 全面性 / 正确性 | 是，但只能采样 / 异步 / 离线 |

**关键判断**：

1. **T0.5 / T1 只能当"触发器"，不能当"反馈生成器"**。embedding 余弦、probe 分数都是标量/距离，给不出"哪里不对 + 证据 + 怎么改"。要么配**模板化反馈**（T0.5/T1 触发 + 固定话术），要么**升级到 T1.5/T2 让它写反馈文本**。
2. **"向量化把分数映射到高维空间"**（用户设想）= T1 的 probe 路线。它对"冗余 / 覆盖度"类有效，但**对"深度/严谨性"较弱**——embedding 相似度 ≠ 深度。别指望它判断深度。
3. **纯 T0 实测"limited impact"**（见 §6）。要抓住真正影响质量的"合法但无意义"动作（搜得浅、维度没换、该读没读），**至少需要 T0.5/T1，理想是 T1.5**。
4. **三类的训练/校准数据来源统一是 benchmark 的历史 event log**（见 §8）——这也是 §2 缺口"两套系统没打通"的接缝。

---

## 6. 两条实测铁律（HarnessBridge 消融，Table 5）

1. **纯确定性规则 reject 影响有限**：
   > "rule-based rejection alone has limited impact, since many inefficient actions are **syntactically valid but semantically unproductive**."
   → 对用户"不借助 AI"的诚实修订：**零 AI 只能抓"明显坏"；"合法但无意义"必须上 T0.5/T1/T1.5**。

2. **过度干预会实测降低成功率**：
   > "strict rejection can over-intervene and reject otherwise useful actions, reducing task success. A more tolerant rejection mode achieves a better balance."
   → 印证"误报比漏报更致命"。对**研究型 agent 尤其致命**（DataPRM：会惩罚必要探索）。每个 detector 上线前必须回测误报率（§8），且反馈应分级、带 cooldown、默认 tolerant。

**对用户"不借助 AI"约束的最终修订口径**：

> 不是"零 AI"，而是 **"不用昂贵 AI per-loop，且任何反馈都必须有 trajectory 证据支撑（无证据则放行）"**。
> - T0 零 AI 抓明显坏（高价值、免费）；
> - T0.5/T1/T1.5 用窄能力、默认放行的小模型抓"合法但无意义"；
> - T2 大 judge 只采样 / 异步 / 离线。

---

## 7. linnya 特有红利：引用机制把部分"内容质量"降维成"可计算事实"

用户指出 linnya 输出带引用（`[@XXXXXX]`），引用即证据。这里要区分**两种 evidence**，别混：

- **Agent 为其输出提供的 evidence**（引用支撑论断）——内容层。
- **Detector 为其反馈提供的 evidence**（trajectory 事实支撑 concern）——HarnessBridge 的 `evidence` 槽。

二者不同，但引用机制带来一个真实红利：**它让一部分"内容质量"检查从语义判断降维成 T0 可计算事实**：

- 论断句无引用 → 计数（T0）。
- 引用密度过低 → 计数（T0）。
- **引用了一个事件流里从未检索/读取过的源 ID（疑似幻觉引用）** → 引用集合 vs 事件流 `search/read` 命中集合做差集（T0）。

第三条尤其有价值——它是“零 AI 测内容可信度”的少数真实可行点，可先作为新 Benchmark 的候选事实指标验证，再决定是否进入实时循环。

**但要清醒**：引用密度高 ≠ 论证深。引用是**可信度**的 proxy，不是**深度**的 proxy；深度仍落在 §3 那 1 成纯判断里，归 T2。否则把引用密度做强反馈会被 Goodhart——agent 学会堆砌无意义引用。

---

## 8. 落地前必须守的三条工程纪律

1. **detector 是 event 流的纯函数（stateless-over-history）**：每 tick 从 RuntimeEvent 历史重算（system-reminder 现在就是这么干的，见 `system-reminder/helpers.ts`）。理由：可审计、可 replay、**可在历史 event log 上离线回放校准**。禁止隐藏累加器状态。
2. **闭环要有阻尼（用 ABC 的 hard/soft invariant + recovery window 表达，见 §4.5）**：反馈改变行为→改变信号→改变反馈，是闭环（benchmark 是开环）。每个 detector 声明 `hard`（一次违反即 breach，立即 Reject / Escalate）或 `soft`（容忍偏离，但须在 k 步内恢复）；soft 的 recovery window + Arbiter 的"每 tick 最多 1 条反馈"预算共同构成阻尼，替代早期手搓的 cooldown / hysteresis。**recovery window 必须实现成"对事件前缀回看 k 步"的纯函数，不得做成隐藏累加器**（守纪律1，保 replay）。proxy 类信号**只配做升级触发器，不配做直接 steer**（防 Goodhart）。
3. **precision 校准用 benchmark trace**：detector 只有在"它触发的 run 确实评分更低"被回测验证后，才允许进 in-loop。**benchmark 从此不只是事后打分，而是 detector 的校准实验台**——这正是 Life-Harness "从训练轨迹进化 harness 再冻结" 的做法。

### Signal substrate 定稿：统一事实层（2026-06-22）

"统一事实层 vs 各 placement 各算"——选统一，但"统一"指**同一个派生函数定义，不是每 tick 只算一次**：

> Signal substrate = 纯函数 `deriveSignals(events_up_to(P))`，在每个 placement 用"该处可见的事件前缀"调用。**统一的是函数（口径唯一），变化的是输入前缀（时序正确）。**

这样根除"搜索次数在 reminder / toolNode / final 三处不一致"，同时允许时序差异（不同 placement 看到的前缀本就不同）。配套三道闸（防上帝对象，对齐架构规则）：

1. **Signal 只放低层、可复用、领域无关的派生事实**（计数 / hash / 集合 / 比率）；任何带阈值或病理判断的都是 Detector。`searchCount=3` 是 signal，`repeated_equivalent_search` 是 detector。
2. **两层**：framework substrate（领域无关）+ host substrate extension（产品语义：关键词相似度、引用图谱、契约覆盖度）。对齐 linnkit/linnya 边界。
3. **按需计算**：detector 注册时声明所需 signal，substrate 只算被注册 detector 需要的并集（避免无人使用的 embedding signal 每 tick 白烧）。

**feedback channel 绝不直接扫 event log，一切经 substrate。**

### 已定：DetectorPort（host 实现）+ framework 守纯函数 / 审计契约（2026-06-22 第三轮）

定位拍板：linnkit 是通用基座框架，**不内置任何具体病理规则**；detector 判据全部在 host。形态用 linnkit 既有 port 范式（同 `TokenizerPort / ObservationPreviewPort / AuditPort` 那套依赖注入）：

- **linnkit 给（笼子 + 底座）**：`SignalSubstratePort`（访问派生信号）、`Detector` 接口、`Verdict` schema（**开放可扩展 record**，吸收 ProbGuard 的扩展性、但不预留 `riskScore`，见 §4.5）、Detector registry、Arbiter / Feedback bus、placement hooks、audit/accepted 分离（C-Trace 映射）、escalation port。
- **linnya 给（具体判据）**：`repeated_equivalent_query` / `final_before_evidence` / `citation_id_validity` 等具体 detector 实现。

关键：**linnkit 不出规则，但出纪律**——port 接口本身把"detector 必须是 substrate 的纯函数 + 输出可序列化 Verdict + 自动 emit 到 audit"钉死，host 只能在这个笼子里写具体判据。这样"host 拥有 detector"与"framework 保住可审计 / 可 replay"不矛盾。

这是对早期"声明式注册表优先 + customMatcher escape"倾向的修正：**port 化比"内置 detector kind + 填阈值"更贴基座定位**——内置 kind 会让 linnkit 背上一份产品规则库（违反 §2 那条"framework 给插槽、host 给内容"）。声明式参数仍可作为 host 在自己 port 实现里的内部组织方式，但不再是 framework 的对外接口。T1.5 生成式检测器将来也走同一个 DetectorPort（只是实现里调小模型），不需要新通道。

---

## 9. 评测机制：2026 共识 + linnya 接线缺口

| 共识 | 出处 | linnya 现状 / 缺口 |
|---|---|---|
| **双轨 + 同一套 rubric**：离线 CI gate（部署前）+ 在线采样评分（部署后），**两边同评分词汇** | futureagi 2026 指南、Dual Evaluation 模式 | benchmark hard-rules + Judge 只跑 dev；缺"同规则接到线上采样" |
| **从 trace 评分，不重跑** | agentevals | RuntimeEvent 流就是现成 trace；建议对齐 OTel GenAI `gen_ai.evaluation.*` 语义约定 |
| **在线 judge 必须采样 + 异步 + 开环**（用户已看到输出，judge 只能进 dashboard / 异步队列，不阻塞请求） | Scorer Live Monitoring、Sampled Prompt Trace Eval | 这正是慢循环在生产里的形态：异步背景 pass，非 per-tick 同步 |
| **agent step 用 promise/progress，不用对错二分** | AgentPRM | 影响慢循环评分维度设计 |
| **通用 PRM 会惩罚探索、漏 silent error** | DataPRM | 研究型 agent 必须环境感知 + 区分可纠正/不可纠正错误 |

---

## 10. 决策状态（2026-06-22 更新）

**已定**：

1. **T1.5（学习型检测器）**：接受方向，但**暂不做**——个人开发者扛不动训练/运维。先 T0。
2. **慢循环生产形态**：倾向"注入下一轮"，但依赖 T1.5，故**搁置**；当前只把 escalation 病理记录到 trace（= rollout 的 shadow 归宿）。
3. **第一步范围**：确定性 T0 规则；但当前仍在**架构讨论阶段，先不改代码**。
4. **任务分类**：用 capability flags，不用 task-type 硬枚举（§12）。
5. **Detector 形态**（第三轮拍板）：**DetectorPort（host 实现）+ framework 守纯函数 / 审计契约**（见 §8）。linnkit 只给底座、不内置规则库——取代早期"声明式注册表优先"的倾向。
6. **Verdict schema**：**开放可扩展 record**；当下含 `confidence` + ABC 的 `recoveryWindow / cooldown`，**不预留 `riskScore` 等投机字段**（§4.5 ProbGuard）。
7. **Provenance**：不独立成层，是"图形状 signal"；**结构边（现在 / 纯函数）vs 语义边（以后 / AI / audit）必须拆**（§4.5）。
8. **命名**：伞 = Agent Behavior Engineering；本文件主线子系统 = **Behavior Control Loop**（§0）。

**仍开放**：暂无阻塞性概念分歧。下一步是把以上折成 `docs/framework/<topic>.md` 的协议草案（DetectorPort / Verdict schema / Arbiter / placement hooks），**仍未到改代码阶段**。

---

## 11. 不要误抄

- **不要把 TrajAD 的 rollback-and-retry 直接搬给 linnya**——前提是环境可回滚，linnya 多数场景（写文档、对外回答）不可回滚。
- **不要用 proxy（引用密度 / 关键词数）做强反馈**——会被 Goodhart 刷成废话，proxy 只配做升级触发器。
- **不要每条 trace 都跑 judge**——成本翻倍，规模上不可行；采样 + 重点加权。
- **不要凭想象列 detector**——每个 detector 必须 trace 到一次 benchmark 里诊断过的真实失败（Hashimoto 规则）。
- **不要把 reminder 持久化进 history**——违反 linnkit reminder 协议（`docs/integration/context-engineering.md` §6）；需持久化走 fence `lifetime: 'persisted'`。
- **不要用 task-type 硬枚举 gate detector**——误分会误报；用 capability flags，缺省静默（§12）。
- **不要让 detector 各自做 cooldown/去重**——必须中心化到 Arbiter，否则多 detector 并发时退化成噪音轰炸（§3.5）。
- **不要让 Reject 通道无限重试**——必须带重试上限，超了 Escalate 或带标记放行（§3.5）。
- **不要把语义性 provenance 边（SUPPORT / CONTRADICT / INVALIDATE）填进快循环**——它们是 AI 判断，会在 substrate 里偷藏 judge，零昂贵 AI 论证当场崩；只用结构边（§4.5）。
- **不要复用 `AgentSpec` 命名给运行时强制 DSL**——linnkit 已有同名静态画像类型，会撞名（§4.5）。
- **不要吸 C-Trace 的 redaction（对 agent 隐藏事实）**——本系统是补盲区事实，方向相反（§4.5）。
- **不要预留 `riskScore` 等没有指回真实失败的投机协议字段**——用开放可扩展 Verdict 代替，将来非破坏性扩展（§4.5 ProbGuard / ratchet 原则）。

---

## 12. 任务分类：capability flags，不用 task-type 枚举

**问题**：要不要按"本次是 research / writing / qa"分类？精细化对特定任务好，但枚举无法覆盖所有任务、易误分。

**结论**：**不要用硬枚举 gate detector；用 capability/contract flags，且优先静态来自 AgentSpec。快循环用 flag，慢循环/离线 eval 才可以用粗分类（选 rubric，可用 AI，不在热路径）。**

理由（逻辑闭环）：

- detector 分两种：**task-agnostic**（协议/行为：配对、schema、重复搜索、reject-loop——任何任务都该 fire）和 **task-conditional**（`required_evidence_missing` 只在需证据任务有意义；creative writing 不需引用）。
- 真问题不是"分不分类"，是"task-conditional detector 的条件怎么表达"。
- **硬枚举的失败模式是"fire 错 detector"（误分→误报）；flag 的失败模式是"该 flag 的 detector 静默"（未声明→不 fire）。** 既然本系统第一原则是"误报比漏报更致命"，**任何失败模式会误报的方案都被否决**——flag 严格优于枚举。
- flag **可组合**：research-then-write = `requires_evidence` + `creative_synthesis`，无需"research_writing"类。
- flag 大部分**已静态躺在 AgentSpec**（deep_research 静态要证据、default 闲聊不要），不需 NL 实时分类，避免重新引入 AI-classifier 的成本与新误差源。

形态：

- detector 声明依赖哪些 flag；flag 缺省 = 该 detector 不 fire（安全降级，不误伤）。
- flag 来源优先级：**静态 AgentSpec** → （将来）agent 自己在 taskstate/plan 里声明意图（自绑定，低误报）→ **不用脆弱启发式分类器**。
- 多态的 `default` agent（一会儿算 2+2、一会儿研究供应链）：T0 阶段**只给 task-agnostic + 最弱普适契约检查，不尝试分类**。

---

## 13. 收缩版落地边界（给定 §10 决策）

给定 T1.5 搁置、慢循环搁置、第一步 T0，当前真正要设计清楚的是这个收缩版：

```text
framework(linnkit):  Signal substrate(纯函数 / 按需 / 两层 / 支持窗口聚合)
                     + DetectorPort + Detector registry(host 实现，framework 守纯函数/审计契约)
                     + Verdict schema(开放可扩展，无 riskScore)
                     + Arbiter / Feedback bus(去重 / 冷却 / hard·soft invariant / 每tick预算)
                     + placement hooks(buildDecision / toolNode后 / 新preFinal闸 / applyReminder)
                     + audit/accepted 分离(全量verdict→AuditEnvelope，仅放行的→context)
                     + Escalation port(只留 seam，先只记 trace)

host(linnya):        T0 detectors(process + contract)
                     contract 从静态 AgentSpec 的 capability flags 派生
                     signal / detector 判据从 benchmark hard-rule 搬
                     慢循环 judge：先空
```

**这个收缩版不需要任何 embedding / 小模型**：关键词相似度先用纯词法 Jaccard（T0 免费），引用有效性用"引用集合 − 事件流检索集合"（T0 免费），契约用静态 AgentSpec flag（T0 免费）。escalation port 当下价值 = 给 T0 抓不住的语义病理留统一出口，先只 shadow 记录。

**detector 上线顺序（precision 安全闸）**：

1. **shadow mode**：只记录不反馈。
2. **trace replay 回测**：看误报率与触发频率（benchmark event log 当校准集）。
3. **soft reminder**：只对高置信 detector 开（Expose Fact）。
4. **hard action**：Reject / Constrain 只给几乎不误报的 detector，且带重试上限。

**第一批 detector（从 benchmark hard-rule 搬）**：`required_tools_coverage` / `tool_success_rate` / `repeated_equivalent_query` / `read_budget_without_synthesis` / `final_before_evidence` / `citation_id_validity` / `output_contract_validity`。

接线动作：把 `SystemReminder` 从"自己判断触发"升级成"消费 detector verdict 的一种 feedback channel（Expose Fact）"，不再让规则各自扫 history。
