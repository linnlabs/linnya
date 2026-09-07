# 03 · 持久化与 read model

> **What** · 事实表与 UI read model 的双层结构、durable projection、rebuild 机制、迁移纪律。
> **When to read** · 改表结构、改 durable projector、加迁移、排查"重载后消息与实时不一致"之前。
> **不变量** · [INV-01](./00-invariants.md#inv-01--runtimeevent-是唯一事实源)、[INV-08](./00-invariants.md#inv-08--无历史兼容主链)、[INV-17](./00-invariants.md#inv-17--strict-schema-必须在真实边界执行)、[INV-44](./00-invariants.md#inv-44--durable-ui-与-foreground-context-按-routing-identity-隔离)
> **Related** · [02 事件管线](./02-event-pipeline.md) · [04 schema](./04-schema-contract.md) · [06 read model](./06-read-model.md)

---

## 1. 双层结构

```text
events（immutable facts）           ← 唯一事实源，审计 / 恢复 / rebuild / replay
   │ 增量 projection
   ▼
conversation_ui_messages +
conversation_ui_citation_facts（read model） ← 可随时删除重建的派生缓存
   │ HTTP 分页
   ▼
Renderer message window
```

关键性质：**上层永远可以从下层完全重建**。这决定了升级策略——合同变更不写兼容层，而是把 projection 标为 `pending` 再重建（[INV-08](./00-invariants.md#inv-08--无历史兼容主链)）。

### 1.1 表清单

Event/read-model 真源是 `src/app-hosts/linnya/adapters/persistence/event-store/conversation.schema.ts`；Citation 命名控制表由 sibling
adapter 的 `citation-ref-claims/schema-provider.ts` 独立拥有：

| 表 | 层 | 职责 |
|---|---|---|
| `events` | 事实 | immutable RuntimeEvent；审计与 rebuild 的唯一来源 |
| `conversations` | 聚合根 | 会话元信息（标题、项目归属等） |
| `runs` | 生命周期 | RunRegistryStore 的 owner：`parentRunId + status + currentNode + iterationsUsed（逻辑 run 累计步数）+ errorIfAny`；当前 execution 步数由 execution metrics / checkpoint 事实观测 |
| `conversation_ui_messages` | read model | 可重建的 UI 行 |
| `conversation_ui_citation_facts` | read model | 按 Conversation/ref/消息时点查询的规范化引用事实索引 |
| `conversation_citation_ref_claims` | 生产控制状态 | Conversation 内稳定来源身份 ↔ 6 位 ref 的持久原子声明；不是 event/read model |
| `conversation_ui_projection_state` | read model 元数据 | `status('pending'|'ready') + revision + last_event_rowid + rebuilt_at` |
| `conversation_event_asset_links` | 事实关联 | immutable event ↔ workspace asset 的有序引用；`UNIQUE(event_id, ordinal)` |

`runs` 是按父级查询 child 生命周期的**唯一 owner**（[INV-27](./00-invariants.md#inv-27--subrun-lifecycle-汇总只属于-runsupervisor)）。EventStore 保存 child facts，parent `subrun_trace` 形成可重建 UI read model，Telemetry / CostCollector / LLM Audit 只做观测。

`conversation_citation_ref_claims` 与上述双层 projection 正交：它不保存来源标题/摘录，也不能从 events
重建；作用只是保证已经发给模型的短别名以后不会改指向。Citation domain 拥有候选和碰撞规则，Host
SQLite adapter 只提供 `IMMEDIATE` 短事务与双唯一约束。当前处于开发期，表由 current schema provider
直接创建，不为未发布结构追加历史 migration。

`conversations.title` 是可变聚合元信息，不是事件投影。数据库默认值只承担“尚无业务标题”的存储占位；`ensureConversation()` 不得从 `initialEvents` 推导标题。首问 fallback、自动标题和手动改名统一由 Renderer `features/conversation-title/` 通过标题更新 API 持久化，避免 Host 与 Renderer 各自维护一套规则（[INV-35](./00-invariants.md#inv-35--标题资格来自创建动作)）。

**turn index 不建独立表**：按 `message_type='user_input'` 查询即得（`GET /:id/turns`）。

---

## 2. durable UI projection

代码位置 `src/app-hosts/linnya/adapters/persistence/event-store/ui-projection/`：

| 文件 | 职责 |
|---|---|
| `projectEvent.ts` | 事件 → UI row 的唯一投影入口 |
| `toolProjection.ts` | 工具行的身份与 lifecycle 归并 |
| `sqliteApplier.ts` / `memoryApplier.ts` | 落地实现（两个后端，同一投影） |
| `rebuildConversation.ts` | 全量重建 |
| `sqliteUiMessagesReader.ts` | 分页读取 |
| `attachments.ts` | asset link 投影 |
| `sqliteCitationFactIndex.ts` | main/Subrun 引用事实索引、按 ref 查询与删除 |
| `types.ts` | 内部投影类型 |

### 2.1 与前端投影的关系

后端 `projectEvent.ts` 与前端 `reduceEvent` 是**两套独立实现**，用同一组业务 fixture 锁 parity（[INV-02](./00-invariants.md#inv-02--messageprojection-是唯一投影体系)）。

**为什么不抽共享实现**：共享实现会让同一个 bug 同时出现在两端，parity 测试就失去意义。代价是必须同 PR 改两边——这是自觉接受的成本。

### 2.2 增量与全量共用治理规则

增量写入与全量 rebuild 必须共用 Linnkit event governance（`shouldPersistRuntimeEvent` 等，见 [02 §2](./02-event-pipeline.md)）。治理规则升级时把 disposable projection 标成 `pending`，再由启动维护从规范 immutable events 重建。

ephemeral `context_usage_snapshot` 只经 EventBus/SSE 服务运行中展示，必须同时满足
`persist=false / replayToUi=false`。最终值只由 durable `run_execution_metrics.context_usage` 进入 events 与
`conversation_ui_messages`，因此 rebuild 不依赖曾经在线收到的快照（[INV-60](./00-invariants.md#inv-60--上下文占用的实时快照与结算事实分层)）。

缺 routing 的事实必须拒绝，**不能根据 `runs` 表恢复身份**。

### 2.3 一致性模型

```text
projection_state.revision + last_event_rowid
        │
        ├─ 落后于 events → status='pending' → UI 显示"正在准备窗口"
        └─ 追平 → status='ready' → 正常分页
```

落后时**不回退全量 replay**。一致性靠 revision + 后台 rebuild。

---

## 3. 写入路径

### 3.1 Agent 生成事实

```text
publisher.publish() → EventBus → persistence consumer 写 events → 增量 projection
```

realtime 与 persistence 是**平级消费者**，不存在 collector-only、persistence-only 终态或收尾补写。

### 3.2 Host incoming fact（durable-first）

```text
publisher.route() → admission transaction 内写 events → commit
   → publishRouted() fan-out → 向 persistence consumer 登记已提交（禁止重复写）
```

详见 [02 §6](./02-event-pipeline.md)。

### 3.3 存储读取边界必须校验

`src/app-hosts/linnya/adapters/persistence/event-store/functions/runtimeEventStorageCodec.ts` 是存储事实的编解码边界。`events` 窄列与 `runs` 关系拥有公共身份，`payload` 只拥有事件 body；读取时先组合两者，再执行完整 routed schema。非法 row 或 payload 中重复出现身份字段都必须显式失败，不得 catch 后补默认值（[INV-17](./00-invariants.md#inv-17--strict-schema-必须在真实边界执行)）。

---

## 4. 分层隔离（[INV-44](./00-invariants.md#inv-44--durable-ui-与-foreground-context-按-routing-identity-隔离)）

EventStore 默认读取保存并返回**所有**满足持久化资格的正式事实。消费方各自按 routing identity 过滤：

| 消费方 | 只消费 |
|---|---|
| Conversation 主 read model | `lane=foreground / visibility=conversation` |
| foreground Agent history | 同上 |
| 用户消息计数、会话预览 | 同上 |
| child 恢复与审计 | `lane=child / visibility=parent-trace` 亦可读 |
| 父级正文展示 | **只**通过 parent `subrun_trace` |

### 4.1 `eventStoreId` 是游标不是身份

Linnkit adapter 的 `PersistedEvent` 只有 `eventStoreId + event`：

- `eventStoreId` → 存储分页游标
- `RuntimeEvent.id` → 业务事实身份

两者不得互相 fallback，也不在外层重复保存 conversation/run/timestamp（详见 [01 §6.1](./01-identity.md)）。

---

## 5. 迁移纪律

代码位置 `src/electron-main/services/database/migrations/`。当前采用开发基线 + 显式增量迁移：

- fresh database 由各 domain schema provider 直接建立当前结构；
- 已有数据库只从 `HOST_SCHEMA_BASELINE_VERSION` 开始，按注册项的 `fromVersion`
  逐步迁移；
- 文件名使用 `v{from}-to-v{to}-{purpose}.ts`，注册顺序不得代替版本身份。

### 5.1 已发生的合同性迁移（作为范式）

| 迁移 | 做了什么 | 范式意义 |
|---|---|---|
| v50→v51 | 按 answer segment `completion_reason` 重建 UI read model | 合同升级 = 重建，不是加兼容字段 |
| v51→v52 | 删除已退出 Runtime 合同的 Todo 专属持久化 | 退役即物理删除，不留兼容读取 |
| v52→v53 | 按 run-scoped Tool message identity 重建 UI read model | 身份规则变更 → 全量重建（对应 [INV-11](./00-invariants.md#inv-11--tool-ui-身份不属于单个事件)） |
| v61→v62 | 扩展 durable Subrun summary trace 合同 | 派生历史合同升级必须显式迁移 |
| v62→v63 | 建立可重建 citation fact index、删除重复 `subrun_id` 的废弃 `child_run_id`，并把既有 UI projection 标记为 `pending` | 新 read model 从 durable facts 重建；退役伪状态物理删除，不做历史 shape fallback                |

这些迁移都不写 shape guessing。这就是 [INV-08](./00-invariants.md#inv-08--无历史兼容主链) 在数据层的体现。

### 5.2 写迁移的规则

1. **read model 变更用 rebuild，不用 ALTER + 回填**。把 `conversation_ui_projection_state.status` 置 `pending` 即可，启动维护会重建。
2. **事实表（`events`）不可重写**。它是唯一事实源；投影规则变了就重投，事实本身不动。
3. **退役字段物理删除**。不保留"仍被消费"的错觉（教训 6）。
4. 注册表只追加连续的 `fromVersion` 条目，不修改已发布迁移的起点或语义。
5. 迁移必须幂等（现有条目普遍用 `PRAGMA table_info` 探测后再改）。

---

## 6. 禁止清单

| # | 禁止 | 正确做法 |
|---|---|---|
| 1 | 回写 `conversation.messages` | read model 只读；变更走投影（[INV-01](./00-invariants.md#inv-01--runtimeevent-是唯一事实源)） |
| 2 | 从 `runs` 表恢复缺失的事件 routing 身份 | 缺身份即拒绝（§2.2） |
| 3 | 为旧 payload 加 fallback 读取 | 标 `pending` 重建（§5.1） |
| 4 | 用 `eventStoreId` 当业务身份 | 只作游标（§4.1） |
| 5 | persistence 与 realtime 之间补写终态 | 平级消费者，无收尾补写（§3.1） |
| 6 | incoming fact 先 fan-out 再落盘 | durable-first（§3.2） |
| 7 | 为 turn index 建独立表 | 按 `message_type='user_input'` 查询 |
| 8 | projection 落后时退回全量 replay | 显示"正在准备窗口"等 rebuild（§2.3） |

---

## 7. 门禁

涉及 durable UI read model 的改动**至少**使用真实 `SQLiteEventStore`，并同时断言四层：

```text
committed Runtime fact → SQLite UI row → live SSE → reload DTO
```

只使用 `MemoryEventStore`、mock persistence port 或字段快照**不能**证明主链正确（[02 §8.10](./02-event-pipeline.md)）。完整测试分层见 [11 测试](./11-testing-gates.md)。
