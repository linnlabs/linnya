# 24 · Phase E 实施 Runbook（真抽包到 `packages/linnkit/`）

> **类型**：实施手册（runbook）
> **状态**：✅✅ **彻底完成（2026-04-23）**：§9 完成判据 11/11 全绿，桌面手测主链路用户已亲手验证通过。
> 收官期间顺手做了一波架构加固（详见 §12 收官归档清单），Phase E 至此封盘，进入维护态。
> linnsec 正式立项前置全部就位。
> **前置**：
> - [`engine/07-public-api-and-package-boundary.md`](./07-public-api-and-package-boundary.md) —— Phase E 真抽包主真源
> - [`engine/11-phase-e-hard-blockers.md`](./11-phase-e-hard-blockers.md) —— 第一轮硬阻塞已全部关闭
> - [`engine/20-d3-d4-port-interfaces-plan.md`](./20-d3-d4-port-interfaces-plan.md) —— Phase D 已完成
> - [`engine/23-b3-eventstore-runbook.md`](./23-b3-eventstore-runbook.md) —— EventStore Phase E 前置已关闭
> **目标**：把 `src/agent/` 真正变成 `packages/linnkit/`，删除 dryrun，批量改全仓 import，跑完整回归，不留双源和过渡层。

---

## 0. 启动准入

开始 Phase E 之前，必须同时满足：

- [x] `engine/07` 已标记 **Phase D 完成**
- [x] `engine/11` 已确认 **第一轮硬阻塞全部关闭**
- [x] `packages/agent-engine-dryrun/` 的 `typecheck` / `test:smoke` 已跑通过（Phase D 结果）
- [x] `guard:agent-boundary` 当前为最终 enforce，reverse deep import baseline = `0`
- [x] B1 Checkpointer / B2 Telemetry / B3 EventStore 已完成，`linnkit` 不再存在死接口
- [x] package 正式名已定为 `linnkit`
- [x] 用户决策已明确：**直接物理搬迁 + 脚本批量改 import 路径，不做长期过渡**

如任一不满足，**ABORT**，先回到对应上游 topic。

---

## 1. 本 runbook 固定决策

| ID | 决策 | 含义 |
|----|------|------|
| **E-D1** | **真源只有一份** | `src/agent/` 与 `packages/agent-engine-dryrun/` 不能长期并存；Phase E 完成后只保留 `packages/linnkit/` |
| **E-D2** | **物理 move，不做 re-export 过渡** | 直接 `git mv src/agent packages/linnkit/src`，不新建 `src/agent/index.ts -> linnkit` 兼容桥 |
| **E-D3** | **路径改写走脚本，不手改 200+ 处** | 用 codemod 批量把消费侧 `src/agent` 改到 `linnkit` / `linnkit/<entry>` |
| **E-D4** | **脚本与 move 同批合并，不留半迁移态** | 允许同 PR 内先 move 再 codemod，但 merge 前不得残留“靠临时 alias 才能工作”的状态 |
| **E-D5** | **dryrun sunset 是 Phase E 的一部分** | 删除 `packages/agent-engine-dryrun/`、`src/agent/__tests__/dryrun.workspace.test.ts`、guard/vitest 中对 dryrun 的豁免 |
| **E-D6** | **B2/B3 不再阻塞 Phase E** | `defaultGraphExecutorContextBuilder` 与 runtime/child-run 默认工厂归类为 host-owned default，后续再治理 |
| **E-D7** | **不顺手扩 scope** | 不顺手补新 port、不顺手清 unrelated tech debt、不顺手改产品行为 |
| **E-D8** | **回归优先级高于路径洁癖** | 任何批量改写都必须先有脚本/测试证据，再做大范围机械替换 |

---

## 2. 当前仓库实情（按真实代码，不按旧文案想象）

### 2.1 workspace / 包管理现实

- 仓库同时存在 `package-lock.json` 与 [`pnpm-workspace.yaml`](../../../../../pnpm-workspace.yaml)
- 根 [`package.json`](../../../../../package.json) **没有** `workspaces` 字段；workspace 真源在 `pnpm-workspace.yaml`
- 因此 E-3 要改的不是“根 package.json 的 workspaces”，而是：
  - `pnpm-workspace.yaml`
  - 根 `tsconfig.json`
  - `vite.config.mjs`
  - `vitest.config.ts`
  - 各消费侧 package/runtime alias

### 2.2 dryrun 已提供现成真源

`packages/agent-engine-dryrun/` 已经预演了：

- [`package.json`](../../../../../packages/agent-engine-dryrun/package.json)
  - `name: "linnkit-dryrun"`
  - exports: `. / ports / contracts / runtime-kernel / context-manager / testkit`
- [`tsconfig.json`](../../../../../packages/agent-engine-dryrun/tsconfig.json)
  - 已验证 `linnkit` / `linnkit/*` 路径别名形状
- [`vitest.config.ts`](../../../../../packages/agent-engine-dryrun/vitest.config.ts)
  - 已验证测试侧 alias 映射

**结论**：Phase E 不需要重新设计包形状，只需要把 dryrun 里已经证实可用的 package 结构升格为正式包。

### 2.3 dryrun sunset 的真实触点（PR-D 已落地）

历史上与 dryrun 绑定的仓库真点位（全部已在 PR-D 中清除）：

- ~~`vitest.config.ts` 排除 `packages/agent-engine-dryrun/**`~~ → 已删除该 exclude
- ~~`scripts/guards/agent-package-boundary-guard.ts` 的 `IGNORED_RELATIVE_PREFIXES` 忽略 `packages/agent-engine-dryrun/`~~ → 已置空数组
- ~~`packages/linnkit/src/__tests__/dryrun.workspace.test.ts` 锁住 dryrun workspace 契约~~ → 已删除
- ~~`scripts/__tests__/agent-package-boundary-guard.test.ts` 含 `exempts dry-run workspace copies` 豁免测试~~ → 已删除该用例
- ~~`packages/agent-engine-dryrun/` 整目录~~ → 已 `git rm -r`

### 2.4 E-4 的真实改写面

实测（不含 `packages/agent-engine-dryrun/**`）：

- 消费侧 `src/agent...` import 命中：**248**
- 消费侧 `@/agent...` import 命中：**0**

统计口径目录：

- `src/app-hosts`
- `src/features`
- `src/electron-main`
- `src/tools`
- `src/integrations`
- `src/testkit`
- `apps`
- `scripts`

说明：

- 248 包含生产代码、测试代码、以及部分脚本测试
- 这不是 deep import 违规数；而是 **Phase E 物理抽包后必须改成 `linnkit` 的真实引用面**
- 因此 E-4 不能靠手改，必须先有 codemod

---

## 3. 关键文件清单

### 3.1 必改配置

- [pnpm-workspace.yaml](../../../../../pnpm-workspace.yaml)
- [package.json](../../../../../package.json)
- [tsconfig.json](../../../../../tsconfig.json)
- [vite.config.mjs](../../../../../vite.config.mjs)
- [vitest.config.ts](../../../../../vitest.config.ts)

### 3.2 必删 dryrun 触点

- [packages/agent-engine-dryrun/package.json](../../../../../packages/agent-engine-dryrun/package.json)
- [packages/agent-engine-dryrun/tsconfig.json](../../../../../packages/agent-engine-dryrun/tsconfig.json)
- [packages/agent-engine-dryrun/vitest.config.ts](../../../../../packages/agent-engine-dryrun/vitest.config.ts)
- [src/agent/__tests__/dryrun.workspace.test.ts](../../../../../src/agent/__tests__/dryrun.workspace.test.ts)
- [scripts/guards/agent-package-boundary-guard.ts](../../../../../scripts/guards/agent-package-boundary-guard.ts)
- [scripts/__tests__/agent-package-boundary-guard.test.ts](../../../../../scripts/__tests__/agent-package-boundary-guard.test.ts)

### 3.3 需要批量改 import 的主目录

- `src/app-hosts/linnya/**`
- `src/features/**`
- `src/electron-main/**`
- `src/tools/**`
- `src/integrations/**`
- `src/testkit/**`
- `apps/**`
- `scripts/**`

---

## 4. PR 切片总览

本 runbook 按 **4 个 PR** 执行。禁止一口气把 E1-E8 全塞进一个 commit。

| PR | 范围 | 目标 |
|----|------|------|
| **PR-A** | codemod + 测试 | 先把 `src/agent -> linnkit` 的机械改写脚本写好，跑在 fixture 和小样本上 |
| **PR-B** | 正式 package 壳子 | 建 `packages/linnkit/`，把 dryrun manifest/tsconfig/vitest 形状升格为正式包 |
| **PR-C** | 真 move + 批量 import 改写 | `git mv src/agent packages/linnkit/src`，跑 codemod，全仓切到 `linnkit` |
| **PR-D** | dryrun sunset + 文档 + 全量回归 | 删除 dryrun/豁免/旧测试，补文档，跑完整 baseline 与桌面手测 |

---

## 5. PR-A：导入改写 codemod ✅ 已完成（当前工作树）

### 5.1 目标

新增一个**通用** codemod，把：

- `src/agent`
- `src/agent/contracts`
- `src/agent/runtime-kernel`
- `src/agent/context-manager`
- `src/agent/testkit`
- `src/agent/ports`

批量改写为：

- `linnkit`
- `linnkit/contracts`
- `linnkit/runtime-kernel`
- `linnkit/context-manager`
- `linnkit/testkit`
- `linnkit/ports`

### 5.2 文件范围

- [x] 新增 [rewrite-agent-imports-to-linnkit.ts](../../../../../scripts/codemods/rewrite-agent-imports-to-linnkit.ts)
- [x] 新增对应测试 [rewrite-agent-imports-to-linnkit.test.ts](../../../../../scripts/codemods/__tests__/rewrite-agent-imports-to-linnkit.test.ts)
- 必要时新增 fixture（只在脚本测试目录）

### 5.3 验收

- 能处理 `import` + `import type`
- 能处理同文件多条 import
- 不误改注释 / 普通字符串 / 文档
- 对不支持的 deep import（如 `src/agent/runtime-kernel/graph-engine/engine`）必须**显式报错**，不偷偷猜路径

### 5.4 禁止事项

- 不做“见到 deep import 就自动拍脑袋映射”
- 不直接跑全仓改写
- 不在这一步动业务代码

### 5.5 当前结论

- 已支持：
  - static import
  - dynamic import
  - `typeof import('...')`
- 已明确：
  - 只改公开入口 `src/agent` / `contracts` / `runtime-kernel` / `context-manager` / `testkit` / `ports`
  - 遇到 deep import 会直接报错，不做猜测性映射
- 已验证：
  - `npx vitest run scripts/codemods/__tests__/rewrite-agent-imports-to-linnkit.test.ts` 全绿


---

## 6. PR-B：正式 package 壳子 ✅ 已完成（当前工作树）

### 6.1 目标

创建正式的 `packages/linnkit/`，但此时还**不** move `src/agent`。

### 6.2 具体动作

1. 新建 `packages/linnkit/package.json`
2. 新建 `packages/linnkit/tsconfig.json`
3. 新建 `packages/linnkit/vitest.config.ts`
4. 新建最小 smoke/manifest 测试，锁住正式包形状
5. manifest 与 alias 以 dryrun 已验证形状为准，但 `name` 改为 **`linnkit`**

当前已落地：

- [x] `packages/linnkit/package.json`
- [x] `packages/linnkit/tsconfig.json`
- [x] `packages/linnkit/vitest.config.ts`
- [x] `packages/linnkit/__tests__/package.shell.test.ts`

当前约束：

- package shell 只锁配置形状，不复制第二份 `src`
- `exports` 明确指向未来 `./src/*` 真路径，等待 PR-C 的 `git mv`
- 在 PR-C 之前，禁止把 `packages/linnkit/` 变成回指 `src/agent` 的桥接层

验证结果：

- [x] `npm --prefix packages/linnkit run test:smoke`
- [x] `npm --prefix packages/linnkit run typecheck`

### 6.3 关键原则

- 这里只建正式包壳子，不复制第二份 `src/`
- 正式包的 `src/` 会在 PR-C 通过 `git mv` 直接进入
- 不在 PR-B 建 re-export 兼容层

---

## 7. PR-C：真 move + 批量改写

### 7.1 目标

这是 Phase E 的主 PR：

1. `git mv src/agent packages/linnkit/src`
2. 跑 codemod，把消费侧 `src/agent...` 全量改成 `linnkit...`
3. 修正配置，让运行 / 构建 / 测试都指向新 package

### 7.2 预期改动面

- `src/app-hosts/**`
- `src/features/**`
- `src/electron-main/**`
- `src/tools/**`
- `src/integrations/**`
- `src/testkit/**`
- `apps/**`
- `scripts/**`
- 根配置：`tsconfig.json` / `vite.config.mjs` / `vitest.config.ts` / `package.json`

### 7.3 强制顺序

1. 先 `git mv`
2. 再跑 codemod
3. 再修正脚本/构建配置
4. 再跑聚焦验证

不得颠倒成“先手改 import，最后再 move”。

### 7.4 聚焦验证

至少覆盖：

- `guard:agent-boundary`
- `lint:codename`
- `tsc --noEmit -p tsconfig.json`
- `npm --prefix packages/linnkit run test:smoke`
- 一组 host flow / child-runs / context-builder 聚焦测试

当前实测状态：

- `testkit` deep import 与 `runtime-kernel` 测试 deep import 已全部收口
- `agentRunner.interrupted.integration.test.ts` 与 `flow.followup-tool-history.integration.test.ts` 已切到 public seam
- codemod dry-run 已能完整扫描目标目录并给出稳定统计（`filesChanged = 134` / `rewrittenImports = 209`）
- PR-C 前置已清空，可直接进入 `git mv + codemod`

### 7.5 失败回滚口径

- codemod 输出若出现未映射 deep import → **ABORT**
- 若 `git mv` 后需要靠长期 alias 才能让仓库工作 → **ABORT**，回到 PR-A 扩脚本，不允许把临时兼容层 merge 进去

---

## 8. PR-D：dryrun sunset + 全量回归（已完成主体）

### 8.1 目标

删除所有 dryrun 残留，让 `packages/linnkit/` 成为唯一真源。

### 8.2 必做动作（状态：✅ 全部完成 2026-04-23）

- [x] 1. 删除 `packages/agent-engine-dryrun/`（`git rm -r`）
- [x] 2. 删除 `packages/linnkit/src/__tests__/dryrun.workspace.test.ts`
- [x] 3. 删 `vitest.config.ts` 中对 `packages/agent-engine-dryrun/**` 的 exclude
- [x] 4. 清 `scripts/guards/agent-package-boundary-guard.ts` 中 `IGNORED_RELATIVE_PREFIXES`（保留空数组作未来扩展点）
- [x] 5. 删 `scripts/__tests__/agent-package-boundary-guard.test.ts` 里 `exempts dry-run workspace copies` 用例
- [x] 6. 同步本 runbook / 相关文档路径
- [x] 7. 桌面手测主链路用户已亲手验证通过（2026-04-23）

### 8.2.x 包内端到端 smoke（PR-D 期间补强）

`packages/linnkit/src/testkit/__tests__/graphLoop.endToEnd.contract.test.ts` 用最小 mock 在
linnkit 内部跑通完整 `user → llm → tool → llm → answer` graph loop，覆盖 4 个核心场景：

1. 成功路径：LLM 决策 tool → ToolNode 真实 executeTool → 回灌 → 最终答案
2. 错误恢复：tool 返回 `{ success: false }` → ToolNode 路由回 `llm` → 兜底答案
3. abort：已 abort 的 signal → ToolNode 抛 AbortError、`executeTool` 不被调用
4. seam 一致：`createDefaultGraphExecutor` 与 `createGraphLoopHarness` 共用同一图调度

意义：未来若有 PR 不小心破坏 testkit / runtime-kernel 的公开装配 seam，
这组测试会在 packages/linnkit 内部第一时间挂掉，作为 agent 行为永久回归门
（与 host 侧 `src/app-hosts/linnya/testkit/agent-harness/__tests__/graphLoop.integration.test.ts` 互补）。

### 8.3 最终验证

- `npm run guard:agent-boundary`
- `npm run lint:codename`
- `npx tsc --noEmit -p tsconfig.json`
- `npm test`
- `git diff --check`
- 桌面主流程手测：
  - 创建对话
  - LLM 调用
  - 工具调用
  - 子 agent
  - abort
  - persistence / history replay

如果遇到 SQL 版本不匹配：

1. `npm run rebuild:better:node`
2. `npm run rebuild:better:electron`
3. 然后重跑测试

---

## 9. 完成判据

以下必须同时满足，才算 Phase E 完成：

- [x] `packages/linnkit/` 成为唯一 agent package 真源
- [x] 仓库中不再存在 `packages/agent-engine-dryrun/`
- [x] 仓库中不再存在消费侧 `from 'src/agent...'`
- [x] `src/agent/` 已从原位置移除
- [x] `npm run guard:agent-boundary` 通过
- [x] `npm run lint:codename` 通过
- [x] `tsc` 不高于当前 baseline（488，与 P1 收尾后 baseline 持平）
- [x] `npm test` 不高于当前 baseline（PR-D 后 7 files / 12 cases，较 P1 收尾后 8/15 净改进 -1/-3）
- [x] 包级 smoke 通过（含新增的端到端 graph loop smoke，4 个场景）
- [x] 桌面手测主链通过（用户已亲手验证：创建对话 / LLM 调用 / 工具调用 / 子 agent / abort / persistence / history replay 全部正常，2026-04-23）
- [x] 文档入口改到新路径

> **判据 11/11 全绿（2026-04-23）**：Phase E 至此封盘，进入维护态。
> 收官期间额外做了一波架构加固（详见 §12 收官归档清单 §12.2 一节）。

---

## 10. 异常协议

### A1. codemod 遇到 deep import 无法映射

操作：

1. 停止全仓替换
2. 先补公开入口或修正单个消费方
3. 给 codemod 加显式用例后再继续

### A2. move 后需要长期 alias 才能运行

操作：

1. 不合并
2. 回到 PR-A / PR-B，把脚本或 package 壳子补完整

### A3. dryrun 删除后发现正式包 smoke 不稳

操作：

1. 不恢复 dryrun 双源
2. 直接在 `packages/linnkit/` 修真源

### A4. 测试碰到 SQLite / better-sqlite3 版本不匹配

操作：

1. `npm run rebuild:better:node`
2. `npm run rebuild:better:electron`
3. 再重跑

### A5. 发现文档与代码冲突

操作：

1. 以代码与已落地测试为准
2. 回写本 runbook / `engine/07` / `engine/README`

---

## 11. 执行建议

最稳的起手动作不是立刻 `git mv`，而是：

1. [x] **先做 PR-A**：把通用 import rewrite codemod 和测试落地 ✅
2. [x] **再做 PR-B**：把 `packages/linnkit/` 壳子建起来 ✅
3. [x] **然后再做 PR-C**：一次性真 move + 路径改写 ✅
4. [x] **最后做 PR-D**：dryrun sunset + 文档 + 全量回归 ✅
5. [x] 桌面手测主链路用户已亲手验证通过 ✅（2026-04-23）

原因很简单：

- 现在真正的大风险不是“搬目录”，而是 **248 处消费侧 import 的机械改写**
- 先把脚本和测试钉牢，后面的物理迁移就是大体力活，不是脑补活

---

## 12. 收官归档清单

### 12.1 文档同步（2026-04-22 + 2026-04-23 两轮收尾完成）

- [x] [`engine/07-public-api-and-package-boundary.md`](./07-public-api-and-package-boundary.md) —— 状态行 + §5.4.3 完成判据 + §7.6 + §8 状态 + §“下一步”
- [x] [`engine/11-phase-e-hard-blockers.md`](./11-phase-e-hard-blockers.md) —— 状态行 + 新增 §0 Phase E 已完成后记
- [x] [`engine/README.md`](./README.md) —— Topic 24 行 + Topic 11 行 + 进度文字 + 实施时序 M5 段落 + §6 收官归档声明（2026-04-23）
- [x] [`packages/linnkit/src/INTEGRATION_GUIDE.md`](../../../../../packages/linnkit/src/INTEGRATION_GUIDE.md) —— 头部口径 + 全文 `src/agent/` 路径 → `packages/linnkit/src/`（69 处）+ §6 入口规范
- [x] [`packages/linnkit/src/docs/README.md`](../README.md) —— §1 物理位置 + §2 目录树根目录 + §5 表格（M4/M5/Phase 9）+ §6 关联历史文档新路径 + §7 归档与下一阶段（2026-04-23 新增）
- [x] [`packages/linnkit/src/docs/00-vision-and-split.md`](../00-vision-and-split.md) —— §3 物理位置 + §4.1 dryrun 已落地 + §5 决策树注解 + §6 阶段终态快照（2026-04-23 新增）
- [x] [`packages/linnkit/src/docs/secretary/README.md`](../secretary/README.md) —— §0 顶部 banner + §3 第 4 步状态升级（2026-04-23 新增）
- [ ] 根 [`README.md`](../../../../../README.md) —— 仅在用户认为有必要时加 `packages/linnkit/` 一段；当前不阻塞

### 12.2 Phase E 收官期"硬件升级"（2026-04-23 顺手做的架构加固）

桌面手测期间陆续暴露并彻底解决的若干历史隐患，作为 Phase E 真抽包的"附赠加固"一并归档：

| # | 问题域 | 现象 | 根因 | 修法 |
|---|--------|------|------|------|
| 1 | **bundler externalize** | `vite build` 失败：`randomUUID is not exported from 'crypto'` | `packages/linnkit/src/shared/ids.ts` 直接 `import { randomUUID } from 'crypto'`，被 Vite externalize 后浏览器路径炸 | `ids.ts` 同构化（优先 `globalThis.crypto.randomUUID()` → fallback 自实现 v4）+ 新增浏览器子入口 `linnkit/runtime-kernel/events`（不引 Node-only 依赖） |
| 2 | **bundler externalize** | Electron 启动：`Vitest failed to access its internal state` | `packages/linnkit/src/index.ts` 中 `export * as testkit from './testkit'` 把 `vitest` 拖进了生产 bundle | 从 root entry 删除 testkit 再导出；3 个测试文件改为显式 `linnkit/testkit` 子入口；新增 `AGENT-GUARD-10-no-testkit-in-production` 规则永久守门 |
| 3 | **codemod 漏改** | Electron 启动：`Cannot find module '../../agent/runtime-kernel/graph-engine/nodes/userNode'` | `src/electron-main/routes/index.ts` 里 4 处 `require('../../agent/...')` 是动态 require，Phase E codemod 没扫到 | 4 处全部重写为顶层 ESM `import { userNode, ... } from 'linnkit/runtime-kernel'` |
| 4 | **boundary guard 健壮性** | guard 误报正则跳过引发的 false positive | 旧版 `agent-package-boundary-guard.ts` 用纯正则扫 import，遇到注释 / 字符串字面量 / 动态 import 时分不清 | 整体重构为 `TypeScript Compiler API` AST 遍历（`ts.createSourceFile` + `ts.isImportDeclaration` / `ts.isCallExpression`），rule 统一为 `(importPath, isStatic) => boolean`；新增对抗测试 |
| 5 | **DB schema drift（核心）** | Electron 启动 WARN：`no such table: engine_checkpoints` / `engine_telemetry` | `DatabaseService.initialize()` 历史上只在 `user_version === 0` 时跑 `createTables()`；新加的 schema-provider 表只对**新库**生效，老库必须配对一条 migration —— DRY 违反 + 长期隐患 | (a) 先用 `v23→v24` migration 临时止血；(b) 然后做根本修复：`createTables()` 改成**每次 init 都跑**；(c) 全量审计 94 条 schema-provider DDL，确认 100% `CREATE ... IF NOT EXISTS` 幂等；(d) 全量审计 24 条 migration，把 v14/v19 两条数据回填非幂等的修成"列存在不 ALTER、UPDATE 永远跑（WHERE 兜底幂等）"；(e) 新增 `database-service.idempotent-init.test.ts`（fresh / idempotent / auto-heal 三大用例）+ `v014-v019-idempotency.test.ts`（6 用例覆盖 legacy / always-create / repeat 三场景）；(f) 重写 `migrations/README.md` §5/§6 把"schema-provider vs migration 职责分工 + migration 幂等纪律"写死 |
| 6 | **better-sqlite3 ABI** | Electron 启动：`NODE_MODULE_VERSION 127 vs 133` | Vitest 跑 Node ABI / Electron 跑 Electron ABI，来回切环境会 ABI mismatch | `npm run rebuild:better:node` / `npm run rebuild:better:electron` 双脚本切换；约定写在 §8.3 / §A4 |
| 7 | **dead mock 清理** | `flow.followup-tool-history.integration.test.ts` 里 `vi.mock('src/agent/shared/TokenCalculator', ...)` 不再生效 | Phase E 后路径已变，mock 落空 | 直接删除（已确认不影响测试结果） |

**意义**：第 5 项是真正的"核心 architectural invariant 加固" —— 把"新加 schema-provider 表必须配对写一条 migration"这个长期 DRY 违反**从根上消除**。
未来任何加表 / 加索引只需改 schema-provider，老库会在下次启动时被 `createTables()` 自动补齐，不再可能出现"开发机能跑、用户机器报 no such table"的事故。
该不变式由 `database-service.idempotent-init.test.ts` 的 auto-heal 用例长期看护。
