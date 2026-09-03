# 16 · M4 / M5 回归测试计划

> **状态**：✅ 已上线（2026-04-21 → Sprint 1+1.7 + PR1 后口径）
> **作用**：把 M4（实施 Phase D）和 M5（执行 Phase E）期间的"测试到底跑什么、什么时候跑、什么算门禁通过"统一到一处
> **关联**：
> - 主计划：[`07-public-api-and-package-boundary.md`](./07-public-api-and-package-boundary.md)
> - 命名 / R5：[`12-agent-contracts-audit.md`](./12-agent-contracts-audit.md)
> - 文件级迁移顺序：[`15-host-migration-file-manifest.md`](./15-host-migration-file-manifest.md)
> - **D-1.a 真源**：[`14-stable-vs-compat-exports.md`](./14-stable-vs-compat-exports.md)（PR1 决策定稿）
> - **类型债清理史**：[`17-tech-debt-cleanup-plan.md`](./17-tech-debt-cleanup-plan.md)（Sprint 1+1.7 把 baseline 砍了 67%/99%）
> - **真源 baseline 文件**：`.baseline/m4-summary.txt`（CI 与 pre-commit 都从这里读）

---

## 1. 为什么需要这份文档

`engine/07` 回答"M4/M5 要做什么"，本文档回答"做完每一刀，怎么知道**没引入回归**"。

之前的状态：
- 各模块 README 里散落着"最小验证集合"，但**没有跨阶段统一视图**
- 没有 CI 自动门禁（`.github/workflows/` 为空）
- 没有"基线快照 → 改动后 diff" 的对照机制
- 没有 Phase E 的桌面手测 checklist

M4 一旦开始，**每一刀 PR 都涉及 import 路径或 ports 边界**，没有这套体系兜底，回归会很容易溜进 main。

---

## 2. 现状盘点（baseline，Sprint 1+1.7 后口径，2026-04-21）

| 维度 | 当前事实 |
|------|---------|
| **测试套件总数** | 384 个测试文件（含 D-1.a/b 新增的 5 个 snapshot/manifest 测试；sheet/engine fork 379 个内部测试已 exclude） |
| `src/agent/` 测试数 | 44 |
| `src/app-hosts/linnya/` 测试数 | 28 |
| `*.integration.test.ts` 数 | 17 |
| **测试运行器** | `vitest run`（无 shard、无 split） |
| **现有静态护栏** | `scripts/guards/agent-package-boundary-guard.ts`（D-2 后已扩到 reverse-import / codename / internal-only 共 10 条规则）|
| `npm run guard:agent-boundary` 当前状态 | ✅ **通过**（当前为“0 net-new + 0 frozen existing violations in .baseline/agent-deep-import-baseline.txt”） |
| `tsc --noEmit -p tsconfig.json` 错误总数 | ⚠️ **526 条**（Sprint 1: 1601 → 526，-67%；剩余为真业务债，分布见 §8）|
| 其中 promptKey 相关 | 9（Sprint 1 顺手清掉 5 个）|
| **vitest 全量基线（D-1.a/b + flaky 修复后）** | **测试文件 384：9 fail / 369 pass / 6 skipped**；**测试用例 3282：14 fail / 3265 pass / 3 skip**；耗时 **37.7s** |
| 上述 fail 性质 | 全部为真业务断言失败：transcriptionMerger 5 / llmAuditContext 2 / agent registry 2 / 其余分散 5 |
| `.github/workflows/` | ✅ **`agent-guard.yml` 已上线**（动态读 baseline，含 vitest gate）|
| `.husky/pre-commit` | ✅ 与 CI 同口径（guard + tsc baseline diff，跳 vitest）|
| dryrun workspace（`packages/agent-engine-dryrun/`）| **不存在**（D-5 任务未启动）|
| e2e / 桌面端自动化 | 无 playwright / cypress / spectron |

> **重要解读**：Sprint 1+1.7 把 noise debt 全清，剩 526 + 14 全是真业务债。`.baseline/m4-summary.txt` 是 CI/hook 的真源，本文档数字必须与之同步——baseline 收紧时优先改 `.baseline/m4-summary.txt`，本文档跟着回填。

---

## 3. 四层防线

### 防线 1：基线快照

**baseline 已抓并焊进 CI / pre-commit**（`.baseline/m4-summary.txt` 为真源）。日常工作不需要重抓——只在以下两种情况刷新 baseline：

1. **降低 baseline**（推荐）：你顺手清了一批债，跑下面命令重抓 → 修改 `.baseline/m4-summary.txt` 数字 → commit → CI 与 hook 自动跟上
2. **升高 baseline**（罕见）：必须有 PR 描述明确论证；reviewer 重点检查

刷新命令：

```bash
mkdir -p .baseline
npm run guard:agent-boundary 2>&1 | tee .baseline/m4-guard-baseline.txt
node scripts/guards/tsc-baseline-guard.mjs --log-file=.baseline/m4-tsc-baseline.txt
npm test
# 然后手动更新 .baseline/m4-summary.txt 的"Door"段
```

详细 TSC 日志由 guard 统一把仓库绝对路径归一化为 `<repo-root>`。Vitest 只把汇总数字写入
`.baseline/m4-summary.txt`，不再提交包含进程、工作目录和临时失败输出的整段运行日志。

需要记录的**基线数字**（已落档在 `.baseline/m4-summary.txt`）：

- guard 违规数（`m4-summary` 真源仍为 0；D-2 专用 `.baseline/agent-deep-import-baseline.txt` 当前已清零）
- tsc 错误总数（当前 = **526**）
- tsc 关键子集错误数（promptKey = **9**）
- vitest 文件 fail / 用例 fail / 总耗时（当前 = **9 / 14 / 37.7s**）

**`.baseline/` 必须 commit 进仓库**（不要 gitignore）——后续 PR 描述要直接 link 到具体 baseline 文件做对照。

### 防线 2：分层 vitest 套件

把测试按 M4 各刀的"改动半径"切成 4 个套件，每刀只跑对应套件 + PR merge 前兜底跑全量。

| 套件 ID | 范围 | 命令 | 用在哪 |
|---------|------|------|-------|
| **A. ports / index 入口** | `src/agent/ports/**`、`src/agent/*/__tests__/**` | `vitest run src/agent/ports src/agent/runtime-kernel/__tests__ src/agent/context-manager/__tests__ src/agent/testkit` | D-1.a / D-1.b（起 index、改 exports）|
| **B. graph 主链 + harness** | `runtime-kernel/graph-engine/**`、`agent-harness/**` | `vitest run src/agent/runtime-kernel/graph-engine src/app-hosts/linnya/testkit/agent-harness` | 改 ports → graph 透传字段（如 R5 第二阶段）；改 LLM provider 装配 |
| **C. 宿主装配** | `src/app-hosts/linnya/**` | `vitest run src/app-hosts/linnya` | D-2 / Batch 0~5（host migration）|
| **D. 全量回归** | 全部 384 个文件 | `npm test` | 每个 PR merge 前 + Phase E E-5 |

**约定**：
- 每刀 PR 描述里必须列：**改动半径** + **跑了哪个套件** + **vs baseline 的 diff**
- 套件 A/B/C 跑完后，**必须再跑一次 D 兜底**才允许 merge
- 套件 A 单跑不超过 30s，B 不超过 1min，C 不超过 3min（跑得太久说明范围划错）；全量 D 当前 37.7s，红线 45s（≥ 45s 必须找原因）

### 防线 3：静态护栏（D-2 后口径）

| Guard ID | 当前 / 新增 | 规则 | 自带测试 |
|----------|-----------|------|---------|
| AGENT-GUARD-01 ~ 06 | ✅ 已有 | 拦 `from 'src/app-hosts/'` / 拦非 schemas 的 `@app/*` / 拦已删除目录 | 跟着主脚本 |
| **GUARD-07** | ✅ 已上线 | host 不能 `from 'src/agent/<sub>/<deep>'`；只能 `from 'src/agent'` 或 `from 'src/agent/<entry>'` | 有 unit test |
| **GUARD-08** | ✅ 已上线 | `runtime-kernel` 不能直接 import `context-manager/profiles/<deep>` | 有 unit test |
| **GUARD-09** | ✅ 已上线 | 业务代码（`*.ts/.tsx/.vue`）不能硬编码字符串 `linnkit` / `linngent`（白名单见 `engine/07 §7.2 T7b`）| 有 unit test |
| **GUARD-10** | ✅ 已上线 | `src/agent/ports/**` 不允许 `import { PromptKey } from '@app/schemas'`（防止 M-1 R5 倒退）| 有 unit test |

**新 guard 要求**：每条都写 **positive + negative fixture**（合法/非法各 1 个最小样例文件），跑 `vitest run scripts/__tests__/agent-guard.test.ts` 验证它能拦 + 不误伤；与生产 guard 同 PR。

### 防线 4：Phase E 桌面手测 checklist

E-5 步骤的人工 checklist（自动化兜不住，必须每条手过）：

| # | 场景 | 操作 | 验收标准 |
|---|------|------|---------|
| 1 | 应用启动 | 启动桌面 Linnya，加载主界面 | UI 完整渲染、无 console error |
| 2 | 默认 chat 主链 | 新建对话，发 "hi"，等 LLM 完整回复 | stream_end 收到、消息持久化、刷新后 history 正确 |
| 3 | Agent 模式 + 工具调用 | 切到 default agent，让它"读 README" 或类似工具调用 | tool_process / tool_output 正常渲染、无残留 spinner |
| 4 | 子 agent / task | 触发 deep_research 或 task_subagent | 子 run 创建、parent 收回结果、卡片渲染、subrun trace 正常 |
| 5 | requireUser / wait_user | 触发 review 工具或 ppt_plan 等待节点 | pause 正常、用户提交 approve/modify/submit/skip 后正确 resume |
| 6 | abort | 运行中点"停止" | 立刻中断、不留 zombie run、checkpoint 完整 |
| 7 | 重启恢复 | 关闭应用 → 重启 → 打开同一对话 | history 完整 replay、无回放错误 |
| 8 | 多 provider 切换 | OpenAI / Claude / Gemini 各跑一次 agent + 工具 | 各 adapter 协议正常、tool_calls 不串味 |

**任何一项不过 → Phase E 不算完成 → 不能宣布 linnsec 可以启动**。

---

## 4. 六个门禁（每个 D-x / E-x 完成的硬判据）

| 门禁 | 触发时机 | 必须满足 |
|------|---------|---------|
| **G1：D-1.a / D-1.b 完成** | 起 `src/agent/index.ts` + 3 个新 sub `index.ts`（runtime-kernel / ports / testkit）+ `src/agent/package.json` 草案 | 套件 A 通过；guard 0 违规；tsc 错误数 ≤ **526**；vitest 文件 fail ≤ **9** / 用例 fail ≤ **14** / 耗时 ≤ **45s** |
| **G2：engine/03 装配完成** | LlmProviderPort + LinnyaLlmProviderFactory 接好 | 套件 A + B 通过；多 provider 切换冒烟（手测） |
| **G3：D-2 完成** | GUARD-07 / 08 / 09 / 10 上线 + CI 接入 + reverse-import 白名单完成收尾 | 4 条 guard 自身测试通过；guard 无新增违规；CI workflow 跑通；`.baseline/agent-deep-import-baseline.txt` 为空 |
| **G4：D-5 dry-run（穿插）** | 按 `engine/07 §5.2` 在 Batch 0 / 2 / 5 各跑一次；当前已完成最终 dry-run workspace 验证 | dryrun workspace 内 `test:smoke` / `typecheck` 通过；代表性公开面示例测试全绿；engine/14 列的 stable export 可独立 import |
| **G5：Phase E E-5** | E-1 ~ E-4 完成（physical move + monorepo 配置 + import 全改）| **全量 vitest 通过 0 净增**；桌面手测 8 项全过；`pnpm install` / `pnpm build` 成功 |
| **G6：Phase E 完成 / linnsec 解锁** | E-7 删 `src/agent/` 占位后 | grep 0 残留 deep import；guard CI 阻断生效；linnkit package 可独立 install / build / test |

**任何门禁红 → 立刻 revert 对应 PR，不允许"下一个 PR 修"。**

---

## 5. 回归对比机制

每个 D-x / E-x 都是**独立 PR**，PR 描述强制三栏：

```markdown
## 改动范围
- 文件 X / Y / Z
- 涉及 engine/07 的 T几（或 E几）

## 跑了哪个套件
- [x] 套件 A (vitest run src/agent/ports ...)
- [x] 套件 D 全量兜底 (npm test)
- [x] guard:agent-boundary
- [x] tsc --noEmit

## vs baseline diff（数字以 `.baseline/m4-summary.txt` 为准）
| 指标 | baseline | 本 PR | diff |
|------|---------|------|------|
| guard 违规 | 0 | 0 | 0 |
| tsc 错误总数 | 526 | 526 | 0 |
| tsc promptKey | 9 | 9 | 0 |
| vitest 测试文件 fail | 9 | 9 | 0 |
| vitest 测试用例 fail | 14 | 14 | 0 |
| vitest 耗时 | 37.7s | ~ | ≤ 45s |
```

**任何 diff 列出现正数都不能 merge**，除非 PR 里明确说明并提供"为什么这是预期"的论证。

---

## 6. 回滚策略

| 风险等级 | 操作 |
|---------|------|
| 单文件改动 | `git revert <commit>` |
| 跨多文件改动 | revert 整个 PR 的 merge commit |
| **Phase E E-2（git mv 之前）** | 必须先打 backup branch：`git branch backup/pre-phase-e-$(date +%s)` |
| **Phase E E-5 桌面手测红** | 立即 revert E-3/E-4 的 monorepo 改动；保留 `src/agent/` 占位不删 |
| **Phase E E-7（删占位）后发现遗留** | 不要从头来；从 backup branch cherry-pick `src/agent/` 临时回填 + 补 import |

---

## 7. CI 自动门禁

### 已上线：`ci_yes`（2026-04-21，Sprint 1.7 直接跨过 ci_minimal）

实际文件：[`.github/workflows/agent-guard.yml`](../../../../.github/workflows/agent-guard.yml)

行为：
- **每次 PR + push 到 main**（path 过滤到 agent / host / scripts / workflow 自身）
- 自动跑 `npm run guard:agent-boundary` —— 必须通过
- 自动跑 `tsc --noEmit` 并 **动态读 `.baseline/m4-summary.txt`** 做 diff —— 错误数净增直接红 + 阻断 merge
- 自动跑 `npm test` 并对 baseline 做 diff —— vitest file fail / case fail / 耗时任一净增直接红
- baseline 收紧时（如完成下一轮债清理），改 `.baseline/m4-summary.txt` 即可，CI 自动跟上，无需改 workflow

本地 `.husky/pre-commit` 与 CI 同口径（跑 guard + tsc baseline diff，跳 vitest）。`git commit -n` 跳本地，CI 仍会拦。

时间预算：
- guard ≈ 30 秒
- tsc ≈ 1-2 分钟
- vitest ≈ 38 秒（Sprint 1 砍到 29.8s；D-1.a/b 加 5 个 snapshot 测试 + 本地环境波动后稳定在 37.7s）
- 总耗时 ≈ 3-4 分钟（含 npm ci + checkout）

### 后续升级（D-2 完成后）

- 加 4 条新 guard（GUARD-07/08/09/10）跑通
- 把 vitest 耗时纳入硬门禁（当前为提示，建议 45s 红线变成失败条件）
- Phase E 之前增加 `pnpm install` / `pnpm build` 的 dryrun workspace check（G4）

---

## 8. 已知例外 / 长期债务（M4 期间不归零，Sprint 2-5 转机会主义清理）

| 项 | 当前数字 | 处置 |
|----|---------|------|
| tsc 全量错误 | **526** | Sprint 1 已砍 1601 → 526（-67%）；剩余分布：ai-ppt 94 / context-manager 27 / knowledge-base 26 / runtime-kernel 24 / linnya 21 / 其余分散 277 / sheet/ui cascading 57 |
| tsc promptKey 残余 | **9** | M-1 收公共面后剩 host 端，R5 第二阶段消化 |
| vitest baseline 测试文件 fail | **9 / 384** | 全部为真业务 fail，详见 17-tech-debt-cleanup-plan.md |
| vitest baseline 测试用例 fail | **14 / 3282** | transcriptionMerger 5 / llmAuditContext 2 / agent registry 2 / 其余 5；M4 期间要求 ≤ 14，0 净增 |
| vitest baseline 耗时 | **37.7s** | 红线 45s（≈7s 缓冲）；超出说明引入慢测试 |
| Sprint 2-5 策略 | 机会主义清理 | 详见 17-tech-debt-cleanup-plan.md §11+§12；不专门做，谁碰到对应目录顺手清 |

---

## 9. 这份计划的责任分工

| 谁 | 责任 |
|----|------|
| **每个 PR 提交者** | 抓 PR baseline diff 三栏；本地跑对应套件；CI 红立即处理 |
| **PR reviewer** | 检查 PR 描述三栏齐全；检查改动范围是否对应 engine/07 的 T几/E几；任一门禁红拒绝 merge |
| **M4/M5 节奏看守者** | 维护 `.baseline/m4-summary.txt`；每完成一道门禁更新 status；Phase E E-1 前打 backup branch |

---

## 10. 状态

- [x] 第一轮草稿落地（2026-04-21）
- [x] guard / tsc 基线已抓（guard 0 / tsc 1601 / promptKey 14）
- [x] vitest 基线已抓（文件 1130：722 fail / 408 pass；用例 3785：80 fail / 3643 pass / 62 skip）
- [x] **Sprint 1+1.7 噪音债清理**（tsc 1601 → 526；vitest 722 → 9 file fail / 80 → 14 case fail；耗时 76.8s → 29.8s；详见 [17](./17-tech-debt-cleanup-plan.md)）
- [x] **CI workflow 上线**：直接跨过 ci_minimal 跑到 `ci_yes`（含 vitest gate + 动态读 baseline）
- [x] **本地 pre-commit hook 与 CI 同口径**（guard + tsc baseline diff，跳 vitest）
- [x] **PR1：engine/14 决策定稿**（D-1.a 真源就位，commit `723a7ea7`）
- [x] **PR2：D-1.a 实施**（4 个 sub `index.ts` 实现 + 顶层 index.ts 扩展）
- [x] PR3：D-1.b（package.json 草案）
- [ ] PR4+：engine/03 §7.1 T1-T6 → D-3 → D-4 → D-5 → Phase E

---

## 附录 A：相关 README 的"最小验证集合"汇总

各模块 README 已经列过自己的最小验证集合，本附录汇总，便于一处查阅：

### A.1 `src/agent/testkit/README.md` 列出的
- `src/agent/testkit/tool-fixtures/toolContext.test.ts`
- `src/app-hosts/linnya/testkit/agent-harness/__tests__/graphLoop.integration.test.ts`
- `src/app-hosts/linnya/testkit/agent-harness/__tests__/graphLoop.stepPolicy.test.ts`
- `src/tools/agent_control/subrun/shared/__tests__/subagentRunner.integration.test.ts`
- `src/tools/task/__tests__/task.failure-recovery.integration.test.ts`
- `src/tools/deep_research/__tests__/researchSubagentTools.harness.integration.test.ts`
- `src/app-hosts/linnya/adapters/realtime/__tests__/runtimeEventLifecycle.contract.test.ts`
- `src/agent/context-manager/profiles/agent/context/providers/__tests__/multiToolFollowup.integration.test.ts`

### A.2 `src/agent/runtime-kernel/graph-engine/README.md` 列出的
- 改 graph 主链：`graph-loop.integration` / `graph-loop.stepPolicy` / `graph-agent-executor.model-lock` / `graph-executor`
- 改节点：`nodes/__tests__/*`
- 改 pipeline：`tick-pipeline/__tests__/*` / `prepareCallStage.test.ts` / `middlewares/*.test.ts`

### A.3 `src/app-hosts/linnya/agent-registry/README.md` 列出的
- `agents/__tests__/taskAgents.test.ts`
- `agents/__tests__/slidesAgent.test.ts`
- `agents/__tests__/deepResearchAgents.test.ts`
- `agents/__tests__/mindmapWorkflowLeader.test.ts`
- `src/features/skills/__tests__/agentSkillExposure.test.ts`
- 涉及 child-run / tool 主链时再加：`subagentRunner.integration.test.ts` / `task.failure-recovery.integration.test.ts` / `researchSubagentTools.*.test.ts` / `deepResearchDataFlow.integration.test.ts` / `mindmapSubagentTools.test.ts`

### A.4 套件归属对照
- 套件 A 包含 A.1 前 1 项 + A.2 全部 + A.3 前 5 项
- 套件 B 包含 A.1 第 2-3 / 7-8 项 + A.2 全部
- 套件 C 包含 A.1 全部 + A.3 全部
- 套件 D 包含全部
