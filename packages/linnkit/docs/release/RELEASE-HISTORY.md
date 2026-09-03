# linnkit · Release History（修订全文 + 历次发版叙事 + 运维 runbook）

> 本文是 [RELEASE.md](./RELEASE.md) 的"长叙事"伴生文件——把每次发版的踩坑细节、修订背景、PAT runbook 等不需要每次发包都看的内容沉淀在这里，避免污染主文档"现在怎么做"的清晰度。
>
> - 需要查"现在该怎么做" → 读 [RELEASE.md](./RELEASE.md)
> - 需要查"为什么这样做 / 历史踩过什么坑 / 怎么 rotate token" → 读本文

---

## A. 修订记录全文

### A.18 v21 — 2026-08-19 Provider-neutral inference boundary

**实质内容**：Linnkit inference 主链完成 provider-neutral 收口。`ProviderContinuation` v2 使用通用 route identity，payload 在 stream、audit、Context 与 durable replay 中只保序和原样传递，不再读取或合并厂商内部字段；Linnya Host 后续以不兼容 v61 当前事实作为桌面持久化基线，不再保留历史 sidecar 的运行时升级链。`LlmCaller` 只接受 Host 投影的 canonical actual usage，不再解析 OpenAI-shaped raw usage；默认 tokenizer 不再按模型名猜 encoding；raw request/response policy hook、固定厂商 tool extra shape、Provider-specific reasoning capability 字段和厂商 fallback 启发式全部退役。

公共 function-tool envelope 从 `OpenAIToolSchema` 不兼容改名为 `FunctionToolSchema`，不保留兼容别名。no-host-leakage 改为大小写不敏感；model inference boundary guard 新增 Linnkit 核心检查，禁止直接 import Provider SDK、厂商 wire 字段和按厂商/模型家族名称分支。Host 仍拥有 codec、route、usage 与 continuation payload 解释，Linnkit 继续拥有上下文、Agent loop、工具执行、重试预算和 durable replay。

### A.17 v20 — 2026-08-14 ordered Assistant replay

**实质内容**：新增 `assistant_replay_parts`，把 text、reasoning 和 tool call 放入同一 durable 顺序容器；Canonical stream 在 part start 时分配全局 index，避免按交错结束顺序误排。RuntimeEvent、AiMessage、Context Manager、formatter 和 Host request projector 全链路保序；tool-call 封口正文不再形成重复 Assistant turn。当前持久化合同不双读旧聚合 continuation，也不猜测排序。

### A.16 v19 — 2026-08-14 provider continuation 不兼容升级

**实质内容**：`reasoning_details` durable 字段升级为严格 `provider_continuations`，每项包含 schema version 与完整 producer route identity；Host 负责 Provider wire 投影，Linnkit 负责验证、持久化与回放。AgentSpec 的 `providerReplay` 覆盖、文本降级和 provider 空字段 fallback 退役；required 能力只由显式 inference route 注入，缺失 continuation 时 fatal。当前持久化合同不接受匿名旧字段，不双读、不猜测回填。

### A.11 v12 — 2026-05-12 0.5.0 minor release（Phase F P0 三件）

**实质内容**：N-1 `AgentSpec` 一等对象、N-3 `RunSupervisor` / `RunHandle` v2、G-1 `AuditEnvelope` / `AuditPort` 落地；testkit 升级为 run-harness + 15 条不变量；`docs/INTEGRATION_GUIDE.md` 拆分为 `docs/integration/` 主题手册；`docs/framework/` / `docs/archive/` / `docs/99-research-notes/` 作为内部档案退出 npm tarball。

### A.12 v13 — 2026-05-13 0.6.0 minor release 准备（Context Engineering 协议化）

**实质内容**：`AgentSpec.contextPolicy` 从 budget/toolHistory/summarization 扩展到 mustKeep、workingMemory、checkpoint、reasoningRetention、tokenEstimation、systemReminder、contextTrace、toolOutput、providerReplay；摘要通过 host 注册的 summarization agent 执行；tool observation preview 通过 host `ObservationPreviewPort` 落完整副本；provider replay policy 可按 agent 覆盖；新增 host-neutral `ContextCheckpointTool` / `createContextCheckpointTool()`；framework 对比与现状评估文档按 0.6.0 候选线重评。

### A.13 v15 — 2026-05-13 0.8.0 minor release（TokenizerPort）

**实质内容**：新增 host-injectable `TokenizerPort`、默认实现 `DefaultTokenizerPort` / `createDefaultTokenizerPort()`、context-manager / orchestrator 注入点、`createMockTokenizerPort()` 与 C12 context-harness invariant。发布口径切到 npmjs public registry 后，外部接入方可以继续无 `.npmrc` 安装。

### A.14 v17 — 2026-05-22 0.9.0 minor release（stream reasoning_details + ToolNode batch）

**实质内容**：新增 streaming `reasoning_details` 归并 helper，最终 LLM result 和 provider sidecar event 都先压缩相邻纯文本 reasoning 片段；`ToolNode` 在返回 LLM 前完整消费当前 assistant message 的所有 `tool_calls`，即使某个工具失败也不丢同批后续工具调用。

### A.15 v18 — 2026-06-15 0.10.0 minor release（checkpointKey contract）

**实质内容**：`GraphExecutor` / `Checkpointer` host adapter 合同统一使用 `checkpointKey` 表达 engine-state snapshot identity；runtime `conversationId` 作为 host 会话身份从 graph local / child-run request 显式传递；同步 child-run 的 RuntimeEvent / Audit / Telemetry scope 与 host 注册 run 对齐；detached run 使用 `spawnDetached()` 捕获时的 `AgentSpec` / request / metadata snapshot，避免后续对象 mutation 改写后台 run 上下文。

**版本判定**：0.x 期间改既有公开合同语义按 minor 发版。本次不是防御性补丁，而是把 `checkpointKey` 与 host `conversationId` 的职责边界拆清楚，修复 EventStore-backed audit 写入时把 child `runId` 和内部 checkpoint key 混用为不存在 run session 的根因。

**发布结果**：`v0.10.0` release run 首次到 npm publish 时被 npmjs 以 `E404 / you do not have permission` 拒绝。工程验证、dist smoke、`npm pack --dry-run` 均已通过，根因不是源码或 tarball，而是 npm package settings 还没有信任 `linnlabs/linnkit` 的 GitHub Actions workflow。配置 Trusted Publisher（provider=GitHub Actions，repo=`linnlabs/linnkit`，workflow=`release.yml`，permission=`npm publish`）后 rerun 同一个 workflow 成功，npm `latest` 更新为 `0.10.0`，GitHub Release 创建成功。

### A.1 v0 — 2026-04-23 立项 + 规格草稿

拍板表初稿 + 草拟 `customConditions` 双入口方案。

### A.2 v1 — 2026-04-23 工程层全部落地

**关键修订**：dev 体验改用 **paths/alias 平行别名**（`linnkit*` + `@linnya/linnkit*` 两组同时登记），而非 `customConditions: ["linnya-dev"]` —— 因为 linnya 主仓本就不通过 `node_modules` 解析 linnkit，而是靠 `tsconfig.paths` + `vite.alias` + `vitest.alias` 直读 src，`customConditions` 在这条路径上不会生效。

### A.3 v2 — 2026-04-23 架构归位（消除循环依赖）

把 `LlmCallOptions` / `ToolCallChunk` / `LlmResponseContent` / `LlmRetryConfig` / `ToolCall` 5 个 AI 引擎协议 type 从 `runtime-kernel/llm/caller.types.ts`（实现层）搬到 `ports/ai-engine.types.ts`（协议层）。原位置改为从 `../../ports` barrel re-export，保持 `llm.LlmCallOptions` namespace 访问语法不变。

**效果**：`ports ⇄ runtime-kernel` 反向循环依赖彻底消除，rollup dts 打包层不再有 circular 警告；`LlmCaller` 全部 47 个单测 + linnya 主仓 boundary guard / harness integration test 全绿。

### A.4 v3 — 2026-04-23 scope 重选 `@linnya` → `@linnlabs`

发包前置检查时实测发现 v0 拍板表里"`@linnya` org 已存在"是错的——`github.com/linnya` 是一个 2016 年注册、2018 年后废弃的个人 user 账号（type=User，name="linnya network"），不属于自己；同时 `@linn` 这个最干净的总品牌 scope 被英国 Hi-Fi 公司 Linn Products（github.com/linn，verified org，2014 注册）永久占用。

**新拍板**：用 `@linnlabs`（GitHub username 可注册，命名学上明确表达"linn 系列总品牌伞"），未来 `@linnlabs/linnya`、`@linnlabs/linnsy` 也都挂同一 scope。

**改动面**：所有出现 `@linnya/linnkit` 的位置（包名、tsconfig paths、vite/vitest alias、shell test、CI workflow scope、各种文档表格）一并替换为 `@linnlabs/linnkit`，旧名 `linnkit*` 别名仍保留，linnya 主仓 ~170 处 `import 'linnkit'` 零改动。

### A.5 v4 — 2026-04-24 0.1.1 patch release + 独立 repo 路线拍板 + npmjs scope 锁定

**§7 独立 repo 路线拍板**：linnsy 计划 phase 1 完成 + 内部 dogfooding 后开源，linnkit 必须同步独立成 `linnlabs/linnkit` public repo + 包从 GitHub Packages 切到 npmjs.com 公开。npmjs.com `@linnlabs` scope 已抢注锁定（与 GitHub `linnlabs` org 同名同 owner，0 包，default team `Developers`，npm user `linnlab`）。

**0.1.1 patch release** —— D-5 schemas detach round 2 落地 + 0.1.0 manifest URL 瑕疵兑现修正，连撞 2 个发版坑都被 CI 兜底。详见下方 [§C.2 0.1.1 发版历程](#c2-011-patch-release2026-04-24)。

### A.6 v5 — 2026-04-24 0.1.2 patch release（docs/ 文档架构重组）

**触发**：`linnkit/src/` 内同时混着源码（`.ts`）和长篇文档（`README.md` 682 行框架指南 + `INTEGRATION_GUIDE.md` + `DEVELOPMENT_GUIDE.md` + `docs/{framework,99-research-notes,archive/engine-phase-a-to-e}/`），且包根 `RELEASE.md` 单文件杂糅"现在该怎么做"和"长叙事 + runbook"，结构反 npm 标准包 convention（标准是：包根 `README.md` 入口 + `docs/` 详细文档）。

**改动面**：

| 类别 | 旧位置 | 新位置 |
|------|--------|--------|
| 框架总入门 | `src/README.md`（682 行） | `docs/README.md`（合并 `src/docs/README.md` 90 行写作约定为 §13） |
| 接入指南 | `src/INTEGRATION_GUIDE.md` | `docs/INTEGRATION_GUIDE.md` |
| 开发指南 | `src/DEVELOPMENT_GUIDE.md` | `docs/DEVELOPMENT_GUIDE.md` |
| Framework topic | `src/docs/framework/` | `docs/framework/` |
| Research notes | `src/docs/99-research-notes/` | `docs/99-research-notes/`（不进 npm tarball） |
| Archive | `src/docs/archive/engine-phase-a-to-e/` | `docs/archive/engine-phases/`（重命名 + 不进 npm tarball） |
| Release docs | 包根 `RELEASE.md`（455 行单文件） | `docs/release/RELEASE.md`（"现在该怎么做"瘦身）+ `docs/release/RELEASE-HISTORY.md`（修订全文 / 历次发版长叙事 / runbook） |
| 包根入口 | （无） | 新增 `README.md`（47 行，标准 npmjs/GitHub 入口；链向 `docs/` 详细文档） |

**配套同步**（73 个文件改动；全部用 `git mv` 保 blame）：
- `package.json#files`：旧 `[dist, src/README.md, src/INTEGRATION_GUIDE.md, src/DEVELOPMENT_GUIDE.md, src/docs]` 5 项 → 新 `[dist, README.md, docs/README.md, docs/INTEGRATION_GUIDE.md, docs/DEVELOPMENT_GUIDE.md, docs/framework, docs/release]` 7 项
- `package.json#linnkit.sourceOfTruth`：`packages/linnkit/RELEASE.md` → `packages/linnkit/docs/release/RELEASE.md`
- `.npmignore`：重写为"白名单 + 兜底拦截 archive/99-research-notes"
- 仓库根 `tsconfig.json` / `vite.config.mjs` / `vitest.config.ts` 注释里的 `RELEASE.md` 路径同步
- `.github/workflows/release-linnkit.yml` 注释里的 `RELEASE.md` 路径同步
- `packages/linnkit/__tests__/package.shell.test.ts` 断言 `src/*.md` → `docs/*.md` + 新增 3 条（包根 `README.md` / `docs/framework` / `docs/release`）
- 跨仓引用全量修复（96+ 处）：linnkit 包内 6 个 `.md` + linnsy 16 个文档（`plan/*` + 7 个顶层 spec）

**与 0.1.1 的对比**：
- 运行时 dist 字节级一致（exports / 类型签名 / 实现 0 变化）
- 仅 npm tarball 内容变化（结构 + 包根 README）
- 按当时版本号策略判定为 patch：实现优化 / 不改 exports / 不改既有签名。

**为什么不继续等更大改动一起发？** linnsy daemon 即将在 S0 T0.9 切到 registry 装包；先把包结构整理干净再让 daemon 装是最 clean 的路径，避免出现"daemon 装到 0.1.1 旧 src/*.md 结构、几天后再升 0.1.2"的中间态。

详见下方 [§C.4 0.1.2 发版历程](#c4-012-patch-release2026-04-24)。

### A.7 v6 — 2026-04-24 0.1.3 patch release（packaging fix：tiktoken external + declared dep）

**触发**：linnsy 独立仓 `BCAutumn/linnsy` 已就位 + `packages/linnsy-daemon/` 完整 S0 骨架（SQLite runtime / harness / LLM bridge / 18 files / 44 tests / coverage 91%）+ 已声明 `"@linnlabs/linnkit": "^0.1.1"` + `.npmrc` 配 `@linnlabs:registry=https://npm.pkg.github.com`。准备进 S1 wiring `GraphExecutor + SqliteCheckpointer + SqliteRunRegistryStore + LinnsyAiEngineBridge` 时，linnsy 端反馈：

```
node -e "import('@linnlabs/linnkit/runtime-kernel')..."
→ Missing tiktoken_bg.wasm
```

**根因**（深查后定性，0.1.0~0.1.2 三个版本都有此问题，但**之前没人真从外部 npm install 装过来 import**，所以一直没暴露）：

1. `src/shared/TokenCalculator.ts` 顶层 `import { get_encoding, Tiktoken } from 'tiktoken'`
2. 该 import 被 5 处生产代码透传：`runtime-kernel/graph-engine/tick-pipeline/middlewares/llmTelemetryMiddleware.ts` + `context-manager/{shared/summarization/SummarizationTrigger.ts, profiles/chat/config/defaults.ts, profiles/agent/context/config.ts, profiles/chat/context/config.ts}` + `testkit/agent-harness/scriptedAiEngineHarness.ts`
3. **`packages/linnkit/package.json` 没有 `dependencies` 字段** —— tiktoken 是主仓 root `package.json` 的依赖，monorepo dev 时 hoist 到 root `node_modules` 能解析，但**包发出去后**外部消费者的 `node_modules` 里没有 tiktoken
4. **`tsup.config.ts` external 数组只有 `['vitest']`**，注释还误写成"默认所有 node_modules 都视为 external"——**事实是 tsup 只把 `package.json#dependencies / peerDependencies` 已声明的包视为 external，其余 import 全部 inline bundle 进 dist**
5. tsup 把整个 tiktoken **JS 部分** inline 进 8 个 dist bundle（`{index, runtime-kernel, context-manager, testkit}.{js, cjs}`），bundle 字符串里到处是 `./tiktoken_bg.wasm` 资源路径
6. **但 wasm 资源没跟着进 dist** —— `package.json#files` 只发 `[dist, README, docs]`；tsup 也不复制资源文件
7. 结果：外部消费者一旦 `import @linnlabs/linnkit/runtime-kernel`（或 `/context-manager` / 根入口），bundle 顶层执行时立刻 `fetch ./tiktoken_bg.wasm` → 404 → throw `Missing tiktoken_bg.wasm`

**修复策略**（评估了 3 个方案，详见 [`§C.5`](#c5-013-2026-04-24--packaging-fix-tiktoken-external--declared-dep) 决策表，选 **Option A**）：把 tiktoken 当成本包真正的 runtime dependency 处理 —— 在 `package.json#dependencies` 声明 `^1.0.22`（与主仓 root `package-lock.json` 锁定版本对齐）+ 在 `tsup.config.ts#external` 加 `'tiktoken'`，让 dist 改成 `require('tiktoken')` / `import from 'tiktoken'` external，npm install 时 npm 自动把 tiktoken（含 wasm）装到外部消费者的 `node_modules/tiktoken/`，bundle 加载时从那里解析 wasm。

**捎带发现并修复 zod 同款灾难**（反向稽核测试一上线就抓出来）：

`src/contracts/{events,execution,messages,sse}.ts` 全在用 zod 定义 schema，但 `package.json` 既没声明 zod 也没 external，0.1.0~0.1.2 三个版本的 dist 把整个 zod runtime 都 inline 进了 8 个 bundle（contracts.js 151KB、index.js 605KB、events.js 51KB DTS）。zod 不带 wasm 所以没 0.1.0 时立刻炸，但有两个**更隐蔽的暗坑**：

| 暗坑 | 后果 |
|------|------|
| 接入方自己也用 zod（如 linnsy daemon `zod@^3.24.0` / 主仓 root `zod@^3.25.76`） | 接入方 import 出的 `z.ZodSchema` 跟自己装的 zod 不是同实例；`schema instanceof z.ZodObject` 返回 false；不同 zod 版本的 `.parse()` 互不兼容；schema reuse / safeParse 行为不确定 |
| dist bundle 巨胖 | contracts.js 151KB，发布给所有消费者的每次下载都带一份完整 zod；index.js 605KB 含两份 zod runtime（一份直接来自 contracts，一份通过 runtime-kernel re-export） |

zod 的修复策略与 tiktoken **不同**——zod 标 `peerDependencies@^3.22.0` 而不是 `dependencies`：让接入方自己锁 zod 版本（避免 schema 实例隔离 trap），同时 `tsup.config.ts#external` 加 `'zod'`。

**修完后 dist 体积验证**（zod external 立竿见影）：

| 入口 | 0.1.2 → 0.1.3 |
|------|---------------|
| `dist/runtime-kernel.js` | 374 KB → **244 KB**（-35%） |
| `dist/runtime-kernel.cjs` | ~ → **248 KB** |
| `dist/context-manager.js` | 391 KB → **260 KB**（-33%） |
| `dist/index.js` | 605 KB → **472 KB**（-22%） |
| `dist/contracts.js` | 151 KB → **28 KB**（**-81%**！contracts 几乎全是 zod schema 定义） |
| `dist/contracts.cjs` | ~ → **32 KB** |

**配套加固**（防止下一个第三方 dep 再踩同款坑）：

| 加固项 | 实现 |
|--------|------|
| `package.runtime-import.test.ts` | spawn 子进程 `node -e import()` 实测 dist 7 入口；4 个 Node 全展开入口期望 `ok`；testkit ESM 期望 throw `Vitest failed to access its internal state`，testkit CJS 期望 throw `Vitest cannot be imported in a CommonJS module`（两套 by-design 错误信息双兼容）；events / contracts / ports 期望 ok；外加结构守卫：dist bundle 不能含 `tiktoken_bg.wasm` 字符串 + 必须以 `require/import 'tiktoken'` external 形态出现 + 必须以 `require/import 'zod'` external 形态出现 |
| `package.events-browser-safe.test.ts` | events.{js,cjs} 静态 grep 守卫，不能含 tiktoken / `node:async_hooks` / `node:child_process` / `node:worker_threads` / better-sqlite3 等 6 个违禁 import |
| `package.shell.test.ts` 新增 src 反向稽核 describe | 扫描 `src/**/*.ts` 全部 import / require 语句，提取所有非 node-builtin / 非 alias / 非相对路径的 bare specifier，校验**全部**在 `package.json#dependencies` 或 `peerDependencies` 出现；不在则失败，列出具体哪些包 + 哪些文件 + 修复指引 |
| `tsup.config.ts` 注释刷新 | 删除"默认所有 node_modules 都视为 external"的错误叙述，写明真相：external 必须**同时**满足 (a) 在 `package.json#dependencies/peerDependencies` 声明 + (b) 在 `tsup.config.ts#external` 列出 |
| `vitest` 改 `peerDependencies` (optional) | 之前 `vitest` 只在 `external` 列表，没在 `package.json` 任何 deps 字段；改为 `peerDependencies` + `peerDependenciesMeta.vitest.optional=true`，让用 testkit 的消费者明确知道要装 vitest，不用 testkit 的不被强制装 |
| `zod` 改 `peerDependencies` (required) | zod schema 实例隔离 trap；标 peer 让接入方自己锁版本，zod ^3.22.0 范围全部兼容 |

**与 0.1.2 的对比**：
- ✅ exports 字段 / 公开 API 0 变化（仍然 6 入口 + events + package.json）
- ✅ 类型签名 0 变化
- ✅ 运行时行为对**已经能跑的消费者**0 变化
- ⚠️ dist bundle 内容变化（tiktoken JS 不再 inline；体积下降，但 source map 大头不变所以总尺寸看不出明显差异）
- ➕ 新增 `dependencies.tiktoken@^1.0.22`（消费者多装一个 transitive dep）
- ➕ 新增 `peerDependencies.vitest@^2||^3` (optional)（消费者主动装才生效）

**判定为 patch 的依据**：按当时版本号策略，bug fix / 实现优化 / 不改 exports / 不改既有签名走 patch。本质是**修复 bug**（0.1.0~0.1.2 三个版本所有 Node 全展开入口外部消费者都装不动是 bug），不是新功能。

详见下方 [§C.5 0.1.3 发版历程](#c5-013-2026-04-24--packaging-fix-tiktoken-external--declared-dep)。

### A.8 v7 — 2026-04-26 0.2.0 minor release（provider sidecar replay upgrade）

DeepSeek V4 thinking/tool follow-up 暴露出 provider sidecar 不能只挂在 tool call 决策上：工具结果后的 `final_answer` 历史同样需要保留原始 `reasoning_details`，否则下一轮 replay 会缺 `reasoning_content`。

本版把 `reasoning_details` 升级为 assistant 输出通用 sidecar：`tool_call_decision.payload.reasoning_details`、`final_answer.reasoning_details`、`AiMessage.metadata.reasoning_details`、`formatAgentLlmMessages(...)` 全链路保留；流式路径新增 `provider_sidecar` 事件供 host finalization 写入最终回答。`ToolReplayProtocolPolicy` 仍保持 provider-agnostic，只新增 `provider_empty_replay_field` 通用行为，DeepSeek wire format 仍留在 Linnya integration。

### A.9 v8 — 2026-04-27 0.2.1 patch release（docs: `INTEGRATION_GUIDE.md` npm-consumer rewrite）

**触发**：`docs/INTEGRATION_GUIDE.md` 从 monorepo 内部路径引用为主，对外部 `npm install @linnlabs/linnkit` 的接入方不友好；重写为只使用真包名 `@linnlabs/linnkit/*` 子入口、补 GitHub Packages 鉴权、将 context engineering **fence**（`FenceRegistry` / `FenceInjection` / `MustKeepPolicy` / `FenceLifetimePreprocessor` / `context_injection`）升格为一等接入面。

**判定为 patch 的依据**：

- `package.json#exports` / `dist/*` 零变化；类型签名与运行时行为对 0.2.0 消费者 **0 行为变化**。
- npm tarball 内容变化：更新后的 `docs/INTEGRATION_GUIDE.md` 随 `package.json#files` 打入包。

### A.10 v9 — 2026-04-27 0.2.2 patch release（docs: `README` / `RELEASE` / `RELEASE-HISTORY`）

**触发**：`docs/README.md` 仍写「6 个稳定子入口」与 `exports` 七条子路径不一致；`RELEASE.md` §5 保留已全程完成的 S0 长清单，占版且与 §8 / 本文重复；`RELEASE-HISTORY` 中 linnsy 验证「6 个入口」表述与 7 条 export 易误读。

**判定为 patch 的依据**：`dist` / `package.json#exports` / 类型签名与 0.2.1 **完全一致**；仅文档与 `package.shell.test.ts` 注释修正。

---

## B. 运维 runbook

### B.1 PAT rotate runbook

90 天到期或泄漏时执行：

1. https://github.com/settings/tokens revoke 旧 token
2. 同页面新建同 scope token（`repo` + `write:packages` + `read:packages`）
3. 本地 `nano ~/.npmrc` 替换 token —— **不要 `cat` / heredoc，避免泄漏到 shell history**
4. https://github.com/BCAutumn/Tingtalk_official_version/settings/secrets/actions 编辑 `LINNLABS_NPM_TOKEN` 重新粘贴
5. `npm whoami --registry=https://npm.pkg.github.com/` 验证本地
6. workflow_dispatch + `dry_run=true` 验证 CI

**未来**：等 §7 路线落地（linnkit 迁到 `linnlabs/linnkit` 独立仓 + 切 npmjs.com）后，PAT 替换为 npmjs Automation token；同 owner 后 `secrets.GITHUB_TOKEN` 也可工作（如果还需要 GitHub Packages mirror）。

---

## C. 历次 release 发版历程

### C.1 0.1.0 首发（2026-04-23）

**§5.5a GitHub org 注册**：`linnlabs` 已注册 + GitHub username 锁定，未来 `@linnlabs/linnya`、`@linnlabs/linnsy` 也都挂同 scope。

**§5.5b dedicated PAT 路径**：在 `BCAutumn/Tingtalk_official_version` repo settings 加 secret `LINNLABS_NPM_TOKEN`（classic PAT, scope = `repo` + `write:packages` + `read:packages`，90 天过期）；workflow yml `NODE_AUTH_TOKEN` 引用从 `secrets.GITHUB_TOKEN` 切到 `secrets.LINNLABS_NPM_TOKEN`。

**理由**：本仓 owner 是个人账号、包 scope owner 是 org（linnlabs），repo-scoped 的 `secrets.GITHUB_TOKEN` 不能跨 owner publish。等 §7 路线落地后可改回 `secrets.GITHUB_TOKEN`（同 owner）+ 删除该 PAT。

**§5.6 dry-run**：CI run 2m 2s Success，`Publish to GitHub Packages` step 按预期 skipped；`https://github.com/orgs/linnlabs/packages` 仍为引导页（零包）确认 dry-run 没真发。

**§5.7 真发**：包已上 `https://github.com/orgs/linnlabs/packages`；`npm view @linnlabs/linnkit --registry=https://npm.pkg.github.com/` 输出 `@linnlabs/linnkit@0.1.0 | UNLICENSED | deps: none | versions: 1 | latest: 0.1.0 | published by BCAutumn`，shasum + sha512 integrity 齐全。

**0.1.0 manifest 已知瑕疵**（不影响包可用性，0.1.1 修）：`homepage` / `repository.url` / `bugs.url` 在发包当时错写为虚构的 `linnya/linnya`，0.1.1 已修正为真实仓库 `BCAutumn/Tingtalk_official_version`；GitHub Packages 不支持改已发版本 manifest，所以 0.1.0 元数据保持原样直至 0.1.1 出现。

**收尾（CI workflow 升级）**：`actions/checkout` / `actions/setup-node` `@v4 → @v5`，修 Node 20 deprecation warning。

### C.2 0.1.1 patch release（2026-04-24）

**实质内容**：
1. **D-5 schemas detach round 2**：6 处生产代码 `@app/schemas → ../../contracts`；新增 `contracts/{constants,execution,sse}.ts` 三个真源文件（内化 `DEFAULT_MAX_STEPS` / `EventEnvelope` / `ExecutionTraceContext` / 完整 `SSEEvent` 系列 / `createSSE*` 工厂）；删 `packages/schemas/src/{execution-events,sse-events,sse/*}.ts`；删 `packages/schemas/package.json` 死 subpath exports `./view-models` / `./runtime-models`；加 `schemasDetach.contract.test.ts` 守门
2. **manifest URL 三件套修正**：`homepage` / `repository.url` / `bugs.url` 由虚构 `linnya/linnya` 改为真实 `BCAutumn/Tingtalk_official_version`
3. **CI workflow upgrade**：`actions/checkout` / `actions/setup-node` `@v4 → @v5`

**首发连撞 2 个坑（都被 CI 兜住，npm 零污染）**：

| # | 撞的是什么 | CI 兜底 step | fail 时长 |
|---|---|---|---|
| ① | tag 推早了：`package.json#version` 还是 0.1.0 | `Verify tag matches package.json version` exit 1 | 1m14s |
| ② | D-5 commit `45b953b6` 手抖漏 `git add` 了 3 个真源新文件（`git commit -am` 的 `-a` 只 stage 已 tracked 文件的修改/删除，**不会自动 add 新文件**），git 远端没这 3 个文件，CI checkout 后 `src/contracts/index.ts` 的 `export * from './sse'` 等 3 行 esbuild 报 `Could not resolve` | `Build (tsup → dist)` exit 1 | 2m36s |

两次 fail npm 上 0.1.1 都没出现，证明 `verify-tag` + `build-before-publish` 两道防线都生效。这是 v0/v1 工程层就位时设计的"防呆"，2026-04-24 同一天连续兑现两次价值。

**修复链**：
1. bump `package.json#version` → `0.1.1` + 同步 `package.shell.test.ts` 断言
2. 补 `git add` 3 个漏的真源 + commit
3. `git push --delete origin linnkit-v0.1.1 && git tag -d linnkit-v0.1.1 && git tag linnkit-v0.1.1 && git push origin linnkit-v0.1.1`

**第 3 次 CI（2m10s）成功**，`@linnlabs/linnkit@0.1.1` 上线。

**Release-time 机械检查清单**（当前口径见 [`RELEASE.md`](./RELEASE.md) 的发版前检查）：
- (a) bump version commit 后 `git diff HEAD~1 -- packages/linnkit/package.json` 必须看到 version 行变化
- (b) `git status --short` 必须**完全为空**才允许打 release tag（任何 untracked / modified 都先解决）
- (c) 本地先跑 `npm --prefix packages/linnkit run build` 验通过再 push tag

**验证**：
- dist 体积 `runtime-kernel.cjs` 407 KB → 384 KB（-23 KB，因 SSE/EventEnvelope 不再 fork inline）
- `contracts.cjs` 增厚（成为真源）
- `grep -r '@app/schemas' packages/linnkit/dist` 零命中
- linnkit 全量单测 + smoke 全绿
- linnya host 侧 `import from 'linnkit/contracts'` 抽样无回归

**最终上线**：
- `@linnlabs/linnkit@0.1.1` 已上 `https://github.com/orgs/linnlabs/packages`
- `versions: ['0.1.0', '0.1.1']`，`latest = 0.1.1`
- `deps: none`（D-5 兑现）
- manifest URL：`homepage` / `bugs.url` 完整修正

### C.3 已知小瑕疵：repository.url 在 GitHub Packages 跨 owner 场景被静默丢

**现象**：`npm view @linnlabs/linnkit@0.1.1 repository.url --registry=https://npm.pkg.github.com/` 输出空，但本地 `package.json#repository.url` 字段完整存在。

**根因**：publish 来源 repo（个人账号 `BCAutumn/Tingtalk_official_version`）和 package scope owner（org `linnlabs`）跨 owner，GitHub Packages registry 在存元数据时把 `repository.url` 字段静默丢了。`homepage` / `bugs.url` 不受影响。

**影响**：非阻塞。包能装、能跑、能溯源；只是 `npm bugs` / `npm repo` 这类用 `repository.url` 的命令不可用，用户走 `homepage` / `bugs.url` 一样能到达。

**修复时机**：等 §7 路线落地（linnkit 迁到 `linnlabs/linnkit` 独立 repo + 同 owner）后这个字段会自动保留。0.1.2 同样不修这个（仍然要等 §7 同 owner）。

### C.4 0.1.2 patch release（2026-04-24）

**实质内容**：纯文档/打包结构 patch，**运行时 dist 字节级一致**。

1. **docs/ 文档架构重组**：所有 `.md` 从 `src/` 收口到包根 `docs/`：
   - `src/README.md`（682 行框架总入门）→ `docs/README.md`（合并 `src/docs/README.md` 90 行写作约定为 §13）
   - `src/INTEGRATION_GUIDE.md` → `docs/INTEGRATION_GUIDE.md`
   - `src/DEVELOPMENT_GUIDE.md` → `docs/DEVELOPMENT_GUIDE.md`
   - `src/docs/framework/` → `docs/framework/`
   - `src/docs/99-research-notes/` → `docs/99-research-notes/`
   - `src/docs/archive/engine-phase-a-to-e/` → `docs/archive/engine-phases/`（重命名）
   - 包根 `RELEASE.md` → `docs/release/RELEASE.md`
   - 新增 `docs/release/RELEASE-HISTORY.md`（修订全文 + 历次发版长叙事 + PAT runbook，从原 `RELEASE.md` 拆出）
   - 新增包根 `README.md`（47 行 npmjs/GitHub 标准入口，链向 `docs/`）

2. **package.json#files 同步**：5 项 → 7 项；不再发 `src/*.md`，发 `dist + README.md + docs/{README,INTEGRATION_GUIDE,DEVELOPMENT_GUIDE}.md + docs/{framework,release}`；`docs/archive/` + `docs/99-research-notes/` 不进 tarball（兜底见 `.npmignore`）

3. **`.npmignore` 重写**：白名单为主 + 兜底拦截 archive/research-notes

4. **`linnkit.sourceOfTruth`**：`packages/linnkit/RELEASE.md` → `packages/linnkit/docs/release/RELEASE.md`

5. **跨仓引用全量修复**（96+ 处）：linnkit 包内 6 个 `.md` + linnsy 16 个文档（`plan/*` + 7 个顶层 spec）+ 仓库根 3 个 config 文件注释 + 1 个 workflow yml 注释

**与 0.1.1 的对比**（验证运行时零变化）：
- 7 条可 import 子路径（根 + 6 子入口；含 `runtime-kernel/events` slim）的 dist 全部 emit、内容字节级与 0.1.1 一致（`tsup` config / `src/` 实现 0 修改）
- `package.json#exports` 完全不动
- `package.json#dependencies` 完全不动（仍 `deps: none`）
- 类型签名、运行时行为、tree-shaking 形态全部不变
- linnya host 侧 `import from 'linnkit'` / `import from '@linnlabs/linnkit'` 抽样无回归

**判定为 patch 的依据**：按当时版本号策略，bug fix / 实现优化 / 不改 exports / 不改既有签名走 patch。运行时 0 变化，仅包元数据 + 文档结构刷新。

**机械检查清单兑现**（从 0.1.1 D-5 教训沉淀，本次预先跑全）：
- (a) bump version commit 后 `git diff HEAD~1 -- packages/linnkit/package.json` 看到 `"version": "0.1.1" → "0.1.2"` ✅
- (b) `git status --short` 完全为空才打 tag ✅
- (c) 本地先跑 `npm --prefix packages/linnkit run build` 验证全绿 ✅

**仍未修的瑕疵**（按计划继续延后）：
- §C.3 `repository.url` 跨 owner 静默丢失 —— 等 §7 同 owner 自动解决，0.1.2 不动

**最终上线**（2026-04-24 03:09:43Z）：
- `@linnlabs/linnkit@0.1.2` 已上 `https://github.com/orgs/linnlabs/packages`
- `versions: ['0.1.0', '0.1.1', '0.1.2']`，`latest = 0.1.2`
- CI run `24870127537`：2m 21s success，11 个 step 全绿（`Verify tag matches package.json version` / `Smoke test` / `Build` / `Verify dist artifacts` / `npm pack --dry-run` / `Publish to GitHub Packages` 全通过；机械检查清单 (a)/(b)/(c) 本地预跑 + CI 复跑双保险，0 撞坑）
- tarball：84 files / 3.0 MB / 15.9 MB unpacked / shasum `4e810139797995aebb179df777a1465d65fbac2a`

### C.5 0.1.3 patch release（2026-04-24 — packaging fix: tiktoken external + declared dep）

**事故等级**：高 —— 0.1.0 首发到 0.1.2 整 24 小时内的**所有版本**对外部消费者**都不可用**（任何 `import @linnlabs/linnkit/runtime-kernel` / `/context-manager` / 根入口立即 `Missing tiktoken_bg.wasm`），但因为只有 linnya monorepo 内的 dev alias 路径在用（直读 src 不走 dist），所以一直没被发现，直到 linnsy 独立仓真实 install 装包。

**发现路径**：
1. linnsy 已迁出到独立仓 `BCAutumn/linnsy`（commit history `85f0c84` import from linnya monorepo + `09b1c57` GitHub remote 策略 + `0a4a8a7` linnsy 自己 docs/ 整理）
2. linnsy `packages/linnsy-daemon/` 已就位完整 S0 骨架（独立 `package.json` + `.npmrc`），声明 `"@linnlabs/linnkit": "^0.1.1"`
3. linnsy daemon 测试通过 8 项验证（typecheck / lint / guard:boundary / test 18 files 44 cases / coverage 91% / contract / build / git diff --check）
4. 准备 wiring GraphExecutor 全链路时，`node -e "import('@linnlabs/linnkit/runtime-kernel')..."` 在 daemon 目录里立即报 `Missing tiktoken_bg.wasm`
5. linnsy 一侧反馈，附 7 步修复计划

**3 方案评估**（决策矩阵）：

| 方案 | 实现 | 优点 | 缺点 | 选否 |
|------|------|------|------|------|
| **A. external + declared dep** | tsup external 加 `'tiktoken'` + `package.json` 声明 `dependencies.tiktoken@^1.0.22` | 包边界最干净；不复制 wasm；tiktoken 自己加载自己的 wasm；公开 API 0 变化；最小行为修改 | 消费者多装一个 transitive dep | ✅ 选 |
| B. lazy-load + 估算回退 | TokenCalculator 改异步动态 import + tiktoken 不可用时降级到 char-count 粗估 | 长期韧性最强；wasm 受限环境也活 | API 改异步是 break；TokenCalculator 当前所有方法同步调用，改动面非常大；治标不治本（治标的是 bundling，不是 tiktoken 本身） | ❌ 否 |
| C. 把 tiktoken_bg.wasm 复制进 dist | tsup hooks 或 postbuild script 把 wasm 文件复制到 dist 同层 | 零依赖；快 | 脆弱（依赖 tiktoken 内部目录布局 + tsup 输出细节）；忽视真问题（依赖没声明）；下次 tiktoken 升级或 tsup 升级又会断 | ❌ 否（除非紧急 hotfix） |

**选 A 理由**：linnsy 端**还没真投产**（S1 wiring 还没开始），现在修是**第一时间窗口**。tiktoken 也不是要消失的过渡依赖（linnkit context-manager / token telemetry / agent-harness 都核心在用），声明它是真依赖最干净。

**修复执行**（按 10 步骨架，1 次 commit + 1 次 push + 等 CI ~2 分半 + linnsy 端验证）：

1. **L0 sync linnsy 真实状态**：发现 linnsy 已经远不止"纯文档仓"，daemon 完整骨架就位 + `.npmrc` 配好 + dep 声明 `^0.1.1`（npm semver `^0.1.1` 自动可解析到 0.1.3，所以无需主动 bump dep range）
2. **L1 tsup.config.ts 改造**：`external: ['vitest']` → `['vitest', 'tiktoken']`；同时刷新文件顶部错误注释（删除"默认所有 node_modules 都视为 external"，写明真相 + 反向稽核保护机制）
3. **L2 package.json 加 dependencies**：`"dependencies": { "tiktoken": "^1.0.22" }`（与主仓 root `package-lock.json` `tiktoken@^1.0.22` 完全对齐）；vitest 从只在 tsup external、package.json 没声明的灰色状态，正式改为 `peerDependencies` (optional)
4. **L3 rebuild 验证**：`npm run build:clean && npm run build` 后 grep 确认：dist 8 bundle 文件 0 个含 `tiktoken_bg.wasm` 字符串（之前是 8 个）；`runtime-kernel.cjs` 第 3 行变成 `var tiktoken = require('tiktoken')`，`runtime-kernel.js` 第 1 行变成 `import { get_encoding } from 'tiktoken'`，确认真 external；外加 `node -e import` 子进程实测 7 入口：runtime-kernel / context-manager / index / events / contracts / ports 全 ok，testkit by-design throw vitest 错（这是 AGENT-GUARD-10 已知行为）
5. **L4 新增 `__tests__/package.runtime-import.test.ts`**：上面 4 步的 dist 子进程 import 测试 + 结构守卫永久收编
6. **L5 新增 `__tests__/package.events-browser-safe.test.ts`**：events seam 6 个违禁 import 静态守卫
7. **L6 加固 `__tests__/package.shell.test.ts`**：新增 describe 块 `packages/linnkit src third-party import reverse audit`，扫描 `src/**/*.ts` 全部 import/require/import() 语句，提取 bare specifier，对比 `package.json#dependencies + peerDependencies` 反向稽核；不在则失败 + 输出修复指引
8. **L7 bump 0.1.3**：`package.json#version` 0.1.2 → 0.1.3 + `linnkit.phase` + `linnkit.notes`（首条改 0.1.3 packaging fix 叙述）；`RELEASE.md` 顶部状态行 + §0 修订摘要 v6 + §0 当前版本 + §1.1 external 列表 + §1.2 dependencies/peerDependencies 文档化 + §2.2 dep 示例 ^0.1.1 → ^0.1.3 + §5.7 / §5.8 / §5.9 √ 完成；本文新增 §A.7 + §C.5 + §D 表格条目；`package.shell.test.ts` 期望版本 0.1.2 → 0.1.3
9. **L8 local 全套验证**：`build:clean + build + test:smoke + publish:dry-run` 全绿
10. **L9 commit + tag linnkit-v0.1.3 + push + 等 CI + npm view 验证 latest=0.1.3**

**linnsy 端验证**（L10）：daemon 直接装 0.1.3 + 加 `__tests__/contract/linkit-package-import.contract.ts` 永久收编 import 闭环测试 + 跑 daemon 全套 typecheck / lint / guard:boundary / test / test:contract / build。

**Release-time 机械检查清单兑现**：
- (a) bump version commit 后 `git diff HEAD~1 -- packages/linnkit/package.json` 看到 `"version": "0.1.2" → "0.1.3"` ✅
- (b) `git status --short` 完全为空才打 tag ✅
- (c) 本地先跑 `npm --prefix packages/linnkit run build && npm --prefix packages/linnkit run test:smoke && npm --prefix packages/linnkit run test:smoke:dist` 验证全绿 ✅

**首次 push CI 撞 1 坑（被 CI 第 7 步 Smoke test 兜底，npm 零污染）**：

| # | 撞的是什么 | CI 兜底 step | fail 时长 | 教训沉淀 |
|---|---|---|---|---|
| ① | 新增的 `package.runtime-import.test.ts` + `package.events-browser-safe.test.ts` 都需要 `dist/` 已经存在；CI workflow 是 **smoke → build** 顺序（设计是"快速门禁"），smoke 跑时 dist 还没生成 → ENOENT。本地一直绿是因为本地我先 build 后 smoke | `Smoke test (package.shell)` exit 1（events-browser-safe 的 readFile 抛 ENOENT） | 1m27s | **拆 smoke 测试为两个 script**：`test:smoke` 只跑 manifest 测试（不需要 dist，CI build 前跑保留快速门禁），`test:smoke:dist` 跑 dist 子进程 import + events seam（CI build 后跑）；workflow yaml 在 build 后插一步 `npm run test:smoke:dist`；`prepublishOnly` 同步加上 |

**修复链**：
1. `package.json` 拆 scripts：`test:smoke` (shell.test only) + 新增 `test:smoke:dist` (runtime-import + events-browser-safe)
2. `prepublishOnly` 加 `&& npm run test:smoke:dist`
3. `.github/workflows/release-linnkit.yml` 在 `Build (tsup → dist)` + `Verify dist artifacts` 之后插一步 `Smoke test (dist runtime imports + events browser-safe)`
4. fix commit + delete tag + recreate tag at fix commit + push

第 2 次 CI（`<TBD>`）成功，`@linnlabs/linnkit@0.1.3` 上线。

**预防同款灾难再次发生**（沉淀 lessons learned 进 `package.shell.test.ts` 反向稽核 + `package.runtime-import.test.ts` 子进程实测）：
- 单元 / 集成测试不够：linnkit src 内 TokenCalculator 的所有单测都过，因为 monorepo dev 路径 hoist 了 tiktoken；只有从外部消费者 `node_modules` 视角的 import 测试才能发现
- tsup default behavior 是反直觉的：注释错写"默认 external 所有 node_modules"导致每个 reviewer 误信
- "未来你可能会引入第二个第三方依赖"——反向稽核测试是事前守卫，不需要等下一个 wasm/native 包出事

**最终上线**（2026-04-24 07:36:48Z）：
- `@linnlabs/linnkit@0.1.3` 已上 `https://github.com/orgs/linnlabs/packages`
- `versions: ['0.1.0', '0.1.1', '0.1.2', '0.1.3']`，`latest = 0.1.3`
- CI run `24877928093`：2m32s success（第 2 次；第 1 次 `24877700434` 因 smoke 测试在 build 之前跑而 fail，被本节"首次 push CI 撞 1 坑"修复链处理）
- tarball：84 files / 2.2 MB packed (-27% vs 0.1.2) / 10.5 MB unpacked (-34% vs 0.1.2) / shasum `131d0de27f7c2acfea2e808e3422dce9c7b1eda3` / sha512 integrity `pOdXqOXHjLXg2ZVnG3POwzH1JdjGbAD3BeIlr3DIutipm1P8P54bsj52+JzahYzjIDObrrYdozh4NrIfx+Ep+A==`
- `dependencies`：`{ tiktoken: "^1.0.22" }`（首次非空 deps）
- `peerDependencies`：`{ vitest: "^2||^3" }` (optional) + `{ zod: "^3.22.0" }`

**linnsy 端 L10 验证**（2026-04-24 同日完成）：
- `cd <workspace-root>/linnsy/packages/linnsy-daemon && npm install @linnlabs/linnkit@0.1.3 --save`：升级成功（`^0.1.1 → ^0.1.3`）
- `node_modules/tiktoken` 含完整 wasm + JS（`init.{cjs,d.ts,js}` / `load.{cjs,d.ts,js}` / `encoders/` 等）
- `node_modules/zod` 装好（消费者自己锁的版本，符合 peerDependency 设计）
- 主链路子路径 `node -e import` 抽检全 OK：根 / runtime-kernel / context-manager / runtime-kernel/events / contracts / ports（**`package.json#exports` 共 7 条**可 import 子路径；`testkit` 未做 `node -e` 手搓，由后续 contract 覆盖）
- `GraphExecutor` 类型为 `function` —— S1 wiring 阻塞解除
- 新增 `__tests__/contract/linnkit-package-import.contract.ts`（9 个 contract test，永久收编）
- daemon 全套验证全绿：typecheck / lint / guard:boundary / test (19 files / 53 tests，新增 +1 file +9 tests) / test:contract (12 tests，含新 9 个) / build

### C.6 0.2.0 minor release（2026-04-26 — provider sidecar replay upgrade）

**实质内容**：
- `reasoning_details` 从工具决策扩展到所有 assistant 输出，`FinalAnswerEvent` / `RuntimeEvent(final_answer)` / `AiMessage(final_answer)` / `MessageFormatter` 均保留 sidecar。
- `LlmCaller.callStream` 累积流式 `reasoning_details`，并发出 `provider_sidecar` 事件；Linnya Flow 通过 `StreamCollector` 写入最终 `final_answer.reasoning_details`。
- `ToolReplayProtocolPolicy.missingSidecarBehavior` 新增 `provider_empty_replay_field`，让 host 可以选择“保留结构化工具回放 + 交给 provider codec 补空字段”，而不是只能降级为文本。
- `linnkit` 不新增 DeepSeek/Gemini/Kimi 字段判断；DeepSeek `reasoning_content` 的真实 sidecar 映射、空字段 fallback、disabled thinking 剥离都留在 Linnya integration。

**版本判定**：公开契约新增字段和策略枚举，符合 0.x 策略中的 minor bump。

**最终上线**（2026-04-26）：
- `@linnlabs/linnkit@0.2.0` 已发布到 GitHub Packages。
- `versions: ['0.1.0', '0.1.1', '0.1.2', '0.1.3', '0.2.0']`，`latest = 0.2.0`。
- 发布前 `prepublishOnly` 通过：tsup build + `package.shell.test.ts` + dist runtime import/browser-safe smoke。
- tarball：84 files / 2.2 MB packed / 10.9 MB unpacked / shasum `2bfe3dd4b62ea8d0aa7b2897e716f07708675f7d`。

### C.7 0.2.1 patch release（2026-04-27 — docs: `INTEGRATION_GUIDE` npm-consumer rewrite）

**实质内容**：

- `docs/INTEGRATION_GUIDE.md` 彻底重写：面向 `npm install @linnlabs/linnkit` 的外部消费者；7 个稳定子入口表、装包/`.npmrc` 说明、单点接入节（含 fence 一等面）、不引用 monorepo 内部 `packages/linnkit/src/...:line`。
- 运行时 `tsup` 产物、公开 API 边界与 0.2.0 **一致**。

**最终上线**（推 `linnkit-v0.2.1` tag 触发 CI，或具备 `write:packages` 的 PAT 在 `packages/linnkit` 执行 `npm publish` 后）：

- `https://github.com/orgs/linnlabs/packages` 出现 `@linnlabs/linnkit@0.2.1`。
- 验证：`npm view @linnlabs/linnkit version --registry=https://npm.pkg.github.com/` → `0.2.1`。

### C.8 0.2.2 patch release（2026-04-27 — docs: `README` / `RELEASE` / `RELEASE-HISTORY`）

**实质内容**：

- `docs/README.md`：公开 API 表与 **7 条**子路径、`@linnlabs/linnkit` 说明对齐。
- `docs/release/RELEASE.md`：§5 改为「现行发版」为主，S0 长清单收进本文考古；§2.2 / §8 依赖建议更新。
- `RELEASE-HISTORY.md`：0.1.2 与 linnsy L10 验证行改为不误数「6 个入口」。

**最终上线**（推 `linnkit-v0.2.2` tag 或本地 `npm publish` 后）：

- `npm view @linnlabs/linnkit version --registry=https://npm.pkg.github.com/` → `0.2.2`。

### C.9 0.5.0 minor release（2026-05-12 — Phase F P0 三件）

**实质内容**：

- N-1：`AgentSpec` / `AgentCapability` / `ToolBindingSpec` / `AgentSpecContextPolicy` 进入 `linnkit/contracts`。
- N-3：`DefaultRunSupervisor` / `RunHandle` / `MemoryRunRegistryStore` 进入 `runtime-kernel/run-supervisor`；支持 cancel、observe、cost、spawnDetached、waitForTerminal、drain、recoverOnBoot。
- G-1：`AuditEnvelope` / `AuditPort` 与 noop / console / file / EventStore / composite sink 落地。
- testkit：新增 run supervisor harness、collecting audit、mock telemetry、15 条 run 不变量。
- 文档：外部接入手册拆分为 `docs/integration/`，内部 framework / research / archive 文档不再进 npm tarball。

**版本判定**：公开协议新增大量类型、子 namespace 与 runner 装配约定，符合 0.x minor bump。

### C.10 0.6.0 minor release（2026-05-13 — Context Engineering 协议化）

**实质内容**：

- `AgentSpec.contextPolicy` 扩展为上下文工程控制面：mustKeep、workingMemory、checkpoint、reasoningRetention、tokenEstimation、systemReminder、contextTrace、toolOutput、providerReplay。
- summarization 改为引用 host 注册的无工具 agent/chat，不允许 framework 内直接裸 LLM call。
- `ObservationPreviewPort` 把超长 tool observation 的完整副本交给 host 存储，模型上下文只保留 preview + `tool_output://...` 指针。
- `providerReplay` 支持按 agent 覆盖 sidecar 缺失策略。
- 新增通用最小 checkpoint 工具 `ContextCheckpointTool` / `createContextCheckpointTool()`，降低外部接入方启用主动 checkpoint 的成本。
- `framework/01` / `framework/02` / `99-research-notes/topic-agent-framework-comparison-2026.md` 按 0.6.0 候选线重评。

**版本判定**：新增公开类型、公开工具与 context policy 字段，符合 0.x minor bump。

### C.11 0.8.0 minor release（2026-05-13 — TokenizerPort）

**实质内容**：

- `TokenizerPort` 进入 `@linnlabs/linnkit/ports`，host 可以用 Claude / Gemini / 私有模型 tokenizer 替换默认 token 估算。
- `DefaultTokenizerPort` / `createDefaultTokenizerPort()` 进入 `runtime-kernel`，继续包装现有 `TokenCalculator`。
- `ContextManagerBaseOptions.tokenizer` / `tokenizerModelId` 与 `updateTokenizerModelId()` 支持同一个 context manager 跑多模型时刷新估算模型。
- testkit 新增 `createMockTokenizerPort()` 与 C12 invariant，证明 host 注入 tokenizer 后预算 trace 真正由它驱动。

**版本判定**：新增公开 port、runtime helper、testkit helper 与 context-manager 注入点，符合 0.x minor bump。

### C.12 0.9.0 minor release（2026-05-22 — stream reasoning_details + ToolNode batch）

**实质内容**：

- 新增 `appendStreamingProviderReasoningDetails` / `compactProviderReasoningDetails` / `compactReasoningDetailsInValue`。
- streaming `reasoning_details` 在最终 LLM result 与 provider sidecar event 前归并相邻纯文本片段，避免 audit 存 token-by-token 片段。
- `ToolNode` 完整消费当前 assistant message 内所有 `tool_calls`，即使较早工具调用失败，也保证同 batch 每个 tool call 都有对应 tool output。

**版本判定**：新增 runtime-kernel public exports，且 ToolNode batch 执行行为更严格，符合 0.x minor bump。

### C.13 0.10.0 minor release（2026-06-15 — checkpointKey contract）

**实质内容**：

- `GraphExecutor` / `Checkpointer` 参数命名从含混的 conversation/key 语义收敛为 `checkpointKey`，只表达 engine-state snapshot identity。
- graph telemetry 从 runtime local state 读取 host `conversationId`，不再把 checkpoint key 当 host conversation。
- 同步 child-run 可以接收显式 host `conversationId`，同时继续使用内部 checkpoint key 隔离 GraphExecutor state。
- detached run 运行时使用 `spawnDetached()` 注册时捕获的 `AgentSpec` / request / metadata snapshot，避免后台 run 被 caller 后续对象 mutation 影响。

**版本判定**：`Checkpointer` / `CheckpointMeta` host adapter contract 有公开语义变化，按 §4 走 0.x minor。这里的修复边界是“身份职责拆分”，不是在 EventStore adapter 外层加 fallback。

**发版结果**：

- tag：`v0.10.0`
- release run：`27521712528`
- 第一次 publish 失败：npmjs 返回 `E404 / The requested resource '@linnlabs/linnkit@0.10.0' could not be found or you do not have permission to access it.`
- 失败定位：typecheck / build / smoke / dist smoke / pack 全绿，tarball 包含 `bin/linnkit.cjs`；问题只在 npm package settings 未配置 Trusted Publisher。
- 修复动作：在 npm `@linnlabs/linnkit` 包设置中添加 GitHub Actions Trusted Publisher，repo=`linnlabs/linnkit`，workflow=`release.yml`，permission=`npm publish`。
- 最终结果：rerun failed job 成功；npm `latest` 更新为 `0.10.0`；GitHub Release `@linnlabs/linnkit v0.10.0` 创建成功。

---

## D. 与发布手册的分工

`RELEASE.md` 现在只保留当前发布步骤、发布边界和失败处理；本文只保留历史背景、踩坑和复盘。不要再维护“主文档章节号映射”，否则每次精简 runbook 都会制造失效引用。

| 想查什么 | 读哪里 |
|---|---|
| 现在怎么发版 | [`RELEASE.md`](./RELEASE.md) |
| 某次发版为什么这样做 | 本文 §A / §C |
| 历史 PAT / token 路线 | 本文 §B |
| 对外版本变化 | [`CHANGELOG.md`](../../CHANGELOG.md) |
