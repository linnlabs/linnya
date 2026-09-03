# 21 · 宿主侧 Port 适配研究（B0）

> **类型**：研究文档（非 runbook）  
> **目标**：在写「Linnya 接 linnkit 4 个 port」的实施手册前，先把事实摸清，避免 runbook 写空、跑出来宿主接了空 port。  
> **产出**：B 拆批建议 + dryrun 治理决策 + 改名（C）结论 + 3 个待用户决策的问题。  
> **完成后下一步**：B1/B2/B3 已完成；下一步是按 [`engine/07`](./07-public-api-and-package-boundary.md) + [`engine/11`](./11-phase-e-hard-blockers.md) 进入 Phase E 起手判定。B4 RunRegistry 继续暂搁，等 RunSupervisor。
>
> **状态**：✅ 研究已完成（2026-04-22）；B1 Checkpointer / B2 Telemetry / B3 EventStore 第一轮（PR-A/B/C/D）均已完成。B3 的 Phase E 硬阻塞已解除；当前只剩 B4 RunRegistry 暂搁和 `engine/11` 里的少量设计收尾判定。

---

## 0. 摘要

把 4 个 port 接到 Linnya 看似一件事，**实际上是两件事**：

1. **B-engine**：让 linnkit 主循环真正调用这些 port。当前 4 个 port 里只有 `Checkpointer` 真在主循环里被 caller。其余 3 个（`EventStore` / `RunRegistryStore` / `TelemetryPort`）**只有接口 + 内存默认 + contract test，主循环根本没人调**。如果不先做 B-engine，宿主接 port = 空动作。
2. **B-host**：Linnya 拿宿主自己的存储（`workspace.sqlite` / `electron-store`）实施这些 port。

**重大隐性问题**：原本以为 B 是「单层落地」，事实是「两层落地」。

**推荐拆批**（详见 §5）：

| 批次 | 范围 | 是否需要 B-engine | 估时 |
|---|---|---|---|
| **B1** | Checkpointer 持久化 | 否（已 wire） | ✅ 已完成 |
| **B2** | TelemetryPort 桥接 | 是（middleware 改 emit） | ✅ 已完成 |
| **B3** | EventStore 模型对齐 + 适配 | 是（设计决策为主） | ⏳ 当前阶段；详见 engine/22 |
| **B4** | RunRegistryStore | 是（先要 RunSupervisor 落地） | 暂搁，等 engine/01 §5.2 实施 |

**dryrun 治理**：默认 X1（短命，B+E 加起来 2-3 周内 sunset）。

**改名（C）**：linnkit 已定，无需 batch rename，无需独立 runbook。

---

## 1. Linnya 持久化栈摸底（事实）

### 1.1 数据库引擎全景

| 引擎 | 实例 | 文件 | 用途 |
|---|---|---|---|
| **better-sqlite3**（主力） | `workspace.sqlite` | `src/electron-main/services/database.ts:12` / `:32` | 几乎所有结构化数据 |
| **electron-store** | `config` | `src/electron-main/store/index.ts:5` | 应用配置 / 模型清单 |
| **直接 fs** | 日志、qdrant 索引等 | `src/shared/logger.ts:189` 等 | 非结构化文件 |
| Qdrant（远程） | — | `src/infra/adapters/vector-store/index.ts:7` | 向量库 / 知识库 |
| ~~Redis~~ | — | 同上 :10 注释 | **已移除** |
| ~~sql.js / metadata.sqlite~~ | — | `src/features/knowledge-base/infrastructure/metadataRepository.ts:9` 注释 | **已迁出** |
| IndexedDB / dexie / idb | — | （全仓未使用） | 不存在 |

**结论**：Linnya 持久化 = **better-sqlite3 + electron-store**，没有 IndexedDB。

### 1.2 进程分工（关键）

- **DB 在主进程**：`DatabaseService` 在 `src/electron-main/services/database.ts` 打开 `workspace.sqlite`
- **渲染进程不直连 DB**：通过两条通道访问：
  1. **HTTP**：本地 Express 路由（如 `historyApiService` GET `/api/v1/conversation/...`，见 `apps/renderer/domains/conversation/history/services/historyApiService.ts:75 / :133`）
  2. **IPC**：`ipcMain.handle(...)` 处理工作区/文档/agents 类操作（如 `src/electron-main/ipc/handlers/workspace/agents-ipc.ts:53`）
- **实时事件流**：Server-Sent Events（`src/app-hosts/linnya/adapters/flow/flow.router.ts:65`）

**含义**：linnkit 4 个 port 的实施位置 **必须在主进程 / Express 后端**，不是渲染进程。这一点对 dryrun 无影响（dryrun 只验证抽包），但对 B 的 wiring 位置至关重要。

### 1.3 Conversation / Event / Run 三件套的现状

Linnya 已经有一个**完整的对话 + 事件 + run 持久化层**，但**它不是 linnkit `EventStore` port 的实现**：

| 抽象 | 文件 | 接口形状 |
|---|---|---|
| `IEventStore`（宿主） | `src/app-hosts/linnya/adapters/persistence/event-store/event-store.interface.ts:46` | `appendRun(conversationId, events: RuntimeEvent[], metadata: RunMetadata): Promise<string>` |
| `SQLiteEventStore`（实现） | `src/app-hosts/linnya/adapters/persistence/event-store/sqlite.implementation.ts:34` | 基于 `appendRun` |
| Schema | `conversation.schema.ts:12` | 4 张表：`conversations` / `runs` / `events` / `messages` |
| linnkit `EventStore`（kernel） | `src/agent/runtime-kernel/graph-engine/event-store/base.ts:18` | `append(conversationId, event: PersistedEvent)` + `range` + `latestEventId` + `truncate?` |

**模型不一致**：
- 宿主侧：**run-grained**（一次 run 批量写一组事件 + 含 metadata）
- linnkit：**event-grained**（一个事件一个事件 append，配 `range/latestEventId` 做回放）

**含义**：B3 不是简单的「替换实现」，而是**两个模型怎么对齐**的设计决策。详见 §3.2。

### 1.4 Checkpointer 现状

- **当时生产路径全是 in-memory**，历史上有 3 个注入点：
  1. `src/electron-main/routes/index.ts:151` —— 主路径
  2. `src/agent/runtime-kernel/child-runs/internalAgentInvoker.ts:423` —— 子 agent
  3. 已删除的旧 Default Agent Benchmark 自建 runtime
- **没有任何 SQLite 版 Checkpointer**：`grep SqliteCheckpointer / setCheckpointer` 全仓 0 命中
- **没有"绕过 port"的等价物**：宿主没有手写 EngineState 序列化的代码

**含义**：Checkpointer 是 4 个 port 里**最干净、最容易接、收益最直接**的。进程重启即丢失，是当前真实痛点。

---

## 2. Telemetry 历史还原（事实）

### 2.1 被删的 telemetry 模块原本做什么

**删除 commit**：`b15d67d3` —— "研究agent抽包和新产品开发问题 26.04.21"

| 角色 | 路径（删前） | 职责 |
|---|---|---|
| README | `apps/renderer/shared/telemetry/README.md` | 阶段 0 目标：DAU + ActiveTime + 本地队列 + PostHog |
| `activeTimeTracker.ts` | 同目录 | 前台 + 有交互的活跃时长聚合，60s 或切后台 flush `app_heartbeat` |
| `initTelemetry.ts` | 同目录 | 初始化 distinct_id、`app_opened`、定时 flush 队列 |
| `localQueue.ts` | 同目录 | `localStorage` 队列 `telemetry.queue.v1`，MAX 500 |
| `posthogConfig.ts` | 同目录 | PostHog Project API Key / Host |
| `telemetryClient.ts` | 同目录 | 写队列 + flush + 用 `posthog-js/dist/module.full.no-external.js`（Electron 适配） |
| `types.ts` | 同目录 | `TelemetryEventName` 含 `app_opened`/`app_heartbeat`/`app_deep_research_*` |
| 主进程 IPC | `src/electron-main/ipc/handlers/system/telemetry-ipc.ts` | 提供匿名 distinct_id（`sha256(machineId + salt)`） |

**删除原因**：方向变了：去掉 PostHog 客户端埋点，DAU 改走云端日志。当前 Cloud 边界见 `cloud/README.md`。

### 2.2 现在残留的 telemetry 引用点

| 类别 | 残留位置 | 说明 |
|---|---|---|
| linnkit 自己的 TelemetryPort | `src/agent/runtime-kernel/telemetry/*` | 我们刚加的，**主路径未 emit** |
| LLM 遥测（ALS 旁路） | `src/agent/shared/llmTelemetryContext.ts` | 与 TelemetryPort 并行存在，未对接 |
| `flow.agent-runner.service.ts` | `src/app-hosts/linnya/adapters/flow/flow.agent-runner.service.ts:13` | 宿主用 `withLLMTelemetryContext`/`LlmCallTelemetry` 包裹 run |
| `behavior_events` 表 | `src/features/analytics/infrastructure/sqlite/analytics-schema.provider.ts` | analytics 残留，**与 linnkit 无关** |
| Univer sheet telemetry | `apps/renderer/domains/sheet/engine/telemetry/` | 第三方表格库自带，**与 linnkit 无关** |
| Cloud 正式规范 | `cloud/README.md` | 网关、在线模型注册和服务端日志的当前合同，无 Linnkit 运行时影响 |

**含义**：
- 旧 telemetry **彻底拔了**，不存在「需要兼容旧上报路径」的负担
- 但 LLM 遥测的旁路 ALS（`recordLlmCallTelemetry`）还在，**这是新 TelemetryPort 必须吸收的存量**
- 新 TelemetryPort 的 sink 不是 PostHog，应该是「写本地 DB / 日志，未来由网关侧聚合 DAU」

### 2.3 新 TelemetryPort 接口形状

```ts
interface TelemetryPort {
  emit(event: TelemetryEvent): void;
  flush?(): Promise<void>;
}

type TelemetryEvent =
  | { kind: 'llm_call'; modelId; stream; durationMs; usage?; scope }
  | { kind: 'tool_call'; toolName; durationMs; ok; errorCode?; scope }
  | { kind: 'graph_node'; nodeId; durationMs; scope }
  | { kind: 'run_lifecycle'; runId; phase: 'spawned'|'completed'|'failed'|'cancelled'; scope };
```

事件类型（`telemetryEvents.ts:1`）：
- `llm_call` —— LLM 一次调用
- `tool_call` —— 工具一次调用
- `graph_node` —— graph 节点一次跑
- `run_lifecycle` —— run 的生死状态

**注意**：这里**没有**「DAU / ActiveTime / app_opened」类宿主级埋点 —— 那些不是 linnkit 该管的，归宿主自己。

---

## 3. 4 个 Port 的真实使用点 + 等价物分析

### 3.1 Checkpointer ✅ B1 已完成

| 维度 | 现状 |
|---|---|
| 接口 | `load` / `save` / `clear` / `peekMeta?` / `list?` / `purgeStale?` |
| 主循环 caller | `GraphExecutor` 全程使用（`engine.ts:23-39`） |
| 默认实现 | `MemoryCheckpointer` 仅留作 fallback / 测试用 |
| 等价物 | **不存在**。宿主无手写 `EngineState` 持久化 |
| **接的难度** | ✅ 已落地。换实现 + wire 3 个注入点 + GC 已完成 |

**B-engine 工作量**：0（已 wire）✅  
**B-host 工作量**：✅ **已完成**：
- `SqliteCheckpointer`（表 `engine_checkpoints (conversation_id, state_json, schema_version, updated_at)` + 4 个 column 子表 / 索引）
- `purgeStale()` GC + 30 天 retention，启动时执行
- 3 个注入点全部切换到 SQLite 实现
- `internalAgentInvoker.ts` 类型从 `MemoryCheckpointer` 修复为 `Checkpointer` 抽象
- contract test 4 个新用例覆盖 GC 场景

**详见**：`src/app-hosts/linnya/adapters/persistence/checkpointer/README.md`。

### 3.2 EventStore 🟡 主循环未 emit + 宿主已有不同模型

| 维度 | 现状 |
|---|---|
| 接口 | `append(conversationId, PersistedEvent)` + `range` + `latestEventId` + `truncate?` |
| 主循环 caller | **无**（仅 contract test） |
| 默认实现 | `MemoryEventStore`（仅测试用） |
| 等价物 | **存在但模型不同**：宿主 `IEventStore.appendRun(conversationId, events[], metadata)` |
| **接的难度** | **最高**。模型对齐是设计决策 |

**B-engine 工作量**：决定要不要让 GraphExecutor / EventBus 在主循环 `emit` PersistedEvent。如果要，要改 `runtime-kernel/event-bus` 加一个 sink 层。

**B-host 工作量**：要么写 `SqliteEventStore` 完整支持 `append/range/latestEventId`（新增一张表，与现有 `events` 并存），要么写适配器把现有 `IEventStore.appendRun` 包成 linnkit `EventStore` 接口。

**关键问题（待用户决策）**：参见 §8 Q1。

### 3.3 RunRegistryStore 🟠 主循环未 emit + 等价 registry 不存在

| 维度 | 现状 |
|---|---|
| 接口 | `save` / `load` / `list` / `delete` |
| 主循环 caller | **无**。`engine/01-async-runs-and-handles.md` 描述未来用法，代码未实施 |
| 默认实现 | `MemoryRunRegistryStore`（仅测试） |
| 等价物 | **不存在**。`RunContext` 是单 run 内存元数据，不是跨 run registry |
| **接的难度** | 中等，但**前置依赖**：要先实施 RunSupervisor |

**B-engine 工作量**：要先做 `engine/01-async-runs-and-handles.md` §5.2 RunSupervisor 落地，否则 RunRegistryStore 没人调。  
**B-host 工作量**：实施 `SqliteRunRegistryStore`（一张表 `agent_runs (run_id PK, status, parent_run_id, started_at, ...)`）。

**含义**：B4 应该**暂时搁置**，留 in-memory 默认即可，等 RunSupervisor 落地后再做。这不影响 Phase E。

### 3.4 TelemetryPort ✅ B2 已完成

| 维度 | 现状 |
|---|---|
| 接口 | `emit(TelemetryEvent)` + `flush?` + `purgeStale?` |
| 主循环 caller | ✅ 4 个埋点全部接入（详见 B-engine 工作量段） |
| 默认实现 | `noopTelemetry`（observability off 时零成本） |
| 等价物 | `llmTelemetryContext.ts` 的 ALS 实现（`withLLMTelemetryContext`）—— **保留并存**，详见 §4.3 |
| **接的难度** | ✅ 已落地 |

**B-engine 工作量**：✅ **已完成**（4 batch，4 commits）：
- Batch 1 `llm_call` —— `llmTelemetryMiddleware.ts` `ctx.telemetry.emit(...)`，commit `7f929ea9`
- Batch 2 `tool_call` —— `toolNode.ts` `emitToolCallTelemetry()` 在 success/failure/protocol-error 三路覆盖，commit `32d9c48b`
- Batch 3 `graph_node` —— `executor.ts` 在 `runUntilYieldInternal` 用 `try/finally` 包 `node.run()`，commit `d507dbe8`
- Batch 4 `run_lifecycle` —— `executor.ts` `runUntilYield` 外层 `try/catch/finally` emit `spawned` / `completed` / `failed` / `cancelled`，commit `ed78309b`

**B-host 工作量**：✅ **已完成**：
- 独立表 `engine_telemetry`（窄表 + JSON payload + 3 个索引）
- `SqliteTelemetryAdapter` 双 sink（SQLite + Logger）
- `purgeStale()` GC + 7 天 retention，启动时执行
- `npm run telemetry:tail` CLI 便捷查询脚本
- README + contract test 全套

**详见**：`src/app-hosts/linnya/adapters/telemetry/README.md`。

**关键问题（待用户决策）**：参见 §8 Q2 —— 已决策（B + C 双 sink）+ 已实施。

### 3.5 4 个 port 综合判断（**2026-04-22 二轮更新**）

| Port | B-engine | B-host | 状态 | 备注 |
|---|---|---|---|---|
| Checkpointer | ❌（已 wire） | ✅ `SqliteCheckpointer` + GC | ✅ **B1 已完成** | 痛点最直接，先做完用代码验证了 port 设计 |
| TelemetryPort | ✅ 4 emit 点已接入 | ✅ `SqliteTelemetryAdapter` 双 sink + GC | ✅ **B2 已完成** | ALS 与 TelemetryPort 双写并存（详见 §4.3） |
| EventStore | ✅ 不在 EventBus 挂 sink；`persistRun()` 已切到 event-grained core（PR-D `08c77ce6`） | ✅ B3a `deb0e834` / B3a.5 `4b31a76f` / B3b `bd889409` / B3c `08c77ce6` | ✅ **B3 已完成** | A2 已落地；Phase E 的 EventStore 硬阻塞已解除 |
| RunRegistryStore | ⏸ 需先做 RunSupervisor | ⏸ 简单表 | ⏸ **B4 暂搁** | 不阻塞 Phase E；等 RunSupervisor 落地再做 |

---

## 4. 关键洞察

### 4.1 B 是两层不是一层

之前的 ABCD 推荐里我把 B 描述为「Linnya 接 port」，**这个表述不准确**。事实是：

> 4 个 port 里有 3 个连引擎主循环都没 emit，所以宿主接了也是空动作。  
> 必须先做 B-engine（让引擎调 port），再做 B-host（让宿主实施 port）。

这意味着 B 的工作量比预估的大约**多一倍**。但好消息是 P0（Checkpointer）跳过了 B-engine，可以**立刻动手**。

### 4.2 EventStore 是个潜伏的设计决策

宿主已经有完整的 `SQLiteEventStore`，跟 linnkit 的 `EventStore` port 模型不同：

```
宿主：appendRun(convId, events[], metadata)        ← run-grained
linnkit：append(convId, event), range(...)         ← event-grained
```

不能简单替换。要么改一个，要么写适配器。这个决策影响 Phase E 的可行性，必须在 B3 之前拍板。

### 4.3 TelemetryPort 必须吸收 ALS 旁路

`llmTelemetryContext.ts` 的 ALS 实现是「事实上的旁路 telemetry」，宿主已经在用。如果 TelemetryPort 不吸收它，会出现两条 telemetry 路径长期并存，跟 §0 反复强调的「不留双源」精神冲突。B2 必须**桥接 + 同时**或**桥接 + 替换**。

**B2 实际方案（已实施）**：**双写并存，不互斥**。
- ALS（`recordLlmCallTelemetry` / `withLLMTelemetryContext`）继续保留，专责"benchmark / 单链路内聚合"场景（按 run scope 把多次 LLM call 聚合成一份汇总）。
- TelemetryPort `emit({ kind: 'llm_call', ... })` 同时调用，专责"宿主全局 sink"场景（每次调用一条记录，可跨 run 查询）。
- 两路语义清晰、消费者不同，**不算"双源"**——它们是"同一事实事件的两种聚合视角"。这条结论在 `llmTelemetryMiddleware.ts` 的 inline 注释里也写明了。

### 4.4 dryrun 的保鲜期 = B 的实施周期

B 越快做完，dryrun 越早可以删。如果 B 拖到 1 个月，dryrun 已经严重漂移。所以 **dryrun 治理决策直接由 B 节奏决定**。

---

## 5. B 拆批推荐

### 5.1 推荐拆 4 批（**2026-04-22 二轮更新**）

| 批次 | 范围 | B-engine | B-host | 状态 | 阻塞 Phase E? |
|---|---|---|---|---|---|
| **B1** | Checkpointer 持久化 + 移除子 agent in-memory | ❌ | ✅ `SqliteCheckpointer` + GC + 3 注入点 + 类型修复 | ✅ **已完成**（commit `783784b4`） | 否 |
| **B2** | TelemetryPort 桥接 ALS + 双 sink | ✅ 4 emit 点（Batch 1-4） | ✅ `SqliteTelemetryAdapter`（独立表 + GC + Logger 双 sink + CLI tail） | ✅ **已完成**（commits `7f929ea9` / `32d9c48b` / `d507dbe8` / `ed78309b` + B2-host commit） | 否 |
| **B3** | EventStore 模型对齐（A2 schema-preserving event-grained core） | ✅ 不挂 EventBus sink 当主路径；`persistRun()` 已切 event-grained core | ✅ B3a `deb0e834` / B3a.5 `4b31a76f` / B3b `bd889409` / B3c `08c77ce6` | ✅ **已完成**，详见 [`engine/22 §7`](./22-eventstore-alignment-research.md#7-拆批建议) + [`engine/23`](./23-b3-eventstore-runbook.md) | 否（该硬阻塞已关闭） |
| **B4** | RunRegistryStore + RunSupervisor | ✅ RunSupervisor 整体落地 | ✅ `SqliteRunRegistryStore` | ⏸ **暂搁** | 否（in-memory 在 Phase E 后仍可用） |
| **B5** | run-granularity-merger（合并 input/AI/stream_end 到一个 run） | — | — | ⏸ **未来 topic**（详见 [`engine/22 §11.1`](./22-eventstore-alignment-research.md#111-b5--run-granularity-merger一次请求合并到一个-run)） | 否（B3 第一版不动 run 粒度） |

### 5.2 推荐执行顺序

```
B1 (P0) ──→ B2 (P1) ──→ B3 (P2) ──→ Phase E
                                      ↑
                                 B4 推迟到 Phase E 之后
                                 (engine/01 §5.2 RunSupervisor 落地时一起做)
```

理由：
- B1 收益最快，验证「port 抽象本身合理」
- B2 在 B1 之后做，因为 LLM 遥测的 sink 实施时可以参考 Checkpointer 的 sink 模式
- B3 是 Phase E 的硬阻塞，必须做完
- B4 可以推迟，不影响 linnkit 抽包

### 5.3 每批的产出

原计划每批一个 **PR + commit**，统一用一份 B 手册涵盖 B1-B3。后续实际执行已调整：B1/B2 已完成；B3 因 EventStore 模型风险单独升级为 [`engine/22-eventstore-alignment-research.md`](./22-eventstore-alignment-research.md)，拍板后再写专门 B3 runbook。

---

## 6. dryrun 治理决策

### 6.1 dryrun 寿命 vs B 节奏

| 场景 | dryrun 寿命 | 推荐选项 |
|---|---|---|
| B1+B2+B3 在 2 周内做完 | < 2 周 | **X1（短命，不维护）** |
| B 拖到 1 个月以上 | > 1 个月 | X2（写 sync 脚本定期重 snapshot） |
| 跳过 B 直接 Phase E | 短 | X3（不推荐，B-engine 必须先做） |

### 6.2 推荐 X1（短命）

- 不写 sync 脚本，dryrun 在 Phase E 启动那一刻 `rm -rf packages/agent-engine-dryrun/`
- 期间允许 src/agent 演进，dryrun 漂移就漂移（不再跑它的 typecheck/smoke）
- 唯一约束：**B1+B2 不要等 dryrun 跑过才 merge**（dryrun 在 B 期间已不再具有验证意义）

### 6.3 dryrun sunset 的具体动作（写进 Phase E runbook）

```
Phase E 启动时：
1. git rm -rf packages/agent-engine-dryrun/
2. git rm -f src/agent/__tests__/dryrun.workspace.test.ts
3. 同步删 vitest.config.ts 里的 'packages/agent-engine-dryrun/**' exclude
4. 同步删 scripts/guards/agent-package-boundary-guard.ts 里的 IGNORED_RELATIVE_PREFIXES
5. 同步删 scripts/__tests__/agent-package-boundary-guard.test.ts 里的 dryrun 豁免测试
6. 同步删 codename lint 里 dryrun 相关的允许字面量
7. git mv src/agent packages/linnkit/src（真物理 move）
```

写进后续 Phase E runbook（编号待定，Phase E 写时定稿）。

---

## 7. 改名（C）结论

linnkit 已在 `00-vision-and-split.md §4.1` 拍板为最终名（2026-04-22）。

**不需要 batch rename**：
- src/agent 内部用的是 path（`src/agent/*`），不是 `linnkit` 字面量
- dryrun 已经预演 `linnkit-dryrun` + alias `linnkit/*`，证明名字可用
- 公开 export 入口（src/agent/index.ts、ports/index.ts、contracts/index.ts 等）的 namespace 名是 `linnkitCompat`，已用

**Phase E 时一次性改**：
- `git mv src/agent packages/linnkit/src`
- `packages/linnkit/package.json` 里 `name: "linnkit"`
- 全仓 `from 'src/agent'` → `from 'linnkit'`（或 monorepo workspace alias）

**所以 C 不是独立批次**，是 Phase E 的内嵌动作。从 ABCD 列表里**移除 C**。

---

## 8. 待用户决策的 3 个问题

### Q1（B3）：EventStore 模型怎么对齐？

> **✅ 已关闭并已实施（2026-04-22）**：
> - **B / C 否决**（详见 [`engine/22 §3.2 / §3.3`](./22-eventstore-alignment-research.md#3-三个方案复盘)）。
> - **A 原版方向对，但描述太粗，不能按字面执行**，升级为 [`engine/22 §4 / §7` 的 A2](./22-eventstore-alignment-research.md#4-推荐方案a2--schema-preserving-event-grained-core)：schema-preserving event-grained core（保留现有四表 schema，不新增双源表，不做 buffer 适配器，把 `SQLiteEventStore` 内部重构为逐事件 append core，`appendRun()` 降级为 helper）。
> - 后续只按 A2 继续，不再回到原 A/B/C 三选一。
> - 拆批为 B3a / B3a.5 / B3b / B3c / B3d，详见 [`engine/22 §7`](./22-eventstore-alignment-research.md#7-拆批建议)。
> - **第一轮已落地**：B3a `deb0e834` / B3a.5 `4b31a76f` / B3b `bd889409` / B3c `08c77ce6`。B3d（live EventBus sink）继续延后到 Phase E 之后评估。
>
> 本节下面 A/B/C 三选保留作历史记录，不要再当成"待决策"。

宿主有 `IEventStore.appendRun(convId, events[], metadata)`，linnkit `EventStore` 是 `append(convId, event)` + `range`。两个模型怎么收？

**选项 A · 改宿主侧**：把 `IEventStore` 重构成与 linnkit `EventStore` 一致的 event-grained 接口；`appendRun` 变成「在 linnkit `EventStore.append` 之上的 helper」  
- 优点：linnkit 接口最干净，宿主语义统一  
- 代价：宿主侧大改，影响 history API、SSE、UI  

**选项 B · 写适配器**：linnkit `EventStore` 实现里包装宿主 `IEventStore.appendRun`，buffer 到一定大小再批量 flush  
- 优点：宿主代码最少改  
- 代价：需要 buffer 策略，failure mode 复杂；`range/latestEventId` 还得绕一圈宿主 SQLite 直查  

**选项 C · 双写并行一段时间**：linnkit `EventStore` 走自己的表（新增 `linnkit_events`），宿主 `IEventStore` 暂保留；future PR 再决定是否合并  
- 优点：风险隔离  
- 代价：两张事件表长期并存，违反"不留双源"

**推荐**：**A**（彻底但干净）。理由：linnkit 设计 EventStore 时已经考虑了 event-grained 是更通用的抽象，宿主侧改造一次性付掉好过长期适配层。

---

### Q2（B2）：TelemetryPort 的 sink 写哪？

> **✅ 已决策 + 已实施**：选 **B + C 双 sink**（独立表 `engine_telemetry` + Logger）。详见 §3.4 + `src/app-hosts/linnya/adapters/telemetry/README.md`。
> 本节下面 A/B/C 三选保留作历史记录。

linnkit 4 类 telemetry event（llm/tool/graph/run）要落到 Linnya 哪？

**选项 A · 现有 `behavior_events` 表**：复用 analytics 域的表，sink 把 4 类 event 全写进去  
- 优点：复用已有 schema，UI 可以直接用现成 analytics 查询  
- 代价：`behavior_events` 原本是产品级埋点，可能与 engine telemetry 字段不匹配  

**选项 B · 新增 `engine_telemetry` 表**：linnkit telemetry 独立成一张表  
- 优点：模型干净，未来抽包后 schema 可一并搬走  
- 代价：要写迁移 + 新增 schema-provider  

**选项 C · 只写日志（Logger sink）**：用 `src/shared/logger.ts` 写结构化 JSON log，不落 DB  
- 优点：最简单，0 schema 工作  
- 代价：查询不方便，long-term 存储依赖外部聚合  

**推荐**：**B + C 双 sink**（用 composite pattern 同时写 SQLite 和 logger）。理由：B 提供本地查询能力，C 提供未来云端聚合通路（与 `linnya-cloud-architecture.md` 方向一致）。

---

### Q3（B 节奏 + dryrun）：B 想让我接着做，还是先停在 B0？

> **✅ 已决策 + B1/B2 已完成**：选 **B**（直接动手做 B1，验证 port 抽象）。B1 + B2 都按这个节奏完成；B3 因模型对齐风险升级为独立研究文档 `engine/22`，再按 §7 的子批次推进。
> 本节下面 A/B/C 三选保留作历史记录。

我现在已经摸完事实，可以直接进入 B 实施。但你之前的工作模式是「我研究→你拍板→你自己实施」。**B 也走这个模式吗**？

**选项 A · 我继续写 B 实施 runbook**，你看完拍板，自己实施  
- 适合：你想自己控制实施细节  
- 我的角色：写 runbook + 后续审计  

**选项 B · 我直接动手做 B1**（Checkpointer 是最简单的，1-2 天能完）  
- 适合：你想快速验证「port 抽象设计 + B 拆批方案」是否真合理  
- 我的角色：实施 + 写 PR + 跑测试  

**选项 C · 先写 B 整体 runbook，再让我做 B1，B2-B3 你决定**  
- 折中  

**推荐**：**B**。理由：B1 极小（一张表 + 改 3 个注入点），与其写 runbook 不如直接做完用代码验证 port 设计。如果 B1 顺利，B2-B3 再决定写不写 runbook。

---

## 9. 状态

- ✅ B0 研究完成（2026-04-22）
- ✅ B1 Checkpointer 已完成
- ✅ B2 Telemetry 已完成
- ✅ B3 EventStore 第一轮已完成（PR-A `deb0e834` / PR-B `4b31a76f` / PR-C `bd889409` / PR-D `08c77ce6`）
- ⏸ B4 RunRegistry 暂搁，等 RunSupervisor
- 📌 dryrun 治理已定 X1
- 📌 改名（C）已并入 Phase E
- 📌 完整 ABCD → ABE'（A=Phase E，B=本研究，E'=baseline 收紧）
