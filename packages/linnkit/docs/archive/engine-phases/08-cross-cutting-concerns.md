# 08 · Cross-Cutting Concerns（abort port / telemetry port / error model）

> **状态**：✅ 决策定稿，等候实施（按 audit §3 "拆细"决议拆为三件单独评估）  
> **日期**：2026-04-21  
> **触发**：[`00-engine-scope-audit.md` §3](./00-engine-scope-audit.md) 修订时确认 08 拆为 abort port / telemetry port / error model 三件单独评估  
> **前置**：
> - [`00-engine-scope-audit.md` §1.4](./00-engine-scope-audit.md) "engine 留接口、不做工具、信息丰富" 原则
> - 现有 `src/agent/shared/errorClassifier.ts`（已有 ErrorClassifier 系统）
> - 现有 `src/agent/shared/llmTelemetryContext.ts`（AsyncLocalStorage 收集）

---

## 0. Q1-Q4 边界判定（按三件分别过门槛）

### 0.1 Abort port

| 维度 | 判断 | 证据 |
|------|------|------|
| Q1 协议? | ✅ 是 | abort 链路是 engine 协议层 |
| Q2 ≥2 消费者? | ✅ | 所有产品都需要 |
| Q3 不加就没法接? | ❌ | **当前 `AbortSignal` 已经全链路穿透**（caller / toolNode / executionContext / internalAgentInvoker），是 web 标准 API；Engine 不需要再做"port"包装 |
| Q4 不破坏? | ✅ | 不动现有 |

→ **abort 不需要新 port**——`AbortSignal` 本身就是 web 标准协议，engine 已经正确使用。但需要**文档化"abort 链路保证"**作为公开契约。

### 0.2 Telemetry port

| 维度 | 判断 | 证据 |
|------|------|------|
| Q1 协议? | ✅ | telemetry 收集点 / 聚合维度是协议层 |
| Q2 ≥2 消费者? | ✅ | linnya 桌面要做 LLM 用量统计；linnsec 也需要（"今天 codex 烧了多少 token"）|
| Q3 不加就没法接? | ⚠️ **协议核心：是**（当前 `llmTelemetryContext.ts` 是 AsyncLocalStorage 隐式收集，没有正式 port） | 详见 §1 |
| Q4 不破坏? | ✅ | 现有 telemetry 行为可保留，新 port 是新增可选 capability |

→ **telemetry 需要正式 port**（按 §1.4 "留接口、不做工具"——engine 留收集点 + 数据出口接口，不做存储后端 / 上报渠道 / 仪表盘）。

### 0.3 Error model

| 维度 | 判断 | 证据 |
|------|------|------|
| Q1 协议? | ✅ | 错误分类 + 错误结构是协议层 |
| Q2 ≥2 消费者? | ✅ | 所有产品都需要"重试 vs 不重试"判定 |
| Q3 不加就没法接? | ❌ | **当前 `ErrorClassifier` 系统已经存在**，覆盖 RETRYABLE / NON_RETRYABLE / RATE_LIMIT 三类；engine 已自包含 |
| Q4 不破坏? | ✅ | 不动现有 |

→ **error model 不新增**，但需要**信息丰富化**（按 §1.4）：errorCode 命名表、recoverable 字段、retry hint 字段，让上层做 UI / 工具时不用再 parse 字符串。

---

## 1. 问题与场景

### 1.1 三件各自的现状

| 件 | 现状 | 缺什么 |
|----|------|--------|
| **Abort** | `AbortSignal` 全链路穿透，是 web 标准 | 缺**公开契约文档**（"engine 保证 abort 在 X 处生效"）|
| **Telemetry** | `llmTelemetryContext.ts` AsyncLocalStorage 收集 LLM call 数据 | 缺**正式 port 接口**让 host 接入 + 缺统一收集点（tool / graph 节点 / RunHandle 等也都该可观测）|
| **Error model** | `ErrorClassifier` 三分类 + 错误重试策略 | 缺**信息丰富化的错误结构**（按 §1.4 留 `errorCode` / `recoverable` / `retryAfterMs` / `hint`）|

### 1.2 用户场景

#### S1：linnya 桌面"今天调用了多少 token"

用户想看一份"近 7 天 LLM 用量、按模型 / 按对话 / 按节点 / 按工具" 统计。

**当前**：`llmTelemetryContext` 收集 LLM call 级别数据，但是 AsyncLocalStorage 隐式 + 没有 port → host 没办法把它沉淀到产品 db / 仪表盘。

**需要**：telemetry port，让 host 接入自己的 telemetry sink。

#### S2：linnsec 永驻 daemon"故障告警"

linnsec daemon 跑了一周，某次 LLM 调用 503 → ErrorClassifier 判定 RATE_LIMIT 重试 → 1h 后又 503 → 再重试 → ... → 永远成功不了。

**当前**：error 信息只有 `{ category, reason, suggestedDelay }`，host 没法判断"这次错误能不能告警"或"该不该升级到 page"。

**需要**：信息更丰富的 error 结构（`errorCode` / `recoverable: false` / `escalationHint`）。

#### S3：linnya / linnsec 用户主动取消

用户中途按 ESC（linnya）或在 IM 发"取消"（linnsec）→ host 调 `RunSupervisor.cancel(runId)` → engine 内部触发 `AbortSignal.abort()`。

**当前**：abort 链路已就绪（`signal` 一路传到 caller / tool / 子 run），但**没有公开契约文档**保证"abort 后 X 秒内一定停止"，host 不知道能信赖到什么程度。

**需要**：abort 公开契约 + 文档化的"何处会响应、何处不响应、最长延迟"。

### 1.3 不解决什么

- **不解决**：仪表盘 / 上报后端 / 时序数据库 / 监控告警平台 —— 产品层
- **不解决**：error code 全集自动分类（如 LLM provider 特有错误）—— 由 LlmProviderPort 实现层各自决定
- **不解决**：分布式 trace（OpenTelemetry / Jaeger）—— 留给 telemetry port 的 host 实现
- **不解决**：abort race condition 复杂场景（如 abort 与 wait_user 并发）—— 已由现有 graph engine 处理

---

## 2. 当前 Linnya 现状

### 2.1 Abort 链路

`grep` 验证 `abortSignal` / `AbortSignal` 全链路覆盖：
- `runtime-kernel/llm/caller.ts` —— LLM 流式调用
- `runtime-kernel/graph-engine/engine.ts` —— 主循环
- `runtime-kernel/graph-engine/nodes/toolNode.ts` —— 工具执行
- `runtime-kernel/tools/toolExecutionContext.ts` —— 工具上下文
- `runtime-kernel/child-runs/internalAgentInvoker.ts` —— 子 run

**评估**：✅ 完整。但**没有公开契约文档**说明"abort 后多久内能停"。

### 2.2 Telemetry 现状

`src/agent/shared/llmTelemetryContext.ts`：

```typescript
export type LLMTelemetryContext = {
  scope?: { conversationId?, turnId?, runId?, stepId?, stepIndex? };
};
export type LlmCallTelemetry = {
  modelId; stream; startedAt; durationMs; usage?: NormalizedLlmUsage;
};
```

实现：基于 `AsyncLocalStorage`；用 `withLLMTelemetryContext(...)` 包裹执行链路才会收集。**默认不启用**。

**评估**：
- ✅ AsyncLocalStorage 设计漂亮，无侵入
- ❌ 没有正式 port 让 host 接入 sink（产品 db / 仪表盘）
- ❌ 只覆盖 LLM call；tool execution / graph 节点切换 / RunHandle 操作 都没有 telemetry hook
- ❌ 收集后只能 in-process 聚合，没有"flush" / "export" 协议

### 2.3 Error model 现状

`src/agent/shared/errorClassifier.ts`：

```typescript
export enum ErrorCategory { RETRYABLE, NON_RETRYABLE, RATE_LIMIT }
export interface ErrorClassification {
  category: ErrorCategory;
  reason: string;
  suggestedDelay: number | null;
}
```

**评估**：
- ✅ 重试 vs 不重试判定到位
- ❌ `reason` 是自由文本（中文 console.log 字符串），上层没法 i18n / 没法做 UI 分组
- ❌ 没有 `errorCode`（结构化标识）
- ❌ 没有 `recoverable` 二分位（vs `category` 三分类）
- ❌ 没有 `retryAfterMs`（区分"建议延迟"和"必须延迟"）
- ❌ 没有 `hint`（给上层 / 用户的可读建议）

### 2.4 现状评估总结

| 件 | 现状 | 缺什么 | 本 topic 决定 |
|----|------|--------|-------------|
| Abort | 已就绪 | 公开契约文档 | **写文档；不加 port** |
| Telemetry | 隐式 AsyncLocalStorage | 正式 port + 覆盖面扩展 | **新增 TelemetryPort；扩展收集面** |
| Error model | ErrorClassifier 三分类 | 信息丰富化 | **扩展 ErrorClassification 字段；不动分类逻辑** |

---

## 3. 各参考项目做法（按本 topic 范围摘）

### 3.1 OpenClaw

参考价值：⭐

- 没有清晰的 abort / telemetry / error model 抽象
- 不作正面参考

### 3.2 Codex

参考价值：⭐⭐⭐

- Rust **`tokio::CancellationToken`** + **`anyhow::Error` + thiserror 派生**
- error 分类显式（`thiserror` 强制 enum 形式）
- telemetry 用 `tracing` crate（行业标准）
- **启发**：error code 用 enum；telemetry 走结构化输出
- 详见 [`../99-research-notes/codex.md`](../99-research-notes/codex.md)

### 3.3 Claude Code

参考价值：⭐⭐

- Anthropic API 的 error model（HTTP status + structured error body）
- 内部 error 主要是 `{ status, type, message }`
- **启发**：errorCode 命名空间应当 stable

### 3.4 Hermes

参考价值：⭐⭐

- 自定义 telemetry 系统（每个 backend 自定义 hook）
- error 主要靠 Python exception
- **反例**：缺统一 telemetry port → 多 backend telemetry 字段不一致

### 3.5 启发摘要

| 启发点 | 来源 | 是否进入 engine |
|--------|------|----------------|
| `errorCode` 用 stable string namespace | CC + Codex | ✅ engine 加 |
| Cancellation token = AbortSignal 等价 | Codex | ✅（已有，文档化即可）|
| Telemetry 走结构化输出 | Codex tracing | ✅ engine 留 port + 结构化事件 |
| OpenTelemetry 直接耦合 | 行业标准 | ❌ 留给 host 实现，engine 不耦合 SDK |

---

## 4. 候选方案（按三件分别）

### 4.A Abort 方案

**A1（推荐）**：**写公开契约文档，不加 port**

具体内容：
- 在 `runtime-kernel/README.md` 新增 "Abort 契约" 章节
- 列出"何处保证响应 abort"：caller / toolNode 之间 / 每次 LLM stream chunk / 每次 tool 调用前后 / 子 run spawn 检查
- 给出"最长响应时延"上限（如 ≤ 1 个 LLM token 流式间隔 + ≤ 1 个 tool 当前 IO 边界）
- 说明"不响应 abort 的边界场景"（如 tool 内部纯 CPU 计算未释放 event loop）

**A2**：把 `AbortSignal` 包装成 `AbortPort`

→ 否决——`AbortSignal` 是 web 标准，包装一层只增加 boilerplate。

### 4.B Telemetry 方案

**B1（推荐）**：**新增 `TelemetryPort` + 结构化事件 + 扩展收集面**

```typescript
export type TelemetryEvent =
  | { kind: 'llm_call'; modelId: string; stream: boolean; durationMs: number; usage?: NormalizedLlmUsage; scope: TelemetryScope }
  | { kind: 'tool_call'; toolName: string; durationMs: number; ok: boolean; errorCode?: string; scope: TelemetryScope }
  | { kind: 'graph_node'; nodeId: string; durationMs: number; scope: TelemetryScope }
  | { kind: 'run_lifecycle'; runId: string; phase: 'spawned' | 'completed' | 'failed' | 'cancelled'; scope: TelemetryScope };

export type TelemetryScope = {
  conversationId?: string;
  runId?: string;
  parentRunId?: string;
  turnId?: string;
  stepId?: string;
};

export interface TelemetryPort {
  emit(event: TelemetryEvent): void;
  flush?(): Promise<void>;
}
```

**做法**：
- engine 在 4 个收集点（LLM call / tool call / graph node / run lifecycle）emit 结构化事件
- 默认 host 不传 port = noop（行为不变）
- host 自由实现 sink：写 SQLite / 上报 OpenTelemetry / Posthog / 自家仪表盘
- 保留现有 `llmTelemetryContext.ts` AsyncLocalStorage 作为内部聚合实现细节（用于 LLM call 跨 chunk 累计 usage 等）—— port 是它的"出口"

**B2**：直接绑定 OpenTelemetry SDK

→ 否决——绑定 SDK 违反 §1.4 "engine 不带工具"。

### 4.C Error model 方案

**C1（推荐）**：**ErrorClassification 字段扩展 + errorCode 命名空间**

```typescript
export interface ErrorClassification {
  // 现有字段保留
  category: ErrorCategory;
  reason: string;
  suggestedDelay: number | null;

  // 新增（信息丰富）
  errorCode: string;             // 'llm.rate_limit' / 'llm.invalid_tool_args' / 'tool.timeout' / 'engine.delegate_depth_exceeded' / ...
  recoverable: boolean;          // 是否可恢复（与 category 互补：RATE_LIMIT 也 recoverable=true，NON_RETRYABLE 通常 false）
  retryAfterMs?: number;         // 必须延迟（vs suggestedDelay 是建议）
  hint?: string;                 // 给上层 / 用户的可读建议（i18n key 或英文短语）
  metadata?: Record<string, unknown>; // 自由挂载
}

export const ENGINE_ERROR_CODES = {
  LLM_RATE_LIMIT: 'llm.rate_limit',
  LLM_INVALID_TOOL_ARGS: 'llm.invalid_tool_args',
  LLM_PROVIDER_DOWN: 'llm.provider_down',
  TOOL_TIMEOUT: 'tool.timeout',
  TOOL_PROTOCOL_FUSE: 'tool.protocol_fuse',
  ENGINE_DELEGATE_DEPTH: 'engine.delegate_depth_exceeded',
  ENGINE_BUDGET_EXHAUSTED: 'engine.budget_exhausted',
  USER_CANCELLED: 'user.cancelled',
  // ...
} as const;
```

**做法**：
- engine 内部所有错误抛出位置都 produce 结构化 ErrorClassification（不只是 LLM 错误）
- errorCode 是 stable string，host / linnsec 可基于 code 做 i18n / UI / 告警
- 现有 `category` / `reason` / `suggestedDelay` 保留 100% 向后兼容

**C2**：走 thiserror-like 强 enum

→ 否决——TypeScript 没有 thiserror 等价物；过度工程。

---

## 5. 当前倾向

### 5.1 拍板小结

- **Abort**：写公开契约文档，不加 port（A1）
- **Telemetry**：新增 `TelemetryPort` + 结构化事件 + 扩展收集面（B1）
- **Error model**：扩展 ErrorClassification 字段 + errorCode 命名空间（C1）

### 5.2 实施分步

| Step | 件 | 内容 | 文件 |
|------|----|------|------|
| 1 | Abort | 写"Abort 契约"段落 | `runtime-kernel/README.md` 新增章节 |
| 2 | Telemetry | 新建 `runtime-kernel/telemetry/{telemetryPort.ts,noopTelemetry.ts,telemetryEvents.ts}` | 新建 |
| 3 | Telemetry | engine 4 个收集点接入 emit（LLM caller / toolNode / graph executor / RunSupervisor）| 多文件 |
| 4 | Telemetry | 把 `llmTelemetryContext.ts` 与 TelemetryPort 衔接（内部聚合 → port emit） | shared/llmTelemetryContext.ts |
| 5 | Error model | 扩展 `ErrorClassification` + 加 `ENGINE_ERROR_CODES` 常量表 | shared/errorClassifier.ts |
| 6 | Error model | engine 内所有错误抛出位置 produce 结构化 errorCode（渐进迁移）| 多文件 |
| 7 | exports | 把 `TelemetryPort` / `ENGINE_ERROR_CODES` / `ErrorClassification` 加进 exports（与 [`07 §7.1`](./07-public-api-and-package-boundary.md) 协调）| `runtime-kernel/index.ts` |
| 8 | docs | 更新 README 段落 + 更新 audit §4 状态 | docs |

### 5.3 触发其他改动的可能性

| 改动 | 触发条件 |
|------|---------|
| OpenTelemetry SDK 绑定 | 真出现"linnya/linnsec 都用 OTLP" 时考虑（host 实现层） |
| Error i18n 表 | linnsec / linnya UI 团队需要本地化时由产品层做 |
| Telemetry sampling 协议 | 高吞吐量场景出现采样需求时再加 |

---

## 6. 待决策问题（已逐项定稿）

> **2026-04-21 默认推荐定稿**：A1 + B1 + C1。

| # | 问题 | 决策 | 理由 |
|---|------|------|------|
| Q1 | Abort 是否新增 port？ | ✅ **不新增**（A1）| `AbortSignal` 是 web 标准；engine 已正确使用；只缺契约文档 |
| Q2 | TelemetryPort 是必选还是可选？ | ✅ **可选**（host 不传 = noop） | 不强迫 linnya 桌面承担；linnsec 接入即可 |
| Q3 | Telemetry 收集面 | ✅ **4 件套**（LLM call / tool call / graph node / run lifecycle） | 覆盖 engine 主要可观测面；扩展点足够给上层做仪表盘 |
| Q4 | 是否保留 `llmTelemetryContext.ts` AsyncLocalStorage | ✅ **保留**（作为 LLM call 跨 chunk 内部聚合） | 不破坏现有；TelemetryPort 是它的出口 |
| Q5 | errorCode 命名风格 | ✅ **dot-notation `domain.specific`**（如 `llm.rate_limit`） | 易扩展、可前缀过滤、与 OpenTelemetry semconv 接近 |
| Q6 | `recoverable` 是否与 `category` 冗余 | ✅ **不冗余、两者都留** | category 是引擎重试策略；recoverable 是给上层 UI / 告警的语义 |
| Q7 | 错误结构是否带 `metadata: Record<string, unknown>` | ✅ **带**（与 §1.4 信息丰富对齐）| 上层 / linnsec 可挂载诊断信息 |

---

## 7. 落地任务

### 7.1 Engine 内任务

- [ ] T1：**Abort**：在 `runtime-kernel/README.md` 新增 "Abort 契约" 章节（列出响应点、最长时延、不响应边界）
- [ ] T2：**Telemetry**：新建 `runtime-kernel/telemetry/` 模块
  - `telemetryPort.ts` —— `TelemetryPort` interface + `TelemetryEvent` / `TelemetryScope` 类型
  - `telemetryEvents.ts` —— 事件 kind 常量
  - `noopTelemetry.ts` —— 默认 noop 实现
- [ ] T3：**Telemetry**：4 个收集点接入 emit
  - LLM caller —— 已有 telemetryContext，再加 emit 出口
  - toolNode —— 每次 tool 执行结束 emit `tool_call`
  - graph executor —— 每次节点切换 emit `graph_node`
  - RunSupervisor —— spawn / complete / fail / cancel emit `run_lifecycle`
- [ ] T4：**Telemetry**：把 `llmTelemetryContext.ts` 与 TelemetryPort 衔接（emit `llm_call`）
- [ ] T5：**Error model**：扩展 `ErrorClassification` 加 `errorCode` / `recoverable` / `retryAfterMs?` / `hint?` / `metadata?` 字段；加 `ENGINE_ERROR_CODES` 常量表
- [ ] T6：**Error model**：engine 内主要错误抛出位置渐进迁移，produce 结构化 errorCode（先覆盖 8-10 个高频 code）
- [ ] T7：把 `TelemetryPort` / `ENGINE_ERROR_CODES` / 扩展后的 `ErrorClassification` 加进 `runtime-kernel/index.ts` exports

### 7.2 Host 侧任务（Linnya）

- [ ] T8：linnya host 装配点：默认不注入 TelemetryPort（行为不变）
- [ ] T9：可选：linnya 桌面自己实现一个 `LocalTelemetrySink` 把数据落到 Linnya 的 db（"今天用了多少 token" 仪表盘前置）

### 7.3 Linnsec 侧任务（不在 engine 范围）

- T10（linnsec 实施时）：实现 `SqliteTelemetrySink` / `OtlpTelemetrySink` 等
- T11（linnsec 实施时）：基于 errorCode 做 i18n 错误提示 / 告警规则配置

### 7.4 文档任务

- [ ] T12：更新 `runtime-kernel/README.md` 加 "Abort / Telemetry / Error model 三件契约" 段落
- [ ] T13：更新 `00-engine-scope-audit.md` §4 把 08 状态同步为 "✅ 决策定稿，等候实施"

---

> **2026-04-22 实施时序更新**（决策 G1，已落地）：
> §7.1 **T2 / T5 / T7（port 接口部分）已通过 [`engine/20 §3`](./20-d3-d4-port-interfaces-plan.md) T0 阶段实施完成**：
> - T2 Telemetry：新建 `runtime-kernel/telemetry/{telemetryPort.ts,telemetryEvents.ts,noopTelemetry.ts,index.ts}` + contract test
> - T5 Error model：`shared/errorClassifier.ts` 加 `errorCode` / `recoverable` / `retryAfterMs?` / `hint?` / `metadata?` + `ENGINE_ERROR_CODES` 常量表 + contract test
> - T7 Exports：`TelemetryPort` / `ENGINE_ERROR_CODES` / 扩展后的 `ErrorClassification` 全部进 `runtime-kernel/index.ts`
>
> 仍待执行：§7.1 T1（Abort 契约文档）/ T3 / T4 / T6（engine 内部接入 emit / 错误抛出位置渐进迁移）+ §7.2（host 装配）。

## 8. 状态

- [x] §0 三件分别过 Q1-Q4 边界判定
- [x] §1 三件各自现状 + 用户场景明确
- [x] §2 当前 Linnya 现状盘点完成
- [x] §3 参考项目启发汇总
- [x] §4 三件各自候选方案 + 取舍
- [x] §5 当前倾向（A1 + B1 + C1 分步）
- [x] §6 7 题已逐项定稿
- [x] §7 落地任务展开 T1-T13
- [x] T2 / T5 / T7（port 接口部分）已落地（见上方 2026-04-22 实施时序更新）
- [ ] T1 / T3 / T4 / T6 + §7.2 待后续排

**下一步**：
1. ✅ §6 决策已定（abort 不加 port + telemetry 新增 port + error model 扩展信息）
2. T1-T7 engine 内实施（abort 文档化 → telemetry 端到端接入 → error model 字段扩展）
3. T8-T9 host 侧装配（linnya 默认行为不变）
4. T12-T13 文档同步
