# 22 · EventStore 模型对齐研究（B3）

> **类型**：研究文档（非 runbook）  
> **日期**：2026-04-22（首版）／ 2026-04-22 二轮修订（E pivot + 3-runs 已知现状显式化 + 拆批细化为 B3a/B3a.5/B3b/B3c/B3d）  
> **背景**：`engine/21` 已把 B 阶段拆成 B1 Checkpointer / B2 Telemetry / B3 EventStore / B4 RunRegistry。当前以实际进度为准：B1、B2 已完成，下一步是 B3。  
> **目标**：在动手改 EventStore 前，把 Linnya 宿主 EventStore 与 linnkit EventStore 的模型差异、影响面、风险、拆批和回滚路径摸清。  
> **结论摘要**：推荐 **A2：schema-preserving event-grained core**。即不新增 `linnkit_events` 双源、不做 buffer 适配器；保留现有 `conversations / runs / events / messages` 四表，把 `SQLiteEventStore` 内部重构为逐事件 append 的 core，`appendRun()` 退化为兼容 helper。  
> **二轮修订关键点**：  
> 1. **不挂 EventBus sink 当主写路径**（详见 §4.4）。改为让 `EventPersistenceCoordinator.persistRun()` 内部从 `appendRun(events[])` 切到基于 event-grained core 的循环写，**持久化集合保持 `result.events.filter(shouldPersistRuntimeEvent)` 不变**。EventBus live sink 降级为 Phase E 之后再评估的未来选项。  
> 2. **B3 第一版不动 run 粒度**（详见 §4.5）。当前一次用户请求会产生 3 个 `runs` 记录（input / AI / stream_end），这是 B3 之前就存在的事实，B3 不在第一版重塑，挂 TODO 至 B5。  
> 3. **拆批从 B3a-e 改为 B3a / B3a.5 / B3b / B3c / B3d**（详见 §7）。新增 B3a.5 显式定义 internal-public 写入会话 API + 短事务边界契约，避免 B3b 偷偷破坏 B3a 的「无行为变化」承诺。  

---

## 0. 问题一句话

B3 表面上是“把宿主 EventStore 接到 linnkit EventStore port”，实际问题更尖锐：

```text
宿主 IEventStore:
  appendRun(conversationId, RuntimeEvent[], RunMetadata) -> runId
  同时维护 conversations / runs / events / messages

linnkit EventStore:
  append(conversationId, PersistedEvent) -> void
  range(conversationId, cursor) -> PersistedEvent[]
  latestEventId(conversationId) -> string | null
```

如果不做 B3，Phase E 真抽包后会出现一个死接口：`linnkit` 公开了 `EventStore` port，但 Linnya 主链仍继续旁路 `SQLiteEventStore.appendRun()`。这违反“公开面必须有真实消费方”的边界原则。

---

## 1. 当前事实

### 1.1 B 阶段真实进度

| 批次 | 内容 | 当前状态 | 对 B3 的影响 |
|------|------|----------|--------------|
| B1 | Checkpointer | ✅ 已完成 | 已证明 host port wiring 可以走 SQLite adapter |
| B2 | Telemetry | ✅ 已完成 | `GraphExecutor` / `GraphAgentExecutor` 已能接受 host port 注入 |
| B3 | EventStore | ⏳ 当前研究对象 | Phase E 硬阻塞 |
| B4 | RunRegistryStore | ⏸ 暂搁 | 等 RunSupervisor，不阻塞 Phase E |

### 1.2 宿主 EventStore 现状

真实 owner：
- `src/app-hosts/linnya/adapters/persistence/event-store/event-store.interface.ts`
- `src/app-hosts/linnya/adapters/persistence/event-store/sqlite.implementation.ts`
- `src/app-hosts/linnya/adapters/persistence/event-store/conversation.schema.ts`

宿主接口不是纯事件表接口，而是“conversation history aggregate”：

| 方法 | 语义 | 谁依赖 |
|------|------|--------|
| `appendRun(conversationId, events[], metadata)` | 一次 run 原子写入 | `EventPersistenceCoordinator` / `HistoryRepository` / tests |
| `ensureConversation(...)` | 创建/补齐 conversation 元数据 | flow incoming facts |
| `readEvents(...)` | 读取事实事件 | history API / replay / context rebuild |
| `readMessages(...)` | 读取物化消息 | 历史 UI 可用，但当前主回放更依赖 facts |
| `listConversations(...)` | 历史列表 | renderer history list |
| `getConversationMetadata(...)` | 模式/标题/计数 | renderer history loader |
| `updateTitle(...)` / `deleteConversation(...)` | UI 管理操作 | history panel |
| `truncateAfter(...)` | 编辑重发/从某步重跑 | flow history handler / UI |

真实表结构：

| 表 | 语义 | B3 影响 |
|----|------|---------|
| `conversations` | 对话元数据、预览、计数、项目归属 | 逐事件写入时仍要更新 |
| `runs` | run 级生命周期、模型、toolset | 逐事件写入前必须先有 run |
| `events` | RuntimeEvent 事实源，`run_id NOT NULL` | linnkit `PersistedEvent.runId?` 可选会冲突 |
| `messages` | UI 物化视图，按 `seq` 排序 | 逐事件写入时必须继续物化 |

关键事实：`events.run_id` 是非空外键，所以“直接把 `EventStore.append()` 接到现有 `events` 表”不成立，除非先解决 runId / run lifecycle。

### 1.3 linnkit EventStore 现状

真实 owner：
- `src/agent/runtime-kernel/graph-engine/event-store/base.ts`
- `src/agent/runtime-kernel/graph-engine/event-store/memoryEventStore.ts`

接口形状：

```ts
export type PersistedEvent = {
  eventId: string;
  timestamp: number;
  conversationId: string;
  runId?: string;
  event: RuntimeEvent;
};

export interface EventStore {
  append(conversationId: string, event: PersistedEvent): Promise<void>;
  range(conversationId: string, opts?: EventRangeOptions): Promise<PersistedEvent[]>;
  latestEventId(conversationId: string): Promise<string | null>;
  truncate?(conversationId: string, opts: { beforeEventId?: string; beforeMs?: number }): Promise<void>;
}
```

当前它只被 contract test 覆盖，没有生产 caller。`GraphExecutorConfig` 已有 `telemetryPort`，但没有 `eventStore`；`EventBus.publish()` 只发内存事件，不持久化。

### 1.4 写入路径现状

当前 flow 写入分三段：

1. `FlowHostSessionService.persistIncomingEvents()`  
   先把 `user_input / tool_output from user` 立即落库。

2. `FlowHostSessionService.persistRunEvents()`  
   run 完成后过滤 `shouldPersistRuntimeEvent(event)`，再一次性 `persistRun()`。

3. `FlowHostSessionService.finalize()`  
   直接发送 `stream_end` SSE，并把对应 RuntimeEvent 立即落库。

所有写入最终都走：

```text
EventPersistenceCoordinator
  -> ConversationPersistencePort.appendRun()
  -> SQLiteEventStore.appendRun()
```

### 1.5 读取与 UI 影响面

读取路径比写入路径更广：

```text
SQLiteEventStore.readEvents()
  -> HistoryRepository.readEvents()
  -> HistoryService / HistoryRouter
  -> /api/v1/conversation/:id/events/paginated
  -> HistoryApiService.fetchEvents()
  -> historyLoaderStore.loadConversation()
  -> historyReplayService.convertRuntimeEventToSSE()
  -> messageProjection
```

关键不变量：
- `readEvents(direction=backward)` 每页内仍返回旧到新。
- 前端 loader 收集多页后整体反转页顺序，保证全局旧到新。
- replay 必须读 `events` 事实表，不能只读 `messages` 物化视图，否则 `todo_updated / subrun_trace / history_summary / stream_end` 等非主消息事件会丢。
- `truncateAfter()` 当前按 message 或 event 定位，再按 run 删除后续数据。

所以 B3 不能只看 append 写入；必须保证 `readEvents / truncateAfter / messages materialization / conversations counters` 一起不退化。

---

## 2. 影响面量化

### 2.1 生产文件清单

不含测试，当前直接相关生产文件：

| 类别 | 文件 |
|------|------|
| 宿主接口/实现 | `src/app-hosts/linnya/adapters/persistence/event-store/event-store.interface.ts` |
| 宿主 SQLite 实现 | `src/app-hosts/linnya/adapters/persistence/event-store/sqlite.implementation.ts` |
| 宿主 schema | `src/app-hosts/linnya/adapters/persistence/event-store/conversation.schema.ts` |
| flow 写入协调 | `src/app-hosts/linnya/adapters/flow/flow.persistence.ts` |
| flow session | `src/app-hosts/linnya/adapters/flow/flow.host-session.service.ts` |
| flow history handler | `src/app-hosts/linnya/adapters/flow/flow.history-handler.service.ts` |
| history repository | `src/features/conversation/history/history.repository.ts` |
| history service/router | `src/features/conversation/history/history.service.ts`, `history.router.ts` |
| main route wiring | `src/electron-main/routes/index.ts` |
| renderer API | `apps/renderer/domains/conversation/history/services/historyApiService.ts` |
| renderer loader/replay | `historyLoaderStore.ts`, `historyReplayService.ts` |
| renderer list/panel | `historyListStore.ts`, `FullHistoryPanel.vue` |
| engine event bus | `src/agent/runtime-kernel/execution/event-bus.ts`, `sequencer.ts` |
| engine EventStore port | `src/agent/runtime-kernel/graph-engine/event-store/*` |

### 2.2 调用点统计

本地扫描结果：
- `IEventStore` 生产主路径集中在 `event-store.interface.ts`、`sqlite.implementation.ts`、`HistoryRepository`、host testkit。
- `appendRun()` 生产主路径集中在 `flow.persistence.ts`、`HistoryRepository`、`SQLiteEventStore`。
- 读取侧跨到 renderer：`HistoryApiService`、`historyLoaderStore`、`historyReplayService`、history list/panel。

结论：写入面窄，读取/回放面宽。正确切法应先封装写入 core，保持读取 API 不动；不要第一刀就改 renderer。

---

## 3. 三个方案复盘

### 3.1 方案 A 原版：直接把宿主 IEventStore 改成 event-grained

思路：把 `IEventStore` 改成和 linnkit `EventStore` 一样，业务层逐条 append。

优点：
- 最符合 linnkit public port。
- 不留双源。
- 长期模型最干净。

问题：
- 原版 A 低估了 `runs/messages/conversations` 的耦合。
- `events.run_id NOT NULL` 要求先有 run，单独 `append(event)` 不够。
- `messages` 物化和 conversation 计数不能丢。
- `truncateAfter()` 当前是 run-grained 删除，不能突然变成只删单条 event。

结论：方向对，但原版 A 描述太粗，不能按字面执行。

### 3.2 方案 B：适配器 buffer + flush 到 appendRun

思路：实现一个 linnkit `EventStore` adapter，内部先 buffer 事件，到 run 结束再 flush 成 `appendRun()`。

优点：
- 宿主改动少。
- 能快速让 `linnkit EventStore` 有 caller。

致命问题：
- failure mode 复杂：进程崩溃时 buffer 丢失，和 EventStore “持久化事件流”目标相反。
- range/latestEventId 需要读已 flush 的 SQLite，读不到 buffer 中未 flush 的事件，语义割裂。
- flush 边界必须知道 run 何时结束，等于把 run lifecycle 偷塞进 adapter。
- `stream_end` / incoming facts / tool_output from user 这些立即写入事件会和 buffer run 混在一起。

结论：不推荐。它看起来小改，实际是把复杂度藏起来。

### 3.3 方案 C：新增 `linnkit_events` 双写

思路：linnkit EventStore 写新表，宿主旧 EventStore 继续写旧四表。

优点：
- 风险隔离。
- 不影响现有 history/SSE/UI。

致命问题：
- 双源会长期存在，最容易变成“以后再收”的债。
- 同一 RuntimeEvent 同时存在两套事实源，回放、审计、truncate、迁移都要回答“哪个为准”。
- Phase E 后 `linnkit` 仍无法真正拥有历史主链，反而多了一张旁路表。

结论：不推荐。除非线上迁移风险不可接受，但当前还没到必须双源的阶段。

---

## 4. 推荐方案：A2 · schema-preserving event-grained core

### 4.1 一句话

保留现有四张表和 history API，对 `SQLiteEventStore` 做内部重构：

```text
现状:
  appendRun(events[]) 内部一次事务：
    create run
    insert all events
    materialize messages
    update run completed
    update conversation

A2:
  beginRun(conversationId, metadata) -> runId
  appendEvent(conversationId, PersistedEvent with runId) -> void
  completeRun(runId) -> void
  appendRun(events[]) = helper:
    beginRun()
    for each event -> appendEvent()
    completeRun()
```

然后让 linnkit `EventStore.append()` 对接 `appendEvent()`，而不是新增表，也不是 buffer。

### 4.2 为什么是 A2

A2 同时满足：
- 不留双源。
- 不破坏现有 DB schema。
- 不第一刀改 renderer。
- 允许 engine/EventBus 未来逐条 append。
- `appendRun()` 仍可作为过渡 helper 存在，但不再是唯一真源。

这比原版 A 更稳，因为它不是“把宿主历史系统推倒重写”，而是把 `SQLiteEventStore` 里已经存在的事务步骤拆成高内聚的小操作。

### 4.3 对 linnkit EventStore port 的小修正建议

#### 4.3.1 `PersistedEvent.runId` 由 host adapter 自行 fail-fast

当前 `PersistedEvent.runId?: string` 是可选，但 Linnya 的现有事实表必须有 runId。

建议 B3 不急着改成必填，而是新增一个 host-side guard：

```ts
function requirePersistedRunId(event: PersistedEvent): string {
  if (typeof event.runId !== 'string' || event.runId.length === 0) {
    throw new Error('[SQLiteEventStoreAdapter] PersistedEvent.runId is required for Linnya SQLite events table');
  }
  return event.runId;
}
```

原因：
- linnkit port 要服务更多消费者，event-only 后端可以没有 run 表。
- Linnya adapter 自己有 run 表约束，应该在 adapter 层明确报错。
- 不要把 Linnya 的 schema 约束反推成 linnkit 全局约束。

#### 4.3.2 `event_store_id` 的 monotonic 生成器

linnkit `EventStore.range(fromEventId, toEventId)` 依赖**可排序、可对比**的 cursor。但现有 `events.id` 是 RuntimeEvent id（`generateMessageId()` / `generateRunId()` 派生，非单调），`rowid` 虽单调但不是业务字段，暴露出去不稳。

**结论**：B3b 给 `events` 表加 `event_store_id TEXT` nullable 列 + 唯一索引；新写入必须带 monotonic id；旧历史数据保留为 NULL，read 路径 fallback 到 `rowid` 排序。

**生成器选型**：

| 选项 | 说明 | 取舍 |
|---|---|---|
| ULID | 26 字符 base32，全局可排序 | 引入新依赖；过度设计（单进程不需要） |
| `printf('%020d', rowid)` | 用 INSERT 后 rowid 反写 event_store_id | 写入需要二次 UPDATE；linnkit port 语义要求 eventId **写入前就确定**，事后被 DB 替换破坏不变量 |
| `createMonotonicEventIdFactory()`（推荐） | host-side process-local 生成器，结构 `${unixMs}-${counter}-${random}` 或类似，timestamp + counter 保单调 | 单进程足够；写入前可拿到值；与 linnkit `PersistedEvent.eventId` 语义一致 |

**Owner 位置**：生成器**放 host 的 `EventStoreSink` / `RunSession` 层**，不放 linnkit。原因同 §4.3.1：避免 host 约束反推到 linnkit port。

**待 runbook 阶段定**：generator 的具体字符串结构（建议 `${ms}-${pid}-${counter}` 或 `${ms}-${counter}` + 启动随机种子防碰撞），以及它和 `PersistedEvent.eventId` 的关系（建议 `eventId === event_store_id`，host adapter 写入时同时填两列）。

### 4.4 持久化路径：B3 第一版不引入 live EventBus sink（**二轮修订**）

#### 4.4.1 修正：不挂 sink 在 `EventBus.publish()`

**首版误判**：原 §4.4 提议把 `EventStoreSink` 挂在 `EventBus.publish()` 后，作为 B3 主写路径。

**二轮修订**：放弃这个方案。原因是 EventBus publish 的事件集合**不严格等于** `events` 表存储的事件集合：

| 事件类别 | 走 EventBus.publish？ | 进 events 表？ |
|---|---|---|
| `final_answer_chunk` / 增量 thought / `tool_process` | ✅ 是（实时增量） | ❌ 否（被 `shouldPersistRuntimeEvent` 过滤） |
| `StreamCollector` 重组的完整 `final_answer` | ❌ 否（persistence-only） | ✅ 是 |
| `incoming facts`（`user_input` / `tool_output from user`） | ❌ 否（直接落库） | ✅ 是 |
| `stream_end` | ❌ 否（finalize 直发 SSE） | ✅ 是 |
| 主流 RuntimeEvent（`final_answer` / `tool_call_request` / ...） | ✅ 是 | ✅ 是 |

如果直接把 sink 挂 `EventBus.publish()` 当主写路径，会**同时**：
- **偷偷扩大持久化范围**：把当前不该入库的实时增量事件写入 `events` 表，破坏 history replay 协议。
- **偷偷缩小持久化范围**：漏掉 `StreamCollector` 重组的 `final_answer` / incoming / stream_end，破坏 messages 物化。

#### 4.4.2 新方案：在 `EventPersistenceCoordinator.persistRun()` 内部循环写

更稳的路径：**保持持久化集合不变**，只把写入方式从"一次性 `appendRun(events[])`"改为"逐事件 `appendEventToRun()` for-loop"。

```text
[B3 之前]                                     [B3 之后]
flow.host-session.service                     flow.host-session.service
  └─ persistRunEvents()                         └─ persistRunEvents()
       └─ EventPersistenceCoordinator                └─ EventPersistenceCoordinator
            └─ persistRun(events[])                       └─ persistRun(events[])
                 └─ port.appendRun(events[])                   ├─ session = port.beginRunSession(metadata)  ← 短事务
                                                               ├─ for each event:                            ← 每条短事务
                                                               │     port.appendEventToRun(session.runId, event)
                                                               └─ port.completeRun(session.runId)            ← 短事务
```

**这样做的好处**：
- `persistRun()` 入参仍是 `result.events.filter(shouldPersistRuntimeEvent)`，**持久化集合零变化**。
- `incoming facts` / `stream_end` 走的 `persistImmediately()` 自动复用同一组新 core API，不需要为它们另开例外路径。
- EventBus 语义不被污染，继续是"实时运行期管道"，不被偷换成"持久化事实流"。
- 回滚成本最低：若新 core 有问题，把 `persistRun()` 折叠回 `appendRun(events[])` 即可，不用拆 sink 装配。

#### 4.4.3 事务边界：短事务，不长事务

**严禁全程持有 SQLite transaction**。LLM/tool run 是异步长过程，单 run 几秒到几分钟，长事务会锁库锁到爆。

正确的事务边界：
- `beginRunSession(metadata)` → 一次短事务（INSERT 一条 run 记录，commit）
- `appendEventToRun(runId, event)` → 每条事件一次短事务（INSERT events + 可能物化 messages，commit）
- `completeRun(runId)` / `failRun(runId)` → 一次短事务（UPDATE run 状态，commit）

**代价**：进程在 run 中途崩溃会留下"open run"状态。这个由 startup recovery 处理（B3 第一版可以先记录 warning，不立即清理；以后再开 task 决定是 mark `failed` 还是按超时 `cancelled`）。

#### 4.4.4 live EventBus sink 不被这次否决，只是延后

如果将来 linnsec / 实时审计 / cloud streaming 需要"边产生边落库"的语义，再回头评估：
- 在 EventBus.publish() 后挂一个独立 sink；
- sink 的事件集合需要专门定义（不是 `events` 表的等价镜像）；
- 它不是 `events` 表的主写路径，是另一条平行通路（可能写另一张表，或上行到外部聚合）。

这条决策放进未来 topic（详见 §11 未解决问题），B3 第一版不做。

### 4.5 runId 来源 + 已知现状（**二轮修订显式化**）

#### 4.5.1 当前并存的 4 种 ID

| ID | 来源 | 用途 | B3 是否动它 |
|----|------|------|--------------|
| `turn_id` | RuntimeEvent 基础字段 | UI/replay 归组 | ❌ 不动 |
| `execution_id` | EventSequencer | 单次 SSE/EventBus execution | ❌ 不动 |
| **SQLite `runs.id`** | `SQLiteEventStore.appendRun()` 内部 `generateRunId()` | 持久化 run 表 | ✅ 改造写入路径，但 ID 生成器位置不动 |
| **GraphExecutor telemetry runId** | B2-engine Batch 4 在 `runUntilYield()` 临时生成 `run_${Date.now()}_${random}` | telemetry scope | ❌ 不动，**且不能复用为 SQLite runId** |

**关键边界**：B3 不应该混用 SQLite runId 和 GraphExecutor telemetry runId。telemetry runId 是 observation 层 scope，不是数据库事实源。两个 runId 各管一摊，B3 第一版就这么并存。

#### 4.5.2 已知现状：一次用户请求产生 **3 个 `runs`** 记录

**这是 B3 之前就存在的事实，不是 B3 引入的问题**。代码实证（2026-04-22）：

```text
flow.host-session.service.ts
├─ persistIncomingEvents()     → persistImmediately(user_input)  → appendRun() → run #1 (kind='input')
├─ persistRunEvents()          → persistRun(AI events)           → appendRun() → run #2 (kind='user_input'|'task')
└─ finalize(stream_end)        → persistImmediately(stream_end)  → appendRun() → run #3 (kind='input')
```

每次 `appendRun()` 都在 `sqlite.implementation.ts` 调 `generateRunId()` 生成全新 runId（详见 `flow.persistence.ts:129-143`）。

**直觉冲突**：从用户视角看"一次请求一次 run"；但从 DB 视角看是 3 个 run。当前 truncate / history list / messages 物化都已经按这个模型工作，不能"顺手统一"，否则会破坏现有读取协议。

#### 4.5.3 B3 第一版不动 run 粒度

**B3 第一版的承诺**：
- runs 表行数与现状 byte-for-byte 一致（同一请求仍产生 3 行）
- runId 生成器位置不动（仍由 `SQLiteEventStore` 内部生成，但封装到 `beginRunSession()` 里）
- truncate / history list / messages 物化逻辑不动

**run 粒度统一另开任务**（暂记为 **B5 · run-granularity-merger**），需要先回答：
- 合并后怎么标 `kind`？（`user_input` 一个 run 内部是否要分 segment？）
- truncate 语义改不改？（现在按 run 删，合并后必须改成按 message/event）
- history list 显示什么？（一个 run 一条还是按 segment 分组）
- messages.seq 顺序如何保证？

详见 §11 未解决问题。

#### 4.5.4 incoming facts / stream_end 走同一组 event-grained core

按 §4.4.2 的方案，`persistImmediately()` 自动复用 B3a.5 引入的 `beginRunSession / appendEventToRun / completeRun` 三件套。**对外行为零变化**：
- 仍创建独立 short run
- 仍按 kind='input' 写入
- runId 仍由 host 生成

只是内部从"一次性 appendRun(events[])"变成"短事务 begin + appendEvent + complete"。

---

## 5. 风险评估

### 5.1 最高风险：重复写入

如果 EventBus sink 开始逐条写，同时 `persistRunEvents()` 仍在 run 结束后 `appendRun()`，同一事件会被写两次，直接触发 `events.id UNIQUE`。

规避：
- B3 迁移必须有 feature boundary：同一批内要么旧 `persistRunEvents()` 写，要么新 EventStoreSink 写，不能双写。
- contract test 必须覆盖“同一 run 只写一次”。

### 5.2 run 结束状态

当前 `appendRun()` 同一个事务里创建 run、写 events、标 completed。逐事件写入后会出现 run 进行中状态。

规避：
- 新增 `beginRun/completeRun/failRun` 这类 host internal API。
- 若 run 失败，标 `failed` 并保留已写事件。
- `finalize()` 中统一 close session，保证状态收口。

### 5.3 messages 物化一致性

当前 `appendRun()` 中物化 message，并用 `MAX(seq)` 追加 seq。逐事件写入必须保持同样规则。

规避：
- 抽出 `materializeEventIfRenderable()`，每 append 一个 event 时处理。
- `tool_process` / `ephemeral` 仍按 `shouldPersistRuntimeEvent()` 过滤，不进入 messages。
- 保留现有 message id = event.id 的约束。

### 5.4 history pagination 顺序

当前分页依赖 `events.rowid`，逐事件 append 后更自然，但不能改返回顺序。

规避：
- `readEvents()` 保持现状，不在 B3 改 renderer。
- 增加一条测试：多页 backward 读取后全局 replay 顺序仍旧到新。

### 5.5 truncate 粒度

当前 truncate 是按 message/event 定位，再删除目标 run 及之后 run。逐事件写入后同一 run 内可能有更多中间态事件已落库。

规避：
- B3 第一阶段不改变 truncate 语义，仍按 run 删除。
- 若未来要支持 event-grained truncate，另开任务，不能混进 B3。

### 5.6 stream_end 例外

`stream_end` 当前不走 EventBus，而是在 `finalize()` 里直接 SSE + 立即落库。

规避：
- B3 不强制把 `stream_end` 改走 EventBus。
- EventStoreSink 覆盖 EventBus 主流事件；`stream_end` 仍由 finalize 调用同一个 event-grained append helper。

---

## 6. 回滚策略

### 6.1 最小回滚边界

B3 必须拆成多 PR，每个 PR 可独立回滚：

1. 只抽内部 helper，不改行为。
2. 加 event-grained adapter contract test。
3. 接入 EventBus sink，但先只在测试 harness 打开。
4. 切 FlowHostSessionService 写入路径。
5. 移除旧 `persistRunEvents()` 的 run-grained 主写路径。

如果第 4 步出问题，回滚第 4/5 步即可；前 1/2 步是无行为重构，可以保留。

### 6.2 数据迁移

不需要迁移历史数据。

原因：
- 沿用现有四表。
- `events.payload` 仍存 RuntimeEvent。
- `readEvents()` / replay 协议不变。
- 只是写入路径从“一次 appendRun 内部 for-loop”拆成“显式 begin + appendEvent + complete”。

### 6.3 fallback

如果 EventBus sink 接入后破坏 SSE/UI：
- 保留 `EventPersistenceCoordinator.persistRun()` 旧路径作为短期 fallback。
- 通过单个 wiring flag 在 host 装配层切回旧路径。
- 但 fallback 只允许存在于同一 PR 的回滚保护里，不能作为长期兼容窗口。

---

## 7. 拆批建议（**二轮修订：B3a / B3a.5 / B3b / B3c / B3d**）

### 7.1 拆批总览

```
B3a    抽 private helpers（仍在 appendRun 事务内）—— 严格无行为变化
B3a.5  新增 internal-public 写入会话 API + 短事务边界契约
B3b    LinnyaEventStoreAdapter (linnkit EventStore) + event_store_id 字段 + monotonic 生成器
B3c    EventPersistenceCoordinator.persistRun() 切到 event-grained core，集合不变 ← 新主写路径上线
B3d    （延后）评估是否引入 live EventBus sink；Phase E 之后再说
```

### 7.2 B3a：抽 private helpers（无行为变化）

**目标**：不改 public `IEventStore`，只把 `appendRun()` 内部的事务步骤拆成具名 private 方法。

**改动**：
- 在 `SQLiteEventStore` class 里抽出：
  - `private insertRunRecord(metadata): string`（返回 runId）
  - `private insertEventRecord(runId, event): void`
  - `private materializeEventIfRenderable(runId, conversationId, event, seq): void`
  - `private completeRunRecord(runId): void`
  - `private updateConversationStats(conversationId, lastEventTs): void`
- `appendRun()` 改为这些 helper 的串联调用，**仍在同一个 `db.transaction(...)` 闭包里**。

**契约**：
- helper 签名都是 private。
- 仍然只被 `appendRun()` 调用。
- 事务边界仍由 `appendRun()` 持有。
- **行为字节级一致**。

**验证**：
- `flow-persistence-real.test.ts`
- `history.repository.test.ts`
- `flow.edit-resend.truncate.integration.test.ts`
- `flow.followup-tool-history.integration.test.ts`
- `npm run guard:agent-boundary`
- 全仓 `npm test` 不高于 baseline。

### 7.3 B3a.5：internal-public 写入会话 API + 短事务边界契约（**新增**）

**目标**：把 B3a 抽出的 helpers 升级为 `IEventStore` 的 internal-public API，**显式定义事务边界**，让 adapter 和 `EventPersistenceCoordinator` 能在事务外按"短事务序列"安全调用。

**新增到 `IEventStore`**：

```ts
interface IEventStore {
  // 既有 API（保留）
  appendRun(conversationId, events[], metadata): Promise<string>;
  ensureConversation(...): Promise<void>;
  readEvents(...): Promise<...>;
  truncateAfter(...): Promise<...>;
  // ... 其他既有方法

  // B3a.5 新增 internal-public
  beginRunSession(conversationId: string, metadata: RunMetadata): Promise<RunSession>;
  appendEventToRun(session: RunSession, event: RuntimeEvent): Promise<void>;
  completeRun(session: RunSession): Promise<void>;
  failRun(session: RunSession, error: { code: string; message: string }): Promise<void>;
}

interface RunSession {
  readonly runId: string;
  readonly conversationId: string;
  readonly startedAt: number;
}
```

**事务契约**（**写进 JSDoc，违反即报错**）：
- `beginRunSession()` —— **一次短事务**：INSERT `runs` 行，commit。
- `appendEventToRun()` —— **每条事件一次短事务**：INSERT `events` 行 + 视情况 INSERT `messages` 行 + UPDATE `conversations.last_event_ts` 等，commit。
- `completeRun()` / `failRun()` —— **一次短事务**：UPDATE run 状态 + 最终 conversation 统计，commit。
- **绝不**要求 caller 在跨多个 API 调用之间持有 transaction handle。
- 若进程崩在中间，留下 `status='running'` 的 run，由 startup recovery 处理（B3 第一版只 log warning，不清理）。

**B3a.5 的 `appendRun()` 同时改为 helper**：

```ts
async appendRun(conversationId, events, metadata) {
  const session = await this.beginRunSession(conversationId, metadata);
  for (const event of events) {
    await this.appendEventToRun(session, event);
  }
  await this.completeRun(session);
  return session.runId;
}
```

**注意**：`appendRun()` 现在变成"短事务序列"，**不再是单个大事务**。这是 B3a.5 的关键行为变化——但**对调用方语义不变**：仍返回 runId，仍按事件顺序物化 messages，失败时仍能保留已写部分（这点和原本"一个事务全 rollback"不同，需要在 contract test 里固化新语义）。

**契约 + 验证**：
- 新增 `IEventStore` contract test 覆盖 4 个新方法。
- 新增"短事务序列下崩溃恢复"测试：模拟 `appendEventToRun()` 中途抛错，验证已写 events 仍可读取，run 状态为 `running`。
- 既有 `appendRun()` 行为测试**全部继续通过**（kind / runId 返回值 / 物化 messages 顺序 / conversation 统计 / 失败回滚后已写事件可见）。

### 7.4 B3b：LinnyaEventStoreAdapter + `event_store_id` 字段

**目标**：实现 linnkit `EventStore` port 的 host 侧 adapter，对接 B3a.5 新 API，但**不替换主写路径**。

**改动**：
1. **schema migration**：`events` 表加 `event_store_id TEXT` nullable + 唯一索引；旧数据保持 NULL。
2. **新增 `createMonotonicEventIdFactory()`**（host-side process-local 生成器，结构 `${ms}-${counter}`，启动随机种子防进程重启碰撞）。
3. **新增 `LinnyaEventStoreAdapter implements EventStore`**：
   - `append(conversationId, persistedEvent)` → `requirePersistedRunId()` + `appendEventToRun()`
   - `range(conversationId, opts)` → 按 `event_store_id` 排序（旧数据 fallback 到 `rowid`）
   - `latestEventId(conversationId)` → `SELECT event_store_id FROM events ... ORDER BY event_store_id DESC LIMIT 1`
   - `truncate(conversationId, opts)` → 复用既有 `truncateAfter()` 的 run-grained 删除（B3 第一版不改 truncate 粒度）
4. **不挂主链**。adapter 暂时只在 contract test / linnkit dryrun 里被消费。

**契约 + 验证**：
- `EventStore` contract test（来自 linnkit kernel）全绿。
- 新增 `LinnyaEventStoreAdapter` 集成测试：写入后 `range()` 顺序稳定、`latestEventId()` 返回最新、`truncate()` 删除正确 run。
- 既有 host 测试**全部不变**。

**待 runbook 阶段定**：generator 的具体字符串结构、是否需要 schema_version 升档、旧数据 backfill 策略（推荐"不 backfill，依赖 NULL fallback"）。

### 7.5 B3c：切 `EventPersistenceCoordinator.persistRun()` 到 event-grained core（**主写路径上线**）

**目标**：让 host 主写路径走 event-grained core，**持久化集合不变**。

**改动**：
- `EventPersistenceCoordinator.persistRun()` 内部从 `port.appendRun(events[])` 改为：
  ```ts
  const session = await port.beginRunSession(conversationId, metadata);
  try {
    for (const event of events) {
      await port.appendEventToRun(session, event);
    }
    await port.completeRun(session);
  } catch (err) {
    await port.failRun(session, { code: 'PERSIST_ERROR', message: String(err) });
    throw err;
  }
  return session.runId;
  ```
- `persistImmediately()` 同上，复用同一组 API。
- **同 PR 内**：不需要移除任何旧主写代码（B3a.5 已让 `appendRun()` 内部就是这套逻辑），但 contract test 加一条"persistRun 不再依赖单个大事务"的断言。

**严禁双写**：
- 同一 RuntimeEvent 不能进入两个写入路径。
- contract test 加："同一 eventId 写两次必抛 UNIQUE 约束"。

**验证 + 灰度**：
- 全仓 `npm test` 不高于 baseline。
- 集成测试覆盖：`flow-persistence-real.test.ts` / `flow.edit-resend.truncate.integration.test.ts` / `flow.followup-tool-history.integration.test.ts`。
- 桌面端手测：发起 chat → tool call → final answer → 重启 → history 列表正确 → replay 顺序正确。
- **可选 wiring flag**（`EVENT_GRAINED_PERSIST=true|false`）—— 仅用于回滚保护和 A/B 测试，不作为长期产品配置；上线 1 个稳定版本后下个 PR 移除。

### 7.6 B3d：（延后）评估 live EventBus sink

**不在 B3 第一版做**。详见 §4.4.4 + §11。

### 7.7 B3 收尾（每个子批次的 doc step）

每个子 PR 自带：
- 更新 `INTEGRATION_GUIDE.md` 的 EventStore 段
- 更新 `engine/21 §3.x` 对应 port 的状态
- 当 B3c 上线后，更新 `engine/21 §8 Q1` 标"已决策 + 已实施"
- 写 `engine/23-b3-eventstore-runbook.md` 把上述 5 步固化为可让 subagent 无人值守跑完的 runbook（在 §8 Q1/Q2/Q3 拍板后立刻开写）

---

## 8. 需要用户拍板的问题

> **状态（2026-04-22 二轮修订）**：Q1/Q2/Q3 均已拍板，并落实为 §7 的拆批方案。下面保留原推荐 + 决策结果，供后续读者追溯。

### Q1：是否采用 A2？

**✅ 已决策：采用 A2**。

`engine/21 §8 Q1` 的关系：
- 原 21 §8 Q1 列了 A / B / C 三选一。
- B / C 已被否决（详见 §3.2 / §3.3）。
- A 原版方向对，但描述太粗，**不能按字面执行**，升级为本文档的 A2。
- 后续只按 A2 继续，不再回到原 A/B/C 三选一。

A2 大白话：
- 不新建第二张事件表。
- 不搞 buffer 适配器。
- 保留现在四张表。
- 把现在 `appendRun()` 里面那坨逻辑拆开，让它既能"一整轮写"，也能"一条条写"。

优点：
- 不留双源。
- 不需要迁移历史数据。
- 不第一刀动前端。
- 最符合 Phase E 真抽包。

缺点：
- `SQLiteEventStore` 要做一次认真重构。
- 需要设计 run session，不是只换一个 import。
- `appendRun()` 不再是单个大事务（变成短事务序列），失败语义略有变化（详见 §7.3）。

### Q2：B3b 是否允许给 `events` 表加字段？

**✅ 已决策并已实施（PR-C `bd889409`）**：允许加 `event_store_id TEXT` nullable + 唯一索引。生成器复用 linnkit 已提供的 `createMonotonicEventIdFactory()`，详见 §4.3.2。

原因：
- linnkit `EventStore.range(fromEventId/toEventId)` 依赖可排序 cursor。
- 现有 `events.id` 是 RuntimeEvent id，不保证单调。
- `rowid` 可排序但不是业务 eventId，暴露给 EventStore 不够稳。
- 加 nullable 字段不破坏历史数据；老数据可以 fallback 到 rowid 读取，新数据写入 monotonic id。
- 不引入 ULID 依赖（单进程不需要）。

### Q3：B3 第一轮是否只做 B3a/B3b，不切主链？

**✅ 已决策并已实施（修订版）**：B3 第一轮先做 **B3a / B3a.5 / B3b**，随后完成 **B3c** 主链切换。落地 commits：B3a `deb0e834` / B3a.5 `4b31a76f` / B3b `bd889409` / B3c `08c77ce6`。B3d（live EventBus sink）继续延后到 Phase E 之后再评估。

原因：
- B3a / B3a.5 / B3b 能先把模型和 contract 锁住。
- B3c 主链切换是风险最高的一步，应该在 adapter contract 绿了以后做。
- B3d live EventBus sink 第一版不引入（详见 §4.4 二轮修订）。
- 这样回滚成本最低。

---

## 9. 验收门槛

B3 完成必须满足：

- `SQLiteEventStore` 仍通过现有 run-grained 行为测试。
- 新增 linnkit `EventStore` adapter contract 测试通过。
- `events` 表不出现双写重复 id（B3c 必须有 UNIQUE 兜底测试）。
- `readEvents()` 旧到新顺序不变。
- `historyLoaderStore` 多页 replay 顺序不变。
- `truncateAfter()` 语义不变：按目标 message/event 所属 run 及之后 run 删除。
- `stream_end` 仍能持久化且 replay 不退化。
- 一次用户请求仍产生 3 个 `runs` 记录（B3 第一版**不动 run 粒度**，详见 §4.5）。
- `npm run guard:agent-boundary` 通过。
- `tsc` 不高于当前 baseline。
- `npm test` 不高于当前 baseline。

---

## 10. 下一步

B3 第一轮已经完成：

1. B3a：抽 private helpers，无行为变化。`deb0e834`
2. B3a.5：internal-public 写入会话 API + 短事务边界契约。`4b31a76f`
3. B3b：`LinnyaEventStoreAdapter` + `event_store_id` 字段 + monotonic 生成器 + schema migration。`bd889409`
4. B3c：`EventPersistenceCoordinator.persistRun()` 切 event-grained core，集合不变（**主写路径上线**）。`08c77ce6`
5. B3d：继续延后，留到 Phase E 之后再评估。

当前下一步不再是写 runbook，而是按 [`engine/07`](./07-public-api-and-package-boundary.md) + [`engine/11`](./11-phase-e-hard-blockers.md) 启动 Phase E 起手判定。

---

## 11. 未解决问题（B3 第一版不做，留给未来 topic）

### 11.1 B5 · run-granularity-merger（一次请求合并到一个 run）

**触发记录**：§4.5.2 显式承认当前一次请求产生 3 个 `runs` 记录（input / AI / stream_end），B3 第一版不动这个粒度。

**未来 topic 需要回答**：
- 合并后怎么标 `kind`？一个 run 内部是否要分 segment？
- truncate 语义改不改？现在按 run 删，合并后必须改成按 message/event。
- history list 显示什么？一个 run 一条还是按 segment 分组？
- messages.seq 顺序如何保证？
- 历史数据是否需要 backfill 合并？

**触发条件**：当 history UI 需要"按用户轮次"展示而不是"按 DB run 行"展示时；或 truncate 需要支持 event-grained 粒度时。

### 11.2 live EventBus sink（"边产生边落库"）

**触发记录**：§4.4.4 把 sink 模式降级为 Phase E 之后再评估的未来选项。

**未来 topic 需要回答**：
- 哪些消费者真需要这个能力？（candidate：linnsec 实时审计 / cloud streaming / 实时 DAU）
- sink 的事件集合怎么定义？（不能是 `events` 表的等价镜像，因为 publish 集合 ≠ 持久化集合）
- 它写到哪？（另一张表？外部 stream？）
- 与 B3c 的主写路径如何并存且不冲突？

**触发条件**：linnsec 立项后明确需要"边产生边落库"语义时。

### 11.3 崩溃恢复：清理"open run"

**触发记录**：§4.4.3 + §7.3 承认 B3a.5 后的短事务序列模型下，进程在 run 中途崩溃会留下 `status='running'` 的 run。

**B3 第一版策略**：startup 时记录 warning，不立即清理。

**未来 topic 需要回答**：
- 自动 mark `failed`？还是按超时 `cancelled`？
- 清理前是否需要保留诊断信息？
- 是否需要管理界面让用户手动恢复/清理？

**触发条件**：生产环境出现孤儿 run 影响 history 显示时。

### 11.4 truncate 改 event-grained 粒度

**触发记录**：§5.5 + §7.4 承认 B3 第一版 `truncate()` 仍按 run 删除，不改语义。

**未来 topic 需要回答**：
- 是否真有 event-grained truncate 的产品需求？
- 如果有，messages 物化、conversation 统计、affected runs 计算如何同步？

**触发条件**：UI 需要"删除某条消息但保留同 run 其他消息"时。

---

## 12. 对其他文档的传导

本文档二轮修订后，需要同步：

- **`engine/21`**：§3.x port 状态（B1/B2/B3 已完成）；§5.1 拆批表同步到 B3 完成；§8 Q1 显式标"已升级到 22 §8 Q1 (A2)，B/C 否决"；§8 Q2/Q3 标"已决策 + 已实施"；§4.3 ALS 双写并存方案补一行。
- **`engine/README.md`**：L79 06/08 行更新（B1/B2/B3 已完成）；当前进度表同步 B 阶段真实进度；M5 启动条件改为"B3 EventStore ✅ 已完成"。
- **`INTEGRATION_GUIDE.md`** EventStore 段：B3c 上线后再改，说明 Linnya 采用 schema-preserving adapter。

详见对应文档的对应段落。
