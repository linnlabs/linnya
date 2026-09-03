# 18 · D-1 实施 Runbook（PR2 + PR3 + PR-template）

> **状态**：📋 执行手册（2026-04-21 编写，等待 subagent 执行）
> **目标读者**：另一个 agent / 远程 subagent，能照着本文档无人值守跑完 D-1.a + D-1.b
> **执行人原则**：本文档列出的所有步骤、判据、异常协议都必须严格遵守；**不要发挥**，遇到本文档未覆盖的情况先停下记录到 §10 而不是猜
>
> **关联**：
> - 主计划：[`07-public-api-and-package-boundary.md`](./07-public-api-and-package-boundary.md) §5.4
> - **真源**（D-1.a sub index.ts 该 export 什么）：[`14-stable-vs-compat-exports.md`](./14-stable-vs-compat-exports.md)（PR1 决策定稿）
> - 测试规约：[`16-m4-m5-regression-test-plan.md`](./16-m4-m5-regression-test-plan.md)（baseline / 套件 A / G1 门禁）
> - 类型债清理史：[`17-tech-debt-cleanup-plan.md`](./17-tech-debt-cleanup-plan.md)
> - **不变量 baseline 文件**：`.baseline/m4-summary.txt`

---

## 0. 启动准入（subagent 第一步必跑）

```bash
git status            # 必须为空（working tree clean）
git log --oneline -1  # 必须 = 723a7ea7（PR1 commit）或更新（用户已提交 engine/16 更新）
cat .baseline/m4-summary.txt  # 必须能读到 526 / 9 / 14 / 29.8s
```

**准入条件**（任何一条不满足必须 ABORT 并报告，**不要尝试修复**）：

- [ ] `git status` clean
- [ ] HEAD 包含 `723a7ea7` 或之后
- [ ] `.baseline/m4-summary.txt` 显示 tsc=526 / vitest file fail=9 / case fail=14
- [ ] `.husky/pre-commit` 存在且可执行
- [ ] `.github/workflows/agent-guard.yml` 存在

---

## 1. 用户已拍板的决策（不再重新确认）

| 决策 ID | 内容 | 影响 |
|---------|------|------|
| **D1** | compat exports 隔离进 `linnkitCompat` namespace | 顶层 `index.ts` 必须 stable / compat 分两组 |
| **D2** | `package.json#name = "linnkit"`（`private: true`）| D-1.b 直接写，不再讨论 scope / @namespace |
| **D3** | `package.json#exports` 一次到位 5 个 entry：`. / ./ports / ./runtime-kernel / ./context-manager / ./testkit` | D-1.b 一刀齐 |
| **D4** | engine/03 先于 D-2（本 runbook 不涉及，仅 PR2 + PR3） | D-1.b 完成后用户开新计划 |
| **D5** | sub index 用 snapshot 测试做防回归 | 每个新 sub index 必须配 `__tests__/<name>.exports.snapshot.test.ts` |
| **D6** | **严格隔离**：PR2/PR3 只动 `src/agent/`，不顺手清 ai-ppt / context-manager 等目录的业务 tsc 债 | 任何对 `src/agent/` 之外文件的修改必须 ABORT 并问 |
| **D7** | 顺手加 `.github/PULL_REQUEST_TEMPLATE.md`（PR4，独立 commit） | 模板内容见 §7 |
| **D8** | subagent 跑到 PR3 收口（D-1.a + D-1.b 完成）；engine/03 / D-2 留给下一轮 | §8 完成判据 |

---

## 2. PR2：D-1.a 实施

### 2.1 范围（精确文件清单）

| 操作 | 文件 | 内容来源 |
|------|------|---------|
| 新建 | `src/agent/runtime-kernel/index.ts` | engine/14 §2.3（stable + compat 完整列表）|
| 新建 | `src/agent/ports/index.ts` | engine/14 §2.2（3 个 stable 符号）|
| 新建 | `src/agent/testkit/index.ts` | engine/14 §2.3 末尾（4 个 stable）+ 摸现状补全 |
| 修改 | `src/agent/index.ts` | engine/14 §2.1（5 行 → 完整版，stable / `linnkitCompat` 分两组）|
| 新建 | `src/agent/runtime-kernel/__tests__/index.exports.snapshot.test.ts` | §2.4 测试规格 |
| 新建 | `src/agent/ports/__tests__/index.exports.snapshot.test.ts` | §2.4 测试规格 |
| 新建 | `src/agent/testkit/__tests__/index.exports.snapshot.test.ts` | §2.4 测试规格 |
| 新建 | `src/agent/__tests__/index.exports.snapshot.test.ts` | §2.4 测试规格 |

**绝对不许动的文件**：
- `src/agent/context-manager/index.ts`（已存在且符合 §2.4 风格，PR2 不动）
- 任何 `src/agent/` 之外的 .ts/.tsx/.vue 业务文件
- `src/app-hosts/linnya/`（host 端 import 收口是 D-2 的事）

### 2.2 实施顺序（强制按此顺序）

| Step | 动作 | 验证命令 | 通过条件 |
|------|------|---------|---------|
| 2.2.1 | 新建 `src/agent/ports/index.ts`（最简，3 行） | `npx tsc --noEmit -p tsconfig.json 2>&1 \| grep -c 'error TS'` | ≤ 526 |
| 2.2.2 | 新建 `src/agent/testkit/index.ts` | 同上 | ≤ 526 |
| 2.2.3 | 新建 `src/agent/runtime-kernel/index.ts`（最大）| 同上 | ≤ 526 |
| 2.2.4 | 修改 `src/agent/index.ts`（顶层）| 同上 | ≤ 526 |
| 2.2.5 | 写 4 个 snapshot 测试 | `npx vitest run src/agent --reporter=basic` | 全绿 |
| 2.2.6 | 全量套件 A 跑通 | 见 §2.3 命令 | 全绿 |
| 2.2.7 | 全量回归（套件 D） | `npm test` | file fail ≤ 9 / case fail ≤ 14 / 耗时 ≤ 35s |
| 2.2.8 | guard 通过 | `npm run guard:agent-boundary` | 0 violations |
| 2.2.9 | 提交（commit message 见 §2.5）| `git commit` | pre-commit hook 通过 |

**任何 step 失败 → 立刻 ABORT 并记录到 §10.异常日志，不要试图自己修**（除非是明显的 typo / import 错路径这种 trivial fix）。

### 2.3 4 个 sub index.ts 的具体内容（实施模板）

#### 2.3.1 `src/agent/ports/index.ts`

```typescript
export type { AgentInvocationRequest } from './agent-invocation';
export type { AgentAiEngine, AgentAiEngineStreamContent } from './ai-engine';
```

> **注意**：engine/14 §2.2 标了 3 个 stable 符号，全是 type，所以全用 `export type`。如果摸现状发现这些符号在源文件里是 interface 或 type alias，按 `export type` 写；如果是 class / enum / runtime value，改成 `export {}`。**先 Read 两个源文件确认形态再写**。

#### 2.3.2 `src/agent/testkit/index.ts`

engine/14 §2.3 末尾列了 4 个 stable 符号：

- `createScriptedAiEngineHarness`
- 常用 assertions
- `createReplayHarness`
- `createToolContextFixture`

**摸现状步骤**：
1. `ls src/agent/testkit/agent-harness/` 找 `createScriptedAiEngineHarness` 实际所在文件
2. `ls src/agent/testkit/context-harness/` 找 `createReplayHarness`
3. `ls src/agent/testkit/tool-fixtures/` 找 `createToolContextFixture`
4. "常用 assertions" 含糊，需查 `agent-harness/` 下是否有 `assertions.ts` 或类似文件；找不到 → 第一版**只 export 3 个明确符号**，留 TODO 注释

**预期模板**（以摸出的实际路径为准）：

```typescript
export { createScriptedAiEngineHarness } from './agent-harness/<actual-file>';
export { createReplayHarness } from './context-harness/<actual-file>';
export { createToolContextFixture } from './tool-fixtures/<actual-file>';

// TODO(D-2): 补 "常用 assertions"——需要先在 agent-harness/ 下整理 assertions 子模块
```

#### 2.3.3 `src/agent/runtime-kernel/index.ts`

按 engine/14 §2.3 的分组结构，**严格按 namespace 暴露 7 个 stable 组 + 7 个 compat 组**：

```typescript
// =============================================================================
// STABLE EXPORTS（engine/14 §2.3 stable 部分）
// =============================================================================

export * as graph from './graph-engine';
export * as tools from './tools';
export * as execution from './execution';
export * as events from './events';
export * as runContext from './run-context';

// =============================================================================
// COMPAT EXPORTS（engine/14 §2.3 compat 部分；长远收回到 ports / factories）
// =============================================================================

export * as llm from './llm';
export * as childRuns from './child-runs';
export * as enrichment from './enrichment';
export * as subrun from './subrun';
```

**实施约束**：
- 每个 namespace 用 `export * as <name> from './<dir>'`，不要平铺
- **每个 sub-dir 必须存在 `index.ts`**——如果没有，**先在 sub-dir 下新建一个 `index.ts` 列举 engine/14 §2.3 列的具体符号**（这是 D-1.a 的预期工作量）
- `graph concrete defaults` / `tools implementation helpers` / `event governance shortcuts` 这 3 个 compat 组在 engine/14 §2.3 里没对应单独 sub-dir，**第一版不暴露**，留 TODO 注释，等 D-2 时重新审

**摸现状步骤**：
```bash
# 检查每个 sub-dir 是否已有 index.ts
ls src/agent/runtime-kernel/{graph-engine,tools,execution,events,run-context,llm,child-runs,enrichment,subrun}/index.ts 2>&1
```

未存在的子模块 index.ts 也要新建，内容按 engine/14 §2.3 列举的具体符号 re-export。

#### 2.3.4 `src/agent/index.ts`（修改，5 行 → 完整版）

```typescript
// =============================================================================
// linnkit · 顶层公开面（engine/14 §2.1 决策定稿）
//
// stable 直接平铺；compat 隔离进 `linnkitCompat` namespace（D1 决策）
// 详见 src/agent/docs/engine/14-stable-vs-compat-exports.md
// =============================================================================

// ---------- STABLE EXPORTS ----------
export * as ports from './ports';
export * as runtimeKernel from './runtime-kernel';
export * as testkit from './testkit';
export { generateMessageId, generateRunId } from './shared/ids';

// ---------- COMPAT EXPORTS（隔离进 linnkitCompat，长远收回）----------
import * as contextManager from './context-manager';
import * as llmTelemetryContext from './shared/llmTelemetryContext';
import * as llmAuditRecorder from './shared/llmAuditRecorder';

export const linnkitCompat = {
  contextManager,
  llmTelemetryContext,
  llmAuditRecorder,
} as const;
```

**重要**：
- 当前 `src/agent/index.ts` 5 行内容（`export * from './ports/agent-invocation'` 等平铺）**必须删除**，改成上述 namespace 形式
- 这会**破坏现有 host 端 import**——但 host 现在都是 deep import `from 'src/agent/ports/agent-invocation'`，不是 `from 'src/agent'`，所以不会造成 host 编译失败
- **验证方式**：跑 step 2.2.1 后立刻 grep `from ['"](src/agent|@/agent)['"]` 应返回 0-2 处（基本无人用顶层 import），如果 > 5 处必须 ABORT 并报告

### 2.4 测试规格（4 个 snapshot 测试）

#### 2.4.1 通用模板

每个测试文件结构：

```typescript
import { describe, it, expect } from 'vitest';
import * as moduleUnderTest from '../index';

describe('<module> public exports snapshot', () => {
  it('exposes stable + compat symbols (snapshot)', () => {
    const symbols = Object.keys(moduleUnderTest).sort();
    expect(symbols).toMatchSnapshot();
  });

  it('does not expose internal-only symbols', () => {
    const symbols = Object.keys(moduleUnderTest);
    // 这里写显式负向断言：列出 engine/14 标为 internal 的符号，确保它们不在
    // 例：expect(symbols).not.toContain('TokenCalculator');
  });
});
```

#### 2.4.2 4 个测试的特异性

| 测试 | 负向断言（must-not-include）|
|------|---------------------------|
| `src/agent/__tests__/index.exports.snapshot.test.ts` | `TokenCalculator` / `errorClassifier` / `logger` |
| `src/agent/runtime-kernel/__tests__/index.exports.snapshot.test.ts` | `tickPipeline` / `LlmNodeState` / `LlmNodeEventBridge` / `toolIdempotency` |
| `src/agent/ports/__tests__/index.exports.snapshot.test.ts` | （ports 没有 internal，留空 it.skip + TODO） |
| `src/agent/testkit/__tests__/index.exports.snapshot.test.ts` | （testkit 现在还没明确 internal 列表，留空 it.skip + TODO） |

**snapshot 文件**（`__snapshots__/*.snap`）必须 commit 进 PR2，与测试 .ts 同 commit。

### 2.5 PR2 commit message 模板

```
feat(agent/index): D-1.a 实施 — 起 4 个 sub index.ts + namespace 化顶层入口

按 engine/14 §2.1-§2.3 决策定稿起 D-1.a：
- 新建 src/agent/{ports,runtime-kernel,testkit}/index.ts，按 engine/14 列表
  re-export stable + compat 符号；internal 一律不暴露
- 修改 src/agent/index.ts：5 行最小版 → 完整版；compat 隔离进 linnkitCompat
  namespace（D1 决策）；context-manager / llmTelemetryContext / llmAuditRecorder
  全部归 compat
- 4 个 snapshot 测试 + 负向断言保证公开面不被意外加/删

按 engine/16 §4 G1 完成判据通过：
- guard:agent-boundary: 0 violations
- tsc: <N> errors（baseline 526，diff <N-526>）
- vitest: <X> file fail / <Y> case fail / <Z>s
  （baseline 9 / 14 / 29.8s）
- 套件 A 全绿

D-1.b（package.json）紧跟下一个 commit。
```

**`<N> / <X> / <Y> / <Z>` 必须填实际数字，不要留模板**。

---

## 3. PR3：D-1.b 实施

### 3.1 范围

| 操作 | 文件 | 内容 |
|------|------|------|
| 新建 | `src/agent/package.json` | §3.2 完整模板 |

**绝不动**：根目录 `package.json`（不要改主仓库的 dependencies / scripts；D-1.b 只起草子包 manifest，不真发布）

### 3.2 `src/agent/package.json` 完整模板

```json
{
  "name": "linnkit",
  "version": "0.0.0-dev",
  "private": true,
  "description": "Agent Engine package draft (Phase D 准备阶段，尚未独立发布；当前与 src/agent 物理同居)",
  "type": "module",
  "exports": {
    ".": "./index.ts",
    "./ports": "./ports/index.ts",
    "./runtime-kernel": "./runtime-kernel/index.ts",
    "./context-manager": "./context-manager/index.ts",
    "./testkit": "./testkit/index.ts"
  },
  "linnkit": {
    "phase": "D-1.b draft",
    "stableExportsTruth": "src/agent/docs/engine/14-stable-vs-compat-exports.md",
    "extractionPlan": "src/agent/docs/engine/07-public-api-and-package-boundary.md",
    "notes": [
      "本文件是 Phase D 起草版，不真发布",
      "Phase E (E-1) 时迁到独立 packages/linnkit/ 目录",
      "TODO(D-2): 加 boundary guard CI hook reference",
      "TODO(engine/03): exports 表加 ./ports 下的 LlmProviderPort 子条目（如适用）"
    ]
  }
}
```

### 3.3 验证步骤

| Step | 验证命令 | 通过条件 |
|------|---------|---------|
| 3.3.1 | `cat src/agent/package.json \| python3 -m json.tool` | 输出有效 JSON 不报错 |
| 3.3.2 | 套件 D 全量 | file fail ≤ 9 / case fail ≤ 14 / 耗时 ≤ 35s |
| 3.3.3 | guard | 0 violations |
| 3.3.4 | tsc | ≤ 526 |

**注意**：当前 `tsconfig.json` 的 paths/include 不需要改（src/agent/package.json 不会改变 TS 解析）。如果 tsc 数字 > 526，**ABORT 并报告**（说明有意料之外的 TS 副作用）。

### 3.4 PR3 commit message 模板

```
feat(agent/package): D-1.b 起 src/agent/package.json 草案 (linnkit)

- name: linnkit (engine/07 §6 Q1 决策)
- private: true (Phase D 不真发布；Phase E 才物理迁移到独立 packages/)
- exports: 一次到位 5 个 entry (D3 决策)
- linnkit.* 字段：写明真源文件路径 + Phase 状态 + 已知 TODO

按 engine/16 §4 G1 通过：guard 0 / tsc <N> / vitest <X>/<Y>/<Z>s。
```

---

## 4. PR4：PR Template（独立 commit，可选最后做）

### 4.1 文件

新建 `.github/PULL_REQUEST_TEMPLATE.md`：

```markdown
## 改动范围

<!-- 文件级清单；涉及 engine/07 哪一个 T几 / D几 / E几 -->

## 跑了哪个套件（参考 engine/16 §3 防线 2）

- [ ] 套件 A（ports / index 入口）：`vitest run src/agent/ports src/agent/runtime-kernel/__tests__ src/agent/context-manager/__tests__ src/agent/testkit`
- [ ] 套件 B（graph 主链）：`vitest run src/agent/runtime-kernel/graph-engine src/app-hosts/linnya/testkit/agent-harness`
- [ ] 套件 C（宿主装配）：`vitest run src/app-hosts/linnya`
- [ ] 套件 D（全量回归）：`npm test`
- [ ] guard：`npm run guard:agent-boundary`
- [ ] tsc：`npx tsc --noEmit -p tsconfig.json`

## vs baseline diff（数字以 `.baseline/m4-summary.txt` 为准）

| 指标 | baseline | 本 PR | diff |
|------|---------|------|------|
| guard 违规 | 0 | | |
| tsc 错误总数 | 526 | | |
| tsc promptKey | 9 | | |
| vitest 测试文件 fail | 9 | | |
| vitest 测试用例 fail | 14 | | |
| vitest 耗时 | 29.8s | | |

任何 diff > 0 必须在下方"差异说明"段论证。

## 差异说明

<!-- 如果 baseline 有净增/净减，必须解释为什么 -->

## 关联文档

- engine/07 § __
- engine/14 / 16 / 17 如适用

## 回滚方案

<!-- 如果 merge 后发现问题，怎么 revert -->
```

### 4.2 PR4 commit message

```
chore(github): add PULL_REQUEST_TEMPLATE 强制 baseline diff 三栏

按 engine/16 §5 模板，让以后所有 PR 都被迫填 baseline diff。
```

---

## 5. 完成判据（subagent 自检）

PR2 + PR3 + PR4 全部 commit 后：

```bash
git log --oneline -4   # 必须看到 3-4 个新 commit（PR2 / PR3 / PR4 / 可能合并）
git status             # 必须 clean
npm run guard:agent-boundary  # 必须 0 violations
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c 'error TS'  # 必须 ≤ 526
npm test 2>&1 | tail -20  # 必须 file fail ≤ 9 / case fail ≤ 14 / duration ≤ 35s
```

**全部满足 = G1 + D-1.b 通过 = 任务成功**。

---

## 6. 异常处理协议（subagent 必读）

| 触发 | 强制行为 |
|------|---------|
| 任何 baseline 数字净增 | **立刻 ABORT**，不要 commit；把当前 diff + 失败日志记录到 §10；停止后续步骤 |
| pre-commit hook 拦下 | **不要 `--no-verify`**；先看 hook 输出是 guard 还是 tsc 失败；按 §10 记录 |
| 摸现状发现 engine/14 列的符号实际不存在 | **立刻 ABORT**；engine/14 错了，需要人工修，不许 subagent 自由替换符号 |
| `src/agent/` 之外的文件出现 modified | **立刻 ABORT**；违反 D6 严格隔离决策 |
| snapshot 测试因为 vitest 行为差异 fail（如 sort 顺序）| 改测试代码用 `.sort()` 显式排序，不要 update snapshot |
| tsc 报新错误，但都是新建的 `__tests__/*.snapshot.test.ts` 里的导致 | 修测试代码（最常见原因：源文件不是 type-only export，得改成 `import`），不要 commit 失败的 tsc |
| 任何超过 5 行的"业务逻辑"修改诱惑（"顺手清个 import 顺序" / "顺手补个 type" 等）| **立刻打住**；违反 D6 |

---

## 7. 测试覆盖说明（D5 决策具体落地）

| 测试位置 | 验证什么 | 测试类型 |
|---------|---------|---------|
| `src/agent/__tests__/index.exports.snapshot.test.ts` | 顶层公开面 = stable 4 项 + linnkitCompat 1 项 | snapshot + 负向断言 internal 不在 |
| `src/agent/runtime-kernel/__tests__/index.exports.snapshot.test.ts` | 9 个 namespace（5 stable + 4 compat）正确暴露 | snapshot + 负向断言 internal 不在 |
| `src/agent/ports/__tests__/index.exports.snapshot.test.ts` | 3 个 stable type 暴露 | snapshot |
| `src/agent/testkit/__tests__/index.exports.snapshot.test.ts` | 3 个 stable harness 暴露 | snapshot |

**snapshot 价值**：
- 任何后续 PR 改了 sub `index.ts` 的 export，snapshot 测试会立刻 fail
- 强迫做 PR 的人在 review 时显式 update snapshot，意图可见
- 防"意外暴露 internal" / "意外删 stable" 两类回归

**人工 update snapshot 的合法场景**：
- D-2 显式扩 stable（如加 `LlmProviderPort`）
- engine/14 升级（如把某个 compat 移到 stable）
- 任何 PR 必须在 commit message 里说明为什么 update

---

## 8. 范围边界（subagent 不要做的事）

- ❌ engine/03（LlmProviderPort 落地）—— 留给下一轮
- ❌ D-2（4 条新 guard）—— 留给 engine/03 之后
- ❌ engine/14 / 15 / 17 等任何文档的回填 / 内容更新（除非纯链接修复）
- ❌ Sprint 2-5 的债清理（D6 严格隔离）
- ❌ 修改 `tsconfig.json` / 根 `package.json` / `vitest.config.ts`
- ❌ 给 host 端的 deep import 改成入口 import（D-2 的事）
- ❌ git push（用户自己 push）
- ❌ 创建 PR（用户自己 PR）

---

## 9. 推荐执行节奏（给 subagent 的 hint）

| 阶段 | 时间预算 | 备注 |
|------|---------|------|
| §0 准入 + §2.3 摸现状 | 10 min | 主要是确认 engine/14 列的符号在源文件真实存在 |
| §2.2.1-2.2.4 4 个 index.ts 改完 | 30-60 min | runtime-kernel 最大；可能需要给若干 sub-dir 新建 index.ts |
| §2.4 4 个 snapshot 测试 | 20-30 min | 第一次跑产生 snapshot；review 内容看是否符合 engine/14 列表 |
| §2.5 commit PR2 | 5 min | pre-commit hook 跑约 1-2 min |
| §3 PR3（package.json）+ commit | 10 min | 几乎零思考量 |
| §4 PR4（template）+ commit | 5 min | 模板原样粘贴 |
| §5 自检 + 写 §10 完成报告 | 10 min | |

**总预算：约 1.5-2.5 小时**。超过 4 小时未完成 → 强制 ABORT 并把进度写到 §10。

---

## 10. 异常日志 / 完成报告（subagent 写在这里）

> subagent 在执行过程中遇到任何 §6 触发的异常，**必须**在本节追加记录；执行完成后也在本节写完成报告。

### 10.1 异常日志

<!-- subagent 追加在这里：[timestamp] step X.Y.Z 触发了 §6 哪一条；当前 git status / log；推荐回退点 -->

### 10.2 完成报告

<!-- subagent 完成后追加在这里：
- 实际 commit hash 列表
- 最终 baseline 实测（guard / tsc / vitest 文件 / 用例 / 耗时）
- 是否全部 G1 通过
- engine/14 §2.7 是否需要刷新（如果改动了 host import 面）
- 留给人工的后续动作清单
-->

---

## 11. 跑完之后用户该做什么

1. Review subagent 的 commit 序列（PR2 / PR3 / PR4，3 个 commit）
2. Review §10.2 完成报告
3. 如果 OK：`git push origin main`（或先开 PR review）
4. 启动下一阶段：engine/03 §7.1 T1-T6（LlmProviderPort 落地）
5. 把 §10 异常日志的内容（如有）回填到 engine/07 / engine/14 / 本 runbook 的迭代区
