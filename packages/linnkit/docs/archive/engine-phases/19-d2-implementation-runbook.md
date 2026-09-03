# 19 · D-2 实施 Runbook（边界静态护栏强化 + 宿主 import 收口）

> **状态**：✅ D-2 package-boundary 收尾已完成（2026-04-22 已实装 PR-A/B/C + Batch 0/1/2/3 + PR-H 主体；原 Batch 5 主 knot 已并入 Batch 4；reverse deep import baseline `179 -> 0`，PR-J 最终 enforce 已上线）
> **目标读者**：另一个 agent / 远程 subagent / 本机操作者，能照着本文档无人值守跑完 D-2.a ~ D-2.f
> **执行人原则**：本文档列出的所有步骤、判据、异常协议都必须严格遵守；**不要发挥**，遇到本文档未覆盖的情况先停下记录到 §9 而不是猜
>
> **关联**：
> - 主计划：[`07-public-api-and-package-boundary.md`](./07-public-api-and-package-boundary.md) §5.4 / §7.2
> - **真源**（宿主迁移文件级顺序）：[`15-host-migration-file-manifest.md`](./15-host-migration-file-manifest.md)（Batch 0~5 定稿）
> - 公开面定稿：[`14-stable-vs-compat-exports.md`](./14-stable-vs-compat-exports.md)（哪些是入口，哪些是 internal）
> - 阻塞清单：[`11-phase-e-hard-blockers.md`](./11-phase-e-hard-blockers.md) B1 / B2 / B5（D-2 要解的硬阻塞）
> - 测试规约：[`16-m4-m5-regression-test-plan.md`](./16-m4-m5-regression-test-plan.md)（baseline / 套件 A / G1 门禁）
> - **不变量 baseline 文件**：`.baseline/m4-summary.txt`（526 / 9 / 14 / ≤45s）
> - 现有 guard 实现：`scripts/guards/agent-package-boundary-guard.ts`（76 行，6 条规则）
> - 现有 CI workflow：`.github/workflows/agent-guard.yml`（已跑 guard + tsc + vitest 三段 baseline 比对）

---

## 0. 启动准入（subagent 第一步必跑）

```bash
git status                                       # 必须为空（working tree clean）
git log --oneline -1                             # 必须 = f7718c19（D-1 文档同步）或更新
cat .baseline/m4-summary.txt | head -20          # 必须能读到 526 / 9 / 14 / ≤45s
ls scripts/guards/agent-package-boundary-guard.ts       # 现有 guard 必须存在
ls .github/workflows/agent-guard.yml             # 现有 CI 必须存在
ls .husky/pre-commit                             # 本地 hook 必须存在
```

**准入条件**（任何一条不满足必须 ABORT 并报告，**不要尝试修复**）：

- [ ] `git status` clean
- [ ] HEAD 包含 `f7718c19` 或之后（D-1.a/b 已 land + 文档已同步）
- [ ] `.baseline/m4-summary.txt` 显示 tsc=526 / vitest file fail=9 / case fail=14 / duration ≤45s
- [ ] 现有 guard / CI workflow / pre-commit hook 三件套都在
- [ ] D-1.a/b 不变量：`src/agent/{ports,runtime-kernel,testkit}/index.ts` + `src/agent/index.ts` + `src/agent/package.json` 都存在

---

## 1. 用户已拍板的决策（不再重新确认）

| 决策 ID | 内容 | 影响 |
|---------|------|------|
| **Q3** | guard 风格：**继续 grep-style**，不上 ESLint plugin | 在 `scripts/guards/agent-package-boundary-guard.ts` 上加规则即可，不开新工程 |
| **N1-N4** | codename = `linnkit`，禁止再发明别名；未来全局换名只动 3 处权威位置 | D-2.d codename lint 落 |
| **D6** | **严格隔离**：D-2 默认只动 (a) `scripts/` 下的 guard 文件 (b) `src/app-hosts/` 等 host 文件的 `import` 收口；**唯一例外**是为收口 host deep import 而在 `src/agent/testkit/` 增加 agent-owned test seam。除此之外不顺手清业务 tsc 债 | 任何超出 `scripts/` / `src/app-hosts/` / `src/agent/testkit/` seam 的修改必须 ABORT 并问 |
| **D9** | D-2 拆 6 个 commit / PR，逐 batch 落地，每 commit 必须过当前 CI baseline | 见 §2 PR 序列 |
| **D10** | 新增 guard 规则采用 **"baseline 模式"**：现存违规进白名单（`.baseline/agent-deep-import-baseline.txt`），CI 只拦"新增违规"；Batch 0~5 完成时白名单收敛到 0 | 解决"上来就 169 处全红"的鸡生蛋问题 |

---

## 2. PR 切片总览

| PR | 内容 | 范围 | 依赖 | 风险 |
|----|------|------|------|------|
| **PR-A** | D-2.a/b 反向 + 跨子模块 lint 规则 + baseline 白名单机制 | `scripts/` + 单测 + `.baseline/` | 无 | 小 |
| **PR-B** | D-2.c CI workflow 接入新规则 | `.github/workflows/agent-guard.yml` | PR-A | 极小 |
| **PR-C** | D-2.d codename hard-coded lint | `scripts/guards/agent-codename-lint.ts` + workflow | PR-B | 小 |
| **PR-D** | D-2.e Batch 0：testkit / tests canary 收口 | engine/15 §2 Batch 0 文件 | PR-A | 小 |
| **PR-E** | D-2.e Batch 1：child-runs 收口 | engine/15 §2 Batch 1 文件 | PR-D | 中低 |
| **PR-F** | D-2.e Batch 2：flow event/session seam 收口 | engine/15 §2 Batch 2 文件 | PR-E | 中高 |
| **PR-G** | D-2.e Batch 3：flow runner core 收口 | engine/15 §2 Batch 3 文件 | PR-F | 高 |
| **PR-H** | D-2.e Batch 4：registry + context + context-policies 收口 | engine/15 §2 Batch 4 文件 | PR-G | 中高 |
| **PR-I** | D-2.e Batch 5：context-injection final knot 收口 | engine/15 §2 Batch 5 文件 | PR-H | 最高 |
| **PR-J** | D-2.f 收尾：白名单清空 + 把 reverse guard 切到 enforce 模式 | guard 配置 + baseline 文件 | PR-I | 低 |

> **subagent 一次跑哪些**：
> - **轮次 1（本 runbook 默认范围）**：PR-A + PR-B + PR-C，先把 guard / CI / codename 三件事做完，但**不动 host 业务文件**
> - **轮次 2~7**：每轮跑一个 Batch（PR-D ~ PR-I），用户 review 后再开下一轮
> - **轮次 8**：PR-J 收尾切 enforce
>
> **本 runbook 的 §3-§5 详写 PR-A/B/C；§6 给 PR-D~I 的统一 batch 模板；§7 给 PR-J 收尾清单**

---

## 3. PR-A：guard 反向规则 + 跨子模块规则 + baseline 白名单

### 3.1 范围（精确文件清单）

| 操作 | 文件 | 内容来源 |
|------|------|---------|
| 修改 | `scripts/guards/agent-package-boundary-guard.ts` | §3.3 新增 3 条规则 + baseline 模式 |
| 新建 | `scripts/__tests__/agent-package-boundary-guard.test.ts` | §3.4 单测规格 |
| 新建 | `.baseline/agent-deep-import-baseline.txt` | §3.5 现状快照（host→agent deep import 全列表）|

**绝对不许动的文件**：
- `src/agent/` 任何业务代码（guard 自检不需要改 src）
- `src/app-hosts/` 任何业务代码（host import 收口是 PR-D~I 的事）
- 任何 `.test.ts` 业务文件

### 3.2 实施顺序（强制按此顺序）

| Step | 动作 | 验证命令 | 通过条件 |
|------|------|---------|---------|
| 3.2.1 | 先 Read 现有 `scripts/guards/agent-package-boundary-guard.ts`，确认 6 条规则结构 | `npm run guard:agent-boundary` | 当前通过（绿）|
| 3.2.2 | 生成 baseline 快照（人工跑下面命令，把输出 commit 进 `.baseline/`） | 见 §3.5 | 文件存在且 ≤200 条 |
| 3.2.3 | 在 guard 里加 3 条新规则（GUARD-07/08/09） + baseline 白名单读取逻辑 | `npx tsx scripts/guards/agent-package-boundary-guard.ts` | 退出码 0（白名单生效）|
| 3.2.4 | 写单元测试覆盖 3 条新规则（fixture 字符串注入式，不依赖真文件树） | `npx vitest run scripts/__tests__/agent-package-boundary-guard.test.ts` | 全绿 |
| 3.2.5 | 全量回归（套件 D） | `npm test` | file fail ≤ 9 / case fail ≤ 14 / 耗时 ≤ 45s |
| 3.2.6 | tsc 不增 | `npx tsc --noEmit -p tsconfig.json 2>&1 \| grep -c 'error TS'` | ≤ 526 |
| 3.2.7 | 提交（commit message 见 §3.6）| `git commit` | pre-commit hook 通过 |

**任何 step 失败 → 立刻 ABORT 并记录到 §9.异常日志**。

### 3.3 3 条新规则的具体定义

| 规则 ID | 防什么 | 触发样例 | 例外 |
|---------|--------|---------|------|
| **AGENT-GUARD-07-no-host-deep-import** | host 端 / 其他模块 不能 `from 'src/agent/<sub>/<deeper>'`，只能 `from 'src/agent'` 或 `from 'src/agent/<entry>'`（4 个 entry：ports / runtime-kernel / context-manager / testkit）| `from 'src/agent/runtime-kernel/llm/caller'` | `src/agent/**` 自身（内部允许）；`src/agent/**/__tests__/**`（测试不查）|
| **AGENT-GUARD-08-no-cross-submodule-deep-import** | 在 `src/agent/` 内部，sub A 不能 `from '<sub-B>/<deeper>'`，必须走 `<sub-B>/index.ts` 公开面 | `runtime-kernel/llm/caller.ts` 写 `from '../../context-manager/profiles/agent/tools/ToolManager'` | 同 sub 内的相对 import；`shared/`（运行期共享 utils）|
| **AGENT-GUARD-09-no-internal-only-import** | 禁止 import `src/agent/shared/{logger,errorClassifier,TokenCalculator}` 等被 engine/14 §2.1 标为 `internal-only` 的路径（无论从哪 import）| `from 'src/agent/shared/TokenCalculator'` | `src/agent/shared/` 内部互引 |

**实现策略**：
- 沿用现有 grep-style：扫整个 monorepo 的生产代码，对每行 `from`/`import(` 做正则匹配
- 加白名单参数：`--baseline=.baseline/agent-deep-import-baseline.txt`，命中白名单的违规只 warn 不 fail
- 退出码：违规且不在白名单 → exit 1；违规但在白名单 → exit 0 + stderr warning
- 新规则要扫的目录范围：**整个 monorepo**（不像 GUARD-01~06 只扫 `src/agent/`），因为 GUARD-07 关心的是 host 侧的 import

### 3.4 单元测试规格

`scripts/__tests__/agent-package-boundary-guard.test.ts`：

- `describe('AGENT-GUARD-07-no-host-deep-import')`
  - case A：`from 'src/agent/runtime-kernel/llm/caller'` → 违规
  - case B：`from 'src/agent/runtime-kernel'` → 通过
  - case C：`from 'src/agent'` → 通过
  - case D：在 `src/agent/runtime-kernel/foo.ts` 内部 `from './bar'` → 通过（豁免）
  - case E：在 `__tests__/` 下 → 通过（豁免）
- `describe('AGENT-GUARD-08-no-cross-submodule-deep-import')`
  - case A：`runtime-kernel/x.ts` 写 `from '../../context-manager/profiles/agent/tools/X'` → 违规
  - case B：`runtime-kernel/x.ts` 写 `from '../../context-manager'` → 通过
  - case C：`runtime-kernel/x.ts` 写 `from '../../shared/logger'` → 通过（shared 豁免）
- `describe('AGENT-GUARD-09-no-internal-only-import')`
  - case A：`from 'src/agent/shared/TokenCalculator'` → 违规
  - case B：`from 'src/agent/shared/ids'` → 通过（ids 是 stable export）
- `describe('baseline whitelist')`
  - case：白名单包含 line `src/foo.ts:from 'src/agent/x/y'` → 不 fail
  - case：相同违规但行号变了 → 仍认为是同一条（按 file + import path 匹配，不按 line number）

测试技法：fixture 字符串注入，不创建真文件；把 `collectViolations` 抽成纯函数 `analyzeLine(file, line, content) => Violation | null`，测试只调用这个纯函数。

### 3.5 baseline 快照生成命令

**人工跑一次，把输出 commit 进 `.baseline/agent-deep-import-baseline.txt`**：

```bash
# 找出所有 src/agent/<sub>/<deeper> 的 host 侧 deep import
# 排除 src/agent/ 内部互引、排除 __tests__、排除 docs
grep -rn -E "from ['\"]src/agent/[^'\"]+/[^'\"]+['\"]" \
  src/app-hosts src/features src/shared src/tools src/electron-main src/integrations src/infra apps \
  --include='*.ts' --include='*.tsx' \
  | grep -v '__tests__' \
  | grep -v '\.test\.ts' \
  | grep -v '\.spec\.ts' \
  | sort -u \
  > .baseline/agent-deep-import-baseline.txt

wc -l .baseline/agent-deep-import-baseline.txt   # 预期 80~150 行
```

格式约定（每行）：

```
src/app-hosts/linnya/adapters/runtime-assembly/graphRuntimeFactory.ts:42:from 'src/agent/runtime-kernel/llm/caller'
```

guard 读取时：忽略 `:<line>:` 中间段，只看 `<file>` + `<import path>` 两元组是否在白名单。

### 3.6 commit message 模板

```
chore(agent): D-2.a/b add reverse-deep-import guard rules with baseline mode

- Add AGENT-GUARD-07-no-host-deep-import (host can only import 4 entries)
- Add AGENT-GUARD-08-no-cross-submodule-deep-import (intra-agent boundary)
- Add AGENT-GUARD-09-no-internal-only-import (forbid shared/{logger,errorClassifier,TokenCalculator} etc.)
- Add baseline whitelist mechanism (.baseline/agent-deep-import-baseline.txt)
  to allow gradual migration during D-2.e Batch 0~5
- Add unit tests covering all 3 new rules + whitelist semantics

Refs: src/agent/docs/engine/19-d2-implementation-runbook.md §3
Refs: src/agent/docs/engine/07 §7.2 T5/T6
```

---

## 4. PR-B：CI workflow 接入新规则（D-2.c）

### 4.1 现状

`.github/workflows/agent-guard.yml` 已经在跑 `npm run guard:agent-boundary`（见 line 42-43）。PR-A 把新规则加进同一个 guard 文件后，**CI 自动跟着跑**，不需要单独"接入"。

但要做 2 件小事：

| Step | 动作 | 文件 |
|------|------|------|
| 4.1.1 | 在 workflow `paths:` 触发条件加 `.baseline/agent-deep-import-baseline.txt` | `.github/workflows/agent-guard.yml` line 6-21 |
| 4.1.2 | 在 guard 失败时上传白名单当前状态作为 artifact，便于 PR 作者 review | 同 workflow，加一个 `actions/upload-artifact@v4` step |

### 4.2 实施顺序

| Step | 动作 | 验证 |
|------|------|------|
| 4.2.1 | 改 workflow `paths:` 加 baseline 文件 | yaml lint 通过 |
| 4.2.2 | 加 artifact upload step（参考已有 tsc-current-log / vitest-current-log 模式）| yaml lint 通过 |
| 4.2.3 | 本地手动模拟：删一行 baseline，跑 guard，应 exit 1 | exit code 1 |
| 4.2.4 | 恢复 baseline，guard 应 exit 0 | exit code 0 |
| 4.2.5 | 提交（commit message 见 §4.3）| pre-commit 通过 |

### 4.3 commit message 模板

```
chore(ci): D-2.c trigger agent-guard on baseline whitelist changes

- Add .baseline/agent-deep-import-baseline.txt to workflow paths filter
- Upload current baseline diff as artifact when guard fails
  (helps PR authors compare expected vs actual whitelist state)

Refs: src/agent/docs/engine/19-d2-implementation-runbook.md §4
Refs: src/agent/docs/engine/07 §7.2 T7
```

---

## 5. PR-C：codename hard-coded lint（D-2.d）

### 5.1 范围

新建 `scripts/guards/agent-codename-lint.ts`，扫描 `linnkit` / 历史代号 `linngent` 是否出现在不允许的位置。

**白名单**（允许出现 codename 字符串）：
- `src/agent/docs/**/*.md`
- `src/agent/README.md` / `src/agent/DEVELOPMENT_GUIDE.md` / `src/agent/INTEGRATION_GUIDE.md`
- `src/agent/package.json` 的 `name` / `description` 字段
- `src/agent/index.ts` 与验证其公开面的测试（如 `src/agent/__tests__/package.manifest.test.ts`）
- lint 自身的实现 / 测试文件（如 `scripts/guards/agent-codename-lint.ts` / `scripts/__tests__/agent-codename-lint.test.ts`）
- `packages/<linnkit>/package.json`（Phase E 后）
- `pnpm-workspace.yaml`、根 `tsconfig.json` paths
- 各 host `package.json` 的 `dependencies`
- `.github/workflows/*.yml` 的 step name / artifact name

**黑名单**（禁止 codename 硬编码字符串）：
- 任何 `.ts` / `.tsx` / `.js` / `.vue` 业务代码（codename 只应作为 import 路径出现，不作为字符串 literal）
- 除权威定义文件 / 权威验证测试外，其他 `.ts` 测试文件也不应散落 codename 字符串

### 5.2 实施顺序

| Step | 动作 | 验证命令 | 通过条件 |
|------|------|---------|---------|
| 5.2.1 | 新建 `scripts/guards/agent-codename-lint.ts`（参考 `agent-package-boundary-guard.ts` 结构）| `npx tsx scripts/guards/agent-codename-lint.ts` | exit 0（允许权威定义 / 权威验证文件命中）|
| 5.2.2 | 在 `package.json` 加 npm script `lint:codename` | `npm run lint:codename` | exit 0 |
| 5.2.3 | 在 `.github/workflows/agent-guard.yml` 加 step 跑 `lint:codename` | yaml lint 通过 |
| 5.2.4 | 写 fixture 单测：黑名单文件加 `const x = "linnkit"` 应 exit 1 | `npx vitest run scripts/__tests__/agent-codename-lint.test.ts` | 全绿 |
| 5.2.5 | 全量回归（套件 D） | `npm test` | file fail ≤ 9 / case fail ≤ 14 / 耗时 ≤ 45s |
| 5.2.6 | 提交 | pre-commit 通过 |

### 5.3 commit message 模板

```
chore(agent): D-2.d add codename hard-coded lint to prevent rename lock-in

- Add scripts/guards/agent-codename-lint.ts (grep-style, ~80 lines)
- Whitelist: docs/, README/, package.json name field, workspace config
- Blacklist: any .ts/.tsx/.js/.vue source containing "linnkit" / "linngent"
  as string literal (use import path or named const instead)
- Wire into npm run lint:codename + CI workflow step

Refs: src/agent/docs/engine/19-d2-implementation-runbook.md §5
Refs: src/agent/docs/engine/07 §7.2 T7b / §7.8 N1-N4
```

---

## 6. PR-D ~ PR-I：Batch 0 ~ Batch 5 宿主 import 收口（D-2.e）

### 6.1 通用 batch 模板（每个 batch 一个 PR，按相同流程跑）

| Step | 动作 | 验证命令 | 通过条件 |
|------|------|---------|---------|
| 6.1.1 | 读 `engine/15 §2 Batch <N>` "先动文件" + "同批改" + "不要拆开改" 三块 | — | 完全理解依赖关系 |
| 6.1.2 | **默认路径**：对每个 "先动文件"，把 `from 'src/agent/<sub>/<deep>'` 收到 `from 'src/agent'` 或 `from 'src/agent/<sub>'`（4 个 entry 之一） | `git diff` | 变更以 import 收口为主 |
| 6.1.3 | **Batch 0 特例**：如果发现 host 测试 harness 直接抓 graph/node/checkpointer internals，先在 `src/agent/testkit/` 建 agent-owned seam，再把 host wrapper 收到公共面；不要机械替换 import | `npx vitest run <batch0-tests>` | seam 先红后绿 |
| 6.1.4 | 如果某 deep 符号在 `<sub>/index.ts` 没 export，且无法通过已有 seam 收口 → 停下，不补 export，记录到 §9 异常 | — | — |
| 6.1.5 | 跑 batch 关联的测试（engine/15 列了"同批改"测试文件） | `npx vitest run <test-files>` | 全绿 |
| 6.1.6 | 跑全量回归 | `npm test` | file fail ≤ 9 / case fail ≤ 14 / 耗时 ≤ 45s |
| 6.1.7 | tsc 不增 | `npx tsc --noEmit \| grep -c 'error TS'` | ≤ 526 |
| 6.1.8 | 跑 reverse guard，确认 baseline 白名单可以删几行 | `npx tsx scripts/guards/agent-package-boundary-guard.ts --emit-baseline` | 输出新 baseline，diff 应只有"删除"|
| 6.1.9 | 更新 `.baseline/agent-deep-import-baseline.txt` 删除已收口的行 | `git diff .baseline/` | 只有删除，无新增 |
| 6.1.10 | 提交（message 模板见 §6.3）| pre-commit 通过 |

### 6.2 各 batch 的精确范围（直接引 engine/15）

| Batch | "先动文件" 数 | "同批改" 测试数 | 风险 | engine/15 章节 |
|-------|---------------|-----------------|------|----------------|
| 0 (testkit canary) | 5 | 2 | 低 | §2 Batch 0 |
| 1 (child-runs) | 4 | 1 | 中低 | §2 Batch 1 |
| 2 (flow event/session seam) | 11 | 5 | 中高 | §2 Batch 2 |
| 3 (flow runner core) | 8 | 5 | 高 | §2 Batch 3 |
| 4 (registry + context + policies) | 16 | ~10 | 中高 | §2 Batch 4 |
| 5 (context-injection final knot) | 1 主 + 6 同批 | 通过 batch 3/4 用例覆盖 | 最高 | §2 Batch 5 |

**关键约束**（从 engine/15 抽出）：
- Batch 0 / Batch 1 / Batch 2 / Batch 3 之间**严格顺序**，不能并行
- Batch 4 在 Batch 3 之后（runtime assembly 和 chat 兼容清理同批做）
- **Batch 5 必须最后**（context-injection 是历史死结，前 4 个 batch 全稳定后才能动）

**Batch 0 额外说明（真实代码校准）**：
- Batch 0 不等于“纯 import 替换”
- `graphLoopHarness.ts` 这类 host test harness 直接装配 `GraphExecutor / MemoryCheckpointer / UserNode / ToolNode / AnswerNode / WaitUserNode` 时，根因是 host 知道太多 agent internals
- 正确做法是拆成 **0A / 0B**
  - `0A`：在 `src/agent/testkit/` 增加 agent-owned graph loop seam
  - `0B`：把 host wrapper / tests 改到这个 seam，再删 baseline 中对应 deep import
- **禁止**为了省事把 graph internals 继续补进 `src/agent/runtime-kernel/index.ts`

### 6.3 commit message 模板

```
refactor(host): D-2.e Batch <N> migrate <theme> to public agent entries

Per engine/15 §2 Batch <N>:
- Replace deep imports `from 'src/agent/<sub>/<deeper>'` with public entries
  `from 'src/agent/<sub>'` across <N> production files
- Updated <M> test files to match
- Removed <K> entries from .baseline/agent-deep-import-baseline.txt
- No public API changes; no new exports added in src/agent/

Verified:
- npx vitest run <batch-tests>: green
- npm test: file fail <= 9 / case fail <= 14 / duration <= 45s
- tsc errors: <X> (<= 526 baseline)
- guard:agent-boundary: 0 new violations

Refs: src/agent/docs/engine/19-d2-implementation-runbook.md §6
Refs: src/agent/docs/engine/15 §2 Batch <N>
```

### 6.4 跨 batch 的禁止操作（红线）

- ❌ **不要顺手在 `<sub>/index.ts` 补缺失的 stable export**（如果 batch 进行中发现某符号 host 用了但 entry 没 export，记录到 §9，等本轮收尾用户决策；自动补 export 会扩大公开面，违反 engine/14）
- ❌ **不要顺手清业务 tsc 债**（D6 严格隔离）
- ❌ **不要在 batch PR 里改 guard 规则**（PR-A 阶段定稿，batch 阶段只用不改）
- ❌ **不要并发跑两个 batch**（依赖顺序见 §6.2）

---

## 7. PR-J：D-2 收尾（白名单已清空 + reverse guard 切最终 enforce）

### 7.1 触发条件

PR-D ~ PR-I 全部 land，且 `.baseline/agent-deep-import-baseline.txt` 已被各 batch PR 削减到 `0` 行。

### 7.2 范围

| Step | 动作 | 文件 |
|------|------|------|
| 7.2.1 | 确认 reverse guard 当前已 0 违规 / 0 baselined | `npm run guard:agent-boundary` |
| 7.2.2 | 在 guard 中把 `.baseline/agent-deep-import-baseline.txt` 设为“必须为空”的最终 enforce 状态 | `scripts/guards/agent-package-boundary-guard.ts` |
| 7.2.3 | 补 guard 单测，锁住“非空 baseline 必须失败” | `scripts/__tests__/agent-package-boundary-guard.test.ts` |
| 7.2.4 | 更新 `engine/07 §8` / `engine/11 §7` / `engine/15 §4` / `engine/19 §10` 状态 | 4 个 markdown |
| 7.2.5 | 提交 | pre-commit 通过 |

### 7.3 commit message 模板

```
chore(agent): D-2 finalize - clear reverse-import baseline and enable final enforce mode

- All Batch 0~5 host imports migrated to public agent entries
- Reverse-import baseline file is now empty
- Guard now treats any non-empty deep-import baseline as a hard error
- Docs and CI wording synced to final enforce mode

Closes: engine/11 B1 / B2 / B5 (host deep import + missing reverse guard)
Refs: src/agent/docs/engine/19-d2-implementation-runbook.md §7
```

---

## 8. 完成判据（D-2 整段视为完成的硬条件）

D-2 视为完成，必须 7 项全绿：

- [x] PR-A land：3 条新 guard 规则 + baseline 白名单机制 + 单测
- [x] PR-B land：CI workflow 接入新规则
- [x] PR-C land：codename hard-coded lint 上线
- [x] PR-D ~ PR-I 对应收口目标已落地：Batch 0~4 完成，原 Batch 5 主 knot 已并入 Batch 4
- [x] PR-J land：白名单清空 + 最终 enforce mode 上线
- [x] `.baseline/agent-deep-import-baseline.txt` 为空
- [x] M4/M5 baseline 不退化：tsc ≤526 / vitest fail file ≤9 / case ≤14 / duration ≤45s 全程保持

完成后状态同步：
- `engine/07 §8` 勾选 "D-2 已完成"
- `engine/11 §7` 里 B1 / B5 标 ✅ closed，B2 / B3 改成设计判定
- `engine/15 §4` 末尾 D-2 收尾项勾选
- `engine/README` 进度表第 7 行改成 "D-2 已完成"
- `engine/19 §10` 状态行更新

---

## 9. 异常协议（subagent 必读）

遇到下面任意一种情况，立刻 ABORT 并把现场记录到 PR description（不要尝试自己修）：

| 异常类型 | 触发情形 | 操作 |
|---------|---------|------|
| **Step 失败** | §3 / §4 / §5 / §6 任意 step 失败 | 记录 step ID + 命令 + stderr，停手 |
| **缺 export** | batch 中发现 host 用了某符号但 entry index.ts 没 export | 记录 symbol + caller file，**不要补 export**，停手等用户决策 |
| **新 tsc 错误** | tsc 数量 > 526 | 记录 diff 错误清单，停手 |
| **新 vitest 失败** | file fail > 9 或 case fail > 14 | 记录失败清单，停手 |
| **耗时回归** | npm test > 45s | 记录耗时和近 3 次趋势，停手等决策（可能是新增大测试，可能是 flaky 复发）|
| **D6 越界** | 计划外修改 `src/agent/` 之外、且不在 §6 batch 范围的 .ts 业务文件 | 立刻 `git restore`，记录 |
| **codename 命中** | PR-C 跑出 > 0 违规 | 记录违规位置，**不要自动改**，等用户决策（可能是合法的 docs 引用漏白名单）|
| **baseline 回潮** | `.baseline/agent-deep-import-baseline.txt` 非空 | 说明有人试图回到旧白名单模式，立即停手回查 |

每个异常都开 PR description 的 "Encountered Issues" 段记录，让 review 人有完整上下文。

---

## 10. 状态

- [x] §0 启动准入定义（5 条硬条件）
- [x] §1 用户决策固化（Q3 / N1-N4 / D6 / D9 / D10）
- [x] §2 PR 切片总览（10 个 PR / 4 个轮次）
- [x] §3 PR-A 详写：guard 3 条新规则 + baseline 白名单 + 单测规格
- [x] §4 PR-B 详写：CI workflow 接入
- [x] §5 PR-C 详写：codename hard-coded lint
- [x] §6 PR-D ~ I 通用 batch 模板（直接复用 engine/15 §2 Batch 0~5）
- [x] §7 PR-J 收尾：白名单清空 + enforce 模式
- [x] §8 完成判据（7 项硬条件）
- [x] §9 异常协议（8 类异常 + ABORT 操作）
- [x] PR-A / PR-B / PR-C 已执行：guard 3 条新规则 + CI + codename lint 均已落地
- [x] PR-D / PR-E / PR-F / PR-G / PR-H 对应收口目标已执行到代码并通过当前 baseline；原 PR-I 主 knot 已并入 Batch 4 解开
- [x] PR-J 已完成（白名单已清空；guard / blocker / CI / runbook 口径已同步成最终 enforce 状态）

**下一步**：
1. 不再机械按旧文案推进“Batch 4 / Batch 5”；D-2 package-boundary 收口已经完成
2. 下一步进入 D-3 / D-4，不再把 reverse-import 当作当前主阻塞
3. B2 / B3 之后只按设计是否合理来判，不再按 package-boundary 越界来判
