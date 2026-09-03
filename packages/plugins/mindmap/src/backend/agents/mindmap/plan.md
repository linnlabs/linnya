# MindMap Workflow（父子 Agent + 并行）计划草案（持续更新）

> 中文说明：
> - 本文件是 **MindMap 自动闭环工作流** 的工程计划（会随着实现推进更新状态与落地位置）。
> - 目标是复用现有成熟范式（Deep Research 的“父编排 + 子角色工具”），并补齐 MindMap 场景下的 **并行与一致性** 基础设施。
> - 讨论对象：MindMap 三个专用子 Agent（拆解/提假设/验假设）已经存在，下一步是“父 Agent 强制工作流 + 多节点并行执行”。

---

## 0) 当前实现状态（2026-02-08）

### 0.1 已完成（Milestone 1：并行独立闭环写图的写入一致性）

- ✅ 新增 per-document FIFO 写入队列：`packages/plugins/mindmap/src/backend/tools/mindmap/mindmapWriteQueue.ts`
- ✅ 改造写版本工具（锁内重读 + apply + save）：
  - `packages/plugins/mindmap/src/backend/tools/mindmap/MindMapCreateNodeTool.ts`
  - `packages/plugins/mindmap/src/backend/tools/mindmap/MindMapTagNodeTool.ts`
- ✅ 新增并发一致性测试（纯队列原语层）：`packages/plugins/mindmap/src/backend/tools/mindmap/__tests__/mindmapWriteQueue.concurrent.test.ts`

> 中文备注：
> - v1 目标是“并行子 agent 写同一文档不再因为 CAS 冲突随机失败”；该目标已达成。
> - 当前写入队列的可观测指标（queued_ms/lock_held_ms 等）以结构化日志为主；如需在工具返回中透传，可作为后续增强（见 11.2.2/11.6）。

### 0.2 未完成（下一步）

- ✅ Milestone 2：新增 MindMap 子 agent runner 工具（固定 promptKey + subrun_trace）
- ✅ Milestone 3：新增 `mindmap_workflow_leader`（强制工作流 + 预算 + 并行调度）
- ✅ Milestone 4：UI 入口接入（根节点右键“深度分析”）

## 1) 背景与现状（代码事实）

### 1.1 现有 MindMap 子 Agent

- `mindmap_decompose_question`：拆解问题 → 创建 `kind=question` 子节点
- `mindmap_propose_hypothesis`：提出假设 → 创建 `kind=hypothesis` 子节点
- `mindmap_validate_hypothesis`：验证假设 → 搜证据 → 创建结论节点 → 挂证据 → 给假设打标（status/confidence）
- `mindmap_reasoning_canvas`：更全能的 MindMap 推理 agent（读/建/打标/挂证据）

位置：`src/app-hosts/linnya/agent-registry/agents/mindmap/*`

### 1.2 现有写图工具（并发语义）

MindMap 写入有两类：

- **写 `mindmap_versions.content_json`（需要版本 CAS）**：
  - `mindmap_create_node`
  - `mindmap_tag_node`
- **写 `mindmap_evidence` 卫星表（不改版本，不需要 CAS）**：
  - `mindmap_attach_evidence`

关键结论（必须写在计划里，避免误判）：
- 目前 `mindmap_create_node` / `mindmap_tag_node` 走 **整文档版本链 CAS**（`expectedBaseVersionNumber`）。
- 因此 **同一文档的并行写版本**（哪怕写不同节点）会产生“版本冲突 → throw → 需要重试/协调”的结构性问题。

---

## 2) 目标 / 非目标 / 约束

### 2.1 目标（我们要做到什么）

从一个“中心问题节点（kind=question）”出发，自动完成：

- **逐个拆解**：生成子问题树（Issue Tree）
- **提出假设**：围绕问题/假设提出子假设
- **验证假设**：证据驱动地挂证据、打标、产出结论节点

同时满足：

- **强制工作流**：父 Agent 必须按固定步骤推进（而非“自由发挥”）
- **可观测/可回放**：每个节点的子过程可追踪（subrun_trace / tool_output）
- **可并行**：多个节点可以同时跑（尤其是多假设验证）
- **子 Agent 独立闭环写图**：子 Agent 需要自己调用写图工具落盘（不是父 Agent 代写）

### 2.2 非目标（暂时不做）

- 不做“删除节点/回滚节点”（当前产品也没有删除工具）
- 不做“跨文档合并写入语义”（先聚焦单 MindMap 文档）
- 不在 v1 强求“全树一次跑完”（默认需要 fanout/预算上限，避免爆炸）

### 2.3 关键约束（硬规则）

- 子 Agent **必须**使用现有 MindMap 工具闭环写图（`mindmap_create_node/tag_node/attach_evidence`）。
- 引用系统不混用：`[#nodeRef]` 仅用于 workspace node 引用；`[@ref]` 仅用于知识库 citation（且证据必须通过工具挂载）。
- 节点类型约束不破坏：
  - `question`：不允许 status/confidence
  - `hypothesis`：允许 status/confidence
  - `conclusion`：不允许 status，允许 confidence

---

## 3) 总体方案（推荐：方案 A = 父编排 + 子 agent 工具）

### 3.1 架构概览

引入一个 MindMap 的“父工作流 Agent”（暂定命名）：

- `mindmap_workflow_leader`（父 Agent）
  - 职责：读当前图 → 决定要对哪些节点发起哪些子流程 → 触发子 Agent 运行 → 汇总状态/下一步建议
  - 重要：父 Agent **不直接写图**；写图由子 Agent 完成（符合闭环约束）

子 Agent 继续沿用现有三个专用 agent：

- 拆解：`mindmap_decompose_question`
- 提假设：`mindmap_propose_hypothesis`
- 验证：`mindmap_validate_hypothesis`

### 3.2 “子 agent 调用机制”的落点（复用 Deep Research 范式）

参考 Deep Research 的 `research_run_*` 工具：

- 为 MindMap 新增一组 “run 子 agent”工具（暂定）：
  - `mindmap_run_decompose_question`
  - `mindmap_run_propose_hypothesis`
  - `mindmap_run_validate_hypothesis`

这些工具的设计要点：

- **固定 promptKey**（不让模型侧选择，防漂移）
- **固定 maxSteps / inheritTurns**（按场景配置）
- **支持 subrun_trace**（绑定到父工具卡，便于 UI 观察）
- 工具内部使用 `ChildRunInvoker.invoke()`（现成基础设施）

父 Agent 的提示词中写死工作流：

- 必须先拆解（如需）→ 再提假设（如需）→ 再验证（按预算/优先级）
- 每个子 agent 调用完必须复读结构或读取关键节点状态，决定下一步

> 注：`subagent` 通过已注册的 `subagent_type` 路由，不接受任意 promptKey；需要固定内部 promptKey 的 MindMap 流程应继续使用独立的 `mindmap_run_*` 工具集合。

---

## 4) 并行策略（我们需要什么程度的并行）

### 4.1 我们真正想要的并行

并行的核心价值是：对多个节点同时推进（尤其是多个假设验证）。

并行的具体粒度建议：

- **节点级并行**：对不同目标节点启动不同子 agent run（例如多个 hypothesis 并行 validate）
- **同节点内尽量顺序**：同一节点的“创建结论 → 挂证据 → 打标”保持单子 agent 内部闭环

### 4.2 并行带来的根因问题：版本 CAS 冲突

由于 `mindmap_create_node` / `mindmap_tag_node` 使用整图版本 CAS：

- 多个子 agent 并行写同一 MindMap 文档，必然触发“版本冲突 throw”
- 这不是“节点不稳定”导致的，而是“写入模型（单版本链）”的结构事实

### 4.3 解决思路（必须补齐的底层能力）

为支持“并行子 agent + 子 agent 自主写图”，需要提供：

- **按 documentId 的写入串行化（mutex/queue）**：让并行写版本变为“排队写”，避免 CAS 冲突
- 同时保留 CAS 作为“最后一道一致性校验”（防止绕过队列的写入路径）

#### 推荐语义（v1）

- 子 agent 可以并行运行（检索/阅读/推理并行）
- 当进入 `mindmap_versions` 写入时：写入自动排队
- `mindmap_attach_evidence`（卫星表）可不排队（但可选也纳入队列，换更确定的一致性与排序）

---

## 5) 写图一致性改造（最小可落地）

### 5.1 改造目标

把“并行写版本会随机失败”变成：

- “并行写版本会自动排队，最终都成功”

### 5.2 改造建议位置（优先级）

优先建议在 **MindMap 写图工具层** 引入 per-document 写入队列（原因：工具层最接近“读-改-写”语义，可在锁内做必要的重读）。

候选落点（待实现时再细化）：

- `packages/plugins/mindmap/src/backend/tools/mindmap/` 下新增一个共享模块：`mindmapWriteQueue.ts`
  - 提供 `withMindMapWriteLock(documentId, fn)` 的 API
  - 内部用 Map<documentId, PromiseChain> 实现串行队列（同进程）
- `mindmap_create_node` / `mindmap_tag_node` 在 `saveMindMapVersion()` 前后包裹该锁

> 备注：如果未来存在多进程/多实例并发写，需要把锁上移到 DB 层或用 sqlite 锁/行锁策略；当前先按“单后端进程”假设落地 v1。

### 5.2.1 必须补齐的细节（否则“排队”并不能解决根因）

中文说明（根因级）：
- MindMap 写图工具属于典型 “read → mutate → CAS save”；
- 仅仅把 `saveMindMapVersion()` 放进锁里是不够的，因为锁外读到的 `ctx.versionNumber` 可能已经过期；
- 正确语义必须是：**锁内重读最新版本 + 锁内执行变更 + 锁内保存**，保证 baseVersion 一致。

因此建议统一落一个“锁内写入模板”，让工具只负责提供“操作意图”：

- `withMindMapWriteLock(documentId, fn)` 在进入临界区后：
  - 重新 `initMindMapDocContext(documentId, context)` 拿到最新 `ctx`
  - 调用 `fn(ctx)` 执行变更（创建节点/打标）
  - 调用 `saveMindMapVersion(ctx)`

### 5.2.2 `mindmapWriteQueue.ts` API 规格（建议）

目标：提供稳定、可测试、可观测的 per-document 串行化原语。

建议 API（示意）：

- `withMindMapWriteLock(params)`
  - 输入：
    - `documentId: string`
    - `context: ToolContext`（用于读取 abortSignal、日志、可选的 trace）
    - `purpose: 'create_node' | 'tag_node' | 'other'`（用于日志/统计）
    - `fn: () => Promise<T>`（临界区内执行的回调）
    - `timeoutMs?: number`（可选：排队超时；默认不超时）
  - 行为：
    - 同一 `documentId` 下严格串行（FIFO）
    - 不同 `documentId` 可并行
    - 支持 AbortSignal：
      - 若在排队期间 `abortSignal.aborted` → 立刻拒绝进入临界区并抛 AbortError
      - 若在临界区内 abort → 由工具自身检查并尽快退出（不强制中断 sqlite 事务）
    - 支持超时（若启用）：在排队阶段超时抛错（错误信息必须包含排队时长与 purpose）
  - 输出：
    - `T`（透传回调结果）

### 5.2.3 哪些操作必须进锁（v1 硬规则）

必须进锁（写 `mindmap_versions`）：
- `mindmap_create_node`
- `mindmap_tag_node`

可选进锁（写卫星表，默认不需要，但可换取更确定的“顺序”语义）：
- `mindmap_attach_evidence`

决策建议：
- v1 默认：`attach_evidence` 不进锁（吞吐更高，且不影响版本）
- v2 可选：提供 `lock_scope: 'versions_only' | 'all_writes'` 的全局开关（便于 A/B 测试与问题定位）

### 5.2.4 并行闭环下的幂等语义（必须定义）

并行子 agent + 写入排队后，仍需定义“重复执行”会不会产生重复节点：

- `mindmap_create_node` 当前会生成新 UUID（每次调用都会新增节点，天然非幂等）
- 因此：
  - 父工作流 agent 的默认策略应该是“对同一目标节点最多触发一次拆解/提假设”（以 nodeRef 为 key 做去重）
  - 对 `validate_hypothesis`：允许重复验证，但需要子 agent 自行避免“重复创建相同结论节点”（可通过读结构检查 topic 前缀/标签来规避）

> 中文备注：这不是“防御性修复”，而是并行系统的必要合同（contract）。

### 5.3 失败语义（要明确的产品行为）

- 若写入队列排队过长：是否允许超时/取消？（建议支持 AbortSignal，用户终止要能快速结束）
- 若写入期间报错：错误应直接返回到子 agent，使其“失败可见”，不要静默吞掉

### 5.3.1 错误分类（建议）

为便于父工作流汇总与 UI 呈现，建议把错误按语义区分：

- `AbortError`：用户终止（必须原样向上抛，避免重试）
- `TimeoutError`：排队超时（仅发生在“启用 timeoutMs”的策略下）
- `VersionConflictError`：理论上在引入锁内重读后应极少发生；发生意味着绕过锁或存在多进程写入（需要报警）
- `ValidationError`：工具入参不合法/违反 kind 规则（应直接失败，不重试）
- `ToolRuntimeError`：数据库不可用/SoT 缺失等运行时问题（按错误内容决定是否可重试，v1 默认不自动重试）

### 5.3.2 可观测性（必须补日志）

建议在 `mindmapWriteQueue` 输出结构化日志字段：

- `document_id`
- `purpose`
- `queue_depth`（进入队列时与出队时）
- `queued_ms`（排队时长）
- `lock_held_ms`（临界区执行时长）
- `aborted`（是否因 AbortSignal 退出）

并将这些信息透传到工具的 `StructuredToolResult.data` 的可选字段里（供 UI/排查使用），但不要把内部版本号暴露给模型侧（遵循现有约束）。

---

## 6) 父 Agent 的工作流设计（强制收敛）

### 6.1 输入/上下文

父 Agent 必须拿到：

- `document_id`
- `target_node_ref`（中心问题节点 ref）
- 当前 MindMap 的 NodeRef View（来自 `read_file` 的 `view="document"` 输出）
- 预算参数（fanout 上限、并行上限、总步数上限）

### 6.2 预算与停止条件（防爆炸）

建议 v1 的默认上限：

- 每个 question：拆解最多 3–7 个子问题
- 每个 question/hypothesis：提出假设最多 3–6 个
- 每轮自动验证：最多并行验证 1–3 个 hypothesis（按“证据可得性/重要性/可证伪性”排序）
- 总运行步数：父 Agent 与子 agent 都要配置 stepPolicy，避免最后一步“来不及落工具”

### 6.2.1 并行调度模型（建议补充规格）

并行发生在“节点级子 agent run”：

- 父 Agent 在一次推进中最多启动 `parallelism_limit` 个子 run（默认 2）
- 每个子 run 的 `document_id` 相同（同一 MindMap），写入由写入队列保证串行
- 父 Agent 需要在每个子 run 返回后立即读一次结构（或读关键节点状态）以做下一轮决策

注意：
- 即使子 run 并行，图引擎 `ToolNode` 仍是顺序执行；并行是通过“子 agent runner 工具内部并发启动 ChildRunInvoker”实现（或父 Agent 分多轮启动并发）。
- v1 推荐：父 Agent 逐个触发 `mindmap_run_*`（工具层内部是否并发由实现决定），避免一次性启动过多导致 UI/资源压力。

### 6.3 幂等与重复运行（允许多次点“深度分析”）

父 Agent 应基于“现有结构”判定是否需要重复执行：

- 已存在子问题：跳过拆解或只补缺
- 已存在假设：跳过提假设或只补缺
- hypothesis 已 `verified/refuted` 且有证据：默认跳过验证

---

## 7) UI/入口（暂定）

v1 入口建议：

- 右键 **根节点** 新增菜单项：**“深度分析（拆解→假设→验证）”**
- 仍保留现有三项手动入口（拆解/提假设/验假设），便于局部推进

> 更新说明（2026-02-09）：
> - 为避免在非中心节点误触发全图编排，v1 把入口收敛为：**仅根节点显示“深度分析”**（语义等价于“自动闭环”）。

---

## 8) 测试与验收（必须可验证）

### 8.1 并发一致性测试（核心）

已落地（v1）：

- ✅ 队列原语并发测试：`packages/plugins/mindmap/src/backend/tools/mindmap/__tests__/mindmapWriteQueue.concurrent.test.ts`
  - 覆盖：同文档 FIFO、不同文档并行、AbortSignal、timeout、错误透传、队列深度查询、metrics 基本正确性

建议补充（v2 / 可选增强）：

- ⏳ 工具层 + DB 的集成并发测试（同一 MindMap 文档并发 create/tag，断言版本增长与内容同时存在）
  - 原因：目前 v1 的测试聚焦在“写入队列原语正确”，集成测试可进一步覆盖 sqlite 事务与 CAS 细节（但成本更高）。

### 8.2 回归测试

- 单子 agent 场景行为不变（不引入额外写入失败）
- AutoRefresh/前端展示仍能正确刷新（version + evidence）

---

## 9) 风险清单（提前写清楚）

- **锁的作用域**：如果后端存在多实例/多进程，同进程 mutex 不够；需要升级为 DB 层协调。
- **写入排序**：并行子 agent 的写入顺序会影响节点 children 的追加顺序；需要接受“先到先写”的排序语义，或引入排序规则（v2）。
- **子 agent 失败处理**：某个节点验证失败（无证据/超时/用户终止）时，父 Agent 如何记录并继续下一节点（建议“失败可见 + 继续推进其它节点”）。

---

## 10) 里程碑（建议）

- ✅ **Milestone 1（工具基础设施）**：实现 per-document 写入队列，并补齐并发测试（已完成：2026-02-08）
- ✅ **Milestone 2（MindMap run 子 agent 工具）**：新增 `mindmap_subrun_*`，对齐 Deep Research 的 subrun_trace/固定策略
- ✅ **Milestone 3（父工作流 agent）**：新增 `mindmap_workflow_leader`（强制工作流 + 预算 + 并行调度）
- ✅ **Milestone 4（UI 接入）**：根节点右键入口“深度分析”（触发 `mindmap_workflow_leader`）

> Milestone 0（讨论定稿）已隐含完成：并行范围与写入队列语义已在 4/5 章定稿并落地。

---

## 11) 具体改动点清单（新增文件 / 修改文件 / 新增测试）

> 中文说明：
> - 本节用于把“并行独立闭环写图”落到可执行的改动清单。
> - 原则：优先复用 Deep Research 的成熟范式（`researchSubagentTools.ts` + `ChildRunInvoker`），只在 MindMap 写图链路补齐缺失的并发控制原语（per-document 写入队列）。

### 11.1 新增文件（后端 / 工具层）

1) ✅ `packages/plugins/mindmap/src/backend/tools/mindmap/mindmapWriteQueue.ts`
   - **目的**：提供 per-document 的写入队列/互斥锁原语（FIFO），用于串行化 `mindmap_versions` 写入。
   - **接口**：实现 `withMindMapWriteLock({ documentId, purpose, abortSignal?, timeoutMs?, fn })`
   - **要求**：
     - 排队阶段支持 `AbortSignal`（用户终止应尽快退出）
     - 输出结构化日志字段：`queue_depth/queued_ms/lock_held_ms/purpose/document_id`
   - **实现备注**：
     - 已处理 `.finally()` 造成的“影子 unhandled rejection”（资源清理链路已显式 catch）

2) ✅ `packages/plugins/mindmap/src/backend/tools/mindmap/mindmapWriteContext.ts`（可选，但推荐）
   - **目的**：收敛“锁内重读 + 锁内执行 + 锁内保存”的模板，减少工具实现重复与遗漏。
   - **建议形态**：
     - `withMindMapVersionWrite({ documentId, context, purpose, apply(ctx) })`
       - 内部：`withMindMapWriteLock` → `initMindMapDocContext` → `apply(ctx)` → `saveMindMapVersion(ctx)`

> 备注：如果不新增 `mindmapWriteContext.ts`，也可以直接在两个工具里手写锁内重读模板，但更容易遗漏/漂移。

### 11.2 修改文件（后端 / 工具层）

#### 11.2.1 写 `mindmap_versions` 的工具（必须改）

1) ✅ `packages/plugins/mindmap/src/backend/tools/mindmap/MindMapCreateNodeTool.ts`
   - **改动点**：
     - 将“初始化文档上下文 + applyCreateNodeOperation + saveMindMapVersion”整体移动到锁内执行（不能只锁 save）
     - 锁的 key：`document_id`
     - `purpose='create_node'`
   - **注意**：
     - 保持现有 CAS 机制不变（仍然传 `expectedBaseVersionNumber`），它作为“绕过锁/多进程写入”的最后防线
     - 不在 observation 里暴露版本号给模型（现有规则）

2) ✅ `packages/plugins/mindmap/src/backend/tools/mindmap/MindMapTagNodeTool.ts`
   - **改动点**：
     - 同上：锁内重读 + applyTagOperation + saveMindMapVersion
     - `purpose='tag_node'`

#### 11.2.2 卫星表工具（默认不改；可选增强）

3) `packages/plugins/mindmap/src/backend/tools/mindmap/MindMapAttachEvidenceTool.ts`（可选）
   - **v1 默认**：不进入写入队列（不改版本）
   - **可选增强**：
     - 在返回 data 中补齐可观测字段（例如写入耗时、成功/失败分布），便于父工作流汇总

#### 11.2.3 MindMap 子 agent runner 工具（新增/修改）

4) ✅ `packages/plugins/mindmap/src/backend/tools/mindmap/mindmapSubagentTools.ts`
   - **目的**：对齐 Deep Research 的 `research_run_*`，提供：
     - `mindmap_subrun_decompose`（固定 promptKey=MINDMAP_DECOMPOSE_QUESTION）
     - `mindmap_subrun_propose`（固定 promptKey=MINDMAP_PROPOSE_HYPOTHESIS）
     - `mindmap_subrun_validate`（固定 promptKey=MINDMAP_VALIDATE_HYPOTHESIS）
   - **实现要求**：
     - 内部使用 `ChildRunInvoker.invoke()`
     - 支持 subrun_trace（绑定 parentToolCallId，metadata 至少包含 `document_id/target_node_ref/prompt_key`）
     - 固定 maxSteps（建议 60，和现有 task/deep_research 对齐）
     - 固定 inheritTurns（建议 0 或 1，按你们“避免串味”原则选）

5) `src/tools/registry.ts`（或你们集中注册工具的位置）
   - 注册新增的 `mindmap_run_*` 工具

### 11.3 修改文件（Agent Registry）

1) `src/app-hosts/linnya/agent-registry/agents/mindmap/workflow_leader/`（新增目录）
   - `index.ts`：新增父工作流 agent definition（`promptKey=mindmap_workflow_leader`）
   - `prompt.ts`：系统提示词（强制工作流、预算、并行策略、错误处理）

2) `/backend/agentRegistry.ts`
   - 增加 `PromptKeys.MINDMAP_WORKFLOW_LEADER`（如尚无）

3) `packages/plugins/mindmap/src/backend/index.ts`
   - 通过 Mindmap backend contribution 的 `agentDefinitions` 贡献新的 `mindmap_workflow_leader`

> 中文备注：父工作流 agent 的工具白名单应尽量小：只允许 `read_file`（`view="document"`） + `mindmap_run_*`（以及必要的列表/读工具），避免父 agent 直接写图。

### 11.4 修改文件（前端入口，v1）

1) `packages/plugins/mindmap/src/renderer/presentation/ui/contextMenu/menuItems.ts`
   - 新增菜单项：`深度分析（拆解→假设→验证）`
   - 仅在 **根节点** 显示

2) `packages/plugins/mindmap/src/renderer/presentation/ui/contextMenu/mindmapAiRun.ts`
   - 新增 action 分支：触发 `promptKey=mindmap_workflow_leader`（历史隔离 run）
   - `context_before` 里必须隐式携带 `document_id + target_node_ref`（不暴露在用户气泡文案里）

3) `packages/plugins/mindmap/src/renderer/presentation/ui/MindMapContextMenu.vue`
   - 接入新菜单 action（保持 UI 只分发意图，不做编排）

### 11.5 新增/修改测试（必须）

#### 11.5.1 工具并发一致性测试（核心）

已新增并通过：

1) ✅ `packages/plugins/mindmap/src/backend/tools/mindmap/__tests__/mindmapWriteQueue.concurrent.test.ts`
   - 覆盖：
     - 同一 `document_id` FIFO 串行（避免 CAS 冲突）
     - 不同 `document_id` 完全并行
     - `AbortSignal`：排队前 abort / 排队中 abort
     - `timeoutMs`：排队超时拒绝进入临界区
     - 错误透传且不阻塞后续排队者
     - 队列深度查询 + metrics 基本正确性

2) ⏳（可选增强）工具 + DB 集成并发测试：
   - 并发 create_node + tag_node 断言版本增长与内容同时存在（见 8.1 建议补充）

#### 11.5.2 子 agent runner 工具测试（推荐）

修改/新增：

- `src/app-hosts/linnya/agent-registry/agents/__tests__/` 下新增 `mindmapWorkflowLeader.test.ts`（或同目录）
  - 测试父工作流 agent 的 availableTools 白名单是否只包含预期工具
  - 通过 mock `ChildRunInvoker` 或用最小 fake runner，验证子 agent runner 工具会使用固定 promptKey（不允许模型侧覆盖）

已新增（v1）：

- ✅ `packages/plugins/mindmap/src/backend/tools/mindmap/__tests__/mindmapSubagentTools.test.ts`
  - 覆盖：固定 promptKey、userMessage 头部（document_id + anchor）、subrun_trace metadata

#### 11.5.3 回归测试

- 现有 MindMap 工具测试（若已有）必须跑通
- Deep Research 相关测试不得受影响（写入队列只作用于 MindMap tools）

### 11.6 验收清单（定义 Done）

- 并发触发 2~3 个 “validate_hypothesis” 子 run（同一 mindmap）：
  - 不出现“版本冲突”工具失败
  - MindMap 版本增长符合预期（每次写版本 +1）
  - 节点新增、证据挂载、标签更新均可在前端刷新后可见
- 日志中可看到每次写入的 `queued_ms/lock_held_ms`，便于后续调优并行度上限
