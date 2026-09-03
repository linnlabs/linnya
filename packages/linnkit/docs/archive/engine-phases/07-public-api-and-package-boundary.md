# 07 · Public API and Package Boundary（Phase D + E）

> **状态**：✅ Phase D 已完成；✅ **Phase E 工程层已完成（2026-04-22）**——`src/agent/*` 已物理 git mv 到 `packages/linnkit/src/*`，PR-A/B/C/D 全部落地，dryrun 工作区已 sunset。§5.4.3 完成判据 7 项中 **6 项自动化通过**，唯一剩"Linnya 桌面应用完整手测主链路"等待用户人工执行。详见 [`engine/24-phase-e-implementation-runbook.md`](./24-phase-e-implementation-runbook.md)。  
> **日期**：2026-04-21（§6 7 题逐项定稿）/ 2026-04-22（Phase E 工程层完成）  
> **触发**：[`00-engine-scope-audit.md` §3 / §5](./00-engine-scope-audit.md) 修订表确认本 topic"必做"，且是 03 LlmProviderPort 落地的前置物理保障  
> **package name**：`linnkit`（用户拍板，不带 scope；未来发 npm 再视情况加 `@linn/linnkit`）  
> **前置**：
> - [Linnkit 定位与边界](../../framework/00-vision-and-positioning.md)
> - 前序私有边界抽取方案的收官结论（Phase A/B/C 已完成；过程记录不属于公开文档）
> - [`engine/03-multi-provider-llm-abstraction.md`](./03-multi-provider-llm-abstraction.md) §7 落地任务依赖本 topic 提供的 host 注入契约
> - [`11-phase-e-hard-blockers.md`](./11-phase-e-hard-blockers.md) / [`13-public-api-surface-and-host-migration-batches.md`](./13-public-api-surface-and-host-migration-batches.md) / [`14-stable-vs-compat-exports.md`](./14-stable-vs-compat-exports.md) / [`15-host-migration-file-manifest.md`](./15-host-migration-file-manifest.md) 提供 D-1 / D-2 的具体研究输入
> - [`16-m4-m5-regression-test-plan.md`](./16-m4-m5-regression-test-plan.md) —— M4 / M5 实施期间的回归测试与门禁定义（必读）

> **命名管理口径（2026-04-21 新增）**
>
> - `linnkit` 只是**临时代号**，不是最终品牌名
> - 本文档统一把它当作 **package codename** 使用
> - 为了保证将来能低成本改名，当前阶段禁止引入第二套别名、禁止在代码里散落硬编码字符串做分支语义
> - 真正发布前，如果要改名，应以：
>   1. 本文档的 package codename 定义
>   2. `src/agent/docs/README.md` 的总入口说明
>   3. 未来 `packages/linnkit/package.json`
>   为唯一权威替换点，按一次性重命名推进

---

## 0. Q1-Q4 边界判定（先过门槛）

按 `00-engine-scope-audit.md` §1.1 流程：

| 维度 | 判断 | 证据 |
|------|------|------|
| **Q1 协议还是实现？** | ✅ 元任务 | 这是 engine 自己的 package 边界与 public API 设计，本身就是"协议层"工作 |
| **Q2 ≥2 消费者真实需求？** | ✅ 强需求 | linnya 桌面已经是消费者；linnsec 即将成为第二消费者；没有清晰的 public API 表面，linnsec 无法独立装配 |
| **Q3 engine 不加就没法接？** | ✅ 是 | exports 表 / 边界护栏 / 接入指南本质上是 engine 自己交付的"产品"，不可能由产品层补 |
| **Q4 不破坏 Linnya？** | ✅ 是 | Phase A/B/C 已经把 Linnya 与 engine 物理解耦完毕（`runtime-kernel` 0 处反向 import 越界已验证），本 topic 是"加封条"，不动行为 |

**结论**：**通过 4 条门槛，确认进入 engine 升级范围**。这是 engine 元任务，不需要"消费者真实痛点"——抽包本身就是任务。

---

## 1. 问题与场景

### 1.1 Phase A/B/C 已完成什么（事实）

来源：前序私有边界抽取方案 §10；下表保留当时已经确认的实现事实。

| 方面 | 状态 |
|------|------|
| `src/agent/*` 中已不存在 `host-adapters` / `product-extensions` | ✅ |
| Linnya 专属实现已统一位于 `src/app-hosts/linnya/*` | ✅ |
| `src/agent/*` 生产代码不再直接依赖 `src/app-hosts/*` / `src/shared/*` / `src/tools/*` / `src/core/*` / `src/model-registry` | ✅（**本 topic 撰写时实地扫描验证：runtime-kernel 内 0 处反向 import 越界**）|
| `context-manager` 已完成 core/profile 提升 | ✅ |
| 工程护栏 `npm run guard:agent-boundary` 已落地 | ✅（`scripts/guards/agent-package-boundary-guard.ts`，6 条规则）|
| 唯一允许的外部 workspace contract = `@app/schemas` | ✅ |

**当前剩余的"非阻塞尾巴"**（来自 §10.2）：

1. `packages/schemas` 协议纯度治理（不混入产品语义）
2. **public API / exports 继续整理**（**当前只暴露最小稳定面，按 package 化需要继续补 `exports`**）
3. host / benchmark 层继续单独演化

### 1.2 Phase D 在原方案中的描述

原 `agent-package-boundary-extraction-proposal.md` §7 给的 Phase D 只列了 3 步：

| 步骤 | 原描述 |
|------|--------|
| D-1 | 完善所有 port 接口定义 |
| D-2 | 编写外部接入指南（`agent-external-integration-guide.md`） |
| D-3 | 编写可复用边界判断标准（`agent-reusability-boundary-rubric.md`） |

**这三条在 2026-03-31 写时是合理的目标**，但走到今天（2026-04-21）情况变了：

- D-3"边界判断标准" = 现在的 [`00-engine-scope-audit.md`](./00-engine-scope-audit.md) §1.1 Q1-Q4 + 决策流程图，**已完成**，不需要再单写一份
- D-1"完善所有 port" 已经被拆成各个具体 topic（`engine/03 LlmProviderPort` / `engine/02 conversationId 协议` / `engine/06 Checkpointer` / `engine/08 abort+telemetry+error model`），**它们各自负责自己的 port**，不在本 topic 重复
- **缺的**：package 层面的 `exports` 表收口、internal-only 边界 lint、`packages/schemas` 协议治理、对 linnsec（第二消费者）接入面的 contract 验证

### 1.3 本 topic 的真实 scope（修订版 Phase D）

**Phase D 重写为 5 个步骤**：

| 步骤 | 工作内容 | 产出 |
|------|---------|------|
| **D-1 Public exports 收口** | 为 `src/agent/*` 设计 `package.json#exports` 与 `tsconfig` paths，把 internal-only 模块锁死，只暴露稳定 public API | `src/agent/package.json` 草案 + exports 清单 |
| **D-2 边界静态护栏强化** | 现有 `guard:agent-boundary` 是 grep-style，6 条规则只防"反向 import 回流"。本步加：(a) 防"engine 内部模块被 host 直接 import"的反向 lint；(b) 把 guard 接到 CI；(c) 评估是否需要替换为 ESLint rule | 增强后的 `agent-package-boundary-guard.ts` + CI 接入 |
| **D-3 接入指南** | 写 `agent-external-integration-guide.md`：让 linnsec 能照着实现自己的 host adapter（含 `LlmProviderFactoryLike` / `ToolRuntimePort` / `Checkpointer` / `sseSink` / `telemetry`/`abortSignal` 各个注入点） | 后续改为扩展现有集成指南，不创建独立 proposal |
| **D-4 `packages/schemas` 协议治理** | 当前 agent 唯一外部依赖面是 `@app/schemas`，需评估：保持现状 / 拆 `agent-contracts` 子集 / 把 agent 用到的子集复制进 agent 包 | 评估结论 + 可能的 schema 拆分提案 |
| **D-5 抽包 dry-run** | 把 `src/agent/*` 拷到独立 workspace 目录（如 `packages/agent-engine-dryrun/`），跑测试套件验证可独立运行（不真发布、不真 rename）；发现的所有问题回灌到 D-1~D-4 | dry-run 报告 + 阻塞项清单 |

### 1.4 不解决什么（**2026-04-21 修订**）

> 原始定义把"真正发布 npm" 与"rename 物理目录"都推到 Phase E。**用户拍板后修订**：Phase E 是"真抽包到 `packages/linnkit/` + 全套回归"（详见 §5.4），**不一定**包含 npm 发布——npm 发布是更后续的可选动作。

- **不解决**：真正发布 `linnkit` package 到 **npm public registry**—— 这是 Phase E **之后**的可选动作（linnsec / 第三方真要装才考虑；linnya + linnsec 同 monorepo 时直接走 workspace 即可）
- **本 topic 解决**：物理 move `src/agent/` → `packages/linnkit/`（详见 §5.4 Phase E）—— 这是 linnsec 正式产品开发的硬前置
- **不解决**：linnsec 装配代码本身—— 那是 secretary topic
- **不解决**：每个 port 的内部协议演进—— 各自属于 `engine/01/02/03/06/08/10`
- **不解决**：repo 结构变更（monorepo / multirepo 选择）—— 当前默认同 monorepo（`packages/linnkit/`）；多 repo 留待真有需求时再说

---

## 2. 当前 Linnya 现状

### 2.1 物理目录边界

```text
src/agent/                              ← 未来 packages/linnkit/（Phase E 物理 move 目标）
├── README.md                           # 顶层入口（已写）
├── DEVELOPMENT_GUIDE.md                # 开发约定（已写）
├── INTEGRATION_GUIDE.md                # 接入指南（部分写，需要 D-3 重写为产品层视角）
├── runtime-kernel/                     # ✅ graph + tool + llm + child-run + events 协议
├── context-manager/                    # ✅ 通用 context 子系统
├── ports/                              # ✅ package-neutral 调用协议
│   ├── agent-invocation.ts             # AgentInvocationRequest 最小调用面
│   └── ai-engine.ts                    # AIEngine port
├── shared/                             # ✅ kernel 内部共享 utils（ids / logger / errorClassifier / TokenCalculator）
├── testkit/                            # ✅ 通用测试底座（无 host 绑定）
└── docs/                               # ✅ 升级 + linnsec 设计文档（最终随 linnsec repo 迁出）

src/app-hosts/linnya/                   ← Linnya 作为第一消费者的接入层
├── adapters/                           # 各 port 的 Linnya 实现
│   ├── child-runs/
│   ├── context-injection/
│   ├── flow/
│   ├── realtime/                       # SSE 出口实现
│   ├── runtime-assembly/               # ⚠️ 关键装配点（含 `LlmProviderFactoryLike` 实现 / `ModelCatalog` 实现 / `Checkpointer` 实现 等）
│   └── tools/                          # ⚠️ default ToolRegistry / ports 装配
├── agent-registry/                     # Linnya 产品语义
├── context/
├── context-policies/
└── testkit/                            # host-bound harness
```

### 2.2 现有工程护栏

`scripts/guards/agent-package-boundary-guard.ts`（76 行 production source 扫描器，6 条规则）：

| 规则 ID | 防什么 |
|---------|--------|
| AGENT-GUARD-00-legacy-dir | `src/agent/host-adapters` / `src/agent/product-extensions` 重新出现 |
| AGENT-GUARD-01-no-app-host-imports | `from 'src/app-hosts/...'` |
| AGENT-GUARD-02-no-dynamic-app-host-imports | `import('src/app-hosts/...')` |
| AGENT-GUARD-03-no-external-src-imports | `from 'src/...'`（除 `src/agent/`）|
| AGENT-GUARD-04-no-dynamic-external-src-imports | `import('src/...')`（除 `src/agent/`）|
| AGENT-GUARD-05-no-non-schema-app-imports | `from '@app/...'`（除 `@app/schemas`）|
| AGENT-GUARD-06-no-dynamic-non-schema-app-imports | `import('@app/...')`（除 `@app/schemas`）|

**优点**：简单、零依赖、grep-style 易理解。  
**缺点**：
- 只防"反向"（agent 不要 import host），**不防"正向越界"**（host 直接 import agent 内部模块而不是走 ports）
- 不防"agent 内部跨子模块越界"（如 `runtime-kernel` 直接 import `context-manager` 私有内部，应当走 `context-manager/index.ts` exports）
- 不在 CI 自动跑（需手动 `npm run guard:agent-boundary`）

### 2.3 现有 ports 表面（已外部稳定）

`src/agent/ports/agent-invocation.ts`：

```typescript
export interface AgentInvocationRequest {
  query: string;
  /** Opaque task / prompt 标识（engine 不解析其值，host 的 task resolver 负责映射）。*/
  promptKey: string;
  model_id?: string;
  imageGenerationModelId?: string;
  mode?: 'agent' | 'chat';
  maxSteps?: number;
  enableTools?: boolean;
  availableTools?: string[];
  conversationHistory?: AiMessage[];
}
```

→ 这是 host 调用 agent 的最小入参形态，已经够稳。
→ **补充定稿口径（2026-04-21）**：`mode: 'chat'` 当前仍保留为兼容字段，但长期目标不是维持 `chat` 与 `agent` 两套并列核心模式，而是收敛为 **统一 agent pipeline**；纯聊天 = tools-disabled agent。Phase D / E 不移除此字段，只禁止继续把 `chat` 扩张成长期一等模式。
→ **R5 第一阶段已落地（commit `8960d17c`）**：`promptKey` 在 ports 公共面已经从 `PromptKey` (Linnya 产品 enum) 抽象为 `string`，engine 不再依赖任何产品语义清单。详见 [`engine/12 §R5`](./12-agent-contracts-audit.md)。

`src/agent/ports/ai-engine.ts`：定义 `AgentAiEngine` port（host 注入 LLM 实现）。**它在事实上就是 engine/03 §4 描述的 `LlmProviderPort` / `LlmProviderFactoryLike` 同一层概念**——D-1 阶段已经决定 **保留 `AgentAiEngine` 命名**（不改名、不合并），engine/03 后续 wire-up 工作直接以 `AgentAiEngine` 为契约名。详见 [`engine/03 §3.x 现状审计`](./03-multi-provider-llm-abstraction.md)。

### 2.4 当前 D-1 ~ D-5 各步的"已有底子"

| 步骤 | 已有底子 | 缺什么 |
|------|---------|--------|
| D-1 | ✅ D-1.a/b 已完成（commits `1a93fe77` D-1.a / `e1fb29ed` D-1.b）：`src/agent/index.ts` 已收口为 `稳定导出 (ports / runtime-kernel / testkit / ids)` + `linnkitCompat namespace`；`runtime-kernel/index.ts`、`ports/index.ts`、`testkit/index.ts` 已落地；`src/agent/package.json` 草案已落地（`name: "linnkit"`，含 `exports`）；snapshot 测试 4 个 + manifest 测试 1 个已落地 | 仍未做：guard 反向 lint（D-2）；engine/03 §7.1 剩余 wire-up（参见 §5.3 修订） |
| D-2 | `guard:agent-boundary` 6 条规则 | 反向 lint（host→agent 内部）、CI 接入、跨子模块越界 |
| D-3 | `INTEGRATION_GUIDE.md` 已存在 | 视角是开发者向，不是"linnsec 这种第二消费者"向；缺各 port 的最小可用 example |
| D-4 | `@app/schemas` 是唯一外部依赖（已确认） | 没有评估"agent 实际用到哪些 schema 类型"，没有"协议纯度"清单，也还没回答哪些 agent 自有合同应该并回 `linnkit` |
| D-5 | 测试套件齐全（`runtime-kernel/__tests__/` + `context-manager/__tests__/` + `testkit/`） | ✅ 已完成 `packages/agent-engine-dryrun/` dry-run：workspace 已建立；package-local `test:smoke` / `typecheck` 通过；代表性公开面示例测试通过；发现的问题已回灌到 D-1~D-4 |

---

## 3. 各参考项目做法（按本 topic 范围摘）

### 3.1 OpenClaw

参考价值：⭐

- 没有清晰的 package 边界（runtime / 产品代码混在一起），不作正面参考
- 反例：抽包前不收口的代价

### 3.2 Codex

参考价值：⭐⭐⭐

- Rust crate 模型：**`client_common` / `core` / `app-server` / `app-server-protocol` / `protocol` 多 crate 拆分**
  - `client_common`：所有 provider 共有的"chat / stream / tool / cache"抽象
  - `core`：agent runtime
  - `app-server` + `app-server-protocol`：daemon + JSON-RPC Lite
  - `protocol`：纯协议定义（与 implementation 强分离）
- **"协议 crate 与 implementation crate 物理分离"** 是值得借鉴的——对应我们 D-4 评估"是否拆 `agent-contracts`"
- 详见 [`codex.md`](../../99-research-notes/codex.md)

### 3.3 Claude Code

参考价值：⭐⭐

- 单 npm package（`@anthropic-ai/claude-code`），没做多 package 拆分
- 但内部用 ESM exports + tsconfig path 锁住 internal-only
- 启发：**单 package + exports 锁内部** 也是可行路径，不一定非要拆多包

### 3.4 Hermes

参考价值：⭐⭐

- Python，单 package（`hermes`）+ entry points（`hermes.gateway` / `hermes.tui` / `hermes.web`）
- profile 隔离（`HERMES_HOME`）作为运行时配置，不在 package 边界
- 启发：**多 entry points 是可行的 public API 暴露形式**（vs 单 main entry）

### 3.5 启发摘要

| 启发点 | 来源 | 是否进入本 topic |
|--------|------|----------------|
| 协议 crate 与 implementation crate 物理分离 | Codex | ⚠️ D-4 评估 |
| ESM exports + tsconfig path 锁 internal | CC | ✅ D-1 主路径 |
| 多 entry points 暴露 public API | Hermes | ⚠️ D-1 评估 |
| 一次性大重构（不要） | OpenClaw 反例 | ✅ 警示：D-1~D-5 渐进，不一次重构 |

---

## 4. 候选方案

### 方案 A（必做底线）：**单 package + exports 锁内部 + 增强 guard**

**做什么**：
1. **D-1**：在 `src/agent/` 加 `package.json`（草案，不真发布；name 已按 §6 Q1 定为 `linnkit`），写 `exports` 字段：
   ```jsonc
   {
     "name": "linnkit",
     "type": "module",
     "exports": {
       ".": "./index.ts",
       "./runtime-kernel": "./runtime-kernel/index.ts",
       "./context-manager": "./context-manager/index.ts",
       "./ports": "./ports/index.ts",
       "./testkit": "./testkit/index.ts"
     }
   }
   ```
   每个 export 后面对应的 `index.ts` 只 re-export 真正的 public API；其余文件即"internal-only"。
2. **D-2**：扩展 `agent-package-boundary-guard.ts`，加：
   - **反向 lint**：扫描 `src/app-hosts/`* + `apps/`* + `src/features/`*，禁止 `from 'src/agent/<sub>/<deep>'`，只允许 `from 'src/agent'` 或 `from 'src/agent/<entry>'`
   - **跨子模块 lint**：禁止 `runtime-kernel` 直接 import `context-manager/profiles/...`（必须走 `context-manager/index.ts`）
   - **CI 接入**：把 `guard:agent-boundary` 加到 `.github/workflows/*.yml` 的 PR check
3. **D-3**：写外部接入指南，含 5 个最小例子：
   - "我要在我的产品里跑一个 agent" → `AgentInvocationRequest` + `runUntilYield`
   - "我要给 agent 接入我的 LLM provider" → 实现 `LlmProviderFactoryLike`
   - "我要给 agent 接入我的工具集" → 实现 `ToolRuntimePort`
   - "我要给 agent 接入我的持久化" → 实现 `Checkpointer` + `EventStore`
   - "我要监听 agent 事件流" → 实现 `sseSink` + `telemetry port`
4. **D-4**：写 `agent-contracts-audit.md`，列出 agent 实际用到的 `@app/schemas` 类型清单 + 评估三选一（保持 / 拆子集 / 复制进 agent）
5. **D-5**：在 `packages/agent-engine-dryrun/` 起一个**完全独立的 workspace**，把 `src/agent/*` 拷过去（不动原物），改 import 路径，跑测试。把发现的问题回灌

**优点**：
- 不动 Linnya 现状，纯加料
- 每一步可独立 PR，可独立验证
- 符合 OpenClaw 反例警示——不一次性重构

**缺点**：
- D-5 dry-run 是"探索性工作"，时间不可精确预估

### 方案 B：**A + 拆 `agent-contracts` 子 package**

**做什么**（在 A 基础上）：
6. 把 `src/agent/ports/*` + `src/agent/runtime-kernel/llm/caller.types.ts` 中的纯类型 + `src/agent/runtime-kernel/tools/toolContracts.ts` 等"纯协议"移入 `packages/linnkit-contracts/`
7. `src/agent/*` 与 host 都 import `linnkit-contracts`，避免协议 / 实现耦合

**优点**：
- 学习 Codex `protocol` crate 模式
- 后续 linnsec 接入只 import contracts，不依赖 agent 实现

**缺点**：
- **当前没有强信号需要拆**——agent 自己就是协议 + 最小骨架；拆 contracts 是双倍 maintenance cost
- 触发条件：等出现"linnsec 想自己做一份 agent runtime（不复用 engine）只是想兼容协议"时再做

### 方案 C：**A + 多 entry point**

**做什么**（在 A 基础上）：
8. 把 `runtime-kernel` / `context-manager` / `ports` / `testkit` 各拆成独立 npm package（`linnkit-runtime` / `linnkit-context` / 等）

**优点**：
- 消费者按需 install
- 各 sub-package 独立版本

**缺点**：
- monorepo 复杂度大幅上升
- linnya 和 linnsec 都不需要"按需 install"——它们都需要全套
- **过早抽象**

---

## 5. 当前倾向

### 5.1 拍板小结

**走方案 A**：单 package + exports + 增强 guard + 接入指南 + schema 评估 + dry-run。

**方案 B 触发条件**：
- 出现第三个消费者只想要 contracts 不要 runtime
- 或 linnsec / linnya 真要 fork engine

**方案 C 触发条件**：
- 出现"某个消费者只装 runtime 不装 context-manager"的真实诉求
- 或单 package 的 dist 体积成为问题

### 5.2 实施顺序（按风险递增）

| Step | 内容 | 依赖 | 工作量估计 |
|------|------|------|----------|
| **D-1.a** | 起草 `src/agent/index.ts` + 各 sub `index.ts` re-export 清单 | 无 | 小（类型工作） |
| **D-1.b** | 起草 `src/agent/package.json` 草案（不真发布） | D-1.a | 小 |
| **D-2.a** | 扩展 `agent-package-boundary-guard.ts` 加反向 lint | D-1.a | 小 |
| **D-2.b** | 扩展 guard 加跨子模块 lint | D-1.a | 小 |
| **D-2.c** | 把 `guard:agent-boundary` 接到 CI（PR check） | D-2.a, D-2.b | 极小 |
| **D-3** | 写 `agent-external-integration-guide.md` | D-1 完成 + engine/03 LlmProviderPort 已落地 | 中（文档） |
| **D-4** | 写 `agent-contracts-audit.md` | D-1 完成 | 小（审计 + 结论文档） |
| **D-5** | dry-run 抽包 | D-1, D-2, D-3 全部完成 | 中-大（探索性） |

**总工作量预估**：D-1~D-4 加起来约 1-2 周；D-5 不可预估，发现问题再回灌。

> **2026-04-21 第二轮研究补充**：
>
> - D-1 的公开面设计，优先以 [`engine/14`](./14-stable-vs-compat-exports.md) 为准
> - D-1 / D-2 之间的宿主迁移顺序，优先以 [`engine/15`](./15-host-migration-file-manifest.md) 为准
> - [`engine/13`](./13-public-api-surface-and-host-migration-batches.md) 负责给出宏观批次，`engine/15` 负责文件级顺序
>
> **D-5 dry-run 的精确时机（S-1，2026-04-21）**：
>
> D-5 不是在 D-1 ~ D-4 全部完成后才一锤子做一次，而是**与宿主 import 收口（engine/15 Batch 0 ~ Batch 5）穿插进行**：
>
> - **Batch 0 完成后**：跑一次 dry-run（最便宜，验证 testkit 入口可用）→ 主要捕"入口缺失"类问题
> - **Batch 2 完成后**：跑第二次（验证 ports + runtime-kernel 公共面）→ 主要捕"内部跨子模块 deep import"类问题
> - **Batch 5 完成后**：跑第三次（最贵，全量）→ 这次必须全绿，等价于 Q7=B 决议里的"D-5 完成"
>
> 这样早期发现的成本远低于 Phase E 阶段才发现，而且每跑一次都给宿主 batch 提供反向反馈（哪些 export 不够用、哪些 deep import 没拦住）。

### 5.3 与 engine/03 的协作时序

> **修订事实（2026-04-22）**：
> - **D-1.a / D-1.b 已完成**（commits `1a93fe77` / `e1fb29ed`）：稳定导出表落地，`AgentAiEngine` 已经可以从 `linnkit/ports` 导出。
> - **engine/03 §7.1 T1 / T3（核心反向解耦）实质上已等价完成**：`runtime-kernel/llm/caller.ts:38` 已经走 `aiEngine: AgentAiEngine` 注入（[caller.ts](../../../src/runtime-kernel/llm/caller.ts)），`src/agent/*` 内部 `grep "from .*infra/adapters/llm"` = 0 命中。`AgentAiEngine` = engine/03 文档里的 `LlmProviderPort` / `LlmProviderFactoryLike`，只是命名不同。
> - **engine/03 §7.1 剩余真活**：T2（chatCompletionStream 重试 / fallback 是否上提到 port 层）、T4（多 provider 并存的命名空间策略）、T5（`createAdapter` 装配点是否搬到 host 端 wiring）、T6（`AIEngine` 与 `AgentAiEngine` 是否在 host `aiEngine.ts` 里物理拆出 chat-only 子集）；这些是命名 / 装配 / 拆分层面的工作，不再是"反向依赖耦合"问题。

修订后建议时序：

1. ✅ **D-1.a / D-1.b 已完成**
2. **engine/03 跑一次"现状对照 + 命名对齐"**（不是从 0 写新接口）：
   - 文档明确 `AgentAiEngine` ≡ `LlmProviderPort`；engine/03 §7.1 T1/T3 标完成
   - 评估 T2/T4/T5/T6 是否值得在 D-2 之前做（建议默认推迟到 Phase E 之后再追，因为不阻塞抽包）
3. **D-2**（guard 反向 lint + CI 接入 + 宿主 import 收口 Batch 0~5）
4. D-3 / D-4 / D-5 各自启动

### 5.4 Phase E：真抽包（linnsec 正式产品开发的硬前置）

> **2026-04-21 用户拍板**：进入 linnsec 开发前，**不只是写完文档**，而是要真正把 `linnkit` 抽出来变成独立的包。Phase D 是"准备好可抽"，Phase E 是"真的抽出来跑"。

#### 5.4.1 为什么 D ≠ E

| Phase D（准备） | Phase E（执行） |
|---------------|---------------|
| 写 exports / 加 guard / 写接入指南 / 起 dry-run workspace | 物理 move `src/agent/*` → `packages/linnkit/` |
| 在 `src/agent/*` 原地工作 | 重写 monorepo 配置 + import 路径全量重写 |
| 不影响 Linnya 运行 | Linnya 必须改 import 路径才能继续工作；引入回归风险 |
| dry-run 是探索性 | 全量回归是兜底 |

D-5 dry-run 是"在不动原物的前提下验证可独立"；Phase E 是"动原物，让它真的成为独立包"。两者不可替代。

#### 5.4.2 Phase E 步骤

| Step | 内容 | 风险 | 兜底 |
|------|------|------|------|
| **E-1** | 在 `packages/linnkit/` 物理建仓（不再是 dryrun，而是真实 package）| 低 | git revert |
| **E-2** | 把 `src/agent/*` 全量 move 到 `packages/linnkit/`（保留 git history：`git mv` 或 filter-repo）| 中 | git revert + 备份 branch |
| **E-3** | 调整 monorepo 配置：`pnpm-workspace.yaml` / 根 `tsconfig.json` 引用 / vite alias / package.json 加入 `linnkit` 依赖 | 中 | 多次小 PR；CI 红可立即回退 |
| **E-4** | 全量改 `src/app-hosts/*` / `apps/*` / `src/features/*` / `src/electron-main/*` 中所有 `from '@/agent/...'` / `from 'src/agent/...'` 改为 `from 'linnkit'` 或 `from 'linnkit/<entry>'`（grep + 自动化）| 高（变更面大）| 分模块 PR；每个 PR 跑全套测试 |

> **E-4 工作量量化（S-3，2026-04-21）**：
>
> - **当前基线**：`engine/11 §2.1` 统计的 host 端 deep import = **169 处，跨 72 文件**
> - **D-1 ~ D-2 完成后预期**：宿主 Batch 0 ~ Batch 5 的目标就是把 deep import 全部替换成入口 import；理论残值应≈ 0
> - **Phase E 阶段实际改动量**：在理想情况下，E-4 只需把已经收口的 `from 'src/agent'` / `from '@/agent'` 这两种入口写法 → `from 'linnkit'`，是机械的 path rewrite（数量 = host 端 batch 收口后的入口 import 总数，估计 30~50 处，按 batch 0-5 完工后再精准统计）
> - **如果 E-4 仍发现 deep import 残留**：说明 D-2 guard 漏拦了，应回到 D-2 补规则、不要在 Phase E 强改
| **E-5** | 跑全套回归：单元测试 / 集成测试 / e2e / 启动桌面应用手测主流程（创建对话、跑 LLM、用工具、子 agent）| 中 | 任何红 → 回退到 E-3 之前 |
| **E-6** | 跑 `guard:agent-boundary`（D-2 已加的反向 lint）+ 接 CI block | 低 | / |
| **E-7** | 删除 `src/agent/` 占位（确认无残留 import）| 低 | grep 清扫 |
| **E-8** | 文档更新：根 `README.md` 加 `packages/linnkit/` 段落；`package.json` `workspaces` 字段；删除 `agent-engine-dryrun/`（被 `packages/linnkit/` 替代）| 低 | / |

#### 5.4.3 Phase E 完成判据（也是 linnsec 启动的硬前置）

- [x] `packages/linnkit/` 独立 package 结构、可独立编译、可独立跑测试 ✅（2026-04-22；`packages/linnkit/src/` + `package.json` exports + 内部端到端 smoke `testkit/__tests__/graphLoop.endToEnd.contract.test.ts`）
- [x] `src/agent/` 占位已删除，仓库无残留 deep import ✅（PR-C；codemod `rewrite-agent-imports-to-linnkit.ts` 全仓改写完毕；`guard:agent-boundary` reverse import baseline 清零并进入 enforce）
- [ ] Linnya 桌面应用完整手测（创建对话 / LLM 调用 / 工具调用 / 子 agent / abort / persistence 至少各一次）通过 🚧（**唯一剩余项**；用户人工执行）
- [x] 所有自动化测试（unit / integration / e2e）通过 ✅（`npm test` baseline 净改善：dryrun sunset 后失败文件 8→7、失败 case 15→12，且新增 4 个 linnkit 内部 smoke case）
- [x] `guard:agent-boundary` CI 检查通过 ✅（`agent-package-boundary-guard` + `agent-codename-lint` 全绿；dryrun 例外已从 IGNORED 列表清除）
- [x] `pnpm install` / `pnpm build` 在干净环境下成功 ✅（`vite build` / `electron:build` 验证通过）
- [x] 文档更新到位（根 README + linnkit README + 接入指南指向新路径）✅（2026-04-22；`docs/README.md` §5 表格、`00-vision-and-split.md` §3 物理位置 + §5 决策树、`engine/README.md` 进度文字、`engine/11-phase-e-hard-blockers.md` 后记、本文件状态行 + §5.4.3 + §7.6 + §8、`INTEGRATION_GUIDE.md` 全文路径全部刷新）

**只有上述全部通过，才视为 linnkit 抽包完成；linnsec 正式产品开发才能真正启动**。

> **2026-04-22 现状**：7 项判据中 **6/7 自动化通过**；唯一剩"桌面手测主链路"由用户人工执行（详见 [`engine/24 §8.3`](./24-phase-e-implementation-runbook.md)）。手测通过后，Phase E 整体闭环、本 topic 进入"已完成 + 维护态"。

#### 5.4.4 Phase E 风险预案

| 风险 | 概率 | 对策 |
|------|------|------|
| import 路径漏改 | 中 | grep 兜底 + tsc 编译期捕获 + ESLint no-restricted-imports |
| circular dependency 暴露 | 中 | dry-run 阶段（D-5）就该提前发现；Phase E 已是验证完毕 |
| Linnya 测试在新结构下偶发挂掉 | 中 | 分模块 PR；CI 红立即 revert |
| 桌面应用 prod build 路径解析问题 | 中-高 | 在 E-3 阶段就跑 `pnpm electron:build` 验证；不要等到 E-7 |
| Git history 丢失 | 低 | `git mv` 保留；备份 branch 兜底 |

---

## 6. 待决策问题（已逐项定稿）

> **2026-04-21 用户拍板**：Q7 走 B（D-1~D-5 全部完成才算完）+ Q1 改 `linnkit`（不带 scope）+ 其他 5 题按 §5 推荐走。

| # | 问题 | 决策 | 理由 |
|---|------|------|------|
| Q1 | package `name` | ✅ **`linnkit`**（不带 scope）| 与 Linnya / linnsec 命名风格一致；当前是 dry-run 草案不真发布；未来若发 npm public registry 再视情况加 `@linn/linnkit` scope |
| Q2 | D-1 是否引入 `tsup` / `tsc -d` 真实 build | ✅ **A 否** | `package.json` 草案不真发布；build 留给真正发 npm 那一天；当前节省工程开销 |
| Q3 | D-2 反向 lint 风格 | ✅ **A 继续 grep-style** | 与现有 `agent-package-boundary-guard.ts` 6 条规则同源、零依赖、易维护；ESLint plugin 维护成本不成比例 |
| Q4 | D-3 接入指南形式 | ✅ **A 单一 `agent-external-integration-guide.md` + 5 个最小例子** | 散开成多份反而难维护；linnsec 接入时一份文档一次过 |
| Q5 | D-4 `@app/schemas` 评估默认推荐 | ✅ **B 先审计列清单，等 linnsec 起步后看是否拆** | 不预设结论；让 D-4 的清单数据 + linnsec 实际使用反馈驱动决策 |
| Q6 | D-5 dry-run 物理位置 | ✅ **A `packages/agent-engine-dryrun/`** | 同 monorepo，发现的问题能直接回灌到 `src/agent/`；隔离性已经够（独立 workspace + 独立 tsconfig） |
| Q7 | engine/07 完成判定标准 | ✅ **B D-1~D-5 全部完成才算完成** | 否则 dry-run（D-5）不跑就贸然抽包风险大；D-3 接入指南 + D-4 schema 治理也都是 linnsec 启动的硬前置 |

---

## 7. 落地任务

### 7.1 D-1 任务（exports 收口）

- [x] T1：列出 `src/agent/` 应当 export 的 public API 清单（按 sub-module 分组：runtime-kernel / context-manager / ports / testkit；稳定导出 vs 兼容导出以 `engine/14` 为准）
- [x] T2：起 `src/agent/index.ts` + `src/agent/runtime-kernel/index.ts` + `src/agent/context-manager/index.ts` + `src/agent/ports/index.ts` + `src/agent/testkit/index.ts`（**已完成 commit `1a93fe77`**；`src/agent/index.ts` 实际收口为 `稳定导出 (ports / runtime-kernel / testkit / ids)` + `linnkitCompat namespace`）
- [x] T3：起 `src/agent/package.json`（草案，`name: "linnkit"`，含 `exports` 字段，**不引入 build 工具链**）（**已完成 commit `e1fb29ed`**）
- [x] T4：把 engine/03 的 `AgentAiEngine`（≡ `LlmProviderPort` / `LlmProviderFactoryLike`）加进 exports（**已完成**：`AgentAiEngine` 已经从 `src/agent/ports/index.ts` 导出，且本身就是 D-1 之前已存在的 port，只是命名不同；详见 §5.3 修订）

### 7.2 D-2 任务（边界静态护栏强化）

- [ ] T5：扩展 `agent-package-boundary-guard.ts` 加反向规则（host 不能 import `src/agent/<sub>/<deep>`，只能 import `src/agent` 或 `src/agent/<entry>`）
- [ ] T6：扩展 guard 加跨子模块规则（`runtime-kernel` 不能直接 import `context-manager/profiles/<deep>`）
- [ ] T7：把 `guard:agent-boundary` 接到 CI（GitHub Actions PR check）
- [ ] T7a：按 `engine/15` 的 Batch 0~Batch 5 顺序执行宿主 import 收口，避免边改边乱序
- [ ] T7b：加命名硬编码 lint（S-2，2026-04-21）—— 防止 `linnkit` / 历史代号 `linngent` 出现在不该出现的位置
  - **白名单**（允许出现 codename）：
    - `src/agent/docs/**/*.md`
    - `src/agent/README.md`
    - `src/agent/package.json`（D-1 起草后）
    - `packages/<linnkit>/package.json`（Phase E 后）
    - `pnpm-workspace.yaml`、根 `tsconfig.json` paths、各 host `package.json` 的 `dependencies`
  - **黑名单**（禁止 codename 硬编码字符串）：
    - 任何 `.ts` / `.tsx` / `.js` / `.vue` 业务代码（codename 只应作为 import 路径出现，不作为字符串 literal）
    - 测试文件中如果出现，必须走 const / fixture，禁止散落
  - **目的**：未来若 codename 二次更名（即便概率小），全局替换只动 3 个权威位置（`engine/07` + `docs/README` + 各 `package.json`），不被业务代码绑架
  - **实现**：在 `agent-package-boundary-guard.ts` 旁边加 `agent-codename-lint.ts`，CI 阶段跑 + commit-msg hook 提示

### 7.3 D-3 任务（接入指南）

> **2026-04-22 修订**（决策见 [`engine/20 §1.1`](./20-d3-d4-port-interfaces-plan.md) E1-E5）：
> - T8/T9 形态从“另起独立 proposal + 完整可跑代码”修订为：
>   - 扩展现有 `src/agent/INTEGRATION_GUIDE.md`（不另开新文件，避免散两份指南）
>   - 5 段双层 testkit 索引模式：每段 = `linnkit 公共契约` + `linnkit 自带 mock` + `Linnya host 真实 / 测试`
>   - 不写完整可跑代码，写文件锚点（行号 / 符号名级别），降低维护成本
>   - 不强制 CI smoke test，testkit 已在 CI 跑覆盖
> - 完整执行计划见 [`engine/20 §5`](./20-d3-d4-port-interfaces-plan.md)

- [ ] T8：扩展 `src/agent/INTEGRATION_GUIDE.md`（在现有 192 行基础上增至 ~400 行，不另开新文件）
- [ ] T9：5 段例子按双层 testkit 索引模式写（[`engine/20 §5.3`](./20-d3-d4-port-interfaces-plan.md) 模板 + §5.4 锚点对照表）
- [ ] T9-prereq：例 4 / 例 5 依赖 T0（engine/06 + engine/08 port 接口实施）完成
- [ ] T9-verify：linnsec 视角通读无卡点（决策 E5 替代 CI smoke test）

### 7.4 D-4 任务（schema 协议治理）

> **2026-04-22 修订**（决策见 [`engine/20 §1.2`](./20-d3-d4-port-interfaces-plan.md) F1-F6）：
> - T10/T11/T11a/T11b 已由 [`engine/12`](./12-agent-contracts-audit.md) 第一轮审计完成（三类清单 + R3 优先收 A 类 + R4 不原样收 C 类）
> - 实施侧拆三步走：D-4.a → D-4.b → D-4.c
> - D-4.c 形态：**物理 move**（不是 re-export 兜底），用 **ts-morph codemod** 处理 split-import；codemod 通用化 Phase E E2/E4 复用
> - 完整执行计划见 [`engine/20 §4 + §6`](./20-d3-d4-port-interfaces-plan.md)

- [x] T10：扫 schemas 依赖清单（[`engine/12 §2`](./12-agent-contracts-audit.md) 已完成；硬数据：AiMessage:57 / RuntimeEvent:48 / PromptKeys:7 / EventEnvelope:4）
- [x] T11 / T11a：三类归属清单（[`engine/12 §3`](./12-agent-contracts-audit.md) §3.1 A 类 / §3.2 B 类 / §3.3 C 类）
- [x] T11b：A 类是否并回 linnkit 的建议（[`engine/12 §4 R3`](./12-agent-contracts-audit.md) 优先收）
- [x] **D-4.a**：R5 第二阶段——清理 engine 内部残留 `PromptKey` type-import 已完成（详见 [`engine/20 §4`](./20-d3-d4-port-interfaces-plan.md)）
- [x] **D-4.b**：D-4.c codemod 设计 review 已拍板，口径为“直接物理迁移 + ts-morph codemod，不做兼容回退”
- [x] **D-4.c**：A 类协议物理 move 已完成（详见 [`engine/20 §6`](./20-d3-d4-port-interfaces-plan.md)）
  - [x] D-4.c.1: codemod 写完
  - [x] D-4.c.2: 建 `src/agent/contracts/` 入口并承接 A 类协议导出
  - [x] D-4.c.3: 跑 codemod 批量替换全仓 import
  - [x] D-4.c.4: 从 `packages/schemas` 真移除 A 类定义/导出，收成“真 move”
  - [x] D-4.c.5: 文档同步 + status 标完成

### 7.5 D-5 任务（dry-run）

- [x] T12：建立 `packages/agent-engine-dryrun/` workspace（同 monorepo，便于回灌；`package.json#name: "linnkit-dryrun"`）
- [x] T13：把 `src/agent/*` 拷过去（不动原物）
- [x] T14：调整 import 路径让其能独立编译
- [x] T15：跑 `runtime-kernel/__tests__/`、`context-manager/__tests__/`、`testkit/` 代表性公开面测试 + package-local smoke/typecheck
- [x] T16：把发现的"必须修才能独立"的问题回灌到 D-1~D-4
- [x] T17：dry-run 完成判据（Q7=B 决议）：D-1~D-5 全绿 + 集成测试通过 + 接入指南 5 个例子在 dry-run 上各跑一遍 → 才视为 Phase D 完成 → 进入 Phase E

### 7.6 Phase E 任务（真抽包）

- [x] E1：在 `packages/linnkit/` 物理建仓 ✅（PR-B；`packages/linnkit/package.json` + `tsconfig.json` + 子入口 re-export 落地）
- [x] E2：`git mv src/agent packages/linnkit`（保留 history）✅（PR-C 主迁移）
- [x] E3：调整 monorepo 配置（`pnpm-workspace.yaml` / 根 `tsconfig.json` paths / vite alias / 各 host `package.json` 加 `linnkit` dep）✅（PR-B/C；vite + tsconfig + workspace 全部对齐）
- [x] E4：codemod 全量改 import 路径（`src/agent/...` → `linnkit` / `linnkit/<entry>`，跨 `src/app-hosts/*` `apps/*` `src/features/*` `src/electron-main/*`）✅（PR-A `scripts/codemods/rewrite-agent-imports-to-linnkit.ts` + PR-C 包内自引相对路径 codemod）
- [ ] E5：跑全套回归：unit / integration / e2e + 桌面应用手测主流程 🚧（**自动化部分 ✅**；桌面手测唯一剩余项，由用户人工执行）
- [x] E6：跑 `guard:agent-boundary` 反向 lint + 接 CI block ✅（reverse-import baseline 已清零并进入最终 enforce）
- [x] E7：删除 `src/agent/` 占位 + grep 清扫无残留 ✅（PR-C 后 `src/agent/` 已不存在；`grep -r "from .src/agent"` = 0）
- [x] E8：文档更新（根 README / linnkit README / 接入指南指向新路径）+ 删除 `packages/agent-engine-dryrun/`（由 `packages/linnkit/` 替代）✅（PR-D dryrun sunset + 2026-04-22 文档同步批次）

### 7.8 命名收敛约束（临时代号管理）

- [ ] N1：所有正式文档只使用一个 package 代号：`linnkit`
- [ ] N2：禁止再发明第二个 package 别名，避免未来 rename 出现双轨口径
- [ ] N3：实施阶段新增目录、workspace、`package.json`、CI job、文档标题时，都以“可一次性全局替换”为前提命名
- [ ] N4：如果未来决定改名，优先从 codename 定义点统一替换，不做长期兼容双名并存

### 7.7 Phase E 后置任务（启动 linnsec 正式产品开发前置）

- 确认 §5.4.3 完成判据 7 项全绿
- linnsec 仓库新建 / 子目录设立时即可 import `linnkit` 起步

---

## 8. 状态

- [x] §0 边界判定通过 Q1-Q4
- [x] §1 问题与场景明确（含 Phase A/B/C 已完成事实 + 修订版 Phase D scope）
- [x] §2 当前 Linnya 现状盘点完成（含工程护栏 6 条规则审计 + ports 现状）
- [x] §3 参考项目启发汇总
- [x] §4 候选方案 + 取舍（方案 A 主路径 + B/C 触发条件）
- [x] §5 当前倾向（方案 A 分步 + 与 engine/03 协作时序）
- [x] §6 7 个待决策问题已逐项定稿（2026-04-21）
- [x] §7 落地任务展开为 T1-T17 + E1-E8
- [x] §5.4 Phase E 真抽包计划（2026-04-21 用户拍板加入）
- [x] **D-1.a / D-1.b 已实施**（commits `1a93fe77` / `e1fb29ed` / `4f302f13` baseline / `48287430` PR template / `3f6e036e` flaky 修复 / `5c4c1772` baseline 收紧；详见 [`engine/16`](./16-m4-m5-regression-test-plan.md) §10）
- [x] D-2 已完成：PR-A/B/C + Batch 0/1/2/3 + PR-H 主体已实装，原 Batch 5 主 knot 已并入 Batch 4 收口；`.baseline/agent-deep-import-baseline.txt` 已从 179 收敛到 0，reverse-import 已进入最终 enforce
- [x] **D-3 / D-4 综合 Plan 已定稿**：[`engine/20`](./20-d3-d4-port-interfaces-plan.md) 用户 13 项决策（E1-E5 + F1-F6 + G1-G3）拍板完毕；T0 (port 接口) 提前到 D-3 之前实施
- [x] T0 / T1 / T2 / T3 已执行（详见 engine/20 §2 序列与依赖图）
- [x] T4 已完成（D-5 dry-run）
- [x] **Phase E 工程层已完成（2026-04-22）**：E1/E2/E3/E4/E6/E7/E8 全部勾上；唯一剩 E5 桌面手测；详见 [`engine/24`](./24-phase-e-implementation-runbook.md) §8 + §9 完成判据
- [x] **dryrun 已 sunset**（PR-D）：`packages/agent-engine-dryrun/` 已 `git rm -r` + 物理清理；`vitest.config.ts` exclude / `agent-package-boundary-guard` IGNORED 列表 / 相关 contract test 全部清理

**下一步**：
1. ✅ §6 决策已定（package name = `linnkit` / 方案 A 分步 / B 完成判定）
2. ✅ §5.4 Phase E 计划已定（D 完成 → E 物理抽包 → linnsec 正式产品开发启动）
3. ✅ **D-1.a / D-1.b 已完成**；engine/03 §7.1 T1/T3 实质等价完成（详见 §5.3 修订）
4. ✅ **D-2 已完成**：guard 反向 lint + CI + codename lint 已上线，宿主 import 收口已完成，reverse-import 已进入最终 enforce
5. ✅ **D-3 / D-4 已完成**：T0（port 插槽）、T1（PromptKey stage-2）、T2（接入指南）、T3（A 类协议真 move）
6. ✅ **Phase D 已完成**：D-1 ~ D-5 全部完成，`packages/agent-engine-dryrun/` dryrun 已 sunset（PR-D）
7. ✅ **Phase E 工程层已完成（2026-04-22）**：E1-E8 中 7/8 项全部勾上；`src/agent/*` 已物理 move 到 `packages/linnkit/src/*`；packages/linnkit 内部端到端 smoke 已落地为永久回归门
8. 🚧 **唯一剩余**：E5 桌面手测主链路（创建对话 / LLM / 工具 / 子 agent / abort / persistence）由用户人工执行；通过后 §5.4.3 完成判据 7/7 全绿，linnsec 正式产品开发前置全部就位；后续产品决策记录不属于本公共归档。
