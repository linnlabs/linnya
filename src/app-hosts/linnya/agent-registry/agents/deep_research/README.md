/**
 * @file src/app-hosts/linnya/agent-registry/agents/deep_research/README.md
 * @description Deep Research agents（Phase 2：多角色编排）
 */

## Deep Research（Phase 2）Agents

> 产品边界见 [Linnya 产品模型总览](../../../../../../docs/product-model-overview.md)；
> Evidence 专用 facade 的剩余退出条件见
> [Evidence owner 文档](../../../../../domains/evidence/README.md)。
>
> 当前 beta 内部角色已从公开 `subagent_type` 隔离。Research 私有编排完成前，下面记录的
> Leader 旧编排链路不作为可用产品能力；Default、Slides 等普通 Agent 不得直接调用这些角色。

### 目标

Deep Research 是由 Leader 编排四种注册研究 subagent 的多阶段流程（Reasoner 分两阶段），目标是：

- **证据驱动**：事实句必须能追溯到稳定引用（`[@ref]`）
- **可回放**：每一步都能被记录与重放（基于事件回放机制）
- **高内聚低耦合**：角色职责单一、工具权限最小化，避免“写作阶段乱检索”

### 引用格式（必须遵守）

> 中文备注（根因级约束）：Deep Research 使用 Knowledge/Web 的稳定短引用，不使用 Workspace 块引用（例如 `[#XXXXXX]`）。

- **唯一合法格式**：`[@XXXXXX]`
  - `XXXXXX` 为 **6 位稳定短引用**（字符集与 `schemas/citation.ts` 一致）
  - 禁止使用 `[@92]` 这类“结果编号”，也禁止把 `block_id`/uuid 片段当作 ref
- **看板（board）ref 字段的约束**：
  - 中文备注：旧的 board 工具已移除，当前不再允许在工具层写入“研究看板”。
  - 不得编造引用 token；引用必须来自 Knowledge/Web 工具返回的 owner citations

### Workspace 协作文档协议

Deep Research 的计划、发现、看板、反证和大纲都是项目正式文档。Agent 统一使用
`list_files/read_file/write_file/edit_file`，不再使用 SharedMemory 私有读写协议。

- 文档放在项目 VFS 根目录，完整路径见迁移方案；
- 新建或全文重写使用 `write_file`，局部修订使用 `edit_file`；
- Scout、Reasoner 与 Challenger 统一通过 canonical `subagent` 调用，返回 `status`、`final_answer` 和稳定 Workspace inode `artifacts`；
- 协作文档拥有 canonical `workspace:` locator，父 Agent 直接通过 `read_file(locator=...)` 回读，并用 `artifacts` 确认 child 实际写入；
- 协作文档中的 ref 通过普通 Workspace 写入 admission 持久化为 CitationMark；Leader 回读时直接获得来源快照；
- 协作文档只记录 canonical `[@XXXXXX]` 与用途，不记录 EvidenceStore bundle id；存储身份只服务内部恢复与审计；
- Leader 自己完成最终写作，并通过 `write_report` 的通用工具控制合同发布最终答案、终止当前 run。

### 文件树

> 中文备注：每个角色目录固定为 `index.ts`（AgentDefinition）+ `prompt.ts`（PromptTemplate）。

```
src/app-hosts/linnya/agent-registry/agents/deep_research/
├─ README.md
├─ leader/
│  ├─ index.ts      # Leader：澄清问题、拆解子问题、制定检索计划与停止条件，生成写作大纲，调用各个子agent（可用 ask/list/search）
│  └─ prompt.ts
├─ scout/
│  ├─ index.ts      # Scout_1：检索/阅读来源并记录 Knowledge producer 返回的 canonical refs
│  └─ prompt.ts
├─ reasoner_1/
│  ├─ index.ts      # Reasoner_1：初步推理与收敛，更新 research_board
│  └─ prompt.ts
├─ challenger/
│  ├─ index.ts      # Challenger：反对派挑战（search/read/write_file）
│  └─ prompt.ts
└─ reasoner_2/
   ├─ index.ts      # Reasoner_2：最终综合，更新 research_board 并产出 reasoner_phase2
   └─ prompt.ts
```

### 🔥 MaxSteps 收尾策略与 SystemReminder（开发参考）

本节用于回答三个“工程性问题”（供未来其它 agent 复用）：

- **最后几步如何提醒模型收敛？**
- **如何强制子 agent 在快结束时调用某个关键工具（确保产物落盘）？**
- **如何在预算边界禁用工具或只保留特定工具白名单？**

#### 1) 配置入口：写在 AgentDefinition（高内聚）

每个角色的收尾策略都应内聚在各自的 `index.ts`（AgentDefinition）里：

- **步数收尾策略**：`AgentDefinition.config.stepPolicy`
  - `kind: 'final_answer' | 'force_tools'`
  - `forcedTools?: string[]`（仅 `force_tools` 需要）
  - `lastStepsHintThreshold?: number`（最后几步提示阈值）
- **SystemReminder 规则选择**：`AgentDefinition.config.contextPolicy.systemReminder.enabledRuleIds`
  - 这是 “system-reminder 不同 agent 可定制” 的配置入口
  - Deep Research 已统一收口在：`src/app-hosts/linnya/agent-registry/agents/deep_research/systemReminder.ts`

#### 2) 执行链路：配置如何生效（端到端）

中文备注：这里是“链路事实”，不是约定。

1. **AgentRunnerService / ChildRunInvoker 下发策略到 executorLocal（执行期状态）**
   - 主会话：`src/app-hosts/linnya/adapters/flow/flow.agent-runner.service.ts`
   - 子 Agent：独立 Linnkit 仓的 `src/runtime-kernel/child-runs/childRunInvoker.ts`
   - 下发字段（写入 `executorLocal`，仅执行期有效，不落库）：
     - `finalStepPolicy / finalStepForcedTools / lastStepsHintThreshold`
     - `systemReminderPolicy`（来自 `AgentDefinition.config.contextPolicy.systemReminder`）

2. **GraphExecutor 计算“阶段 phase/剩余步数”**
   - 独立 Linnkit 仓的 `src/runtime-kernel/graph-engine/engine.ts` 每次节点切换写入：
     - `executorLocal.stepCount / maxSteps / remainingSteps`
     - `executorLocal.phase`：`running / force_final_answer / force_tools`
   - 重要：这里的步数口径是“节点切换次数”，不是“LLM 调用次数”。

3. **LlmNode 按 phase 改写本轮请求的工具视图（决定是否允许/收缩工具）**
   - 独立 Linnkit 仓的 `src/runtime-kernel/graph-engine/nodes/llmNode.ts`
   - 行为：
     - `phase='force_final_answer'`：本轮禁用工具（`enableTools=false`，`availableTools=[]`）
     - `phase='force_tools'`：本轮只允许 `finalStepForcedTools` 白名单工具

4. **`apply_system_reminder` tick stage 注入普通 `<system-reminder>`（只对当前 tick 生效）**
   - 独立 Linnkit 仓的 `src/runtime-kernel/graph-engine/tick-pipeline/stages/applySystemReminderStage.ts` 会在调用 LLM 前：
     - 读取 `executorLocal.systemReminderPolicy` 解释规则集
     - 将 `<system-reminder>...</system-reminder>` **追加到最后一条 message.content 的末尾**
   - 关键约束：
     - 不生成 `RuntimeEvent`，不写入 `history`，不入库
     - 允许进入 `LLMRunAudit/*after_context_manager.json`（真实输入）
     - 这里说的是普通 tick Reminder；自动压缩使用完整原 Prompt 后新增的瞬态末尾 `role=user` Reminder，二者不能共用物理位置

> System Reminder 的位置、role、生命周期和扩展规范见
> [独立 Linnkit 仓的 `src/runtime-kernel/system-reminder/README.md`](https://github.com/linnlabs/linnkit/blob/main/src/runtime-kernel/system-reminder/README.md)。

#### 3) “预算边界直接回答” vs “只保留某些工具”（两种模式）

这两种模式都通过 `stepPolicy` 实现，避免在主链路写 if/else。

- **模式 A：`final_answer`（工具闭环预算不足时禁用工具）**
  - 适用：该角色最终产物是普通文本输出，不依赖工具落盘或原子发布
  - 行为：实际进入 LLM 且剩余预算已不足以完成 `ToolNode → LLM` 时进入 `force_final_answer`，模型必须直接输出最终答案

- **模式 B：`force_tools`（仍能执行最终工具时收缩白名单）**
  - 适用：该角色必须产出工具侧落盘产物（Workspace 文档 / write_report 等）
  - 行为（关键点）：
    - 实际进入 LLM 且剩余节点不超过 2 时：进入 `force_tools`，模型只能调用 `forcedTools` 白名单工具
    - 下一步留给 ToolNode 执行该工具；已经 pending 的普通 ToolNode 不会被收尾逻辑抢占
    - 若最终工具失败或未声明终止，最后一个 LLM 节点禁用工具并如实说明未完成状态，不再生成无法执行的新调用

#### 4) Deep Research 各角色示例（可复制）

- **Leader**（编排并完成最终报告）：
  - `stepPolicy: { kind: 'force_tools', forcedTools: ['write_report'], lastStepsHintThreshold: 3 }`

- **Scout / Reasoner / Challenger**（需要落盘协作文档）：
  - `stepPolicy: { kind: 'force_tools', forcedTools: ['write_file'], lastStepsHintThreshold: 12 }`
  - Knowledge 搜索/阅读在返回前自动捕获 Agent 实际看到的 Evidence，收尾阶段不再和额外物化工具竞争。

### Deep Research 多阶段流程（当前实现）

中文备注：下面描述的是**当前代码事实**，不是未来规划。

1. **Leader**
   - 澄清问题、拆解子问题、定义 stop criteria
   - 通过 `write_file(locator="workspace:/research-plan.md", ...)` 建立/更新研究计划
2. **Scout**
   - 用 `list_files/read_file` 读取研究计划，进行检索/阅读并保留 owner 返回的 canonical refs
   - 将结果写入 `workspace:/research-scout-findings.md`
3. **Reasoner_1**
   - 读取 `plan`、`research_board`、`scout_findings`
   - 更新 `research_board.md`
4. **Challenger**
   - 读取 `plan`、`research_board`
   - 产出 `challenger_report.md`
5. **Reasoner_2**
   - 读取 `plan`、`challenger_report`、`research_board`
   - 更新 `research_board.md`
   - 写入 `workspace:/research-reasoner-phase2.md`
6. **Leader**
   - 通过 `subagent` 的 canonical `artifacts` 确认普通角色的 Workspace 写入
   - 按正式 VFS 路径用 citation-aware `read_file` 读取 `research_board` 与 `reasoner_phase2`
   - 生成 `writing_outline.md`
7. **Leader 最终写作**
   - 再次读取 `research_board`、`reasoner_phase2` 与 `writing_outline`；每个可引用 ref 必须和来源上下文同屏出现
   - 基于持久化 CitationMark 快照完成报告，不生成 Evidence snapshot，不调用专属 Writer
   - 最终通过 `write_report` 输出报告正文并终止当前 run

### 工作区文档约定

- `workspace:/research-plan.md`：Leader 的当前研究计划
- `workspace:/research-scout-findings.md`：Scout 的检索发现与 canonical 证据线索
- `workspace:/research-board.md`：Reasoner 的共享推理看板
- `workspace:/research-challenger-report.md`：Challenger 的反证与攻击点
- `workspace:/research-reasoner-phase2.md`：Reasoner_2 给 Leader 的综合交接
- `workspace:/research-writing-outline.md`：Leader 的最终写作大纲
 
