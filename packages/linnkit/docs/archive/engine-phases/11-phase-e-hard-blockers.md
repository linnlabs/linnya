# 11 · Phase E Hard Blockers

> **状态**：✅ **Phase E 工程层已完成（2026-04-22）** —— 本文档转入"历史归档参考"。Phase E PR-A/B/C/D 全部落地，`src/agent/*` 已物理 move 到 `packages/linnkit/src/*`，所有列入本文档的硬阻塞均已实证关闭，无回归。详见 [`engine/24-phase-e-implementation-runbook.md §9`](./24-phase-e-implementation-runbook.md)。第一轮硬阻塞历史结论：**B4（公开入口）已在 D-1.a/b 关闭，B1 / B5 已在 D-2 + PR-J 关闭，EventStore 的 Phase E 硬阻塞已由 engine/23 关闭，B2 / B3 已判定为 host-owned default，不再作为 Phase E blocker**。
> **日期**：2026-04-21（首版）/ 2026-04-22（D-1.a/b 落地后小幅更新；同日 Phase E 工程层全部完成，本文档转归档参考状态）  
> **作用**：把 `engine/07` Phase E 真抽包前会卡死的硬阻塞集中列出来，避免“边搬目录边踩雷”  
> **关联主文档**：
> - [`07-public-api-and-package-boundary.md`](./07-public-api-and-package-boundary.md)
> - [`12-agent-contracts-audit.md`](./12-agent-contracts-audit.md)

---

## 0. Phase E 已完成后记（2026-04-22）

**Phase E 工程层于 2026-04-22 全部完成**：`src/agent/*` 已物理 git mv 到 `packages/linnkit/src/*`；codemod 全仓改写 import；`packages/agent-engine-dryrun/` sunset；`packages/linnkit` 内部端到端 smoke 已落地为永久回归门。本文档列出的所有硬阻塞均**已被实施验证关闭**，详见 [`engine/24 §9`](./24-phase-e-implementation-runbook.md)。

本文档保留为：
- **历史决策审计追踪**：用于回看"Phase E 启动前我们识别了哪些硬阻塞、各自如何解除"
- **未来抽包项目的方法论参考**：分析硬阻塞的 4 个维度（reverse import / 公开入口 / guard 缺口 / 装配缝死点）可作为下一次包提取的清单模板

如果你只想知道"Phase E 现在到哪一步了"，请直接读 [`engine/24-phase-e-implementation-runbook.md`](./24-phase-e-implementation-runbook.md)。

---

## 1. 结论先说

当前已经从“实现阻塞一堆”收敛到“第一轮硬阻塞全部关闭”。最初那批“宿主大面积 deep import + guard 不拦”的硬阻塞已经拆掉，EventStore 这条 Phase E 硬阻塞也已完成；B2 / B3 经代码实查后确认属于宿主默认装配，不再阻塞真抽包。**2026-04-22 补充**：Phase E PR-A/B/C/D 已全部完成，本节以下分析转为历史归档。

本轮结论：

1. ~~宿主仍大量直接依赖 `src/agent` 内部实现路径~~ ✅ **B1 已关闭**（D-2 收尾后，宿主与 agent 内部 reverse deep import 白名单已从三位数收敛到 `0`）
2. ~~`src/agent` 自己还没有补齐抽包后必须存在的公开入口~~ ✅ **已关闭（D-1.a/b 完成）**
3. ~~`context-manager` / runtime assembly 的残余耦合要不要继续当作 Phase E blocker~~ ✅ **B2 / B3 已判定为非阻塞**（它们是宿主默认装配，不是 agent 私有实现泄漏）
4. ~~当前 boundary guard 只能防一半，CI 看不住最真实的抽包风险~~ ✅ **B5 已关闭**（D-2 guard 反向 lint + CI 已上线，reverse-import baseline 已清零并进入最终 enforce）

一句大白话：箱子和门牌已经好了，保安也到岗了；现在剩的是收尾判断，不是最初那种“外面的人还在直接进卧室拿东西”。

---

## 2. 本轮硬数据

### 2.1 宿主 deep import 面

历史起点（D-2 启动前）按 `src/app-hosts` / `src/features` / `src/electron-main` / `apps` 统计：

- `169` 条 `src/agent/.../...` deep import
- 分布在 `72` 个文件
- 触达 `60` 个内部路径

按一级热点分布：

- `runtime-kernel/execution`：38
- `context-manager/profiles`：37
- `runtime-kernel/tools`：21
- `runtime-kernel/graph-engine`：21
- `runtime-kernel/enrichment`：11
- `runtime-kernel/llm`：9
- `runtime-kernel/events`：9

而当前（2026-04-22 D-2 PR-H 主体后）：

- `.baseline/agent-deep-import-baseline.txt` 已从 `169` 收到 `0`
- 说明宿主主链路 deep import 与 agent 内部跨 submodule deep import 都已经完成收口

这说明当前的第一风险，已经不再是 package boundary 越界，也不再是 EventStore 死接口，而是 B2 / B3 这种“默认装配该不该继续存在”的设计判定。

### 2.2 当前缺失的关键入口文件 ✅ 已在 D-1.a/b 全部补齐

本轮（2026-04-22）确认全部已存在：

- ✅ `src/agent/index.ts`（`稳定导出 + linnkitCompat namespace`）
- ✅ `src/agent/runtime-kernel/index.ts`（含 `graph / tools / events / llm / resilience / instructions / execution` 子 namespace）
- ✅ `src/agent/ports/index.ts`
- ✅ `src/agent/testkit/index.ts`（含 `assertions` namespace）
- ✅ `src/agent/context-manager/index.ts`（D-1 之前已存在）
- ✅ `src/agent/package.json`（草案，`name: "linnkit"`，含 `exports`）

落地 commits：`1a93fe77` (D-1.a) / `e1fb29ed` (D-1.b)。snapshot 测试 4 + manifest 测试 1 均已落地。

→ B4 阻塞解除；下一步是 D-2（guard 反向 lint）+ 宿主 import 收口（engine/15 Batch 0~5）。

---

## 3. 阻塞分级

### P0：不解决就别进 Phase E

#### B1. 宿主还在大面积 deep import `src/agent` 内部 ✅ 已基本关闭（2026-04-22 D-2 PR-H 主体后）

代表文件：

- [defaultGraphExecutorContextBuilder.ts](../../../../../src/app-hosts/linnya/adapters/context-injection/defaultGraphExecutorContextBuilder.ts:3)
- [graphRuntimeFactory.ts](../../../../../src/app-hosts/linnya/adapters/runtime-assembly/graphRuntimeFactory.ts:5)
- [internalAgentInvokerFactory.ts](../../../../../src/app-hosts/linnya/adapters/child-runs/internalAgentInvokerFactory.ts:3)
- [toolRegistry.ts](../../../../../src/app-hosts/linnya/adapters/tools/toolRegistry.ts:1)
- [flow.agent-runner.service.ts](../../../../../src/app-hosts/linnya/adapters/flow/flow.agent-runner.service.ts:13)

当前结论：

- 上面这些代表文件的 deep import 已经被迁到根入口或子入口
- reverse-import baseline 已清零
- 因此 B1 作为 **Phase E 硬阻塞** 已解除；后续若再出现残留，应直接按 guard 回归处理，而不是回到“大面积 deep import”表述

#### B2. `defaultGraphExecutorContextBuilder` 把宿主和 agent 内部结构缝死了 ✅ 已判定为非阻塞

重点位置：

- [defaultGraphExecutorContextBuilder.ts](../../../../../src/app-hosts/linnya/adapters/context-injection/defaultGraphExecutorContextBuilder.ts:3)
- [defaultGraphExecutorContextBuilder.ts](../../../../../src/app-hosts/linnya/adapters/context-injection/defaultGraphExecutorContextBuilder.ts:73)
- [defaultGraphExecutorContextBuilder.ts](../../../../../src/app-hosts/linnya/adapters/context-injection/defaultGraphExecutorContextBuilder.ts:192)
- [defaultGraphExecutorContextBuilder.ts](../../../../../src/app-hosts/linnya/adapters/context-injection/defaultGraphExecutorContextBuilder.ts:202)

原疑点：

- 这里同时吃 `agent/chat` 两套 orchestrator 和 Linnya 自己的 registry
- 还保留 `chat` / `agent` 双分支
- 长远既会卡 `chat` 收敛，也会卡抽包

实查结论（2026-04-22）：

- `defaultGraphExecutorContextBuilder.ts` 已改走 `src/agent` / `src/agent/context-manager` / `src/agent/runtime-kernel` 公共入口
- `AgentMessageOrchestrator` / `ToolManager` / `PendingContextRuntimeEvent` 对应的 public seam 已补齐并有 contract test 锁住
- 该文件位于 `src/app-hosts/linnya/*`，职责是 Linnya 自己的默认上下文装配，而不是 `linnkit` 对外承诺提供的通用工厂
- 它虽然仍承载 `chat/agent` 双分支历史实现，但这属于宿主默认策略，不会阻止 `src/agent` 物理 move 到 `packages/linnkit/`

结论：

- **不再作为 Phase E blocker**
- 后续若要继续收敛 `chat = tools-disabled agent`，应作为宿主默认实现治理或后置清债，不和真抽包绑死

#### B3. `runtime assembly` / `child-runs assembly` 还在直接 new 内核类 ✅ 已判定为非阻塞

代表文件：

- [graphRuntimeFactory.ts](../../../../../src/app-hosts/linnya/adapters/runtime-assembly/graphRuntimeFactory.ts:43)
- [internalAgentInvokerFactory.ts](../../../../../src/app-hosts/linnya/adapters/child-runs/internalAgentInvokerFactory.ts:58)
- [registeredSubagentInvoker.ts](../../../../../src/app-hosts/linnya/adapters/child-runs/registeredSubagentInvoker.ts:107)

原疑点：

- 只要宿主继续直接 `new ModelResolver`、`new LlmCaller`、`new InternalAgentInvoker`
- `linnkit` 就很难对外只暴露稳定工厂或入口

实查结论（2026-04-22）：

- `graphRuntimeFactory.ts` / `internalAgentInvokerFactory.ts` / `registeredSubagentInvoker.ts` 已切到 `src/agent/runtime-kernel` 公共 namespace
- 这些文件都位于 `src/app-hosts/linnya/*`，本质上是 Linnya 默认 concrete defaults，不是 `linnkit` 必须内建的产品无关协议
- 现在的问题不再是“宿主 deep import 内核私有路径”，而是“宿主是否继续持有这些默认 concrete defaults”

结论：

- **不再作为 Phase E blocker**
- Phase E 只需要把 import 入口随物理抽包改到新 package；是否继续保留这些默认工厂，留待后续宿主装配治理

### P1：不先解决会让 Phase E 风险暴涨

#### B4. 缺少公开入口与 package 元信息 ✅ 已关闭（2026-04-22，commits `1a93fe77` / `e1fb29ed`）

D-1.a/b 落地后，`runtime-kernel/index.ts` / `ports/index.ts` / `testkit/index.ts` / `src/agent/package.json` 均已就位（详见 §2.2）。

→ guard 现在已经有清晰的"允许引用面"可以参考（root `index.ts` + 4 个子 entry），D-2 反向 lint 可以基于这套面落地。

#### B5. 当前 guard 不拦外部 deep import ✅ 已关闭（2026-04-22 D-2）

文件：

- [agent-package-boundary-guard.ts](../../../../../scripts/guards/agent-package-boundary-guard.ts:40)
- [agent-package-boundary-guard.ts](../../../../../scripts/guards/agent-package-boundary-guard.ts:99)

现状：

- 只扫描 `src/agent`
- 不扫描 `src/app-hosts` / `src/features`

结果：

- 就算宿主再新增几十处 deep import，CI 也不会报

当前事实：

- reverse-import guard 已上线
- CI / pre-commit 已接入
- `.baseline/agent-deep-import-baseline.txt` 作为白名单真源，当前已清零

→ B5 已关闭；下一步不是“补 guard”，而是把 PR-J 的最终 enforce 口径同步到脚本与文档。

### P2：不一定先做，但必须纳入迁移顺序

#### B6. 宿主 wrapper 还在继续固化 `profiles/chat/*`

代表文件：

- [context/chat/contracts.ts](../../../../../src/app-hosts/linnya/context/chat/contracts.ts:1)
- [context/chat/request-adapters.ts](../../../../../src/app-hosts/linnya/context/chat/request-adapters.ts:1)
- [context/chat/createMessageOrchestrator.ts](../../../../../src/app-hosts/linnya/context/chat/createMessageOrchestrator.ts:1)

由于我们已经定了“`chat = tools-disabled agent`”，这层旧 wrapper 未来应逐步退场。

这不是 Phase E 的第一刀，但必须写进迁移顺序，防止越拖越难清。

---

## 4. 最该先动的文件

按阻塞程度排序：

1. [defaultGraphExecutorContextBuilder.ts](../../../../../src/app-hosts/linnya/adapters/context-injection/defaultGraphExecutorContextBuilder.ts:3)
2. [graphRuntimeFactory.ts](../../../../../src/app-hosts/linnya/adapters/runtime-assembly/graphRuntimeFactory.ts:5)
3. [internalAgentInvokerFactory.ts](../../../../../src/app-hosts/linnya/adapters/child-runs/internalAgentInvokerFactory.ts:3)
4. [registeredSubagentInvoker.ts](../../../../../src/app-hosts/linnya/adapters/child-runs/registeredSubagentInvoker.ts:107)
5. [toolRegistry.ts](../../../../../src/app-hosts/linnya/adapters/tools/toolRegistry.ts:1)
6. [agent-package-boundary-guard.ts](../../../../../scripts/guards/agent-package-boundary-guard.ts:1)

---

## 5. 建议解锁顺序

### Step 1 ✅ 已完成（2026-04-22）

`engine/07` 的 D-1.a / D-1.b：

- ✅ 补 `package.json`
- ✅ 补 `runtime-kernel/index.ts`
- ✅ 补 `ports/index.ts`
- ✅ 补 `testkit/index.ts`

### Step 2 ✅ 已完成主体（2026-04-22）

`engine/07` 的 D-2 主体：

- ✅ guard 扫宿主 deep import
- ✅ 宿主主链路基本都已收口到根入口或少数公开子入口
- ✅ `defaultGraphExecutorContextBuilder` / `graphRuntimeFactory` / `internalAgentInvokerFactory` 的公开 seam 已补上

### Step 3 ✅ 已完成（2026-04-22）

做 D-2 收尾判定：

- ✅ reverse-import baseline 清零后的最终 enforce 校准
- ✅ 明确 engine 内部 / testkit 合法残留
- ✅ 明确 `context_checkpoint` marker compat 点继续保留为 compat，不再阻塞抽包

### Step 4 ✅ 已完成（2026-04-22）

PR-J 收尾：

- ✅ B2 / B3 设计判定完成：均为 host-owned default，非 Phase E blocker
- ✅ reverse guard 已切 enforce 模式

### Step 5

下一步直接进入 Phase E runbook / E1-E8。

---

## 6. Phase E 前最低完成判据（补充版）

在 `engine/07 §5.4.3` 之外，本轮建议再加 4 条“进入 Phase E 之前”的硬判据：

- [x] 宿主生产代码中的 `src/agent/.../...` deep import 已显著下降，并收口到公开入口（D-2 + PR-J 后 reverse-import baseline 已收敛到 `0`）
- [x] `defaultGraphExecutorContextBuilder` 已明确为 host-owned default，不再算 Phase E blocker
- [x] `graphRuntimeFactory` / `internalAgentInvokerFactory` 已通过稳定入口装配核心能力
- [x] guard 已经能拦截新增的宿主 deep import

---

## 7. 状态

- [x] 审计 deep import 规模
- [x] 找出最卡的 6 个文件
- [x] 给出 P0 / P1 / P2 分级
- [x] 给出建议解锁顺序
- [x] 把这些点正式回填到 `engine/07` 的实施排序（已通过 `engine/07 §2.4 / §5.3 / §7` 体现）
- [x] **Step 1（D-1.a/b）已完成**（commits `1a93fe77` / `e1fb29ed`）
- [x] Step 2 收尾（PR-J：reverse-import baseline 清零 + 最终 enforce 已上线）
- [x] B2 判定完成：`defaultGraphExecutorContextBuilder` 为宿主默认装配，非 Phase E blocker
- [x] B3 判定完成：runtime / child-runs 默认工厂为宿主默认装配，非 Phase E blocker
- [x] 第一轮硬阻塞全部关闭

**下一步**：按 [`engine/07 §5.4 / §7.6`](./07-public-api-and-package-boundary.md) 编写并执行 Phase E runbook。
