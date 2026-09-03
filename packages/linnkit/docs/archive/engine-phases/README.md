# Agent Engine 升级计划

> ✅✅ **2026-04-23 阶段终态 banner**：Phase E 已**彻底完成**（§9 完成判据 11/11 全绿，桌面手测主链路用户已亲手验证通过）。本子目录正式进入**维护归档态**——已定稿的 8 份 topic + 7 份支持性工作文档冻结为现状参考；后续不再有"engine 升级 milestone"，仅按需承接 (a) 极少量 follow-up 微调；(b) linnsec 立项过程中真正穿透 4 条 Q1-Q4 门槛的反推需求。
> 进入 linnsec 正式产品开发后，本目录的核心使命已经达成：**linnkit 已具备 linnsec 运行所需的全部基础能力，同时 Linnya 也将自然受益于这一轮升级**（多 provider LLM / RunHandle / Checkpointer / EventStore / Telemetry / 工具并行 / 跨切面错误模型）。详见 §6 阶段终态归档声明。

本子目录承接 **Agent Engine**（`packages/linnkit/src/`*；Phase E 已于 2026-04-22 完成 git mv 并于 2026-04-23 完成桌面手测验证，此前位于 `src/agent/*`）在拆包前最后一轮升级的研究、决策与执行。

> 上一阶段的私有 living docs 主要解决 **Phase 0~C：物理收口与 host/product 边界外置**；过程记录不属于公开文档。
> 本目录承接 **Phase D 之后**：**为多消费者升级（如有需要） → 抽包**。

---

## 1. 工作目标

判断并执行 `packages/linnkit/src/`*（原 `src/agent/`*）抽成独立 package **之前与之中**，是否还有必要的能力升级。**Phase E 已彻底完成（2026-04-23）**，本目录使命已达成；后续仅承接：(a) 已定稿决策的极少量 follow-up 微调；(b) linnsec 立项过程中真正穿透 4 条 Q1-Q4 门槛的反推需求。

判断原则继承自 [Linnkit 定位与边界](../../framework/00-vision-and-positioning.md)，并由 [00-engine-scope-audit.md](./00-engine-scope-audit.md) §1.1 强化：

1. **是协议还是实现？**——只有协议候选才进入下一轮（实现一律归产品层）
2. ≥ 2 个真实消费者**真实需求**（不是假设性需求；Linnya + linnsec 是当前两个候选）
3. **engine 不加这个协议就没法接？**（vs 产品层 wrap 一层就够）
4. 不破坏 Linnya 现状

任一答 No → 归产品层或暂搁。详细决策流程图见 `[00-engine-scope-audit.md` §1.1](./00-engine-scope-audit.md)。

> ⚠️ **更新本表"engine 协议层外部证据"列前**，请先读 `[00-engine-scope-audit.md](./00-engine-scope-audit.md)` §1.2 三个常见误区。**只列 engine 协议层证据**（如"Hermes `on_pre_compress` 钩子的位置"），**不列产品层实现证据**（如"Hermes 8 个 memory backend"）。后者全部归 `secretary/<NN>` 表。

---

## 2. Topic 列表

每个 topic 一个独立文档。**未开始研究的 topic 不预先创建文件**——本表是路线图，文档按需创建。

**本表已经过 `[00-engine-scope-audit.md](./00-engine-scope-audit.md)` §3 + §5 的边界审视修订**。审视前的 8 topic 初稿（一股脑列入 engine）保留在 audit 文档 §3 表格中作为对照。

净结果（2026-04-21 二轮修订后）：删除 1（external agent 移走）+ 缩小 3（02/06/08）+ 暂不升级 3（原 03 memory / 04 long-running tool / 09 permission）+ 新增 2 确认（03 multi-provider LLM / 10 tool parallel execution）+ 新增 1 元文档（00 audit 本身）。

**当前已起草 topic 文档**：00 audit / 01 async / 02 session / 03 multi-provider / 06 checkpointer / 07 phase D + E / 08 cross-cutting / 10 tool parallel —— **共 8 份**（M2 + M3 全部完成）。

**当前已起草支持性工作文档**：

- [`11-phase-e-hard-blockers.md`](./11-phase-e-hard-blockers.md) —— Phase E 前硬阻塞清单（第一轮已全部关闭；B2 / B3 已判定为 host-owned default，不再阻塞真抽包）
- [`12-agent-contracts-audit.md`](./12-agent-contracts-audit.md) —— `@app/schemas` 三类归属审计
- [`13-public-api-surface-and-host-migration-batches.md`](./13-public-api-surface-and-host-migration-batches.md) —— 公开入口草案 + 宿主迁移批次
- [`14-stable-vs-compat-exports.md`](./14-stable-vs-compat-exports.md) —— 稳定导出 vs 兼容导出清单
- [`15-host-migration-file-manifest.md`](./15-host-migration-file-manifest.md) —— 宿主迁移文件级清单
- [`16-m4-m5-regression-test-plan.md`](./16-m4-m5-regression-test-plan.md) —— M4 / M5 回归测试计划（基线 + 4 防线 + 6 门禁 + 桌面手测 checklist）
- [`17-tech-debt-cleanup-plan.md`](./17-tech-debt-cleanup-plan.md) —— 类型债 + 测试债清理（Sprint 1+1.7 已收口；Sprint 2-5 转机会主义）
- [`18-d1-implementation-runbook.md`](./18-d1-implementation-runbook.md) —— **D-1.a + D-1.b 实施手册**（PR2 + PR3 + PR-template；可让 subagent 无人值守跑完；已用于实施）
- [`19-d2-implementation-runbook.md`](./19-d2-implementation-runbook.md) —— **D-2 实施手册**（guard 反向 lint + CI + codename lint + 宿主 import 收口 Batch 0~5；10 PR / 8 轮次；已完成）
- [`20-d3-d4-port-interfaces-plan.md`](./20-d3-d4-port-interfaces-plan.md) —— **T0 (port 接口) + D-3 (接入指南) + D-4 (schema 物理 move) + T4 (dry-run) 综合 Plan**（T0 / T1 / T2 / T3 / T4 已全部完成；Phase D 已完成，可进入 Phase E）
- [`21-host-port-adapter-research.md`](./21-host-port-adapter-research.md) —— **宿主侧 Port 适配研究**（B1 Checkpointer ✅ / B2 Telemetry ✅ / B3 EventStore ✅ / B4 RunRegistry ⏸；EventStore 的 Phase E 硬阻塞已解除）
- [`22-eventstore-alignment-research.md`](./22-eventstore-alignment-research.md) —— **B3 EventStore 模型对齐研究**（A2：保留现有四表 schema + 改 `EventPersistenceCoordinator.persistRun()` 内部循环写，**不挂 EventBus sink 当主路径**；Q1/Q2/Q3 已拍板并完成实施；B3d 继续延后）
- [`23-b3-eventstore-runbook.md`](./23-b3-eventstore-runbook.md) —— **B3 实施 Runbook**（PR-A `deb0e834` / PR-B `4b31a76f` / PR-C `bd889409` / PR-D `08c77ce6` 已全部完成；B3d live EventBus sink 延后到 Phase E 之后）
- [`24-phase-e-implementation-runbook.md`](./24-phase-e-implementation-runbook.md) —— **Phase E 真抽包实施手册**（✅✅ **彻底完成**：PR-A/B/C/D + 桌面手测 11/11 全绿，2026-04-23；§12 含收官期"硬件升级"归档清单：bundler externalize / boundary guard AST 重构 / DB createTables-always 架构加固 / better-sqlite3 ABI 双脚本 等 7 项加固）


| 编号         | Topic                                                | Scope（一句话）                                                                               | 状态          | 文档                                       | engine 协议层外部证据                                                                                   |
| ---------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 00         | **Engine scope audit**（方法论 + 边界纪律）                   | 调研→engine/secretary 分流的强制流程；逐项审视 8 topic 边界；调研存量归档去向；§1.4 "engine 留接口、不做工具、信息丰富"原则                                     | ✅ 已完成       | `00-engine-scope-audit.md`               | （元文档，无外部证据）                                                                                      |
| 01         | Async runs and run handles                           | engine 留 `RunHandle` 协议（spawn / peek / list / wait / subscribe / cancel）+ IterationBudget tree + delegate_depth 硬限制；信息丰富设计 | ✅ 决策定稿（方案 B）   | `01-async-runs-and-handles.md`           | CC + Codex + Hermes 三方都在产品层重复造轮 → 反向证据：engine 应主动留接口消除重复                       |
| 02         | Session and tenancy                          | conversationId 保持 opaque + AgentInvocationRequest 加 4 个可选挂载字段（conversationId / parentConversationId / parentRunId / metadata）                  | ✅ 决策定稿 | `02-session-and-tenancy.md`                                    | engine 协议核心已够薄；信息丰富的挂载点必须留   |
| 03         | **Multi-provider LLM abstraction**（Road Y 定稿）           | Provider 抽象 / streaming 规范化 / 走 Road Y（engine 定 `LlmProviderPort` + host 注入）             | ✅ 决策定稿      | `03-multi-provider-llm-abstraction.md`   | 4 项目均有自己的多 provider 抽象；engine 协议必须统一抽象，否则两个产品各自重复；详见 topic §3                                    |
| ~~03-old~~ | ~~Memory port~~                                      | ~~长期记忆是否需要在 engine 加 port~~                                                              | ❌ **暂不升级**  | 见 [audit §2](./00-engine-scope-audit.md) | 调研归档到 `secretary/06`；触发条件见 [audit §8](./00-engine-scope-audit.md)                                |
| 04         | Long-running tool / wait_external                    | 工具暂停-等外部完成 是否复用 wait_user 协议泛化                                                           | ⚠️ 暂不升级     | 见 [audit §3](./00-engine-scope-audit.md) | CC + Codex + Hermes 均"无内核暂停"，wait_user 已存在；触发条件见 [audit §8](./00-engine-scope-audit.md)          |
| ~~05~~     | ~~External agent tool protocol~~                     | ~~调外部 agent 是否在 engine 提供 helper~~                                                       | ❌ **砍掉**    | 整体移到 `secretary/11`                      | 外部 agent = 一种特化 tool，engine `runtime-kernel/tools/`* 已够                                          |
| 06         | Checkpointer and persistence | 三个独立 port：Checkpointer 扩展（`peekMeta` / `list` / schemaVersion）+ EventStore（可选）+ RunRegistryStore（被 RunSupervisor 消费）         | ✅ 决策定稿 | `06-checkpointer-and-persistence.md`                                    | linnya 桌面 + linnsec 永驻 daemon 双消费者；Hermes SessionDB FTS5 模式启发     |
| 07         | Public API and package boundary (Phase D + E)            | **D-1~D-5 + E1~E8**；package name = `linnkit`；Phase E（真抽包）= linnsec 正式产品开发硬前置                            | ✅ 决策定稿      | `07-public-api-and-package-boundary.md`  | （engine 元任务，不需外部证据；Codex protocol crate 模式作为 D-4 参考）                                            |
| 08         | Cross-cutting concerns（拆三件）                       | abort（写公开契约不加 port）+ telemetry（新增 TelemetryPort + 4 件套收集）+ error model（扩展 ErrorClassification + ENGINE_ERROR_CODES）                                          | ✅ 决策定稿 | `08-cross-cutting-concerns.md`                                    | abort 已就绪；telemetry 当前隐式 AsyncLocalStorage 缺 port；errorCode 需 stable namespace                  |
| ~~09~~     | ~~Permission / Approval port~~                       | ~~工具调用审批是否需要专门 port~~                                                                   | ❌ **暂不升级**  | 见 [audit §4.2 / §8](./00-engine-scope-audit.md) | wait_user + control.requireUser + control.terminateRun 三件套已够；产品层用 wrapper pattern；触发条件见 audit §8 |
| 10         | **Tool parallel execution**（scope 大幅缩小）              | 默认串行 + 工具 opt-in `parallelSafe` + 前缀连续 batch + 第一批纯查询型一律标；超时 / DAG 全部不做                | ✅ 决策定稿      | `10-tool-parallel-execution.md`          | linnya 桌面真实痛点（多 KB+web 串行 ~5s）；Codex tokio + CC `parallel_tool_calls` + Hermes 黑名单作为反例参考         |
| 11         | Phase E hard blockers                              | 真抽包前的硬阻塞盘点：deep import、装配缝死点、guard 缺口、缺失入口文件                                            | ✅ 第一轮审计完成 | `11-phase-e-hard-blockers.md`            | 来自 Linnya 当前代码结构的本地审计                                                                              |
| 12         | Agent contracts audit                             | `@app/schemas` 归属审计：哪些并回 `linnkit`、哪些继续共享、哪些属于 Linnya                                     | ✅ 第一轮审计完成 | `12-agent-contracts-audit.md`            | 来自当前 schemas 与 agent 用法的本地审计                                                                        |
| 13         | Public API surface and host migration batches     | 真抽包前的下一步研究：公开入口怎么开、宿主按什么批次脱离 deep import                                              | 🚧 第一轮研究稿   | `13-public-api-surface-and-host-migration-batches.md` | 来自当前宿主热点 import 与装配点的本地审计                                                                      |
| 14         | Stable vs compat exports                          | 真抽包前的最后一轮导出分类：哪些长期公开、哪些只是迁移期兼容                                                    | 🚧 第一轮研究稿   | `14-stable-vs-compat-exports.md`         | 来自 Linnya 宿主真实使用面的本地审计                                                                            |
| 15         | Host migration file manifest                      | 宿主迁移文件级清单：每批先改哪些、哪些必须同批、哪些不能拆                                                     | 🚧 第一轮研究稿   | `15-host-migration-file-manifest.md`     | 来自 Linnya 宿主代码链路与测试面的本地审计                                                                      |


**当前进度**（2026-04-23 Phase E 桌面手测通过 + 收官归档完成后更新）：

| 类别 | Topic | 备注 |
|------|-------|------|
| ✅ 决策定稿，等候实施 | **01 / 02 / 10** | 3 份 §6 已逐项定稿；M2 + M3 完成；可立即排实施时序 |
| ✅ 决策定稿 + port 接口 + B1/B2/B3 host 接入已实施 | **06 / 08** | port 接口部分已通过 [`engine/20`](./20-d3-d4-port-interfaces-plan.md) T0 阶段落地（2026-04-22）；**B1 Checkpointer**（host `SqliteCheckpointer` + 30d GC + 3 注入点）+ **B2 Telemetry**（engine 4 emit 点 + host `SqliteTelemetryAdapter` 双 sink + 7d GC + CLI tail）+ **B3 EventStore**（A2；PR-A `deb0e834` / PR-B `4b31a76f` / PR-C `bd889409` / PR-D `08c77ce6`）已完成，详见 [`engine/21`](./21-host-port-adapter-research.md) / [`engine/22`](./22-eventstore-alignment-research.md) / [`engine/23`](./23-b3-eventstore-runbook.md)；**B4 RunRegistry** 暂搁等 RunSupervisor |
| ✅ 决策定稿 + 部分已实施 | **03** | §7.1 T1 / T3 / T4 / T5 已等价完成（`AgentAiEngine` ≡ `LlmProviderPort`）；T2 / T6 待按需推进 |
| ✅ 决策定稿 + D-2 已完成 | **07 / 13 / 14 / 15 / 19** | PR-A/B/C + Batch 0/1/2/3 + PR-H 主体已实装并过当前 baseline；原 Batch 5 主 knot 已并入 Batch 4；`.baseline/agent-deep-import-baseline.txt` 已从 179 收敛到 0，reverse deep import 已进入最终 enforce |
| ✅✅ 决策定稿 + Phase E 已彻底完成 | **11 / 24** | **Phase E 全部 4 条 PR + 桌面手测 11/11 全绿（2026-04-23）**；B4 已关闭；B1 / B5 已随 D-2 + PR-J 关闭；B2 / B3 已判定为 host-owned default；本 topic 退入历史归档参考状态；同时归档收官期 7 项"硬件升级"（详见 [`24 §12.2`](./24-phase-e-implementation-runbook.md)）|
| ⏳ 触发再说 | **04 / 09** | 暂不升级；触发条件见 audit §8 |

**实施时序（M4-M5）**：

**M4 实施**（按风险递增、可并行）：
- ✅ **07 的 D-1.a / D-1.b 已完成**（commits `1a93fe77` / `e1fb29ed`）
- ✅ **03 §7.1 T1 / T3 / T4 / T5 等价完成**（命名为 `AgentAiEngine`）
- ✅ **当前主线收官：engine/20 已完成**（详见 [`engine/20`](./20-d3-d4-port-interfaces-plan.md)）
  - [x] **T0**：engine/06 + engine/08 的 **port 接口部分**（仅造插槽，不接线）已实施
  - [x] **T1**：D-4.a R5 第二阶段 PromptKey 清理已完成
  - [x] **T2**：D-3 接入指南扩写已完成
  - [x] **T3**：D-4.c A 类协议物理 move 已完成（真 move + codemod + `packages/schemas` 旧真源移除）
  - [x] **T4**：D-5 dry-run 已完成（独立 workspace + package-local smoke/typecheck + 代表性公开面示例测试全绿）

**M5 Phase E 真抽包**（✅✅ **彻底完成 2026-04-23**）：
- EventStore 前置已解除：B3 已按 [`engine/23`](./23-b3-eventstore-runbook.md) 完成 PR-A / B / C / D，`linnkit.EventStore` 不再是死接口
- B1 Checkpointer ✅ / B2 Telemetry ✅ / B3 EventStore ✅ / B4 RunRegistry ⏸（暂搁不阻塞）
- [`engine/11`](./11-phase-e-hard-blockers.md) 第一轮硬阻塞已全部关闭
- [`engine/24`](./24-phase-e-implementation-runbook.md) **PR-A codemod / PR-B 包壳 / PR-C 真 move + 全仓改写 / PR-D dryrun sunset 已全部完成**；新增 `packages/linnkit/src/testkit/__tests__/graphLoop.endToEnd.contract.test.ts` 作为永久回归门
- §5.4.3 完成判据 11/11 全绿（结构 ✅ / 占位删除 ✅ / 自动化测试 ✅ / guard ✅ / build ✅ / 文档 ✅ / 桌面手测主链 ✅，2026-04-23 用户亲手验证）
- 收官期顺手做了 7 项"硬件升级"（bundler externalize 修复 / boundary guard 重构为 AST / DB createTables-always 架构加固 / better-sqlite3 ABI 双脚本 等，详见 [`24 §12.2`](./24-phase-e-implementation-runbook.md)）
- linnsec 正式产品开发前置全部就位；后续产品决策记录不属于本公共归档

### 2.1 状态符号

- ✅ **必做**：engine 必须做的元任务（07）或已完成的元文档（00）
- ✅ **已调研，待定稿**：调研充分，等用户拍板进入实施（01）
- 🚧 **待研究**：在升级路线上，需要正式 topic 文档
- ⚠️ **缩小后待研究**：scope 经 audit 缩小，需要按新 scope 写 topic 文档
- 🤔 **待评估**：候选项，先评估是否真的需要才决定要不要写 topic
- ⚠️ **暂不升级**：当前不做，但保留触发条件（见 `[00-engine-scope-audit.md` §8](./00-engine-scope-audit.md)）
- ❌ **砍掉**：不属于 engine 范围，已迁出

---

## 3. Topic 文档统一模板

每份 `<NN>-<topic>.md` 必须包含以下小节（**2026-04-21 新增 §0 边界判定，参考 `[03-multi-provider-llm-abstraction.md](./03-multi-provider-llm-abstraction.md)` 实例**）：

```markdown
# <NN> · <Topic Title>

> 状态 / 日期 / 触发 / 前置（链回 audit）

## 0. Q1-Q4 边界判定（先过门槛）
（按 00-engine-scope-audit.md §1.1 流程的 4 条标准逐一答；任一不通过 → 不应该作为 engine topic 存在，应迁出或改名）

## 1. 问题与场景
（这个 topic 解决什么 / 不解决什么；为什么放在 engine 而不是产品层）

## 2. 当前 Linnya 现状
（关键文件路径 + 简要现状描述；带 `path/to/file.ts:line` 引用）

## 3. 参考项目做法
### 3.1 OpenClaw
### 3.2 Codex
### 3.3 Claude Code
### 3.4 Hermes
（每个项目：核心思路、关键文件、对我们的启发；详细引用 `99-research-notes/<project>.md`）
### 3.5 启发摘要（按本 topic 范围 → 是否进入 engine）

## 4. 候选方案
### 方案 A / B / C
（每个方案：思路、优点、缺点、影响面；按渐进升级分级）

## 5. 当前倾向
（推荐哪个方案 + 一句话理由 + 实施分步）

## 6. 待决策问题
- [ ] 问题 1（备选 + 默认推荐）
- [ ] 问题 2

## 7. 落地任务
（pending decision 时先列大颗粒；决策完成后展开为细任务清单）

## 8. 状态
（小节级 checklist + 下一步动作）
```

**示范文档**：
- `[03-multi-provider-llm-abstraction.md](./03-multi-provider-llm-abstraction.md)`（audit 后产出的第一份按本模板写的 topic）
- `[07-public-api-and-package-boundary.md](./07-public-api-and-package-boundary.md)`（engine 元任务模板示范，含 Phase D + E）
- `[10-tool-parallel-execution.md](./10-tool-parallel-execution.md)`（"小而专"协议升级模板示范）
- `[01-async-runs-and-handles.md](./01-async-runs-and-handles.md)`（"信息丰富 ≠ 工具丰富" port 设计示范）
- `[06-checkpointer-and-persistence.md](./06-checkpointer-and-persistence.md)`（多 port 拆分 + 可选 capability 模式）
- `[08-cross-cutting-concerns.md](./08-cross-cutting-concerns.md)`（"abort/telemetry/error 拆三件分别评估"模板）

---

## 4. 状态符号约定

- 📝 **待研究**：还未开始
- 🚧 **进行中**：正在研究/讨论
- 🤔 **决策中**：方案已列，等用户拍板
- ✅ **已决策**：方案确定，进入实施
- ✅✅ **已完成**：决策已实施 + 测试通过

---

## 5. 升级 vs 不升级

每个 topic 的最终决策只能是以下三种之一：

1. **升级 engine** —— 写进 engine 升级清单，按本目录现行治理流程执行
2. **不升级 engine，方案放产品层** —— 在对应 `secretary/<NN>-<topic>.md` 详写产品侧实现
3. **不升级 engine，但需要小调整** —— 比如重命名一个 export、补一段文档、加一个测试，不算"升级"

每个 topic 文档的"当前倾向" §5 必须明确指向上述三种之一。

---

## 6. 阶段终态归档声明（2026-04-23）

本子目录于 **2026-04-23 起进入维护归档态**。一句话总结当前形态：

> **linnkit 已具备 linnsec 运行所需的全部基础能力，同时把这些能力同步带给了 Linnya；engine 升级使命达成。**

### 6.1 已完成的"engine 主升级清单"

| 维度 | 上线能力 | 受益消费者 |
|------|---------|-----------|
| **公开 API 与抽包** | `linnkit` 真 package（`packages/linnkit/`），4 个稳定子入口（root / `runtime-kernel` / `context-manager` / `testkit`）+ 1 个浏览器子入口（`runtime-kernel/events`）；`agent-package-boundary-guard.ts` 升级为 AST 级 + 10 条规则（含禁 testkit 入生产） | Linnya / linnsec / 任何未来消费者 |
| **多 provider LLM 抽象** | `LlmProviderPort` + host 注入工厂（03 Road Y）；engine 不假设具体 provider；纯聊天与 agent 形态归约为同一套 | Linnya / linnsec |
| **Async runs / RunHandle** | `RunHandle` 留接口（spawn / peek / list / wait / subscribe / cancel）+ IterationBudget 树 + delegate_depth 硬限制 | linnsec daemon 长跑场景 |
| **会话与租户** | `conversationId` opaque + 4 个可选挂载字段（`conversationId / parentConversationId / parentRunId / metadata`） | linnsec 多通道 / 多会话隔离 |
| **三件套持久化 port** | `Checkpointer`（含 `peekMeta` / `list` / schemaVersion）+ `EventStore`（A2 schema-preserving，event-grained 写）+ `RunRegistryStore`（暂搁等 RunSupervisor）；host 侧 `SqliteCheckpointer` + 30d GC + 3 注入点 全部上线 | Linnya 桌面 / linnsec 永驻 daemon |
| **Telemetry** | `TelemetryPort` + engine 4 emit 点 + host `SqliteTelemetryAdapter` 双 sink + 7d GC + CLI tail | 两个产品共享排查能力 |
| **跨切面** | abort 公开契约 + `ErrorClassification` 扩展 + `ENGINE_ERROR_CODES` 稳定 namespace | 两个产品共享 |
| **工具并行** | 默认串行 + 工具 opt-in `parallelSafe` + 前缀连续 batch；第一批纯查询型一律标 | Linnya 真实痛点（多 KB+web 串行 ~5s） |

### 6.2 收官期的"硬件加固"（顺手做的，非主升级清单）

详见 [`24 §12.2`](./24-phase-e-implementation-runbook.md) 7 项加固一览表。其中**最具战略价值的是第 5 项**：`DatabaseService.createTables()` 改为每次 init 都跑 + 全量审计 94 条 schema-provider DDL 的幂等性 + 修复 v14 / v19 的非幂等数据回填 + 新增端到端 idempotent-init 测试。这把"新加 schema-provider 表必须配对写一条 migration"这个长期 DRY 违反**从根上消除**——未来任何加表只需改 schema-provider，老库会在下次启动时被 `createTables()` 自动补齐。

### 6.3 未承接的下一步

- **engine 侧**：默认不再有"engine 升级 milestone"。任何新升级提案必须重新走 `[00-engine-scope-audit.md §1.1](./00-engine-scope-audit.md)` 的 Q1-Q4 门槛。
- **产品侧**：后续 linnsec 立项与产品决策在其私有 owner 文档中推进，不由本公共归档承载。
- **Linnya 侧**：自然受益于本轮升级；若有产品需求触发新一轮 engine 升级，按 §6.3 重新走门槛。

### 6.4 文档归档约定

- 本目录 17 份 `.md`（00 audit / 01-15 topic + 18-24 runbook）冻结为**现状参考**，不再持续 living-doc 维护
- 任何后续 engine 改动只在对应 topic 文档**末尾追加 changelog 条目**，不再修改既有决策段落
- 若 linnsec 立项过程中真正穿透 4 条门槛产生新 topic，按 `25-` 起编
