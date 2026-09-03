# 06 · Checkpointer and Persistence Ports

> **状态**：✅ 决策定稿，等候实施  
> **日期**：2026-04-21  
> **触发**：audit §4 修订时确认 06 范围"缩小为协议层评估"；engine/01 §6 Q4 / §7.4 T12 确认本 topic 必须承接 `RunRegistryStore` 接口讨论  
> **前置**：
> - [`00-engine-scope-audit.md` §1.4](./00-engine-scope-audit.md) "engine 留接口、不做工具、信息丰富" 原则
> - [`01-async-runs-and-handles.md` §5.3 / §6 Q4](./01-async-runs-and-handles.md) RunRegistryStore 接口承接

---

## 0. Q1-Q4 边界判定（先过门槛）

| 维度 | 判断 | 证据 |
|------|------|------|
| **Q1 协议还是实现？** | ✅ 协议 | `Checkpointer` / `EventStore` / `RunRegistryStore` 都是接口；具体后端（Memory / SQLite / Postgres / 文件）一律归产品层 |
| **Q2 ≥2 消费者真实需求？** | ✅ 强需求 | linnya 桌面：当前 MemoryCheckpointer 关闭即失，已知短板；linnsec：永驻 daemon + IM 消息历史 + cron 任务追踪都需要持久化 |
| **Q3 engine 不加就没法接？** | ✅ 是 | engine state 序列化语义、save/load 触发时机、事件 ID 单调性这些都是 engine 内部知识，产品层包不了 |
| **Q4 不破坏 Linnya？** | ✅ 是 | 设计为"接口扩展 + 现有 Checkpointer 行为不变"；`EventStore` / `RunRegistryStore` 是新增可选 port |

**结论**：通过 4 条门槛，纳入 engine 升级范围。**按 audit §1.4 新原则，scope 由 "协议层评估" 升级为 "留三个完整 port + 信息丰富"**。

---

## 1. 问题与场景

### 1.1 三个相关持久化职责

engine 内部需要"被持久化"的东西可以分三类：

| # | 职责 | 数据形态 | 当前 engine 状态 | 由谁主导 |
|---|------|---------|----------------|---------|
| **P1** | **Engine state 快照**（节点状态、pendingToolCalls、context summary、checkpointMarker 等）| `EngineState` 结构 | ✅ 已有 `Checkpointer` 接口 | engine/06 主导 |
| **P2** | **Runtime 事件流**（agentEvent、tool_progress、token chunk 等）| `RuntimeEvent[]` 时序流 | ⚠️ 宿主层已有自己的事件存储，但 engine 通用 port 未抽象 | engine/06 新增 `EventStore` port（可选）|
| **P3** | **Run registry**（runId → status / parent / metadata / startedAt / iterations 等）| `RunRecord` 表 | ❌ 未抽象（依赖于 conversationId 间接定位）| engine/01 提需求，engine/06 落接口 |

三者**职责不同、生命周期不同、可由不同后端独立实现**——所以**应当是三个独立 port**，而不是一个超级 PersistenceFacade。

### 1.2 用户场景

#### S1：linnya 桌面"会话历史"

用户重启 linnya，期望看到上次的对话历史（消息 + 工具调用上下文）。当前依赖 Linnya 自己的 db 把 message 表存住，**engine state 关闭即失**——某些跨重启的细粒度状态（如 pendingToolCalls 半截、checkpointMarker、context summary 累积）会丢。

**需要**：`Checkpointer` 接口仍然合适，但实现要换成 disk-backed（linnya host 提供，engine 不实现）。

#### S2：linnsec 永驻 daemon"老板半小时后回来问进展"

老板 8:00 让 linnsec 调度 codex 写一份调研报告，9:00 老板上班顺手问"刚才那事怎么样了"。linnsec daemon 一直在跑，但需要：
1. **P1 Checkpointer**：能 load 出当时的 engine state（即使中间有 daemon 重启）
2. **P2 EventStore**：能查出过去 1 小时的事件流（"它走到哪一步了"）
3. **P3 RunRegistryStore**：能根据 runId 找到 run record（status / parent / metadata）

→ 三者**共同保证 engine/01 §5.2 PeekResult 信息完整**。

#### S3：跨进程 IDE / Web 客户端

未来如果有"linnsec Web 客户端" / "linnya IDE 插件" 需要查 run 状态，它们通过产品层 HTTP API 间接读 engine 持久化。**engine 不暴露跨进程协议**——只暴露三个 port，跨进程协议归产品层（engine/01 §5.4 已明确"不做跨进程序列化"）。

### 1.3 不解决什么

- **不解决**：具体 backend 实现（SQLite / Postgres / 文件）—— 产品层
- **不解决**：跨进程持久化协议、备份 / 迁移 / 加密—— 产品层
- **不解决**：消息内容业务表（message / conversation / topic 等）—— 产品层数据模型
- **不解决**：vector store / embedding / KB 引用持久化—— 是产品层 memory 系统职责
- **不解决**：实时事件 fan-out（多客户端订阅同一事件流）—— SSE 出口归产品层

---

## 2. 当前 Linnya 现状

### 2.1 Checkpointer 接口（已存在，但很薄）

`src/agent/runtime-kernel/graph-engine/checkpointer/base.ts`：

```typescript
export interface Checkpointer {
  load(conversationId: string): Promise<EngineState | null>;
  save(conversationId: string, state: EngineState): Promise<void>;
  clear(conversationId: string): Promise<void>;
}
```

**评估**：
- ✅ 按 conversationId 索引、已正确分层
- ⚠️ 信息薄——没有 `list()`、没有 `peekMeta()`（不读完整 state 只查最后更新时间 / 节点位置）、没有 `existsSince()` 等查询能力
- ❌ 没有版本号 / schema migration 字段——后续 EngineState 演化会遇到向后兼容问题
- ❌ 实现只有 `MemoryCheckpointer`，linnya 桌面也用这个；linnsec 真要持久化必须新写

### 2.2 当前 EngineState 长什么样

`src/agent/runtime-kernel/graph-engine/types.ts`（grep 已确认存在）—— 是核心运行时状态对象：节点位置、pendingToolCalls、conversationView、context summary 等。

**关键事实**：`EngineState` 是 engine 内部 owned，产品层不该 deserialize 它的字段语义——只能整体 save/load。这要求 Checkpointer 是**黑盒序列化**：engine 自己负责 schema，产品层只负责存字节。

### 2.3 Engine-level `EventStore` port：当前不存在

事件直接通过 `EventBridge` emit 给 host（SSE 出口）。

需要把两个概念拆开说：

- **宿主层事实**：Linnya 现在已经有自己的 `Linnya EventStore`
- **engine 层事实**：`linnkit` 还没有通用 `EventStore` port

所以这里的真实问题不是“世界上完全没有 EventStore”，而是：**engine 还没有一套可复用、可插拔、对第二消费者也成立的 `EventStore` 协议**。

- linnya 桌面：当前可以继续用宿主自己的事件存储
- linnsec："老板半小时后问进展"场景下，如果 engine 没有通用 `EventStore` port，就没法把同一能力自然带过去

### 2.4 RunRegistryStore：当前不存在

run / detached run 的概念目前只隐式地存在于 `conversationId` 维度。engine/01 §5.2 已经设计好 `RunSupervisor` 的 API surface，**它需要一个 `RunRegistryStore` port 才能落地**。

### 2.5 现状评估总结

| Port | 现状 | 缺什么 | 本 topic 决定 |
|------|------|--------|-------------|
| `Checkpointer` | ✅ 接口已有 + Memory 实现 | 信息薄 + 缺 `list`/`peekMeta` + 缺 schema 版本 | **扩展 + 加 schema 版本** |
| `EventStore` | ⚠️ 宿主层已有 `Linnya EventStore`，但 engine 通用 port 不存在 | 接口、append/range/cursor 语义、retention 策略 | **新增 port（可选 capability）** |
| `RunRegistryStore` | ❌ 完全没有 | 接口、由 01 提需求 | **新增 port（必备）** |

---

## 3. 各参考项目做法（按本 topic 范围摘）

### 3.1 OpenClaw

参考价值：⭐

- 本身有持久化，但与 runtime 紧耦合
- 不作正面参考

### 3.2 Codex

参考价值：⭐⭐⭐

- Rust **`Conversation` + `RolloutRecorder`**：把每一轮 LLM input/output 持久化为 rollout file
- **`ThreadManager`**：HashMap 内存形态 + 可选 `ThreadStore` 持久化
- 协议 / 实现物理分离（`protocol` crate vs `core` / `app-server`）
- **启发**：rollout file 是"事件流持久化"的极简形态——可视为我们 `EventStore` 的灵感来源
- 详见 [`../99-research-notes/codex.md`](../99-research-notes/codex.md)

### 3.3 Claude Code

参考价值：⭐⭐

- 单进程 CLI，**主要用 in-memory + 文件 dump**
- 没有正式的 EventStore 概念，但有"当前会话 snapshot 文件"
- 启发：单进程产品 EventStore 可以"按需启用"——engine 应当让 EventStore 是**可选** port

### 3.4 Hermes

参考价值：⭐⭐⭐⭐

- **SessionDB SQLite + FTS5**：所有会话状态、消息、cron、KB 引用都在一个 SQLite DB
- 全文检索：上层 UI 可以查 "上周提到 X 的所有会话"
- 多 IM 永驻 daemon → SessionDB 是 lifeline
- **启发**：linnsec 几乎可以照搬 Hermes 模式（独立 port + SQLite + FTS5 实现）
- 详见 [`../99-research-notes/hermes.md`](../99-research-notes/hermes.md)

### 3.5 启发摘要

| 启发点 | 来源 | 是否进入 engine |
|--------|------|----------------|
| 三个 port 独立（state / events / runs）| Codex 多组件分离 | ✅ engine 留三个 port |
| Schema 版本字段 | 通用最佳实践 | ✅ engine `Checkpointer` 加 schemaVersion |
| EventStore append + range + cursor | Codex rollout / EventLog 通用模式 | ✅ engine 留接口 |
| FTS5 全文检索 | Hermes | ❌ 实现层（产品 host 实现 SQLite store 时自带）|
| `peekMeta()` 不 load 完整 state | engine/01 §5.2 PeekResult 需要 | ✅ engine `Checkpointer` 扩展 |

---

## 4. 候选方案

### 方案 A（推荐）：**三个独立 port + Checkpointer 扩展 + 信息丰富**

**做什么**：

1. **Checkpointer 接口扩展**（向后兼容）：

   ```typescript
   export interface Checkpointer {
     // 现有，不变
     load(conversationId: string): Promise<EngineState | null>;
     save(conversationId: string, state: EngineState): Promise<void>;
     clear(conversationId: string): Promise<void>;

     // 新增（可选实现，默认 fallback 到 load）
     peekMeta?(conversationId: string): Promise<CheckpointMeta | null>;
     list?(filter?: CheckpointListFilter): Promise<CheckpointSummary[]>;
   }

   export type CheckpointMeta = {
     conversationId: string;
     schemaVersion: number;
     savedAt: number;
     currentNode?: string;
     iterations?: number;
     hasPendingToolCalls?: boolean;
   };

   export type CheckpointListFilter = {
     savedAfter?: number;
     limit?: number;
     cursor?: string;
   };

   export type CheckpointSummary = CheckpointMeta;
   ```

2. **EventStore 新增 port**（可选 capability）：

   ```typescript
   export interface EventStore {
     append(conversationId: string, event: PersistedEvent): Promise<void>;
     range(conversationId: string, opts?: {
       fromEventId?: string;
       toEventId?: string;
       limit?: number;
     }): Promise<PersistedEvent[]>;
     latestEventId(conversationId: string): Promise<string | null>;
     truncate?(conversationId: string, opts: { beforeEventId?: string; beforeMs?: number }): Promise<void>;
   }

   export type PersistedEvent = {
     eventId: string;        // 单调递增
     timestamp: number;
     conversationId: string;
     runId?: string;
     event: RuntimeEvent;    // engine 自己定义的事件 schema
   };
   ```

   - **eventId 单调性**由 engine 保证（engine 内部生成，不依赖 backend）
   - **可选**：host 不传 EventStore 时，事件不持久化（与 linnya 桌面当前行为一致）
   - **truncate 可选**：retention 策略由产品层决定

3. **RunRegistryStore 新增 port**（必备，被 RunSupervisor 消费）：

   ```typescript
   export interface RunRegistryStore {
     save(record: RunRecord): Promise<void>;
     load(runId: string): Promise<RunRecord | null>;
     list(filter: ListRunsFilter): Promise<{ runs: RunRecord[]; nextCursor?: string }>;
     delete(runId: string): Promise<void>;
   }

   export type RunRecord = {
     runId: string;
     conversationId: string;
     parentRunId?: string;
     status: RunStatus;
     currentNode?: string;
     startedAt: number;
     updatedAt: number;
     iterationsUsed?: number;
     iterationBudget?: { max: number; refundable: boolean };
     errorIfAny?: { errorCode: string; message: string; recoverable: boolean };
     metadata?: Record<string, unknown>;
   };
   ```

   - 与 `engine/01` 的 `PeekRunResult` 字段对齐（`PeekRunResult` = `RunRecord` + 实时附加 `recentEvents`/`pendingInteractionSpec`）
   - `RunSupervisor.peek` 内部 = `RunRegistryStore.load` + 可选 `EventStore.range(latest, limit)` 拼装

4. **engine 提供 in-memory 默认实现**：
   - `MemoryCheckpointer`（已有，加 schemaVersion 字段）
   - `MemoryEventStore`（新增）
   - `MemoryRunRegistryStore`（新增）
   - 默认实现仅供 dev / 测试 / 单进程 host 使用；生产 host 必须自己提供 disk-backed 实现

5. **三个 port 都接到 host 注入点**（与 03 LlmProviderFactory / 10 toolRuntime 同位置）

**优点**：
- 三个职责独立，linnsec 可以一次性提供 SQLite 实现满足全部
- 信息丰富——`peekMeta` / `list` / `latestEventId` 让上层做 UI 不用 wrap
- 向后兼容——linnya 桌面继续用 Memory 系列，零改动

**缺点**：
- 三个 port 需要 host 提供三份装配代码（Linnya / linnsec 各自一次）—— 但写起来很轻

### 方案 B：**单一 PersistenceFacade**

把三个 port 合并成一个 `PersistenceFacade.{checkpoints, events, runs}`。

**优点**：装配点统一。

**缺点**：违反 SRP；三类数据生命周期 / 后端选择 / retention 策略本来就不同（如 linnsec 可能用 SQLite 存 checkpoints/runs、用 JSONL 存 events 做 retention 切片）；也不符合 §1.4 "信息丰富 + 灵活实现"。

→ 否决。

### 方案 C：**只做 Checkpointer 扩展 + RunRegistryStore，EventStore 留 P2**

**优点**：scope 更小。

**缺点**：linnsec 第一阶段必然需要 EventStore（"老板问进展"S2 场景）；分两次做反而更慢。

→ 否决。

---

## 5. 当前倾向

### 5.1 拍板小结

**走方案 A**：三个独立 port + Checkpointer 扩展 + 信息丰富。

### 5.2 实施分步

| Step | 内容 | 文件 | 风险 |
|------|------|------|------|
| 1 | `Checkpointer` 接口扩展（加 `peekMeta?` / `list?`）+ `CheckpointMeta` / `CheckpointListFilter` / `CheckpointSummary` 类型 | `runtime-kernel/graph-engine/checkpointer/base.ts` | 低（可选方法不破坏现有实现）|
| 2 | `EngineState` 加 `schemaVersion` 字段；`MemoryCheckpointer` save 时写入 | `runtime-kernel/graph-engine/types.ts` + `memoryCheckpointer.ts` | 低 |
| 3 | 新增 `runtime-kernel/graph-engine/event-store/{base.ts,memoryEventStore.ts}` | 新建 | 低 |
| 4 | 新增 `runtime-kernel/run-supervisor/runRegistryStorePort.ts` + `memoryRunRegistryStore.ts` | 新建（与 engine/01 §7.1 T1 协调） | 低 |
| 5 | engine 主循环按需注入 EventStore（默认 `noop`）；`runUntilYield` 内部在每次 emit 事件时若 store 存在则 append | `graph-engine/engine.ts` 或 tick-pipeline 中间件 | 中（要小心不影响现有 SSE 路径） |
| 6 | 把三个 port 的 interface 加进 `runtime-kernel/index.ts` exports（与 [`07 §7.1 T2`](./07-public-api-and-package-boundary.md) 协调） | exports | 低 |
| 7 | 文档更新：`runtime-kernel/graph-engine/README.md` 加 "持久化三件套" 章节 | docs | 必做 |
| 8 | host 装配点新增 EventStore / RunRegistryStore 注入（linnya 用 Memory 实现就够；linnsec 实施时换 SQLite）| `src/app-hosts/linnya/adapters/runtime-assembly/*` | 低 |

### 5.3 触发其他改动的可能性

| 改动 | 触发条件 |
|------|---------|
| `Checkpointer` schema migration 协议 | EngineState 不向后兼容时（事先约定 schemaVersion 字段，留好升级空间）|
| 事件流压缩 / partition 策略 | linnsec EventStore 出现 retention 性能问题 |
| 跨进程序列化 RunHandle / Checkpoint | 真出现"IDE 客户端跨进程查 run"场景（YAGNI） |

---

## 6. 待决策问题（已逐项定稿）

> **2026-04-21 默认推荐定稿**：方案 A 三个 port + Checkpointer 扩展。以下 7 题均按 §5 推荐定稿。

| # | 问题 | 决策 | 理由 |
|---|------|------|------|
| Q1 | EventStore 是必选还是可选 capability？ | ✅ **可选**（host 不传 = 不持久化，与 linnya 桌面当前行为一致）| 不强迫 linnya 桌面承担持久化成本；linnsec 接入即可 |
| Q2 | Checkpointer `peekMeta` / `list` 是必选还是可选方法？ | ✅ **可选**（向后兼容现有 MemoryCheckpointer；不实现的 host 自动 fallback 到 load）| 与 Q1 同精神 |
| Q3 | `EngineState.schemaVersion` 字段位置？ | ✅ **EngineState 顶层**（不放 metadata 子对象，便于产品层读取）| migration 检查需要尽早访问 |
| Q4 | EventStore 的 `eventId` 由谁生成？ | ✅ **engine 内部生成**（基于 timestamp + counter），不依赖 backend | backend 无关性、单调性强保证 |
| Q5 | EventStore 是否承担"重放"语义（replay）？| ✅ **不承担**（只做 append + range 查询）；replay 由产品层基于 range 自己实现 | 留接口、不做工具 |
| Q6 | RunRegistryStore 与 Checkpointer 是否可由同一 backend 实现？| ✅ **是**（按惯例推荐 linnsec 用同一 SQLite DB；engine 不强制） | 实现层灵活性 |
| Q7 | 默认 in-memory 实现是否打包进 engine？ | ✅ **是**（dev / 测试 / 单进程必备；零依赖）| 与 03 LlmProviderPort 不打包 OpenAI SDK 不同——in-memory 是 capability 自带 fallback |

---

## 7. 落地任务

### 7.1 Engine 内任务

- [ ] T1：扩展 `runtime-kernel/graph-engine/checkpointer/base.ts`：加 `peekMeta?` / `list?` + 相关类型
- [ ] T2：`runtime-kernel/graph-engine/types.ts` `EngineState` 加 `schemaVersion: number` 顶层字段
- [ ] T3：`memoryCheckpointer.ts` 适配 schemaVersion；`save` 时写入；`load` 时校验（mismatch 时怎么办由 §6 Q3 决议处理）
- [ ] T4：新建 `runtime-kernel/graph-engine/event-store/`
  - `base.ts` —— `EventStore` 接口 + `PersistedEvent` 类型 + 单调 eventId 生成器
  - `memoryEventStore.ts` —— in-memory 默认实现
  - `__tests__/eventStore.contract.test.ts` —— 协议级 contract 测试
- [ ] T5：新建 `runtime-kernel/run-supervisor/runRegistryStorePort.ts` + `memoryRunRegistryStore.ts`（与 [`engine/01 §7.1 T1`](./01-async-runs-and-handles.md) 协调，避免双写）
- [ ] T6：engine 主循环可选注入 EventStore：在每次 emit RuntimeEvent 时若 store 存在则 append（不破坏现有 SSE 路径）
- [ ] T7：把 `Checkpointer` / `EventStore` / `RunRegistryStore` / 相关类型加进 `runtime-kernel/index.ts` exports（与 [`07 §7.1 T2`](./07-public-api-and-package-boundary.md) 协调）

### 7.2 Host 侧任务（Linnya）

- [ ] T8：linnya host 装配点确保三个 port 注入位（与 03 / 10 装配同位置）
- [ ] T9：linnya 桌面继续使用三个 Memory 实现（默认行为不变）

### 7.3 Linnsec 侧任务（不在 engine 范围）

- T10（linnsec 实施时）：`SqliteCheckpointer` + `SqliteEventStore` + `SqliteRunRegistryStore`（共用一个 SQLite + FTS5）—— Hermes 模式

### 7.4 文档任务

- [ ] T11：更新 `runtime-kernel/graph-engine/README.md` 加 "持久化三件套" 章节
- [ ] T12：更新 `00-engine-scope-audit.md` §4 把 06 状态同步为 "✅ 决策定稿，等候实施"

---

## 8. 状态

- [x] §0 边界判定通过 Q1-Q4
- [x] §1 三个持久化职责切分清楚 + 用户场景明确
- [x] §2 当前 Linnya 现状盘点完成
- [x] §3 参考项目启发汇总
- [x] §4 候选方案 + 取舍（方案 A 主路径 + B/C 否决）
- [x] §5 当前倾向（方案 A 分步 + 触发条件）
- [x] §6 7 题已逐项定稿
- [x] §7 落地任务展开 T1-T12
- [x] **§7.1 T1-T5 + T7（port 接口部分）已通过 [`engine/20 §3`](./20-d3-d4-port-interfaces-plan.md) T0 阶段实施完成**（2026-04-22）：`Checkpointer` 扩展（`peekMeta?`/`list?` + `CheckpointMeta`/`CheckpointListFilter`/`CheckpointSummary`）/ `EventStore` + `MemoryEventStore` + contract test / `RunRegistryStore` + `MemoryRunRegistryStore` + contract test / 全部 export 进 `runtime-kernel/index.ts` 的 `runSupervisor` namespace
- [ ] §7.1 T6（engine 主循环可选注入 EventStore）+ §7.2 T8/T9（host 装配）待后续排（Phase E 完成后或宿主有真持久化需求时）

**下一步**：
1. ✅ §6 决策已定（三个独立 port + 信息丰富 + 可选 capability）
2. 与 engine/01 §7.1 协调 RunRegistryStore 实现位置（避免双写）
3. T1-T7 engine 内实施
4. T8-T9 host 侧装配（linnya 默认行为不变）
5. T11-T12 文档同步
