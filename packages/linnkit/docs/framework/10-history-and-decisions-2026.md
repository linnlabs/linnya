# 10 · 2026 H1 升级历史与决策档案

> **2026-05-12 重组**：本文档原名 `10-upgrade-plan-2026.md`。0.5.0 发版后拆分为两份：
>
> - **本文（10）**：**历史档案**——记录"做过什么 / 完成判据 / 已固化的设计决策 / 隐患台账 / 状态登记"。**不修改历史段落，只追加**。
> - **[`11-upgrade-plan-next.md`](./11-upgrade-plan-next.md)**：**未来计划**——下一步要做的阶段（1C / 1D / 1E / 阶段 2 / 阶段 3）。
>
> 主题：**更好的开发体验 + 更健壮的功能 + 更强大的性能**——不做复杂功能；linnkit 是框架不是平台。
>
> 本文是 [`04 协议路线图`](./04-protocol-roadmap.md) + [`06 DX 路线图`](./06-developer-experience-roadmap.md) + [`07 ROI 优先级`](./07-roi-ranked-priorities.md) 三份的**执行档案**——不重复决策原因，只登记"做什么 / 何时做 / 完成判据 / 已固化的设计决策"。
>
> **读者画像**：linnkit 维护方、内部 archeology / 决策溯源。**不是接入手册**——外部接入方读 [`docs/integration/`](../integration/)。

---

## 0. 一句话路线（截至 0.5.0 发版）

```text
阶段 0 · 清旧账（≈1 人周）             ✅ 已完成收口（2026-05-12）
阶段 1A · Phase E 边界整治（≈5.5 人周） ✅ 已完成（0.4.0，2026-05-12）
阶段 1B · Phase F P0 三件（≈5.5 人周） ✅ N-1 / N-3.A-B / G-1 已完成并完成小尾巴清扫（0.5.0）
```

**下一步**：见 [`11-upgrade-plan-next.md`](./11-upgrade-plan-next.md)（阶段 1C / 1D / 1E / 阶段 2 / 阶段 3）。

---

## 1. 升级策略

### 1.1 三个硬约束（来自用户）

- **DX**：5 分钟跑起 hello-agent；外部接入者第一周无需理解 `GraphExecutor` / 依赖袋
- **健壮**：长 run 不丢、cancel 干净、cost 不失控、出事能复盘、Checkpointer 极端情形有 contract test
- **性能**：prompt cache 稳定性、token diff 可观测、工具结果体量有界——**不做**按资源切模型、不做主机级监控

### 1.2 必做清单（按阶段）

| # | 项 | 阶段 |
|---|----|------|
| 1 | 工具协议 `Record<string, any>` → 泛型 `BaseTool<TArgs, TResult>` | 阶段 0（已收口） |
| 2 | `linnkitCompat` 删除 | 阶段 1D |
| 3 | `caller.ts` / `eventMappers.ts` 拆分到 ≤ 250 行 | 阶段 0（已完成） |
| 4 | `context-pipeline` 中文字符串 fatal error → `ContextProviderError` typed error | 阶段 0（已完成） |
| 5 | N-1 AgentSpec 一等对象（含 `contextPolicy` 11 字段，见 §9.1） | 阶段 1B |
| 6 | N-3 RunSupervisor 本体 + RunHandle v2 | 阶段 1B |
| 7 | G-1 AuditEnvelope + AuditPort | 阶段 1B |
| 8 | 5 分钟 quickstart + linnkit-cli v0（init / run / replay / doctor / inspect） | 阶段 1C |
| 9 | chat 兼容收敛（迁到 tools-disabled AgentSpec + 物理删 `profiles/chat/*`） | 阶段 1D |
| 10 | prompt cache 稳定性指南 + PromptTrace + G-3 Replay SDK + DevTools Web v0 | 阶段 2 |
| 11 | N-4 MemoryPort（仅 port + 2 个参考实现：in-memory + markdown） | 阶段 2 |
| 12 | N-5 PermissionPort（先 ask + 白名单，sandbox 后置） | 阶段 2 |
| 13 | G-2 CostLedger + QuotaPort | 阶段 2 |
| 14 | Test DSL `defineAgentTest()` | 阶段 2 |

### 1.3 必不做清单（防止压力推上来）

| 项 | 不做的原因 |
|----|----------|
| 任意图编排 / NodeRegistry / 用户画图 | 90% agent 是固定形态，过设计 |
| Memory backend 全家桶（Mem0/Honcho/Holographic 等 ≥ 3 个） | Hermes 是产品决策；linnkit 给 port + 1-2 参考实现 |
| `bash` / `web_search` / `read_file` 等业务工具内置 | 产品决策，归宿主 |
| Sandbox 具体实现（Seatbelt / bubblewrap / Docker） | 出 `SandboxPort`，宿主自实现 |
| IM 通道适配器（Telegram / WeChat / Slack） | 产品决策 |
| 按系统资源 / 任务复杂度自动切模型 | 4 家共识不做；属 host `modelPolicyResolver` |
| 主机级 CPU / 内存 / 磁盘监控 | 4 家共识不做；属 host |
| 把任何中文表达层标签（"[任务完成]" / "<additional_context>" / "编辑器写作" 等）放进 framework | host 表达层，已被 Phase C `no-host-leakage` guard 守住 |
| 在 framework 中加 `mode: 'agent' \| 'chat'` 新字段 | Phase F 退役方向，不要逆流 |

---

## 2. 阶段 0 · 清旧账

**目的**：在 Phase F 改造前把代码债清掉，避免新账旧账叠加。

### 2.1 已落地（在 0.4.0 期间顺手做了）

| # | 任务 | 状态 |
|---|------|------|
| 0.1 | `BaseTool` 工具协议从 `Record<string, any>` 收口；新增泛型 `BaseTool<TArgs, TResult>` | ✅ 收口 |
| 0.2 | 850 行 `guard:agent-boundary` 拆成 396 / 473 两个文件 | ✅ 已拆 |
| 0.3 | `no-host-leakage` guard 新建 + `shared` 禁止 import `profiles` guard | ✅ 已加 |

### 2.2 已完成收口（2026-05-12）

| # | 任务 | 文件 | 工作量 |
|---|------|------|--------|
| 0.4 | `runtime-kernel/llm/caller.ts` 已按 `request-builder / streaming-adapter / retry-fallback / usage-telemetry / sidecar-replay` 5 个职责拆；本轮核验所有拆分文件 ≤ 250 行 | 6 个文件 | ✅ |
| 0.5 | `runtime-kernel/events/eventMappers.ts` 当时按 `agent-to-runtime / runtime-to-ai-message / sse-projection / provider-sidecar` 拆；2026-06-24 Q-L3 收敛后，`sse-projection` 已删除，SSE 投影真源迁到 `contracts.runtimeEventToSSEEvent` | 5 个文件 → 4 个文件 | ✅ |
| 0.6 | `context-pipeline.ts:190` 中文字符串 fatal error → `ContextProviderError` typed error（`code / fatal / providerName / cause`） | 2 个文件 | ✅ |
| 0.7 | `agent/context/config.ts:168` 把 `DEFAULT_MODEL_ID: 'cl100k_base'` 改名为 `TOKEN_ENCODING_NAME`（实际是 tiktoken encoding 不是 model id） | 4 个文件 | ✅ |

**完成判据**：
- `rg "Record<string, any>" packages/linnkit/src` 0 条
- `caller.ts` 与 `eventMappers.ts` 每个新文件 ≤ 250 行
- `rg "errorMessage.includes" packages/linnkit/src/context-manager` 0 条

---

## 3. 阶段 1A · Phase E 边界整治（0.4.0）

> **2026-05-12 已完成**：A/B/C 三段全部落地，包版本 bump 到 `0.4.0`。详细执行计划见 [`09-context-engineering-package-boundary-plan.md`](./09-context-engineering-package-boundary-plan.md)。

### 3.1 已交付项

| 项 | 状态 |
|----|------|
| 新增 `context_injection` 通用消息 type（system/user 两侧） | ✅ |
| 新增 `FenceRegistry` + `FenceDescriptor` + `FenceInjection` | ✅ |
| 新增 `MustKeepPolicy` | ✅ |
| 新增 `FenceLifetimePreprocessor`（取代 `UserQuoteLifetimePreprocessor`） | ✅ |
| `AgentProfileRequest` 收窄到通用 agent 请求 + `fences[]` | ✅ |
| `MessageFormatter` 不再认识 `document_fragment` / `<additional_context>` / 中文 `[任务完成]` | ✅ |
| linnya host 注册 5 个 fence：`additional-context` / `project-context` / `document-context` / `user-quote` / `review-context` | ✅ |
| `linnkit/context-manager` 主入口冻结 chat namespace；保留 5 个扁平兼容符号（待 Phase F 一并删） | ✅ |
| `no-host-leakage.test.ts` + `shared 禁止 import profiles` guard | ✅ |
| 文档同步：`release/RELEASE.md` / `framework/README` / `INTEGRATION_GUIDE` / `context-manager/README` 全口径切到 fence-first | ✅ |

### 3.2 已登记给后续阶段的过渡兼容

| 项 | 处理时机 |
|----|---------|
| `linnkit/context-manager` 主入口保留的 5 个扁平兼容符号（`ChatMessageOrchestrator` / `BaseConversationalTask` / `chatMessageToAiMessage` / `aiMessageToChatMessage` / `buildGenerateRequestFromAgentRequest`） | 阶段 1D chat 收敛 |
| `userQuoteLifetime` 迁到 chat 兼容层（不在 framework shared 里） | 阶段 1D 随 `profiles/chat/*` 一起物理删 |

### 3.3 host 侧顺便登记的隐患

| # | 文件 | 隐患 | 处理时机 |
|---|------|------|---------|
| H1 | `src/app-hosts/linnya/context/agent/schemas.ts:37` | host 复制了一份 `AiMessage` zod schema（含 `document_fragment` 与 `z.any()`） | ✅ 已清：host 复用 `linnkit/contracts.AiMessage` schema，本地副本与 `any` 已移除 |

---

## 4. 阶段 1B · Phase F P0 三件（0.5.0）

**目的**：把 framework 装进"车身"——agent 一等对象、run 中枢、审计仪表盘。完成后，linnkit 从"内部好内核"升级为"外部可接入框架"。

> 设计依据：[`04-protocol-roadmap.md` §N-1 / §N-3 / §G-1](./04-protocol-roadmap.md)。
> 本节只登记**本次升级的具体执行内容与已固化决策**。

### 4.1 N-1 AgentSpec 一等对象（1 人周）

**协议形状（已固化，详见 §9.1）**：

```ts
interface AgentSpec {
  id: string;
  version: string;
  role?: string;
  description?: string;
  capabilities: AgentCapability[];
  tools: ToolBindingSpec[];

  /** 见 §9.1：8 字段中等暴露面 */
  contextPolicy: AgentSpecContextPolicy;

  modelHints?: {
    preferredProviders?: string[];
    preferredModels?: string[];
    fallbackChain?: string[];
  };

  audit?: {
    redactionLevel?: 'none' | 'standard' | 'strict';
    pii?: boolean;
  };

  metadata?: Record<string, unknown>;
}
```

> **后续修正（2026-06-22）**：`modelHints` 已从当前 `AgentSpec` 契约删除。原因是该字段从未被运行时消费，容易让接入方误以为 `fallbackChain` 会自动生效；模型选择 / fallback 现在必须由 host modelPolicy、运行时 `model_id` 或后续显式 fallback policy 承担。

**任务清单**：

| # | 任务 | 文件 | 工作量 |
|---|------|------|--------|
| N-1.1 | 新建 `packages/linnkit/src/contracts/agentSpec.ts`：`AgentSpec` + `AgentCapability` + `ToolBindingSpec` + `AgentSpecContextPolicy`（11 字段，含 `toolHistory.strategy` / `overflowStrategy`）zod schema | ✅ 已完成：schema + contract test + public export snapshot | 1.5 天 |
| N-1.2 | `ToolBindingSpec.argsSchema` 类型用 `Record<string, unknown>`，**严禁 `any`** | 同上 | 含 N-1.1 |
| N-1.3 | **实现三策略派发**（关键扩展，见 §9.1）：<br/>(a) `ToolInteractionGroup` 加 `runOrdinal: number` 元数据（在 `buildToolInteractionGroups` 内按 `user_input` 边界计算）<br/>(b) `compressToolCallPairsInHistory` 改造为 strategy-driven：`per-pair` 走原逻辑；`per-run` 按 `runOrdinal` 保留最近 K 个 run 内的所有完整 group；`none` 常规不压缩；三策略共用 `maxInteractionGroups + overflowStrategy` 安全阀<br/>(c) `createDefaultAgentPreprocessorRegistry()` 接受 `toolHistory`，注入 strategy + 对应参数 | `shared/toolInteractionGroup.ts` + `agent/preprocessors/toolHistoryCompressor.ts` + `agent/preprocessors/index.ts:244-269` + 对应 test | 1.7 天 |
| N-1.4 | 改造 `AgentWorkingMemoryProvider.constructor()`：接受 `Partial<AgentContextBuilderConfig>`；让 `createAgentContextBuilderConfig()` helper 从死代码变成 hot path | ✅ 已完成：provider constructor + host `createDefaultAgentProviderRegistry(customConfig)` 透传 + customConfig 锁定测试 | 0.5 天 |
| N-1.5 | 提供 host 装配 helper：`agentSpecToContextBuilderConfig(spec): Partial<AgentContextBuilderConfig>`——linnkit 内部不直接读 `AgentSpec`，保持 framework 不依赖宿主形态 | ✅ 已完成：`context-manager/shared/agentSpecAdapter.ts` | 0.5 天 |
| ~~N-1.6~~ | ~~`promptKey` / `mode` 字段标 `@deprecated` + codemod~~ | ❌ **按 §9.6 取消**——AgentSpec 与 AgentProfileRequest 并存不替代，`promptKey` 保留为协议入口 | 0 天 |
| N-1.7 | linnya host 试点接入：找一个 agent definition 用 AgentSpec 写一遍，跑通主链路；同时验证 `strategy: 'per-run'` 的实际工具历史保留行为 | ✅ 已扩展为全量：33 个 agent/chat definition + builtin autocomplete 显式声明 `contextPolicy` | 1 天 |
| N-1.8 | 文档：在 `04 §N-1` 补 contextPolicy 扩展说明；`INTEGRATION_GUIDE` 加 "AgentSpec 入门" + "三种工具压缩策略对比"；本文件 §11 追加完成记录 | ✅ 已完成：04 / INTEGRATION / 10 均已同步 | 0.5 天 |

**完成判据**：
- `linnkit/contracts` 导出 `AgentSpec` schema，contract test 全绿
- `ToolInteractionGroup.runOrdinal` 在所有 buildToolInteractionGroups* 出口处一致填充，有 unit test 覆盖
- `strategy: 'per-pair'` / `'per-run'` / `'none'` 各 1 个 integration test：
  - per-pair / N=2：保留全局最近 2 组工具对（向后兼容）
  - per-run / K=1：保留上一个 run 内**所有**完整工具组（即使有 5 个也全留）
  - none：不调用 compressor，所有 group 保留
- `createDefaultAgentPreprocessorRegistry({ toolHistory: { strategy: 'per-run', keepLatestRuns: 2 } })` 真的改变压缩行为
- 至少 1 个 linnya agent 通过 AgentSpec 走通
- `promptKey` 仍可工作（deprecated alias，console.warn）

### 4.2 N-3 RunSupervisor 本体 + RunHandle v2（2 人周）

**依赖**：N-1 AgentSpec 完成。

**RunSupervisor 9 方法 + RunHandle 8 方法**详见 [`04 §N-3`](./04-protocol-roadmap.md#n-3-runsupervisor-本体--runhandle-v2-p0)。

**关键不变量**（不可妥协）：

| 不变量 | 含义 |
|--------|------|
| `cancel(forceCleanup=false)` = soft | 调 `controller.abort()`；graph 主循环下一个 step 退出；发 `run.cancelled` 事件 |
| `cancel(forceCleanup=true)` = hard | 同样 `controller.abort()`；尊重 signal 的工具会立即停；不尊重的工具继续；`forceCleanup: true` 标记进事件 |
| 物理上 soft/hard 都是 `abort()` | 差别由"工具是否尊重 signal"产生——N-3.A 段不强行统一，保留现实主义 |
| `pause` ≠ `cancel` | 保留 graph state；可 resume；`pause` 期间 cost 不计算（N-3.B 段实现） |
| `cost()` 父子聚合 | `runTree(rootRunId)` 的 cost 是子 run 之和（N-3.B 段实现） |
| `RunHandle.spec()` 返回快照 | 调用时冻结的副本——后续 host 改 AgentDefinition 不影响 in-flight run |
| N-3.A 不改 graph-engine | `EngineLocalState.signal: AbortSignal` 物理通道已存在；N-3 只做"聚合 + 暴露" |
| N-3.B 占位必须显式 | N-3.A 段 `pause/resume/runTree/spawnDetached/handleFailure` 都抛 `NotImplementedError`；N-3.B 已填实 `spawnDetached/waitForTerminal/findActiveByConversation/drain/recoverOnBoot`，`pause/resume/runTree/handleFailure` 继续按真实需求触发 |

**关键架构发现（2026-05-12 核查）**：

读完 `graph-engine/README §5.1` + `flow/README §2-3` 后确认：

1. **cancel 物理通道已存在**：`EngineLocalState.signal: AbortSignal` + GraphExecutor 主循环每个 step 开头查 `signal.aborted`——N-3 无需新建任何取消机制
2. **N-3 的本质是聚合，不是新建**：分散在 `EventSequencer.executionId` / `EngineLocalState.{signal,conversationId,turnId,request}` / `EventBus`（per-execution）/ `RunLifecycleCoordinator` / `llmTelemetryMiddleware` 5 处的状态，统一归并到一个 `RunHandle`
3. **N-3.A 工时下修**：从 2 人周（10 天）→ 1 人周（4.5 天）——因为没有任何新机制要发明

**N-3.A 完整子任务清单**：

| # | 任务 | 工时 | 状态 |
|---|------|------|------|
| N-3.A.1 | `RunRegistryStore` 扩展 `paused` / `agentSpecId` / `pausedAt` / `pauseReason`；memory store 支持按 `agentSpecId` list 过滤 | 0.5d | ✅ 2026-05-12 |
| N-3.A.2 | `RunHandle` 接口 + `DefaultRunHandle` 实现（spec/request/cancel/observe/cost/meta/只读 signal + 生命周期状态写口 + pause/resume 占位）+ 单测覆盖 | 1.5d | ✅ 2026-05-12 |
| N-3.A.3 | `RunSupervisor` 接口 + `DefaultRunSupervisor` 实现（registerRun/observeRun/cancel/list/peek + N-3.B 5 占位）+ 5 单测 case | 1.5d | ✅ 2026-05-12 |
| N-3.A.4 | framework 改造：`RunRegistrationSpec` 加 `runId?: string` + `parentSignal?: AbortSignal`（解隐患 W）；新增 `RunAlreadyRegisteredError`；framework 单测 +3 case | 0.5d | ✅ 2026-05-12 |
| N-3.A.5 | host 装配：新增 `RunCostCollector` + `agentDefinitionToAgentSpec` 适配器；host 启动入口注册 supervisor/costCollector/eventStore 单例；接入 TelemetryPort | 1.7d | ✅ 2026-05-12 |
| N-3.A.6 | host 集成：`FlowAgentRunRequest.runHandle` 字段；`flow.orchestrator` 注册 run 取 handle；`AgentRunnerService` markRunning/markCompleted/markFailed + 替换 signal 来源 + 从 RunRecord 读 cancel reason 写进 stream_end（解隐患 Y）| 0.9d | ✅ 2026-05-12 |
| N-3.A.7 | 深度测试：`runCostCollector.test.ts` 6 case / `agentDefinitionToAgentSpec.test.ts` 4 case / flow interrupted/summarization 回归 | 1.0d | ✅ 2026-05-12 |
| N-3.A.8 | 文档：04 协议 / INTEGRATION_GUIDE 加"5 行代码启动 run"章节 / §11 状态登记 | 0.2d | ✅ 2026-05-12 |
| N-3.B.0 | 同步 child-run telemetry/cost 隔离：child run 使用独立 `runId`（默认 `subrunId`），父 run 通过 `parentRunId` 聚合 `childrenTotal`；不引入后台 detached 执行 | 0.5d | ✅ 2026-05-12 |
| N-3.B.1 | 修隐患 AF：`WaitUserNode` 产生的 `requires_user_interaction` RuntimeEvent 补 `metadata.run_context.runId`；host runner 发布 `runUntilYield().events` 中的 wait-user 事实事件；`RunHandle.markAwaitingUser()` / `DefaultRunSupervisor` 事件联动写入 `RunRecord.status='awaiting_user'` | 0.5d | ✅ 2026-05-12 |
| N-3.B.2 | detached run 协议回流：`RunSupervisor.spawnDetached` / `waitForTerminal` / `findActiveByConversation` / `drain` / `recoverOnBoot` + `RunOutcome` / `RunSnapshot` / `RunExecutorPort`；`RunRegistrationSpec` 补 `iterationBudget/query/contextFences/wakeSource/ephemeral` | 3.0d | ✅ 2026-05-12 |
| N-3.B.3 | testkit 补 detached / wait-user 不变量：新增 I13-I15，`createRunSupervisorHarness({ executor })` 支持后台 run 场景 | 0.5d | ✅ 2026-05-12 |
| **合计** | （较前次估算 +0.6d；原因：新发现隐患 W/X/Y + cost 集成必须自建 RunCostCollector + AgentSpec 物化）| **5.1d** | |

### 4.3 G-1 AuditEnvelope + AuditPort（1 人周）

**依赖**：N-3 RunSupervisor（让 cancel/pause/resume 联动发 envelope）。

**落地拆分**：

| 子任务 | 内容 | 状态 |
|---|---|---|
| G-1.A | `AuditEnvelope` zod schema + `AuditPort` + `noopAudit` / `consoleAudit` / `fileAudit`；`RunHandle.cancel()` 自动 emit `run.cancel` envelope；公共出口 snapshot 更新 | ✅ 2026-05-12 |
| G-1.B | 5 类非确定性决策接入：模型选择 / 工具拒绝 / fallback / wait_user / sandbox；补 EventStore 默认落点 | ✅ 2026-05-12 |
| G-1.C | host 管理面 / CLI `inspect` 消费审计流 | 📋 跟随 CLI / DevTools |

**关键不变量**：

- 所有"非确定性决策"必须发 envelope：模型选择 / 工具拒绝 / fallback / wait_user / sandbox 决策
- envelope **追加只读**
- envelope 默认进 `EventStore`（per `eventGovernance`），宿主可选择再发 OTel / SIEM / 文件

**完成判据**：
- `AuditEnvelope` schema + `AuditPort` 接口入 `linnkit/contracts` + `linnkit/ports` ✅
- 3 个 sample 实现：`noopAudit` / `consoleAudit` / `fileAudit` ✅
- 默认 `EventStore` 落点：`audit_envelope` hidden RuntimeEvent，只持久化，不进 UI / 上下文 / SSE ✅
- contract test 覆盖 5 类事件：模型选择 / fallback / 工具拒绝 / wait_user / sandbox 决策 ✅
- 与 RunSupervisor 联动：cancel 已落地；pause/resume 等 N-3.B 实现后复用同一 emit helper 补 envelope ✅ / 📋

---

## 5. 阶段 1C / 1D / 1E / 2 / 3（未做）

> **2026-06-22 治理归档注记**：本节是 2026-05-12 当时的历史状态，保留不改。实际后续进展已在 §6 追加归档：阶段 1F 已于 0.6.0 完成，阶段 1C 已于 0.7.0 完成；仍未完成的施工项以 [`14-governance-and-cleanup-plan.md`](./14-governance-and-cleanup-plan.md) 为准。

迁出到 [`11-upgrade-plan-next.md`](./11-upgrade-plan-next.md)：

- 阶段 1C · Quickstart + linnkit-cli v0
- 阶段 1D · chat 兼容收敛 + 删 linnkitCompat
- 阶段 1E · linnsy 适配 thin wrapper
- 阶段 2 · Phase G 性能/DX 子集
- 阶段 3 · 按需触发

本档案不再维护这部分；任何新需求都登记到 11 文档。

---

## 6. 2026-06-22 治理归档：1F / 1C 已完成阶段下沉

> 本节是 2026-06-22 文档治理追加段，用来承接 [`11-upgrade-plan-next.md`](./11-upgrade-plan-next.md) 中已经完成但仍留在“未来计划”里的阶段。版本事实以 [`../../CHANGELOG.md`](../../CHANGELOG.md) 为准；后续活施工清单以 [`14-governance-and-cleanup-plan.md`](./14-governance-and-cleanup-plan.md) 为准。

### 6.1 阶段 1F · Context Engineering 协议化（0.6.0）

**完成状态**：✅ 已完成。0.6.0 将 `AgentSpec.contextPolicy` 从早期少量字段扩展为 12 大分组，完成“声明式上下文政策 + 可观测 ContextTrace”的主链路。

| 能力 | 归档结论 |
|---|---|
| `contextPolicy` 协议面 | 当时 `budget` / `toolHistory` / `toolOutput` / `providerReplay` / `summarization` / `mustKeep` / `workingMemory` / `checkpoint` / `reasoningRetention` / `tokenEstimation` / `systemReminder` / `contextTrace` 进入公开契约；`providerReplay` 后于 2026-08-14 下沉 inference route |
| 运行时接线 | working memory、checkpoint、token estimation、reasoning retention、summarization agent、SystemReminder、tool output governance、provider replay 均已从声明式 policy 进入运行时 |
| 可观测 | `ContextTrace` sidecar 已能解释 effective policy、provider token delta、message keep/drop 决策；trace 默认关闭，按需开启 |
| 测试与发布门禁 | 11 条 contextPolicy 不变量已进入 testkit；`runtime-kernel` exports snapshot 已包含 SystemReminder / checkpoint 相关公开符号 |
| 边界约束 | framework 只保存注册 ID 与声明式配置，不持有 host prompt 正文，不内置业务工具，不把 host 表达层塞回 framework |

**固化决策**：

- 摘要能力走 `summarization.agentId`，由 host 注册无工具摘要 agent/chat；framework 不直接持有 prompt 正文。
- SystemReminder 走 trigger/template 注册表；spec 只引用规则与模板 ID，避免函数注入破坏序列化、回放与审计。
- `ContextTrace` 是 1F 的最小可观测闭环，不等同于完整 DevTools / PromptTrace；后者若有真实需求，另行立项。
- `ProviderReplay` 与 `toolOutput.observationGovernance` 属于上下文 token 治理能力，但落盘、对象存储、provider 具体策略仍归 host port / host policy。

### 6.2 阶段 1C · Quickstart + linnkit-cli v0（0.7.0）

**完成状态**：✅ 已完成。0.7.0 只落 P0 三件套，保持 provider-neutral，不新增独立 provider/store starter 包。

| 能力 | 归档结论 |
|---|---|
| quickstart helpers | `defineAgent` / `runAgent` / `defineConfig` 已进入 quickstart 入口 |
| public sub-entrypoint | `@linnlabs/linnkit/quickstart` 已公开 |
| CLI v0 | `linnkit init` / `linnkit run` / `linnkit doctor` 已落地 |
| 模板边界 | quickstart 模板是自包含 demo host；生产接入仍以 `docs/integration/*` 为准 |
| 明确延后 | `replay` / `inspect` 依赖 Replay SDK / DevTools，不纳入 1C v0 |

**固化决策**：

- CLI v0 优先服务“5 分钟跑起 hello-agent”，不是完整运维面板。
- provider adapter 与 store adapter 不进入 linnkit runtime；framework 继续保持 provider-neutral。
- quickstart 是 DX 入口，不替代正式接入指南。

### 6.3 仍未完成项的归属

| 项 | 当前归属 |
|---|---|
| 阶段 1D · chat 兼容层物理删除 | 仍未完成；已在 14 文档 A 类登记，前置是 host 迁 tools-disabled `AgentSpec` |
| 阶段 2 · 性能/DX 子集 | 拆散到 14 文档 D / PF / B / BM 类；Token ledger 批 1–4 已完成，批 5/6 与 Replay SDK / DevTools / Test DSL 等继续排期 |
| 阶段 3 · 跨进程 / 分布式能力 | 继续按真实需求触发，不预先承诺 |
| MemoryPort / KnowledgePort / PromptTrace | 2026-06-22 重新评估为不做 framework port；中长期记忆如做，应归 host 业务层“工具 + 召回 + fence 注入” |

---

## 9. 已固化的设计决策

> 这一节登记的决策**不可逆**（除非显式开 ADR 推翻）。

### 9.1 AgentSpec.contextPolicy 字段范围（2026-05-12 拍板：B 中等 + per-run 策略）

**决策**：暴露 **11 个字段**，覆盖 `AGENT_CONTEXT_BUILDER_CONFIG` 里 95% 会被 host 调用的场景；剩余 5% 内部 tuning（如 `AVG_CHARS_PER_TOKEN`、`P*_PRIORITY` 常量）**不**进 AgentSpec。

```ts
interface AgentSpecContextPolicy {
  /** 必填：复用现有 context profile 概念，对应 'agent' / 'chat-compat' */
  profileId: string;

  /** 可选：Token 预算 override */
  budget?: {
    maxTokens?: number;
    reservedForResponse?: number;
    workingMemoryBudgetPercentage?: number;
  };

  /** 可选：工具历史压缩 override */
  toolHistory?: {
    /**
     * 压缩策略类型（默认 'per-run'）
     * - 'per-pair'：按工具对个数裁（旧默认；适合 4K/8K 等超紧上下文模型）
     * - 'per-run'：按 user_input 划 run 边界，保留最近 K 个 run 完整工具序列（prompt cache 友好；通用默认）
     * - 'none'：不压缩（适合 200K+ 长 context 模型；仅靠单 tool_output token cap 兜底）
     *
     * 注：当前 run（最后一条 user_input 之后）所有工具对永不压缩，不受 strategy 影响。
     */
    strategy?: 'per-pair' | 'per-run' | 'none';

    /** strategy='per-pair' 时：保留最近 N 组完整工具对（默认 2） */
    keepLatestToolPairs?: number;

    /** strategy='per-run' 时：保留最近 K 个 run 完整工具序列（默认 1） */
    keepLatestRuns?: number;

    /** 工作记忆层最多保留的工具交互组总数硬上限（所有 strategy 共用，默认 12） */
    maxInteractionGroups?: number;

    /**
     * 溢出 maxInteractionGroups 时的处置（默认 'keep-latest'）
     * - 'keep-latest'：按 originalIndex 倒序截，留尾不留头（保证最近行动可见）
     * - 'fail-fast'：抛 ContextProviderError，让 host 显式处理
     */
    overflowStrategy?: 'keep-latest' | 'fail-fast';

  };

  /** 可选：摘要触发与体量 override */
  summarization?: {
    triggerThreshold?: number;
    budgetPercentage?: number;
    oldestMessagesPercentage?: number;
  };
}
```

**默认值汇总**：

| 字段 | 默认 |
|------|------|
| `toolHistory.strategy` | `'per-run'`（推荐主流默认） |
| `toolHistory.keepLatestRuns` | `1`（保留上一个 run 完整工具序列） |
| `toolHistory.keepLatestToolPairs` | `2`（仅 `strategy='per-pair'` 时生效，兼容旧默认） |
| `toolHistory.maxInteractionGroups` | `12` |
| `toolHistory.overflowStrategy` | `'keep-latest'` |

> 2026-07-08 更新：`toolHistory.maxPairTokens` / `maxOutputSummaryTokens` 已从公开契约移除。构建期不再按单对工具 token 做截断，tool output 的尺寸治理统一由执行期 `toolOutput.observationGovernance` 负责。

**取舍理由**：

| 取舍 | 理由 |
|------|------|
| 把"工具压缩"提升到 **strategy 类型**而非纯参数 | 三种策略（per-pair / per-run / none）语义截然不同，不是同一算法的调参；强制 strategy 显式选择能避免"调 N=几"的拍脑袋 |
| **默认值改为 `'per-run'`** | (1) prompt cache 命中率：per-run 保证上一个 run 的工具序列 prefix 稳定；(2) 语义完整性：不腰斩同一意图的工具链；(3) 主流 agent（CC / Codex / OpenClaw）实质做法都接近 per-run 或更宽松；(4) 现有 `per-pair` 默认实质是 last-N 跨 run 切，业界少见 |
| 同时保留 `keepLatestToolPairs` 字段 | per-pair 策略仍是合法选项（4K/8K 模型场景），不能直接删；只是从默认 → 可选 |
| 增加 `overflowStrategy` | `keep-latest` 保持默认自愈；`fail-fast` 把“工具组超过硬上限”变成可监控 invariant，而不是静默丢上下文 |
| 暴露 `toolHistory.*` 等具体字段，**不**暴露整个 `Partial<AgentContextBuilderConfig>` | host 真正需要决定的是行为参数；framework 内部 tuning 不进协议 |
| **不**暴露 `P1_TOOL_INTERACTION_PRIORITY` 等优先级常量 | 优先级是 framework 算法骨架（P1 永远 > P2 > P3），不是 host 决定 |
| **不**暴露 `CORE_MESSAGE_TYPES` | 协议级 vocabulary，不是 host 配置项 |
| `contextPolicy` 而非 `contextConfig` | "policy" 表达"宿主的政策"，"config" 太像内部 tuning |

**默认值变更的兼容声明**：

`strategy` 默认从历史隐式的 per-pair（N=2）→ `'per-run'`（K=1）。对所有 host 来说：

- 不会引入新 bug（per-run 是 per-pair 的超集——保留更多消息，不会少留）
- 平均 history token 数 +20-40%（具体看 history 中工具调用密度）
- prompt cache 命中率上升
- host 想保持旧行为：在 AgentSpec 显式设 `toolHistory.strategy: 'per-pair'`

### 9.2 `ChatMessage` 类型搬到 shared（2026-05-11 拍板：A 物理上提）

**决策**：`ChatMessage` 物理搬到 `shared/contracts/chatLineMessage.ts`，`profiles/chat/contracts.ts` 反过来 re-export。理由：`ChatMessage` 本质是 "LLM 调用 wire 格式"，本来就是 shared 概念，只是历史上落错位置。

**实施时机**：阶段 0 剩余收口 / 阶段 1B 起手时一并完成（依附 `caller.ts` 拆分）。

### 9.4 framework 工具压缩默认 strategy 修正（2026-05-12 拍板：A 改代码追文档）

**决策**：把 `toolHistoryCompressor.ts:67` 的 `?? 'per-pair'` 改为 `?? 'per-run'`，让 framework 实现默认与 §9.1 文档承诺一致。

**修复范围**：
- `packages/linnkit/src/context-manager/profiles/agent/preprocessors/toolHistoryCompressor.ts:67` 改默认值
- `packages/linnkit/src/context-manager/profiles/agent/preprocessors/__tests__/toolHistoryCompressor.strategy.test.ts` 调整"不传 options 时的期望"测试 case
- 现有 `toolHistoryCompressor.test.ts`（per-pair 旧行为测试）保持不变，但要显式构造 `{ strategy: 'per-pair' }` 而不是依赖默认

**影响面**：
- 所有不传 `toolHistory` options 的 host 调用方（目前是 100% 的 linnya 调用，因为 `AgentMessageOrchestrator:92` 不传 toolHistory）将自动切到 per-run K=1
- 平均 history token 数 +20-40%
- prompt cache 命中率上升
- host 想保持旧默认：在 `AgentDefinition.config.contextPolicy.toolHistory.strategy` 显式声明 `'per-pair'`

**修复时机**：阶段 1B 起手第一刀，**先于 N-1.1**（5 分钟 + 1 个测试 case 调整）。

### 9.6 AgentSpec 与 AgentProfileRequest 的形态关系（2026-05-12 拍板：A 并存）

**决策**：AgentSpec 与 AgentProfileRequest **并存且互补**，不互相替代。

| 协议 | 职责 | 内容 |
|------|------|------|
| `AgentSpec` | agent 的**静态画像**——"我是什么 agent" | `id` / `version` / `capabilities` / `tools` / `contextPolicy` / `audit` |
| `AgentProfileRequest` | 单次 invoke 的**调用契约**——"这次要做什么" | `query` / `promptKey` / `mode` / `availableTools` / `model_id` 等 per-invocation 字段 |
| 关联 | `AgentSpec.id === AgentProfileRequest.promptKey` 建立 1:1 映射 | host 的 `AgentDefinition` 是这两者的延伸（含 promptKey 与 config.contextPolicy）|

**关键不变量**（写代码时遵循）：

- AgentSpec 是**声明性**：可序列化、可版本化、可复制；不包含任何 per-invocation 信息
- AgentProfileRequest 是**调用性**：每次 invoke 都不同；不试图描述 agent 静态结构
- 两者**不**互相 import：framework 内 AgentSpec 不依赖 AgentProfileRequest 类型，反之亦然；host 通过 `agentSpecAdapter` 做桥

**对后续协议的影响**：

- **N-1.6（promptKey / mode @deprecated + codemod）按本决策取消**——promptKey 仍是 framework 协议入口
- N-3 RunHandle 提供 `spec(): AgentSpec` + `request(): AgentProfileRequest` 两个 getter
- 阶段 1D 删 chat 通过 `tools: []` 的 AgentSpec 表达，与 `mode` 字段 deprecation **无关**
- AgentSpec 的演进（capabilities / audit 等）独立于 AgentProfileRequest 字段演进

**取舍理由**：

| 取舍 | 理由 |
|------|------|
| 职责分离 | spec 与 request 本来就是两个职责（静态画像 vs 单次调用）—— 合并会让 spec 强制带 query 等 per-invocation 字段，违反"声明性" |
| 同类框架共识 | LangGraph / Mastra / OpenAI Agents SDK / Codex 全部 definition + invocation 分离 |
| 兼容性 | promptKey 已经用了 1 年+，标 deprecated 会破坏全仓 host 调用面（35 agent + 8 chat + 前端入口）|
| mode 字段已被 Phase E 收敛 | mode 通过 fence + tools-disabled AgentSpec 表达，不需要再正面拆 |

### 9.5 host per-agent contextPolicy 显式声明（2026-05-12 拍板：A 每个 definition 显式）

**决策**：在 `AgentDefinition.config` 加 `contextPolicy?: AgentSpecContextPolicy`，**每个 agent 在自己的 `index.ts` 显式声明**，不走预设模板、不依赖全局默认。

**理由**：
- agent 作者最了解自己的预期工具密度（高 vs 低）+ 配置的模型 ctx（128K vs 32K）+ 工具结果体量（大文本 vs 小数字）
- 全局默认 per-run K=1 是合理兜底，但 deep_research_leader / mindmap_workflow_leader 这类高密度子调度 agent 应该显式 K=2-3；translation / autocomplete / 内部子 agent 应该显式 N=0 极致省 token
- 预设模板（per_agent_policy_strategy 选项 B）的反对理由：换模型时不知道哪些预设需要联动改，**间接耦合**比直接耦合更糟

**类型层**：`AgentDefinition.config.contextPolicy` 复用 framework 类型 `AgentSpecContextPolicy`，禁止 host 维护本地副本（避免重蹈 `schemas.ts` 复制 zod 的覆辙）。

**实施时机**：N-1.7 阶段，约 1 天（35 agent + 8 chat definition，多数能用 1-2 行 contextPolicy 字面量）。

### 9.3 `task_completion` 改纯透传（2026-05-12 落地 0.4.0）

**决策**：`MessageFormatter` 的 `case 'task_request'` / `case 'task_completion'` 改成 `return { role, content }` 纯透传，删除中文 `[任务完成]` 包装。host 如需包装请通过 fence formatter 实现。

**已加 guard**：`no-host-leakage.test.ts` 禁止 framework 出现 `[任务完成]` 字面。

---

### 9.7 RunHandle.runId 命名方案（2026-05-12 拍板：A host 传 turnId 作 runId）

**问题**：N-3.A.3 落地后，`DefaultRunSupervisor.registerRun` 内部 `generateRunId()` 生成的 runId 与 host `runBootstrapper.ts:138` 里 `runId = params.turnId` 设置的 RunContext.runId **不相等**。

**直接后果**：
- `RunHandle.observe(filter.includePersisted=true)` 调 `EventStore.range(conversationId)` 后用 `event.runId === this.runId || metadata.run_context.runId === this.runId` 双匹配
- 但 host 写入 `PersistedEvent.runId` 用的是 `mappingContext.metadata.run_context.runId = turnId`
- supervisor 的 runId ≠ turnId → 匹配 0 条事件 → persisted replay 失效（**隐患 W**）

**决策（A）**：`RunRegistrationSpec` 增加可选 `runId?: string` 字段；host 在 `flow.orchestrator` 注册 run 时显式传 `turnId` 作为 runId；framework `DefaultRunSupervisor.registerRun` 优先使用 `spec.runId`，否则 fallback 到 `runIdFactory()`（保留子 run / spawnDetached 默认行为）。

**为什么不选 B（host 替换为 supervisor runId）**：
- B 方案要改 `runBootstrapper.createDefaultRunContext({ runId })` / `runLifecycleCoordinator.mappingContext.metadata.run_context.runId` / 所有下游读 `runContext.runId` 的逻辑（LLM audit 落盘文件名、tool runId 追踪）
- 工时 2-3 天，回归风险高
- "runId 通常对应 turnId 或 messageId" 本来就是 `RunContext.runId` 的官方语义（types.ts:13）——A 方案是顺应现有语义，B 方案是颠覆

**遗留**：4 个 ID（conversationId / turnId / runId / traceId）命名"不同名同值"的状态会持续到 N-3.B。N-3.B 在做 child-run + spawnDetached 时一次性命名规范化。

**配套 framework 改动**：
- `RunRegistrationSpec.runId?: string`
- `RunRegistrationSpec.parentSignal?: AbortSignal`（abort chain：外部 signal aborted 时自动级联到 runHandle.signal）
- 新增 `RunAlreadyRegisteredError`（同 runId 注册 2 次抛此错误，防 host 重入污染）

**配套 host 改动**：
- 在 host bootstrap 创建 supervisor + costCollector + eventStore 单例
- `FlowAgentRunRequest` 加 `runHandle` 字段
- `AgentRunnerService` 用 `runHandle.signal` 替换 `runRequest.signal`
- run 起止用 `markRunning / markCompleted / markFailed` 写 RunRecord
- catch `AbortError` 后从 `supervisor.peek(runId).errorIfAny.message` 拿 reason 写 stream_end（**解隐患 Y**）

### 9.8 N-3.B 范围重定义（2026-05-12 拍板：协议回流 + awaiting_user 联动）

**研究依据**：读完 linnsy `runtime/run-spawner/` + `internal-subagent/` 后确认——linnsy 已经在 host 层实现了完整的 detached run 基础设施（含 `spawnDetached` / `waitForTerminal` / `findActiveByConversation` / `drain` / `recoverOnBoot` / `RunOutcome` / `RunSnapshot` / `RunTerminalEvent`），且其内部直接 import `runSupervisor.RunRegistryStore` / `RunRecord`——它已经在用 linnkit 协议，只是补了 linnkit 没提供的能力。N-3.B 的本质是**协议回流**，不是新建。

**同步 vs 异步是两条 API，不是一个开关**：

| API | 谁调 | 何时返回 | 当前实现 |
|-----|------|---------|---------|
| `toolContext.invokeChildRun(spec)` | 父 agent 的工具内部 | 子完成后（result 当工具 output 喂回父）| ✅ `ChildRunInvoker` 已落地 |
| `runSupervisor.spawnDetached(spec)` | HTTP / cron / wake hook / 顶层入口 | 立刻返回 runId | 🔴 N-3.B 新增 |

不在 `AgentSpec` 或 `RunRegistrationSpec` 加 "executionMode" 开关——同一个 graph 两条 API 都能跑，graph 本身不需要知道自己被怎么调用。

**`awaiting_user` 与 `paused` 不是命名冲突**（撤回先前"建议改 paused → awaiting_user"的判断）：

| 状态 | 触发 | 恢复方式 |
|------|------|---------|
| `'awaiting_user'` | `WaitUserNode.run() → kind='pause'` | 用户提交输入 → host 喂回 engine 续跑 |
| `'paused'` | `RunHandle.pause()`（N-3.B 仍占位）| `RunHandle.resume()` |

两者是独立状态，都保留。

**N-3.B 子段清单（替换之前的"pause/resume + runTree"草案）**：

| 子段 | 内容 | 工时 |
|------|------|------|
| B.0 | **修隐患 AF**：WaitUserNode → RunStatus 链路联动。修订后不新增 `run.awaiting_user` 事件，而是复用已经存在且已文档化的事实事件 `requires_user_interaction`：`WaitUserNode` 写入 `metadata.run_context.runId`，host runner 发布/持久化 `runUntilYield().events` 中的 wait-user 事件，`DefaultRunSupervisor` 订阅该事件并写 `RunRecord.status = 'awaiting_user'`；同时提供 `RunHandle.markAwaitingUser()` 供 host runner 同步写入，避免 EventBus 异步 listener 带来的竞态。engine 仍然不持有 supervisor 引用 | 0.5d |
| B.1 | `RunSupervisor` 协议扩展（回流 linnsy 5 个能力）：`spawnDetached` / `waitForTerminal` / `findActiveByConversation` / `drain` / `recoverOnBoot`；新增 `RunSnapshot` / `RunOutcome` / `RunTerminalEvent` 类型；`RunRegistrationSpec` 补 `iterationBudget` / `query?` / `contextFences?` / `wakeSource?: string`（泛化，**不**枚举 linnsy 业务值）/ `ephemeral?` 字段 | 1.5d |
| B.2 | `DefaultRunSupervisor` 实现（直接参考 linnsy `run-spawner.ts:85-237`）：abort chain / outcome persistence / terminal waiter notification / in-flight tracker / drain / recoverOnBoot；持久化 store 保留在 host（linnkit 仍只给 memory 实现）| 1.5d |
| B.3 | host 接入示例 + INTEGRATION_GUIDE 加 "spawnDetached vs invokeChildRun" 对比章节 | 0.4d |
| B.4 | testkit 补 4 条 detached spawn 不变量（spawn 后 status 走完整链路 / awaiting_user 必持久化 / waitForTerminal 不漏事件 / drain 后 in-flight 为 0）| 0.5d |
| B.5 | 顺手解隐患 Z 命名规范化：`subrun/` → `child-run-trace/`，`internalAgentInvoker.ts` → `childRunInvoker.ts`，事件 type `subrun_trace` 保留，公开 namespace 改为 `childRunTrace` | ✅ 2026-05-12 |
| B.6 | 文档：04 协议补完 / framework/10 §11 状态登记 | ✅ 2026-05-12 |
| **合计** | （原"pause/resume + runTree"草案推迟到阶段 3 按需触发，无人在等）| **5.3d** |

**`RunHandle.pause()` / `resume()` 保持 NotImplementedError**——linnsy 也没做真正的进程级冷暂停，业务真有需求再做。

---

## 10. 已知隐患台账

> 状态符号：✅ 已修复 / ⏳ 计划中 / 🟡 登记待办

| # | 文件 | 隐患 | 状态 | 处理阶段 |
|---|------|------|------|---------|
| A | `runtime-kernel/tools/toolContracts.ts` | `BaseTool.run` 的 `Record<string, any>` | ✅ | 阶段 0 |
| B | `src/index.ts:23-27` | `linnkitCompat` 迁移期 alias 未删 | ⏳ | 阶段 1D |
| C | `runtime-kernel/llm/caller.ts` 800 行 | 越过 700 关注线 | ✅ | 阶段 0 已完成：主文件 114 行，5 个职责文件均 ≤ 250 行 |
| D | `runtime-kernel/events/eventMappers.ts` 751 行 | 越过 700 关注线 | ✅ | 阶段 0 已完成：主文件 79 行，4 个 mapper 文件均 ≤ 250 行 |
| E | `context-manager/shared/context-pipeline.ts:190` | 字符串 `'历史对话摘要失败'` 判断 fatal error | ✅ | 阶段 0 已完成：改为 `ContextProviderError` + `SUMMARIZATION_FAILED` |
| F | `context-manager/profiles/agent/preprocessors/index.ts:250` | `new ToolHistoryCompressorPreprocessor()` 不传 `keepLatestToolPairs` | ✅ | N-1.3 |
| G | `context-manager/profiles/agent/context/providers/AgentWorkingMemoryProvider.ts:38` | 直接 `import { AGENT_CONTEXT_BUILDER_CONFIG }`，构造函数不接受 config 注入 | ✅ | N-1.4 已修：constructor 接 `Partial<AgentContextBuilderConfig>`，内部使用 `createAgentContextBuilderConfig()` |
| H | `context-manager/profiles/agent/context/config.ts:321-328` | `createAgentContextBuilderConfig` helper 0 个调用方，死代码 | ✅ | N-1.4 已修：`AgentWorkingMemoryProvider` 与 host provider registry 已走该 hot path |
| I | `context-manager/profiles/agent/context/config.ts:168` | `DEFAULT_MODEL_ID: 'cl100k_base'` 起名为 MODEL_ID 但实际是 tiktoken encoding | ✅ | 阶段 0 已完成：改名为 `TOKEN_ENCODING_NAME` |
| J | `MessageFormatter.ts:1` | `import type { ChatMessage } from '../profiles/chat/contracts'`——shared 反向依赖 profile | ✅ | 已修：`ChatMessage` 物理上提到 `shared/contracts/chatLineMessage.ts`，`profiles/chat/contracts.ts` 反向 re-export，boundary guard 锁定 shared 不得 import profiles |
| K | `shared/toolInteractionGroup.ts` | 函数名 `findCurrentRoundStartIndex` 用 "Round"，实际语义是 "Run"（以 `user_input` 切）；与即将引入的 `RunSupervisor` 命名 inconsistent | ✅ | N-1.3 落地 `findCurrentRunStartIndex`；后续提升为 domain shared 时直接删除旧 alias，不保留兼容 |
| L | `agent/preprocessors/toolHistoryCompressor.ts:97-116` | 算法没有 run 边界感知，`slice(-N)` 跨 run 切，破坏 prompt cache prefix + 语义完整性 | ✅ | N-1.3（三策略 + `runOrdinal` 已落地） |
| M | `agent/preprocessors/toolHistoryCompressor.ts:67` | framework 实现默认 `'per-pair'`，但 §9.1 文档承诺默认 `'per-run'`，不一致；导致 host 100% 跑旧默认拿不到 prompt cache 收益 | ✅ | 2026-05-12 已修复：默认改为 `per-run`，旧 per-pair 测试改为显式配置 |
| N | `agent/orchestration/AgentMessageOrchestrator.ts:90-105` | 装配 preprocessor pipeline 时没有当前 agent 的上下文（不知道 agentId / promptKey），即便 host 加 `AgentDefinition.config.contextPolicy` 也没有装配链路传进 framework；当前调用只透传 `fenceRegistry`，没有 `toolHistory` | ✅ | 2026-05-12 已修复：新增 `resolveContextPolicy` 注入点，按 request 创建 preprocessor pipeline，避免跨 agent 串策略 |
| O | `agent/preprocessors/toolHistoryCompressor.ts` slice(-0) 兼容 bug | `keepLatestToolPairs: 0` 时 `slice(-0)` 等价 `slice(0)`，错变成"全保留"（与语义相反） | ✅ | N-1.3 期间发现并修复（显式判 `> 0`，2026-05-12） |
| P | `AgentMessageOrchestrator.ts:104-119` | 函数名 `ensurePreprocessorPipeline` 暗示懒初始化+缓存，但行为已改为每次重建；命名与行为不一致 | ✅ | 阶段 0 已完成：改名为 `buildPreprocessorPipelineForRequest` |
| Q | `AgentMessageOrchestrator.ts:80` | `private preprocessorPipeline` field 每次 invoke 被覆写，等价于局部变量；让"哪些 method 依赖 cached pipeline"语义模糊 | ✅ | 阶段 0 已完成：删 field，pipeline/toolManager 都改局部变量 |
| R | 仓库级 `npx tsc --noEmit` 失败 | 失败点是既有前端 / 测试类型债（`useSidebarAnimationEvents.ts` 缺 store 方法、多个 JS 模块缺声明、旧测试 `PromptKey` / citation 类型不匹配等），非 linnkit/AgentSpec 链路引入 | 🟡 | 非 linnkit 边界，host 团队后续单独清理；不阻塞 Phase F |
| S | `framework/04 §N-1` line 59-60 | 原草案写"`mode` / `promptKey` 退役 + 从 AgentInvocationRequest 删字段"，与 §9.6 拍板的"并存且互补"决策冲突；同时 RunHandle 草案缺 `spec()` + `request()` 双 getter | ✅ | 2026-05-12 修复（line 59-60 加 ⚠️ 修订 callout + RunHandle 草案补两个 getter） |
| T | 跨 `EventSequencer.executionId` / `EngineLocalState.{conversationId, turnId}` / `RunRecord.runId` 等 5 处 | 4 个 ID 命名混乱、语义不严格区分——`executionId` 与 `runId` 含义重叠却名字不同；host 与 framework 各用一套 | ⏳ | N-3.A.2 已提供 `RunRecord.metadata` / `agentSpecId` 承载映射；N-3.A.4 host 装配时写入 executionId/turnId/traceId 过渡映射；彻底统一留 N-3.B 段 |
| U | `flow.agent-runner.service.ts:AgentRunnerService.run()` | 返回 `RunResult` 而非 `RunHandle`，host 拿不到 cancel/observe/cost 入口 | ✅ | N-3.A.6 已修：`AgentRunnerService.run()` 改为同步返回 `{ handle, result }`，`FlowAgentRunRequest` 强制携带 `runHandle`，不保留旧 Promise 兼容入口 |
| V | N-3.A.2 初版 RunHandle | 缺正式生命周期写口——`status` 只能在 cancel 时变 cancelled，会让 run 长期停留 pending；A.4 接 host 后 RunRecord.status 永远不会变 completed/failed | ✅ | 2026-05-12 N-3.A.2/A.3 落地时已修：新增 `markRunning` / `markCompleted` / `markFailed` 三个生命周期方法，并写到 RunRecord |
| W | `runHandle.observe(filter.includePersisted=true)` 在当前 host ID 命名下 | host 用 `mappingContext.metadata.run_context.runId = turnId` 写入事件，但 `supervisor.registerRun` 内部 `generateRunId()` 与 turnId 不相等——`event.runId === runId` 匹配 0 条事件，persisted replay 失效 | ✅ | N-3.A.4 已修：`RunRegistrationSpec.runId?` 支持 host 显式传 `turnId`；A.9 补充修复 `metadata.run_context.runId/run_id` 嵌套识别，避免真实 EventStore 回放漏事件 |
| X | `llmTelemetryMiddleware.emit({ scope: { conversationId, turnId } })` | scope 缺 `runId` 字段——父子 run 共用一个 conversationId 时 cost 会混 | ✅ | 2026-05-12 G-1 完成时已给 `llm_call` / `tool_call` telemetry scope 补 `runId`；2026-05-12 B.3 小步补齐同步 child-run：child run 默认用 `subrunId` 作为独立 `runId`，`parentRunId` 指向父 run，`RunCostCollector.snapshot(parent).childrenTotal` 可聚合同步子 agent cost。detached 后台 run / runTree 仍留 N-3.B 正式阶段 |
| Y | `runHandle.cancel(opts).reason` 与 host stream_end 之间断链 | cancel reason 已写入 `RunRecord.errorIfAny.message`，但 host catch `AbortError` 后没读 RunRecord——stream_end SSE 事件的 reason 字段会丢失实际取消原因 | ✅ | N-3.A.6 已修：`flow.orchestrator.finally` 在 interrupted 时 `peek(runId)`，把 `errorIfAny.message` 写入 `stream_end.reason_message` |
| H1 | `src/app-hosts/linnya/context/agent/schemas.ts:37` | host 复制了一份 `AiMessage` zod schema（含 `document_fragment` 与 `z.any()`） | ✅ | 已修：`AgentInvokeRequestSchema.conversationHistory` 直接复用 `linnkit/contracts` 的 `AiMessage` schema，本文件 `z.any()` / `any` 收为 `unknown` |
| Z | `runtime-kernel/child-runs/` + `runtime-kernel/subrun/` + `internalAgentInvoker.ts` 命名三套 | 同一个"子 agent run"概念散落在三套命名：(1) `child-run`（执行机制）、(2) `subrun`（观测协议）、(3) `internal-agent`（invoker 文件名）。两个文件夹本身**不重复**——职责分层正确（child-runs 是"怎么跑"，subrun 是"跑的时候怎么发进度事件"），但命名混乱让读代码的人误判为重复 | ✅ | N-3.B B.5 已修：目录统一为 `child-run-trace/`，执行 primitive 统一为 `ChildRunInvoker`；公开事件 type `subrun_trace` 与 `SubRunTrace*` 协议类型保留 |
| AG | `runtime-kernel/run-supervisor/runSupervisor.ts` | `runSupervisor.ts` 当前约 669 行，接近 700 关注线；后续继续加 runTree / failure policy 会撑爆 | 🟡 | N-3.B 后续或阶段 2 前拆 `detached-runner.ts` / `terminal-waiters.ts` / `run-recovery.ts` |
| AH | `runtime-kernel/child-runs/childRunInvoker.ts` | 旧 invoker 文件 682 行，接近 700 关注线，trace sink / checkpoint recovery / transcript 生成职责堆在主类里 | ✅ | N-3.B B.5 已修：重命名为 `childRunInvoker.ts`，并拆出 `childRunTraceSink.ts` / `checkpointRecovery.ts` / `childToolContext.ts` / `childRunEvents.ts`，主文件降到约 367 行 |
| AA | `src/tools/knowledgebase/search/deep/runDeepSearch.ts:190` | 代码 `if (e.type === 'action') { ... }` 假设 RuntimeEvent 有 `'action'` 这个 type——但 `linnkit/contracts/events.ts:178-193` 当前 `RuntimeEvent` 的 15 个 type 中**没有 `'action'`**。这是 dead branch：`pickArgsForTrace` 永远不会被调用，deep search 的 step trace 现在缺"工具参数摘要"。同类协议腐蚀可能还有其他位置——deep search test 文件 + apps/renderer/sheet 引擎里也匹配到了 `type === 'action'`，但 sheet 引擎是另一个 namespace 的 action，不算漂移 | ✅ | 已修：deep search trace 迁到当前 `tool_call_decision` / `tool_process` / `tool_output` 协议，测试 fixture 不再伪造不存在的 `action` 事件，工具参数摘要恢复 |
| AC | `runtime-kernel/run-supervisor/runRegistryStorePort.ts` `RunRegistrationSpec` | 与 linnsy host 实际 `SpawnOptions` 对比缺 5 个字段：`iterationBudget` / `query?` / `contextFences?` / `wakeSource?: string`（泛化值，不枚举业务）/ `ephemeral?`——linnsy 现在每次都要"自己包一层"绕过这个差距 | ✅ | N-3.B.2 已修：`RunRegistrationSpec` 补齐上述字段，`RunExecutorPort` 通过 `RunExecutionContext` 原样接收 |
| AF | `runtime-kernel/graph-engine/nodes/waitUserNode.ts:139` + `runtime-kernel/graph-engine/engine.ts:313` | **关键隐患**：`WaitUserNode` 触发 `NodeResult.kind='pause'`，engine 接到后只 `checkpointer.save()` + return，**完全不写 RunRegistry**——`RunRecord.status` 永远不会变成 `'awaiting_user'`；`RunHandle` 也没有 `markAwaitingUser` 方法（只有 markRunning/Completed/Failed）。直接后果：host 调 `supervisor.peek(runId)` 看到的 status 在 WaitUserNode 之后仍是 `'running'`，与协议声明的 `'awaiting_user'` 不符。**`RunStatus` 4 个状态里有 2 个（`awaiting_user` / `paused`）是孤儿，生产链路无人 write**——`WaitUserNode` 在 `:71-73` 已经从 `local.toolContext` 拿到 runId 用在 audit envelope 里，差最后一步联动 RunRegistry | ✅ | N-3.B.1 已修：复用 `requires_user_interaction` 事实事件，补 `metadata.run_context.runId`，host runner 发布/持久化该事件并同步 `markAwaitingUser()`，supervisor 订阅事件兜底写 status |

---

## 11. 状态登记

> 追加历史，不修改历史段落。

- **2026-05-11 立稿**：升级研究 + 阶段 0/1A/1B/1C/1D/2/3 路线图整理完毕，等待用户拍板
- **2026-05-12 阶段 1A 完成**：Phase E A/B/C 三段全部落地，包版本 bump 到 `0.4.0`；新增 12 条 boundary guard 中的 2 条（`no-host-leakage` + `shared 禁止 import profiles`）；登记到 §3.2 的过渡兼容（5 个扁平符号 + `userQuoteLifetime` 迁 chat 兼容层）等阶段 1D 一起清扫
- **2026-05-12 文档落地**：本文件创建；`framework/README §2 / §3 / §7` 同步更新指向本文件
- **2026-05-12 §9.1 修订（per-run 策略入协议）**：用户提出 per-pair 全局 last-N 切割会破坏 prompt cache prefix + 语义完整性。修订内容：(1) `contextPolicy.toolHistory` 从 4 字段扩到 6 字段，加 `strategy: 'per-pair' | 'per-run' | 'none'` + `keepLatestRuns`；(2) 默认值从隐式 per-pair（N=2）改为 per-run（K=1）；(3) §10 隐患台账新增 K（命名一致性）/ L（无 run 边界算法）两条；(4) §4.1 N-1.3 任务扩展为"实现三策略 + `runOrdinal` 元数据"，工时从 0.5 天调到 1.5 天，N-1 总工时从 ≈5.5 天 → ≈6.5 天；(5) §8 必做清单 5 号项更新为"10 字段含 strategy 类型"
- **2026-05-12 §9.1 第二次修订（overflowStrategy）**：`contextPolicy.toolHistory` 从 6 字段扩到 7 字段，新增 `overflowStrategy: 'keep-latest' | 'fail-fast'`；整个 `contextPolicy` 从 10 字段扩到 11 字段。N-1.3 采用 impl-first 顺序先落地内部算法与配置入口，AgentSpec schema 在 N-1.1 回填真实字段。
- **2026-05-12 N-1.3 完成**：`ToolInteractionGroup.runOrdinal`、`findCurrentRunStartIndex`、`ToolHistoryCompressorPreprocessor` 三策略派发、`maxInteractionGroups + overflowStrategy` 安全阀、默认 preprocessor registry `toolHistory` 配置入口、相关单测与文档已落地。AgentSpec schema 尚未落地，下一步回到 N-1.1。落地过程顺手发现并修了一个 `slice(-0)` 兼容 bug（隐患 O）。
- **2026-05-12 host 现状核查**：核查 `AgentMessageOrchestrator:90-105` 装配点发现两个事实——(1) framework 实现默认仍为 `'per-pair'`，与 §9.1 文档承诺 `'per-run'` 不一致（隐患 M）；(2) 装配链路目前只透传 `fenceRegistry`，没有 `toolHistory`/`agentId`，host 加 contextPolicy 也没有路径传进 framework（隐患 N）。同时核查 host `agent-registry/types.ts`，确认 `AgentDefinition` 已具备 `modelPolicy / stepPolicy / systemReminder / skill` 等策略字段，缺 `contextPolicy`——这是 N-1.7 host 接入的扩展点。
- **2026-05-12 §9.4 / §9.5 拍板**：(1) §9.4 framework 工具压缩默认 strategy 选"改代码追文档"——把 `toolHistoryCompressor.ts:67` 的 `?? 'per-pair'` 改为 `?? 'per-run'`，先于 N-1.1 落地；(2) §9.5 host per-agent contextPolicy 选"每个 definition 显式声明"——拒绝预设模板与全局默认间接耦合，每个 agent 在 `index.ts` 直接写明 contextPolicy；(3) §10 隐患台账新增 M / N / O 三条；(4) 下一步执行窗口：先 5 分钟修 M，然后回到 N-1.1。
- **2026-05-12 隐患 M 修复**：`ToolHistoryCompressorPreprocessor` 未传 `strategy` 时默认改为 `per-run`；新增“不传 options 等价 per-run”的锁定测试；旧 per-pair 行为测试全部改为显式 `{ strategy: 'per-pair' }`，避免再次把兼容行为误当 framework 默认。
- **2026-05-12 N-1.1 / N-1.5 / host contextPolicy 装配完成**：`linnkit/contracts` 新增 `AgentSpec` schema 与 contract test；`context-manager/shared/agentSpecAdapter.ts` 提供 AgentSpec/contextPolicy 到 context builder + preprocessor options 的纯映射；`AgentMessageOrchestrator` 新增纯函数式 `resolveContextPolicy` 注入点并按 request 创建 preprocessor pipeline；linnya 侧 `AgentDefinition.config.contextPolicy` / `ChatDefinition.config.contextPolicy` 已接入并全量声明。
- **2026-05-12 §9.6 拍板（并存）**：AgentSpec 与 AgentProfileRequest 并存且互补，不互相替代；**N-1.6（promptKey / mode @deprecated + codemod）正式取消**；N-3 RunHandle 改为提供 `spec(): AgentSpec` + `request(): AgentProfileRequest` 双 getter；阶段 1B 剩余仅 N-3 + G-1。
- **2026-05-12 §10 隐患新增 P / Q / R**：P/Q 是 `AgentMessageOrchestrator` 改 per-request 重建后留下的命名与字段冗余（顺手隐患，0.5 天，进入下一步 sprint 起手）；R 是仓库级 `npx tsc --noEmit` 失败的既有前端/测试类型债登记（非 linnkit 边界，不阻塞 Phase F）。
- **2026-05-12 隐患 P/Q + 阶段 0 收尾完成**：`AgentMessageOrchestrator` 删除误导性 pipeline/toolManager 缓存字段，`ensurePreprocessorPipeline` 改名为 `buildPreprocessorPipelineForRequest`；核验 `caller.ts` / `eventMappers.ts` 已完成职责拆分且拆分文件均 ≤ 250 行；`context-pipeline` fatal 判断改为 `ContextProviderError` typed error；`DEFAULT_MODEL_ID` 改名为 `TOKEN_ENCODING_NAME`。
- **2026-05-12 N-3.A.1 完成**：`RunRegistryStore` 增加 `paused` 状态占位、`RunRecord.agentSpecId`、`pausedAt`、`pauseReason`；`MemoryRunRegistryStore.list()` 支持 `agentSpecId` 过滤；contract test 覆盖 paused round-trip 与 agentSpecId list。
- **2026-05-12 N-3 架构核查 + 工时下修**：核查 `graph-engine/README §5.1` + `flow/README §2-3` 得到关键洞察——(1) `EngineLocalState.signal: AbortSignal` + GraphExecutor 主循环每个 step 查 `signal.aborted` 的物理通道**已经存在**，N-3 无需新建任何取消机制；(2) "一次 run 的状态"分散在 5 处（`EventSequencer.executionId` / `EngineLocalState.{signal,conversationId,turnId,request}` / `EventBus`(per-execution) / `RunLifecycleCoordinator` / `llmTelemetryMiddleware`），N-3.A 的本质是聚合而非新建；(3) §4.2 N-3.A 工时从 2 人周（10 天）下修到 1 人周（4.5 天）；(4) §10 隐患台账新增 T（4 个 ID 命名混乱）/ U（`AgentRunnerService.run()` 没返回 RunHandle）两条；(5) §4.2 N-3.A 子任务表扩展为完整的 N-3.A.1-7 七步清单 + 7 条关键不变量。
- **2026-05-12 N-3.A.2 / N-3.A.3 完成**：新增 `RunHandle` / `DefaultRunHandle`（`spec` / `request` 快照、`signal` 只读暴露、`cancel`、`observe`、`cost`、`meta`、`markRunning/markCompleted/markFailed` 生命周期写口、`pause/resume` N-3.B 占位）与 `RunSupervisor` / `DefaultRunSupervisor`（`registerRun`、`observeRun`、`cancel`、`list`、`peek`、N-3.B 5 个占位）；新增 framework 层单测覆盖 signal、cancel、实时 observe、persisted+live observe、cost、生命周期状态写入、spec/request 快照、not found、NotImplemented 占位。落地过程顺手发现并修了一个生命周期写口缺口（隐患 V）。
- **2026-05-12 N-3.A.4 host 接缝深度核查**：核查 `AgentRunnerService.run` + `FlowAgentRunRequest` + `runBootstrapper` + `runLifecycleCoordinator` + `linnkit-event-store.adapter` + `llmTelemetryMiddleware` + `RunContext` + `EventMappingContext` 后确认——(1) signal 通道已存在（host 已接外部 signal），N-3.A.4 只需替换来源；(2) cost 数据源已存在（`TelemetryPort.emit({ kind: 'llm_call', usage })`），host 自建 `RunCostCollector` 订阅即可；(3) `linnkit-event-store.adapter` 已存在，直接复用；(4) 新发现隐患 W/X/Y 三条（observe persisted replay 在当前 ID 命名下取 0 条事件 / telemetry scope 缺 runId / cancel reason 写入 RunRecord 但 stream_end 看不到），全部登记 §10；(5) §4.2 N-3.A 子任务表细化为 8 步，工时从 4.5d 上调到 5.1d；(6) **关键决策点：runId 命名方案 A（host 传 turnId 作 runId，零侵入）vs 方案 B（host 全部替换为 supervisor runId，2-3 天大改），等待拍板**。
- **2026-05-12 §9.7 拍板 + oneshot 模式**：(1) §9.7 runId 命名选方案 A——supervisor 加 `runId?` 字段，host 传 turnId；隐患 T 留 N-3.B 一起统一；(2) 执行模式选 oneshot——一次性做完 N-3.A.4 → A.8（5.1 天），其中 A.7 的 15 个深度测试 case 是 hardgate。
- **2026-05-12 N-3.A.4 / A.5 / A.6 / A.7 / A.8 oneshot 完成**：framework `RunRegistrationSpec` 支持显式 `runId` 与 `parentSignal` abort chain，新增 `RunAlreadyRegisteredError`；host 新增 `LinnyaRunCostCollector`、`runnableDefinitionToAgentSpec`、runtime singleton 装配与 telemetry cost ingestion；`FlowOrchestrator` 统一在 runner 前 `registerRun({ runId: turnId })`，`AgentRunnerService.run()` 强制新契约 `{ handle, result }`，并用 `runHandle.signal` 作为唯一 signal 来源；`markRunning/markCompleted/markFailed` 与 cancel reason → `stream_end.reason_message` 链路落地；新增 cost collector / AgentSpec adapter 单测与 flow interrupted/summarization 回归测试。
- **2026-05-12 N-3.A.9 persisted replay 根因补丁**：复核 `RunHandle.observe({ includePersisted: true })` 时发现测试只覆盖 `PersistedEvent.runId` 顶层匹配，未覆盖 linnya 真实写入的 `RuntimeEvent.metadata.run_context.runId`；已补 `metadata.run_context.runId/run_id` 嵌套识别与回归测试，避免 EventStore replay 在真实 host 元数据形状下漏事件。
- **2026-05-12 G-1 完成**：`AuditEnvelope` / `AuditPort` / noop-console-file sink / `run.cancel` envelope / 5 类非确定性决策审计全部落地；新增 `EventStoreAuditPort`，将 envelope 写成 `audit_envelope` hidden RuntimeEvent（只持久化，不进 UI / agent context / SSE）；`GraphAgentExecutor` 发 `model.select` 与 `model.fallback`，`ToolNode` 发 `tool.allow` / `tool.deny`，`WaitUserNode` 发 `wait_user.request`，sandbox 先提供标准 `emitSandboxDecisionAudit()` helper（当前无 SandboxPort 实现，不伪造执行链）。同时 telemetry scope 补 `runId`，隐患 X 在单 run 维度已解除，父子 run 聚合仍留 N-3.B。
- **2026-05-12 隐患 Z + AA 登记**：(Z) `child-runs/` vs `subrun/` 命名混乱——两个文件夹**不重复**，是"执行机制 vs 观测协议"分层，但同概念三套名字（child-run / subrun / internal-agent）让人误判；建议 N-3.B 父子 run 接入时一并统一命名。(AA) `src/tools/knowledgebase/search/deep/runDeepSearch.ts:190` 读 `e.type === 'action'`——但当前 RuntimeEvent 15 个 type 里没有 'action'，是 dead branch，deep search 的 step trace 缺工具参数摘要；说明 host 工具代码可能还有其他类似的协议腐蚀，host 单独窗口扫描清理。
- **2026-05-12 N-3.B.0 小步完成**：不改变 host 现有同步 child-run 语义，不提前实现后台 `spawnDetached`；仅补齐同步子 agent 的可观测/成本口径——`ChildRunExecutionPolicy` 支持显式 `runId/parentRunId`，host 可默认把 `subrunId` 作为 child runId、父 `ToolContext.runId` 作为 `parentRunId`；`llm_call` / `tool_call` telemetry 透传 `parentRunId`；host `RunCostCollector` 支持 `childrenTotal` 聚合同步 child-run cost。后台 detached 子 agent 后续必须作为**显式可选模式**，默认仍保持 sync await。
- **2026-05-12 Testkit T.1-T.4 起步完成**：新增 package-neutral `run-harness`（`createRunSupervisorHarness` / `createCollectingAuditPort` / `createMockTelemetryPort`）与 12 条默认严格 run invariant（lifecycle / audit / telemetry / cost / EventStore / ToolCall 配对）；新增 Linnya host-bound `runAgentScenario()`，复用真实 graph loop 装配并支持 `llm_throw` / `tool_throw` / `cancel_mid_llm` 失败注入入口。定位是协议一致性测试，不是评分框架；外部接入方可直接复用 package-neutral 层，host wrapper 留在各自仓库。
- **2026-05-12 §9.8 拍板 + N-3.B 范围重定义**：读完 linnsy `runtime/run-spawner/` + `internal-subagent/` 后确认 linnsy 已经在 host 层实现了完整 detached run 基础设施且直接 import `runSupervisor.RunRegistryStore`——N-3.B 本质是**协议回流**而非新建。重定义后 N-3.B 改为：(B.0) 修隐患 AF——`WaitUserNode → RunRecord.status='awaiting_user'` 链路断了，优先复用既有 `requires_user_interaction` 事实事件并让 supervisor/host runner 联动写 status；(B.1) 协议扩展（spawnDetached / waitForTerminal / findActiveByConversation / drain / recoverOnBoot + 5 个新 spec 字段）；(B.2) DefaultRunSupervisor 实现；(B.3-B.6) 接入文档 + testkit 不变量 + 命名规范化（含隐患 Z）+ 文档。总工时 5.3 天。`pause()/resume()` 保持 NotImplementedError（linnsy 也未实现进程级冷暂停，按需触发再做）。同步 vs 异步是两条 API 不是开关——`AgentSpec` / `RunRegistrationSpec` 不加 "executionMode" 字段。§10 隐患台账新增 AC（spawn options 字段缺失）/ AF（WaitUserNode → RunStatus 链路断）。
- **2026-05-12 N-3.B B.0-B.4 完成**：修正 §9.8 B.0 方案——不新增 `run.awaiting_user`，复用 `requires_user_interaction` 事实事件；`WaitUserNode` 补 `metadata.run_context.runId`，`AgentRunnerService` 发布/持久化 `runUntilYield().events` 中的 wait-user 事件并同步 `markAwaitingUser()`，`DefaultRunSupervisor` 事件订阅兜底写 status。`RunSupervisor` 回流 linnsy detached 能力：`spawnDetached` / `waitForTerminal` / `findActiveByConversation` / `drain` / `recoverOnBoot`、`RunOutcome` / `RunSnapshot` / `RunExecutorPort` / `RunExecutionContext`、`RunRegistrationSpec.iterationBudget/query/contextFences/wakeSource/ephemeral` 全部落地。testkit 新增 I13-I15（wait_user 状态、detached outcome、drain in-flight）与 `createRunSupervisorHarness({ executor })`。
- **2026-05-12 N-3.B B.5 完成**：命名规范化落地——`runtime-kernel/subrun/` 改为 `child-run-trace/`，公开 namespace 改为 `runtimeKernel.childRunTrace`；执行 primitive 从 `InternalAgentInvoker` 改为 `ChildRunInvoker`，linnya host factory 同步改为 `childRunInvokerFactory` / `createDefaultChildRunInvoker` / `toChildRunAgentConfig`；`subrun_trace` 事件 type 与 `SubRunTrace*` 协议类型保留。顺手修 AH：拆出 `childRunTraceSink` / `checkpointRecovery` / `childToolContext` / `childRunEvents`，主 invoker 从约 682 行降到约 367 行；新增 AG 登记，`runSupervisor.ts` 接近 700 行，后续单独拆。
- **2026-05-12 N-3.B B.6 + 小尾巴清扫完成**：`04-protocol-roadmap.md` 补 N-3.B 最终落地形态（wait-user 复用 `requires_user_interaction` + detached run 两条 API）；N-1.4 状态补实（`AgentWorkingMemoryProvider(customConfig)` + host registry 透传 + 测试锁定）；J 关闭（`ChatMessage` shared 上提已由 boundary guard 锁定）；H1 关闭（host agent schemas 复用 `linnkit/contracts.AiMessage` schema，清掉本地副本与 `any`）。
- **2026-05-12 隐患 AA 关闭**：`runDeepSearch` 的 step trace 从旧的不存在 `action` 事件迁到当前 `tool_call_decision` / `tool_process` / `tool_output`；单测 fixture 同步改为真实 RuntimeEvent，恢复 deep search 回放中的工具参数摘要。
- **2026-06-22 治理归档**：把 `11-upgrade-plan-next.md` 中已经完成但仍停留在“未来计划”的阶段下沉到本文 §6：阶段 1F（0.6.0 Context Engineering 协议化）与阶段 1C（0.7.0 Quickstart + CLI v0）均已归档；阶段 1D / 阶段 2 / 阶段 3 的未完成项改由 `14-governance-and-cleanup-plan.md` 作为活施工清单继续跟踪。
- **当前**：⏳ **下一站推荐：按 14 文档主线进入修 bug 阶段；文档治理 C 类已完成，后续只保留发版后画像回写纪律**
