# 20 · Port 接口实施 + D-3 + D-4 综合 Plan

> **状态**：✅ 已完成（2026-04-22；T0 / T1 / T2 / T3 / T4 全部完成，Phase D 完成）
> **目标读者**：另一个 agent / 远程 subagent / 本机操作者，能照着本文档无人值守跑完 T0 → T4
> **执行人原则**：本文档列出的所有 step / 决策 / 异常协议都必须严格遵守；**不要发挥**，遇到本文档未覆盖的情况先停下记录到 §9 而不是猜
>
> **核心创新（vs engine/19）**：
> - **不是**单一 PR 流水，而是 5 个并行/串行任务组（T0-T4）
> - **不是**重新写 port 设计，而是把 engine/06 / 08 已定稿的 port 接口 **提前到 D-3 之前**实施
> - **不是**把 D-3 例子写完整代码，而是 **"双层 testkit 索引 + 替换地图"**模式
> - **不是**把 A 类协议 re-export 兜底，而是 **物理 move + ts-morph codemod**
>
> **关联**：
> - 主计划：[`07-public-api-and-package-boundary.md`](./07-public-api-and-package-boundary.md) §5.2 / §7.3 / §7.4
> - **真源**：
>   - Port 接口形状 → [`06-checkpointer-and-persistence.md`](./06-checkpointer-and-persistence.md) §4 方案 A + §6 7 题决议
>   - Telemetry / Error model 形状 → [`08-cross-cutting-concerns.md`](./08-cross-cutting-concerns.md) §4 方案 B/C + §6 7 题决议
>   - A 类协议归属 → [`12-agent-contracts-audit.md`](./12-agent-contracts-audit.md) §3.1 + R3
>   - D-3 双层 testkit → `src/agent/testkit/README.md` + `src/app-hosts/linnya/testkit/README.md`
> - 现有可被复用的执行模板：[`19-d2-implementation-runbook.md`](./19-d2-implementation-runbook.md)（PR 切片 / baseline 比对 / 异常协议模板）
> - **不变量 baseline 文件**：`.baseline/m4-summary.txt`（526 / 9 / 14 / ≤45s）

---

## 0. 启动准入

```bash
git status                                                   # 允许脏树，但只允许在当前增量上继续推进；禁止回退无关改动
git log --oneline -1                                         # 必须 = D-2 收尾 commit 或更新（含 reverse-import 0 的事实）
cat .baseline/m4-summary.txt | head -20                      # 必须能读到 526 / 9 / 14 / ≤45s
cat .baseline/agent-deep-import-baseline.txt | wc -l         # 必须 = 0（D-2 收口完成）
ls scripts/guards/agent-package-boundary-guard.ts                   # D-2 完成的 guard 必须在
ls src/agent/{ports,runtime-kernel,context-manager,testkit}/index.ts  # D-1 4 个 entry 必须在
ls src/agent/package.json                                    # D-1.b 草案必须在
```

**准入条件**（任何一条不满足必须 ABORT 并报告，**不要尝试修复**）：

- [ ] 当前工作区允许脏树，但执行人必须只在本轮增量上继续推进，不得回退既有改动
- [ ] HEAD 包含 D-2 收尾（reverse-import baseline = 0 + guard enforce）
- [ ] `.baseline/m4-summary.txt` 显示 tsc=526 / vitest file fail=9 / case fail=14 / duration ≤45s
- [ ] `.baseline/agent-deep-import-baseline.txt` 行数 = 0（如非 0 → 回 D-2 PR-J 收尾）
- [ ] D-1 4 个 sub entry + 顶层 entry + package.json 草案都在

---

## 1. 用户已拍板的决策（不再重新确认）

> **2026-04-22 决策定稿**（第三轮讨论收尾）。

### 1.1 D-3（接入指南）

| 决策 ID | 内容 | 影响 |
|---------|------|------|
| **E1** | D-3 文档位置：扩展现有 `src/agent/INTEGRATION_GUIDE.md`（不另开独立 proposal）| 接入指南随代码一起住进 `src/agent/`，Phase E `git mv` 时无痛 |
| **E2** | 例子代码形态：**写文件锚点**（行号 / 符号名级别），不复制代码块 | 避免文档 / 代码漂移；省维护成本 |
| **E3** | 索引层数：**双层 testkit**（`src/agent/testkit/*` + `src/app-hosts/linnya/testkit/*`）| 给 linnsec 三层视角：linnkit 自带 mock / Linnya host 真实 / Linnya host 测试 |
| **E4** | 例子数量：**第一版 5 个完整例子**（依赖 T0 完成，否则降级到 3 个 + 后续追补）| 接入指南一次到位 |
| **E5** | 完成判据：linnsec 视角通读无卡点（**不强制 CI smoke test**，testkit 已在 CI 跑覆盖）| 降低维护成本，提高真实可读性 |

### 1.2 D-4（schema 治理）

| 决策 ID | 内容 | 影响 |
|---------|------|------|
| **F1** | D-4 拆三步走：**D-4.a → D-4.b → D-4.c** | 风险与价值递增 |
| **F2** | D-4.a：R5 第二阶段——清理 engine 内部残留 `PromptKey` type-import → `string`（实测 9 文件 ~18 处）| 公共面已 R5 第一阶段干净，内部清干净是收尾 |
| **F3** | D-4.b：拍板 D-4.c 形态 + codemod 设计 review（决策窗口）| 防 D-4.c 直接动手出错 |
| **F4** | D-4.c：A 类协议**物理 move**（不是 re-export 兜底）| linnkit 真自包；Phase E `git mv` 时已经是干净状态 |
| **F5** | D-4.c 工程化：用 **ts-morph codemod**（不是 sed），处理 split-import；codemod **要做通用化**，将来 Phase E 的 E2/E4 复用 | 一次写脚本，两次受益 |
| **F6** | D-4.c 不做兼容回退窗口：A 类协议直接物理迁到 `src/agent/contracts/`，再用 codemod 一次性改完整仓导入路径 | 保持“真 move”而不是 copy + fallback，避免旧边界继续存活 |

### 1.3 关联调整（影响其他 topic 的实施时机）

| 决策 ID | 内容 | 影响 |
|---------|------|------|
| **G1** | engine/06 + engine/08 的 **port 接口部分**（不含 host 实现）提前到 D-3 之前实施 | D-3 第一版能直接写 5 个完整例子，否则只能写 3+2 拖 |
| **G2** | port 接口实施仅限：`Checkpointer` 扩展 / `EventStore` / `RunRegistryStore` / `TelemetryPort` / `ErrorClassification` 扩展。**不含**：engine 主循环接入 emit / host 装配点 wire-up（这些留给 G1 实施完后续做）| 控制 T0 范围，避免拖大 |
| **G3** | linnkit 持久化职责：**只提供 port 接口（"插槽"）**，不提供 SQLite / IndexedDB / Postgres 实现 | 接入方负责实现，linnkit 负责契约 |

---

## 2. 整体序列与依赖图

```
       ┌─────────────────────────────────────────────┐
       │  T0: Port 接口实施（G1 范围）               │
       │  - Checkpointer 扩展 + EventStore +        │
       │    RunRegistryStore + TelemetryPort +      │
       │    ErrorClassification 扩展                │
       └──────────────┬──────────────────────────────┘
                      │
                      ↓
       ┌─────────────────────────────────────────────┐
       │  T2: D-3 接入指南扩写（E1-E5）              │
       │  - 5 段双层索引 + 替换地图                   │
       └──────────────┬──────────────────────────────┘
                      │
                      ↓
       ┌─────────────────────────────────────────────┐
       │  T4: D-5 dry-run（链回 engine/07 §7.5）     │
       └──────────────┬──────────────────────────────┘
                      ↓
                  Phase E 起点

  并行轨：
  T1: D-4.a R5 第二阶段（与 T0 并行，无依赖）
  T3: D-4.c 物理 move + codemod（依赖 T1，可与 T2 并行；建议 T2 完成 1 段后再开 T3）
```

| 任务 | 内容 | 前置依赖 | 风险 | 工作量 |
|------|------|---------|------|--------|
| **T0** | Port 接口实施（仅 G2 范围内）| D-2 完成 | 中（新接口设计已定稿，但要写 contract test）| 中（~3 个 PR）|
| **T1** | D-4.a R5 第二阶段 PromptKey 清理 | 无（与 T0 并行）| 极低（机械替换）| 极小（1 PR）|
| **T2** | D-3 接入指南扩写 5 段 | T0 完成 | 低（纯文档）| 中（1 大 PR / 5 小 PR）|
| **T3** | D-4.c 物理 move + ts-morph codemod | T1 完成 | 中-高（跨包大动）| 中（~7 个 PR）|
| **T4** | D-5 dry-run | T0 + T1 + T2 + T3 全部 | 高（探索性）| 不可预估 |

> **subagent 一次跑哪些**：
> - **轮次 1**：T0（Port 接口）—— 一轮跑完 ~3 PR
> - **轮次 2**：T1（D-4.a，与 T0 完全独立）—— 1 PR，可与轮次 1 并发开
> - **轮次 3**：T2（D-3 接入指南）—— 5 段，建议一段一 PR
> - **轮次 4**：T3（D-4.c 物理 move + codemod）—— 7 PR
> - **轮次 5**：T4（D-5 dry-run，链回 engine/07 §7.5）

---

## 3. T0：Port 接口实施（G1 + G2 范围）

### 3.1 范围（精确文件清单）

| 类别 | 操作 | 文件 | 内容来源 |
|------|------|------|---------|
| **持久化 port** | 修改 | `src/agent/runtime-kernel/graph-engine/checkpointer/base.ts` | engine/06 §4 方案 A：`Checkpointer` 加 `peekMeta?` / `list?` + `CheckpointMeta` / `CheckpointListFilter` / `CheckpointSummary` 类型 |
| | 修改 | `src/agent/runtime-kernel/graph-engine/types.ts` | engine/06 §4 方案 A：`EngineState` 加 `schemaVersion: number` 顶层字段（Q3 决议） |
| | 修改 | `src/agent/runtime-kernel/graph-engine/checkpointer/memoryCheckpointer.ts` | save/load 适配 schemaVersion |
| | 新建 | `src/agent/runtime-kernel/graph-engine/event-store/base.ts` | `EventStore` interface + `PersistedEvent` 类型 + 单调 eventId 生成器 |
| | 新建 | `src/agent/runtime-kernel/graph-engine/event-store/memoryEventStore.ts` | in-memory 默认实现（Q7 决议：自带）|
| | 新建 | `src/agent/runtime-kernel/graph-engine/event-store/__tests__/eventStore.contract.test.ts` | 协议级 contract 测试 |
| | 新建 | `src/agent/runtime-kernel/run-supervisor/runRegistryStorePort.ts` | `RunRegistryStore` interface + `RunRecord` 类型 |
| | 新建 | `src/agent/runtime-kernel/run-supervisor/memoryRunRegistryStore.ts` | in-memory 默认实现 |
| | 新建 | `src/agent/runtime-kernel/run-supervisor/__tests__/runRegistryStore.contract.test.ts` | 协议级 contract 测试 |
| **Telemetry port** | 新建 | `src/agent/runtime-kernel/telemetry/telemetryPort.ts` | engine/08 §4.B：`TelemetryPort` + `TelemetryEvent` + `TelemetryScope` |
| | 新建 | `src/agent/runtime-kernel/telemetry/telemetryEvents.ts` | 事件 kind 常量（4 件套：`llm_call` / `tool_call` / `graph_node` / `run_lifecycle`）|
| | 新建 | `src/agent/runtime-kernel/telemetry/noopTelemetry.ts` | 默认 noop 实现 |
| | 新建 | `src/agent/runtime-kernel/telemetry/__tests__/telemetry.contract.test.ts` | 协议级 contract 测试 |
| **Error model** | 修改 | `src/agent/shared/errorClassifier.ts` | engine/08 §4.C：`ErrorClassification` 加 `errorCode` / `recoverable` / `retryAfterMs?` / `hint?` / `metadata?` 字段 + `ENGINE_ERROR_CODES` 常量表（dot-notation：Q5）|
| | 新建 | `src/agent/shared/__tests__/errorClassifier.contract.test.ts` | `ENGINE_ERROR_CODES` 完整性 + 字段语义测试 |
| **Exports** | 修改 | `src/agent/runtime-kernel/index.ts` | 加新 port + 类型 + `ENGINE_ERROR_CODES` 到 stable exports |
| | 修改 | `src/agent/runtime-kernel/__tests__/index.exports.snapshot.test.ts` | 更新 snapshot |

**绝对不许动的文件**（G2 范围卡尺）：
- `src/agent/runtime-kernel/graph-engine/engine.ts`（engine 主循环 emit 接入 = engine/06 T6 / engine/08 T3，**不在 T0 范围**）
- `src/app-hosts/linnya/adapters/runtime-assembly/*`（host 装配点 = engine/06 T8 / engine/08 T8，**不在 T0 范围**）
- 所有 `src/agent/runtime-kernel/llm/caller.ts` 等收集点（接入 emit 不在 T0 范围）

> **关键边界**：T0 只造"插槽"，不接线。这避免 T0 范围爆炸；接线是后续任务。

### 3.2 PR 切片

| PR | 内容 | 文件数 | 风险 |
|----|------|--------|------|
| **T0-PR1** | 持久化 port 三件套（Checkpointer 扩展 + EventStore + RunRegistryStore + 各自 contract test）| 9 | 低 |
| **T0-PR2** | TelemetryPort 三件套（port + events + noop + contract test）| 4 | 低 |
| **T0-PR3** | ErrorClassification 扩展 + ENGINE_ERROR_CODES + contract test + index.ts re-export + snapshot 更新 | 4 | 低 |

### 3.3 实施顺序（每个 PR 内强制按此）

| Step | 动作 | 验证命令 | 通过条件 |
|------|------|---------|---------|
| 3.3.1 | 先 Read 关联 engine/06 §4 / engine/08 §4 的 interface 代码块；照搬到对应文件 | — | 类型完全照定稿 |
| 3.3.2 | 写 contract test（先红再绿）| `npx vitest run <test-file>` | 红 → 实现后绿 |
| 3.3.3 | 实现 in-memory 默认实现 | 同上 | 绿 |
| 3.3.4 | 把新 port 加进 `runtime-kernel/index.ts` exports（**只加 stable，不加 compat**）| `npx tsc --noEmit -p tsconfig.json 2>&1 \| grep -c 'error TS'` | ≤ 526 |
| 3.3.5 | 更新 snapshot 测试 | `npx vitest run src/agent/runtime-kernel/__tests__/index.exports.snapshot.test.ts -u` | 全绿 |
| 3.3.6 | 全量回归 | `npm test` | file fail ≤ 9 / case fail ≤ 14 / 耗时 ≤ 45s |
| 3.3.7 | guard 通过 | `npm run guard:agent-boundary` | 0 violations |
| 3.3.8 | 提交 | pre-commit 通过 |

### 3.4 commit message 模板

```
feat(agent/runtime-kernel): T0-PR<N> add <port-name> per engine/06|08 §4

Add <port-name> public interface and in-memory default implementation.

- New file(s): <list>
- Extended <existing-file> with <fields/methods>
- Added <port-name> to runtime-kernel/index.ts stable exports
- Added contract test covering <test scope>
- Snapshot updated

Decisions referenced:
- engine/06 §6 Q<X>: <decision>
- engine/08 §6 Q<X>: <decision>

Refs: src/agent/docs/engine/20-d3-d4-port-interfaces-plan.md §3
Refs: src/agent/docs/engine/06|08 §7.1
```

---

## 4. T1：D-4.a R5 第二阶段（PromptKey 清理）

### 4.1 范围（实测 9 文件 ~18 处）

执行前先跑确认范围：

```bash
# 实时 grep 确认范围（不要复制本文档列表，可能与执行时已偏移）
rg -l "PromptKey" src/agent/ --type ts | grep -v docs | grep -v __tests__/.*flaky | sort
```

**实测当前命中（2026-04-22）**：
- `src/agent/ports/agent-invocation.ts:1` —— R5 第一阶段已搬到 doc-comment，可能是历史 import 残留
- `src/agent/runtime-kernel/child-runs/internalAgentInvoker.ts` (2 处)
- `src/agent/runtime-kernel/child-runs/__tests__/internalAgentInvoker.test.ts` (3 处)
- `src/agent/runtime-kernel/graph-engine/__tests__/graph-agent-executor.model-lock.test.ts` (2 处)
- `src/agent/runtime-kernel/graph-engine/tick-pipeline/__tests__/runTickPipeline.test.ts` (2 处)
- `src/agent/runtime-kernel/graph-engine/tick-pipeline/middlewares/runModelLockMiddleware.test.ts` (2 处)
- `src/agent/runtime-kernel/graph-engine/tick-pipeline/stages/prepareCallStage.test.ts` (2 处)
- `src/agent/runtime-kernel/graph-engine/tick-pipeline/middlewares/contextAuditMiddleware.test.ts` (2 处)
- `src/agent/runtime-kernel/graph-engine/tick-pipeline/middlewares/llmTelemetryMiddleware.test.ts` (2 处)

**预期数字**：9 个文件，~18 处 `PromptKey` 引用。

### 4.2 实施步骤

| Step | 动作 | 验证命令 | 通过条件 |
|------|------|---------|---------|
| 4.2.1 | 跑 §4.1 grep 确认实际范围 | — | 与本文档预期 ±5 处 |
| 4.2.2 | 对每个文件：判断这处 PromptKey 是 (a) type-import 仅用于 type position（→ 改 string） / (b) 真用 PromptKey enum 值（→ 必须 ABORT 记录到 §9）| 人工 review | 全部为 (a) 才继续 |
| 4.2.3 | 把 `import { PromptKey } from '@app/schemas'` 改成 `string` type（如果 line 中混了其他 schema type，保留其他）| `git diff` | 只删 `PromptKey` 一项 |
| 4.2.4 | 把所有 `: PromptKey` 改成 `: string` | `git diff` | 机械替换 |
| 4.2.5 | tsc 不增 | `npx tsc --noEmit \| grep -c 'error TS'` | ≤ 526（预期降低到 ~520）|
| 4.2.6 | 全量回归 | `npm test` | file fail ≤ 9 / case fail ≤ 14 / 耗时 ≤ 45s |
| 4.2.7 | 提交 | pre-commit 通过 |

### 4.3 commit message 模板

```
chore(agent): D-4.a R5 stage-2 clean residual PromptKey type-imports

Per engine/12 §6 R5 stage-2:
- Replaced `PromptKey` type-imports with `string` across 9 files (~18 occurrences)
- Kept @app/schemas imports for other types still in use
- engine internal already 100% opaque to promptKey value (verified in stage-1)
- Public ports (R5 stage-1, commit 8960d17c) unaffected

Verified:
- tsc errors: <X> (was 526 baseline; expected drop ~6)
- npm test: green at baseline (9/14/<=45s)

Refs: src/agent/docs/engine/20-d3-d4-port-interfaces-plan.md §4
Refs: src/agent/docs/engine/12 §6 R5
```

---

## 5. T2：D-3 接入指南扩写

### 5.1 范围

| 操作 | 文件 |
|------|------|
| 大改 | `src/agent/INTEGRATION_GUIDE.md`（在 192 行基础上扩写到 ~400 行）|
| 不动 | 独立 proposal（**不创建**，决策 E1 否决另起一份）|

### 5.2 文档结构（替换现有 INTEGRATION_GUIDE.md）

```markdown
# Agent Integration Guide

## 1. 你需要接什么（保留现有 §1，更新到 D-1/D-2 视角）
## 2. linnkit 公开面（新章节，引用 D-1 4 个 entry + D-1.b package.json#exports）
## 3. 双层 testkit 概念（新章节，解释为什么有两层）
## 4. 5 个最小接入例子（核心新增）
   ### 4.1 例 1：跑一个 agent
   ### 4.2 例 2：接 LLM provider
   ### 4.3 例 3：接你的工具集
   ### 4.4 例 4：接持久化（依赖 T0 完成的 3 个 port）
   ### 4.5 例 5：监听事件流 / 接 Telemetry（依赖 T0 完成的 TelemetryPort）
## 5. 平台与接入方边界（保留现有 §2，更新）
## 6. D-2 之后的硬约束（新章节）
## 7. 当前不建议你做的事（保留现有 §5，更新）
## 8. 推荐阅读顺序（保留现有 §7，更新）
```

### 5.3 5 段例子的统一模板（决策 E2 + E3）

每段 ~60-80 行 markdown，结构：

```markdown
## 例 N：<场景一句话>

**linnkit 公共契约**
- `src/agent/ports/<port>.ts:<line>` 看 `<TypeName>` 接口

**linnkit 自带 mock primitive（package-neutral）**
- `src/agent/testkit/<sub>/<file>.ts:<line>` 看 `<harness-name>`
  （把 scripted/mock 实现包成 port 注入）

**Linnya host 真实实现示范**
- 生产代码：`src/app-hosts/linnya/adapters/<adapter>.ts:<line>`
  （把 <真实后端> 包成 port 注入）
- 集成测试：`src/app-hosts/linnya/testkit/<sub>/<file>.ts:<line>`
  （host-bound harness 的端到端验证）

**你（接入方）要做的**
1. 实现 <port>（参考上面任一示范的形状）
2. 在你 host 的 runtime-assembly 里 new 出实例
3. 通过 <wire-up-point> 注入

**你不要做的（D-2 后会被 guard 拦）**
- 不要 `from 'src/agent/<sub>/<deep>'`
- 不要在 src/agent/ 里加你的 provider/tool/adapter 实现
- 不要直接 `import { ... } from '@app/schemas'` 拿 A 类协议（D-4.c 完成后请改用 `from 'linnkit/contracts'`）

**最小验证（你的 host 应该能跑通）**
- <某 testkit harness>
- 或参考 Linnya 的 <某 integration test>
```

### 5.4 5 段的具体锚点对照表（subagent 实施时必须填实）

| 例 | 公共契约文件 | linnkit testkit | Linnya 生产 | Linnya 测试 | 依赖 T0？ |
|----|--------------|-----------------|-------------|-------------|----------|
| 1 跑 agent | `ports/agent-invocation.ts` `AgentInvocationRequest` | `testkit/agent-harness/scriptedAiEngineHarness.ts` | `adapters/flow/flow.agent-runner.service.ts` | `app-hosts/linnya/testkit/agent-harness/graphLoopHarness.ts` | ❌ |
| 2 接 LLM | `ports/ai-engine.ts` `AgentAiEngine` | `testkit/agent-harness/scriptedAiEngineHarness.ts` | `adapters/runtime-assembly/graphRuntimeFactory.ts:42-78`（LinnyaLlmProviderFactory）| 同 1 graphLoopHarness | ❌ |
| 3 接工具 | `runtime-kernel/tools/*` 公开面 | `testkit/tool-fixtures/toolContext.ts` | `adapters/tools/defaultToolManager.ts` + `toolRegistry.ts` | `app-hosts/linnya/testkit/agent-harness/toolRegistryHarness.ts` | ❌ |
| 4 接持久化 | T0 后：`runtime-kernel/index.ts` 导出的 `Checkpointer` / `EventStore` / `RunRegistryStore` | T0 后：3 个 memory 实现 | `adapters/persistence/event-store/sqlite.implementation.ts` | `app-hosts/linnya/adapters/persistence/event-store/__tests__/*` | ✅ |
| 5 接 Telemetry | T0 后：`runtime-kernel/index.ts` 导出的 `TelemetryPort` + `TelemetryEvent` 4 件套 | T0 后：`noopTelemetry.ts` | （T0 完成后由后续 host 接入任务补）| —— | ✅ |

### 5.5 实施步骤

| Step | 动作 | 验证 |
|------|------|------|
| 5.5.1 | 跑 §5.4 表 grep 验证每个锚点行号是否准确（被 D-2 移过位置的要修正）| 行号 ±10 内 |
| 5.5.2 | 按 §5.2 结构改写 INTEGRATION_GUIDE.md | markdown lint 通过 |
| 5.5.3 | 5 段每段按 §5.3 模板写 | 每段含 4 个段落（契约/mock/真实/约束）|
| 5.5.4 | 删除现有 §6 关于 `packages/schemas` 的过期口径 | grep 不含 "packages/schemas 现在仍是共享 contract 包" |
| 5.5.5 | 加链回 `engine/13` / `engine/14` / `engine/19` 的 footer | 链接可点 |
| 5.5.6 | linnsec 视角通读（决策 E5）—— 用另一个 agent / 自己冷读 | 无"下一步该看哪里"卡点 |
| 5.5.7 | 提交 | pre-commit 通过 |

### 5.6 commit message 模板

```
docs(agent): D-3 expand INTEGRATION_GUIDE with 5 host-onboarding examples

Per engine/20 §5:
- Updated existing INTEGRATION_GUIDE.md (192 → ~400 lines), no new file
- Added 5 minimal-onboarding examples in dual-testkit-index format:
  example 1: run an agent
  example 2: bring your own LLM provider
  example 3: bring your own tools
  example 4: bring your own persistence (depends on T0)
  example 5: subscribe events / telemetry (depends on T0)
- Each example: 3-layer file anchors (linnkit contract / linnkit testkit mock / Linnya production+test)
- Removed stale "packages/schemas is external" wording (D-4.c will fix physical move)
- Cross-linked to engine/13, engine/14, engine/19

No code changes; documentation only.

Refs: src/agent/docs/engine/20-d3-d4-port-interfaces-plan.md §5
Refs: src/agent/docs/engine/07 §7.3
```

---

## 6. T3：D-4.c 物理 move + ts-morph codemod

### 6.1 范围

| 类别 | 操作 | 文件 / 内容 |
|------|------|-------------|
| **物理 move** | 剪切 | `packages/schemas/src/runtime-events.ts` → A 类 RuntimeEvent 系列 6 个 type/factory → `src/agent/contracts/events.ts` |
| | 剪切 | `packages/schemas/src/domain-models.ts` → A 类 AiMessage 系列 3 个 type → `src/agent/contracts/messages.ts` |
| | 剪切 | `packages/schemas/src/runtime-events.ts:430` → SubRunTraceEvent 系列 → `src/agent/contracts/sub-run-trace.ts` |
| **新入口** | 新建 | `src/agent/contracts/index.ts`（re-export 上面 3 个文件）|
| | 修改 | `src/agent/package.json` `exports` 加 `./contracts: "./contracts/index.ts"` |
| | 修改 | `src/agent/index.ts` 加 namespace 或顶层 re-export（依 engine/14 决策风格）|
| | 新建 | `src/agent/contracts/__tests__/index.exports.snapshot.test.ts` |
| **codemod** | 新建 | `scripts/codemods/move-a-class-to-linnkit-contracts.ts`（ts-morph，可重用框架）|
| | 新建 | `scripts/codemods/__tests__/move-a-class-to-linnkit-contracts.test.ts`（fixture 单测）|
| | 修改 | `package.json` 加 npm script `codemod:move-a-class` |
| **批量替换** | 自动 | 全仓 `from '@app/schemas'` 中 A 类符号 → `from 'src/agent/contracts'`（处理 split-import）| 实测影响约 175 文件 / 187 处 import / 30 处 split |

### 6.2 codemod 设计（决策 F5：通用化，Phase E E2/E4 复用）

**文件**：`scripts/codemods/move-a-class-to-linnkit-contracts.ts`

**职责**：
1. 输入参数：`--symbols=AiMessage,RuntimeEvent,...`（要搬的符号清单）+ `--from='@app/schemas'` + `--to='src/agent/contracts'`
2. 扫整个 monorepo 的 `.ts` / `.tsx` 文件
3. 对每个 import declaration：
   - 如果 `module === --from` 且 `namedImports` 含 `--symbols` 中任一符号
   - **保留** `--symbols` 之外的 named imports（split import）
   - **新增** 一个 import declaration `from --to` 含 `--symbols` 中命中的符号
4. 输出：报告改了多少文件 / 多少 import statement / 多少 split

**通用化要求**：
- 入参完全 CLI 化（不写死 schemas / contracts 路径）
- 输出报告 JSON 化，便于 CI 验证
- 保留 dry-run 模式（`--dry-run` 只报告不写文件）

**Phase E 复用场景**（写出来防止过度泛化）：
- E4：`from 'src/agent'` → `from 'linnkit'` 全仓替换 → 同一脚本，参数 `--from='src/agent' --to='linnkit'`
- E4 子任务：`from 'src/agent/runtime-kernel'` → `from 'linnkit/runtime-kernel'` → 同上

### 6.3 PR 切片

| PR | 内容 | 文件数 | 风险 | 依赖 |
|----|------|--------|------|------|
| **T3-PR1** | 写 codemod + 单测（不动业务文件）| 3 | 低 | 无 |
| **T3-PR2** | 建 `src/agent/contracts/` 入口并承接 A 类协议导出 + 加 snapshot 测试 + 加 package.json#exports | ~5 | 中 | T3-PR1 |
| **T3-PR3** | 跑 codemod 批量替换全仓 import + 修剩余漏网 import + 跑全套验证 | ~175 | 中-高 | T3-PR2 |
| **T3-PR4** | 文档同步 + 从 `packages/schemas` 真移除 A 类真源定义，确认无残留消费者 | 中 | 高 | T3-PR3 |

> **特殊提醒**：T3-PR3 跑 codemod 后，必须验证：
> - guard `agent-package-boundary-guard` 仍 0 violations（新 entry `contracts` 是 sub-entry，不会触发 guard-07）
> - reverse-import baseline 仍 0
> - tsc 不增（理论 0 净增；如果 +1 通常是 codemod 漏改）
> - vitest 全量回归不退化

### 6.4 D-4.c 真 move 的完成口径（决策 F6 + 1.2 F6）

这一步不再允许 `packages/schemas` 做任何 A 类协议的反向 re-export。

真正完成的判据是：

1. `src/agent/contracts/*` 成为 A 类协议唯一真源。
2. 全仓消费者已经改到 `src/agent/contracts`。
3. `packages/schemas/src/{domain-models,runtime-events,index}.ts` 不再暴露 A 类协议定义或导出。
4. 剩余留在 `packages/schemas` 的只允许是 B/C 类共享协议。

如果做不到以上 4 条，就只能算“消费者切过去了”，还不能算“物理迁移完成”。

### 6.5 commit message 模板（每 PR）

```
refactor(agent/contracts): D-4.c.<N> <action> — physical move A-class to linnkit

Per engine/20 §6 + engine/12 §3.1 R3:

T3-PR<N> action: <one-liner>

- <key file changes>
- <verification result>

Verified:
- guard:agent-boundary: 0 new violations
- .baseline/agent-deep-import-baseline.txt: still 0
- tsc errors: <X> (was 526; expected: 0 net change)
- npm test: file fail <= 9 / case fail <= 14 / duration <= 45s
- snapshot tests: updated and green

Refs: src/agent/docs/engine/20-d3-d4-port-interfaces-plan.md §6
Refs: src/agent/docs/engine/12 §3.1 R3
```

---

## 7. T4：D-5 dry-run

简短回顾：详见 [`engine/07 §7.5`](./07-public-api-and-package-boundary.md) + §5.2 已有定稿。

T4 已按 Q7=B 决议完成，产物与验证如下：
- 已建立 `packages/agent-engine-dryrun/` workspace（独立 `package.json` / `tsconfig.json` / `vitest.config.ts`）
- 已把 `src/agent/*` 拷入 dry-run workspace，并补齐 package-local alias / test config
- 已新增 `src/agent/__tests__/dryrun.workspace.test.ts` 锁住 workspace 结构与最小契约
- 已验证 dry-run workspace 的 `test:smoke` 与 `typecheck` 全绿
- 已按接入指南 5 段覆盖到的公开面，实跑代表性示例测试：
  - `graphLoopHarness.contract`
  - `toolContext`
  - `memoryCheckpointer.contract`
  - `eventStore.contract`
  - `runRegistryStore.contract`
  - `telemetry.contract`
- 为避免把 dry-run 拷贝误算进主仓门禁，已：
  - 在 `scripts/guards/agent-package-boundary-guard.ts` 中忽略 `packages/agent-engine-dryrun/**`
  - 在根 `vitest.config.ts` 中排除 `packages/agent-engine-dryrun/**`

本轮实测结果（2026-04-22）：
- `npm --prefix packages/agent-engine-dryrun run test:smoke`：通过
- `npm --prefix packages/agent-engine-dryrun run typecheck`：通过
- `npm run guard:agent-boundary`：通过
- `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c 'error TS'`：`499`
- `npm test -- --reporter=dot`：`8 failed files / 13 failed tests / 35.89s`

说明：
- `.baseline/m4-summary.txt` 仍维持旧 baseline（526 / 9 / 14 / ≤45s），本轮不顺手收紧门禁；收紧另开一轮做。
- 上述实测结果已经满足并优于当前 baseline，因此 T4 可判定完成。

T4 完成 = Phase D 完成 = linnsec 正式产品开发前置全部就位。

---

## 8. 完成判据（每个 T 视为完成的硬条件）

### T0 完成判据
- [x] T0-PR1 / T0-PR2 / T0-PR3 全部 land
- [x] `src/agent/runtime-kernel/index.ts` 已 export：`Checkpointer` 扩展类型 / `EventStore` / `RunRegistryStore` / `TelemetryPort` / `TelemetryEvent` 4 件套常量 / `ENGINE_ERROR_CODES` / 扩展后的 `ErrorClassification`
- [x] 5 个 contract test 全绿
- [x] snapshot 已更新
- [x] M4/M5 baseline 不退化（实测 tsc 499 / vitest 8 / 13 / 35.57s，全部优于 526 / 9 / 14 / ≤45s）

### T1 完成判据
- [x] PromptKey type-import 全仓清扫干净（实测：生产 + 测试 = 0 处 import；剩余 9 处命中全在 docs / contracts snapshot 测试输出）
- [x] `engine/12 §6 R5 stage-2` 标 ✅
- [x] M4/M5 baseline 不退化（tsc 从 526 → 499，降 27 条 ≥ 预期 6 条）

### T2 完成判据
- [x] INTEGRATION_GUIDE.md 5 段写完，每段含 §5.3 模板的 4 段落（实测 363 行）
- [x] §5.4 锚点表所有行号已校验准确
- [x] linnsec 视角通读无卡点（决策 E5）
- [x] 不强制 CI smoke test

### T3 完成判据
- [x] T3-PR1 ~ T3-PR4 全部 land
- [x] `src/agent/contracts/{events,messages,sub-run-trace,index}.ts` 均存在 + snapshot 测试覆盖
- [x] `src/agent/package.json` `exports` 含 `./contracts`
- [x] codemod 通用化完成（`--symbols` `--from` `--to` 三参数完整）
- [x] `packages/schemas` 已删除 A 类真源定义与导出，不再保留反向兜底
- [x] guard / tsc / vitest baseline 不退化
- [x] `engine/12 §3.1 R3` 状态标 ✅ A 类已 move

### T4 完成判据 = Phase D 完成判据
- [x] T0 + T1 + T2 + T3 全部完成判据均勾
- [x] `engine/07 §5.4.3` 7 项 dry-run 完成判据全绿
- [x] linnsec 正式产品开发前置全部就位 → 可启动 Phase E

完成后状态同步：
- [x] `engine/07 §8` 增加 D-3 / D-4 / D-5 完成行
- [x] `engine/06 §8` 标 port 接口部分已实施
- [x] `engine/08 §8` 同上
- [x] `engine/12 §6` 状态全部勾完
- [x] `engine/14 §2` 加 contracts namespace 已落地
- [x] `engine/13 §3.1` 加 contracts entry
- [x] `engine/README` 进度表 + 实施时序
- [x] `INTEGRATION_GUIDE.md` 标"D-3 已落地"

---

## 9. 异常协议（subagent 必读）

遇到下面任意一种情况，立刻 ABORT 并把现场记录到 PR description（不要尝试自己修）：

| 异常类型 | 触发情形 | 操作 |
|---------|---------|------|
| **Step 失败** | §3 / §4 / §5 / §6 任意 step 失败 | 记录 step ID + 命令 + stderr，停手 |
| **PromptKey 真用法** | T1 §4.2.2 发现某处是 `(b) 真用 PromptKey enum 值`（switch / equality）| 必须 ABORT，因为 R5 第一阶段曾验证为 0 处 —— 出现意味着新写入了产品耦合，要先回到 engine/12 评估 |
| **新 tsc 错误** | tsc 数量 > 526 | 记录 diff 错误清单，停手 |
| **新 vitest 失败** | file fail > 9 或 case fail > 14 | 记录失败清单，停手 |
| **耗时回归** | npm test > 45s | 记录耗时和近 3 次趋势，停手 |
| **codemod 漏改** | T3-PR3 跑完后 tsc 出现 ≥ 1 条新错误（多半是 import 漏改）| **不要手动改 import**，回 codemod 修脚本，重跑 |
| **A 类符号仍被旧入口消费** | T3-PR3 跑完后 `apps/renderer/*` 或其他消费者仍依赖 `@app/schemas` 的 A 类符号 | 不做兜底；先补 codemod 命中范围或手工定位漏网点，直到消费者全部切到 `src/agent/contracts` |
| **G2 范围越界** | T0 中计划外修改 engine 主循环 / host 装配点 | 立刻 `git restore`，记录 |
| **D-3 锚点行号偏移** | §5.4 表里行号与执行时实际偏移 > 10 行 | 重新跑 grep 修正，不要瞎填 |
| **新 reverse-import** | `.baseline/agent-deep-import-baseline.txt` 出现新行 | 大概率是 codemod 出问题或新写 deep import，停手回查 |

每个异常都开 PR description 的 "Encountered Issues" 段记录，让 review 人有完整上下文。

---

## 10. 状态

- [x] §0 启动准入定义
- [x] §1 用户决策固化（E1-E5 + F1-F6 + G1-G3，共 13 项）
- [x] §2 整体序列与依赖图（T0-T4 + 5 个轮次切片）
- [x] §3 T0 详写：Port 接口实施（持久化 3 件 + telemetry + error model + 3 PR 切片）
- [x] §4 T1 详写：D-4.a R5 第二阶段（实测 9 文件 ~18 处）
- [x] §5 T2 详写：D-3 接入指南扩写（双层 testkit 索引 + 5 段模板 + §5.4 锚点对照表）
- [x] §6 T3 详写：D-4.c 物理 move + ts-morph codemod 通用化（5 PR 切片）
- [x] §7 T4 简略：D-5 dry-run（链回 engine/07 §7.5）
- [x] §8 完成判据（5 段 T 各自 + Phase D 整段）
- [x] §9 异常协议（10 类异常 + ABORT 操作）
- [x] T0 / T1 已执行完成（轮次 1 / 2）
- [x] T2 已执行完成（轮次 3）
- [x] T3 已执行完成（轮次 4）
- [x] T4 已执行完成（轮次 5，收尾）

**下一步**：
1. ✅ 用户确认本 plan 决策项 13 个全部拍完（E1-E5 + F1-F6 + G1-G3）
2. ✅ T0 已完成：port 插槽（Checkpointer/EventStore/RunRegistryStore/TelemetryPort/ErrorClassification 扩展）已落地
3. ✅ T1 已完成：PromptKey 第二阶段清理已收口
4. ✅ T2 已完成：`INTEGRATION_GUIDE.md` 已按双层 testkit + 5 段例子重写
5. ✅ T3 已完成：A 类协议真 move + codemod + `packages/schemas` 旧真源清理完毕
6. ✅ T4 已完成：`packages/agent-engine-dryrun/` workspace + package-local smoke/typecheck + 代表性公开面示例测试全绿
7. ✅ Phase D 已完成：可进入 engine/07 的 Phase E（真抽包）
