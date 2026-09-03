# 23 · B3 EventStore 实施 Runbook（A2 schema-preserving event-grained core）

> **状态**：✅ B3 第一轮已完成（2026-04-22；PR-A `deb0e834` / PR-B `4b31a76f` / PR-C `bd889409` / PR-D `08c77ce6`）
> **目标读者**：另一个 agent / 远程 subagent / 本机操作者，能照着本文档无人值守跑完 B3a + B3a.5 + B3b + B3c
> **执行人原则**：本文档列出的所有步骤、判据、异常协议都必须严格遵守；**不要发挥**，遇到本文档未覆盖的情况先停下记录到 §10 而不是猜
>
> **关联**：
> - 主决策：[`22-eventstore-alignment-research.md`](./22-eventstore-alignment-research.md)（A2 方案 + 拆批 + 6 个细节问题）
> - 上层路线图：[`21-host-port-adapter-research.md`](./21-host-port-adapter-research.md) §3.2 / §5.1 / §8 Q1
> - Phase E 阻塞清单：[`11-phase-e-hard-blockers.md`](./11-phase-e-hard-blockers.md)
> - 测试规约：[`16-m4-m5-regression-test-plan.md`](./16-m4-m5-regression-test-plan.md)
> - 不变量 baseline：`.baseline/m4-summary.txt`
> - **关键源文件**（runbook 多次引用）：
>   - `src/app-hosts/linnya/adapters/persistence/event-store/sqlite.implementation.ts`（888 行，host SQLite 实现真源）
>   - `src/app-hosts/linnya/adapters/persistence/event-store/event-store.interface.ts`（166 行，host `IEventStore` 接口）
>   - `src/app-hosts/linnya/adapters/persistence/event-store/conversation.schema.ts`（73 行，初始建表 DDL）
>   - `src/app-hosts/linnya/adapters/flow/flow.persistence.ts`（196 行，`EventPersistenceCoordinator` + `ConversationPersistencePort`）
>   - `src/agent/runtime-kernel/graph-engine/event-store/base.ts`（42 行，linnkit `EventStore` 接口 + **已存在** `createMonotonicEventIdFactory()`）
>   - `src/electron-main/services/database/migrations/index.ts`（当前 `SCHEMA_VERSION = 22`）
>   - `src/electron-main/services/database/migrations/v021-v030.ts`（B3b 新 v23 migration 落点）

---

## 0. 启动准入（subagent 第一步必跑）

```bash
git status                                                    # 必须为空（working tree clean）
git log --oneline -1                                          # 必须 = b0ce8d91 或更新（22/21/README 二轮修订已提交）
cat .baseline/m4-summary.txt | head -10                       # 必须能读到 526 / 9 / 14 / ≤45s
ls src/app-hosts/linnya/adapters/persistence/event-store/sqlite.implementation.ts
ls src/agent/runtime-kernel/graph-engine/event-store/base.ts
ls src/electron-main/services/database/migrations/v021-v030.ts
grep -n 'SCHEMA_VERSION = ' src/electron-main/services/database/migrations/index.ts  # 应该是 22
grep -n 'createMonotonicEventIdFactory' src/agent/runtime-kernel/graph-engine/event-store/base.ts  # 应该已存在
```

**准入条件**（任何一条不满足必须 ABORT 并报告，**不要尝试修复**）：

- [ ] `git status` clean
- [ ] HEAD 包含 `b0ce8d91`（engine/22 二轮修订）或之后
- [ ] `.baseline/m4-summary.txt` 显示 tsc=526 / vitest file fail=9 / case fail=14 / duration ≤45s
- [ ] 关键源文件全部存在
- [ ] `SCHEMA_VERSION === 22`（B3b 会升到 23；如果已不是 22 必须停下确认）
- [ ] `createMonotonicEventIdFactory()` 已在 `src/agent/runtime-kernel/graph-engine/event-store/base.ts` export（避免重复造轮子）

---

## 1. 用户已拍板的决策（不再重新确认）

来自 [`engine/22 §8 Q1/Q2/Q3`](./22-eventstore-alignment-research.md#8-需要用户拍板的问题) + 二轮修订：

| 决策 ID | 内容 | 影响哪个 PR |
|---------|------|-------------|
| **B3-D1** | 采用 **A2** (schema-preserving event-grained core)；B/C 已否决，A 原版升级为 A2 | 整个 B3 |
| **B3-D2** | `events` 表加 nullable `event_store_id TEXT` + UNIQUE INDEX；新写入必须有 monotonic id；旧数据 NULL fallback rowid | PR-C (B3b) |
| **B3-D3** | monotonic id 复用 **`createMonotonicEventIdFactory()`**（已在 linnkit `runtime-kernel/graph-engine/event-store/base.ts:24-41` 提供）；不引入 ULID；不在 host 重复造 | PR-C (B3b) |
| **B3-D4** | **不挂 EventBus sink 当主写路径**（详见 [`22 §4.4`](./22-eventstore-alignment-research.md#44-持久化路径b3-第一版不引入-live-eventbus-sink二轮修订)）；B3 第一版的"主写路径切换"通过改 `EventPersistenceCoordinator.persistRun()` 内部循环实现 | PR-D (B3c) |
| **B3-D5** | **短事务**：`beginRunSession` / `appendEventToRun` / `completeRun` / `failRun` 各一次短事务；**绝不**长事务 | PR-B (B3a.5) |
| **B3-D6** | **B3 第一版不动 run 粒度**：一次用户请求仍产生 3 个 `runs` 记录（input / AI / stream_end），run 粒度合并另开 [B5](./22-eventstore-alignment-research.md#111-b5--run-granularity-merger一次请求合并到一个-run) | 整个 B3 |
| **B3-D7** | **B3a 严格无行为变化**：只抽 private helpers，仍只在 `appendRun()` 同事务内调用；行为字节级一致 | PR-A (B3a) |
| **B3-D8** | **B3a.5 失败语义变化必须固化测试**：原本"一个大事务全 rollback"，现在"已写部分保留 + run.status='failed'" | PR-B (B3a.5) |
| **B3-D9** | **B3 第一轮做 PR-A / PR-B / PR-C / PR-D**；**PR-E (B3d live EventBus sink) 延后到 Phase E 之后再评估**，不在本 runbook 实施 | 拆批边界 |
| **B3-D10** | **严禁双写**：同一 RuntimeEvent 不能进入两个写入路径；contract test 加 UNIQUE 兜底 | PR-D (B3c) |

---

## 2. PR 切片总览

| PR | 内容 | 范围 | 依赖 | 风险 | 是否阻塞 Phase E |
|----|------|------|------|------|------------------|
| **PR-A** | **B3a**：抽 private helpers，无行为变化 | `sqlite.implementation.ts`（仅一个文件内部重构） | 无 | 低 | 否 |
| **PR-B** | **B3a.5**：internal-public 写入会话 API + 短事务契约 | `event-store.interface.ts` + `sqlite.implementation.ts` + contract test | PR-A | 中 | 否 |
| **PR-C** | **B3b**：`LinnyaEventStoreAdapter` + `event_store_id` 字段 + monotonic factory 接入 | + `migrations/v021-v030.ts` (v23) + `migrations/index.ts` (SCHEMA_VERSION 22→23) + `conversation.schema.ts` 同步 + 新 adapter 文件 | PR-B | 中 | 否（adapter 暂不挂主链） |
| **PR-D** | **B3c**：`EventPersistenceCoordinator.persistRun()` 切到 event-grained core，**主写路径上线** | `flow.persistence.ts`（`ConversationPersistencePort` 扩展 + `persistRun` / `persistImmediately` 改造）+ `sqlite.implementation.ts` 的 `createConversationPersistencePort` | PR-C | 中高 | **是**（这一步上线后 Phase E 才解阻塞） |
| ~~PR-E~~ | ~~**B3d** live EventBus sink~~ | — | — | — | **延后**，详见 [`22 §4.4.4 / §11.2`](./22-eventstore-alignment-research.md#1112-live-eventbus-sink边产生边落库) |

> **subagent 一次跑哪些**：
> - **轮次 1（本 runbook 默认范围）**：**PR-A**，最小最稳，验证拆批口径
> - **轮次 2**：PR-B
> - **轮次 3**：PR-C
> - **轮次 4**：PR-D（主写路径切换，必须用户 review 后才跑）
>
> 每轮跑完先停下让用户 review，再决定是否进入下一轮。**禁止一口气把 PR-A → PR-D 全跑**。

---

## 3. PR-A：B3a 抽 private helpers（无行为变化）

### 3.1 范围（精确文件清单）

| 操作 | 文件 | 内容来源 |
|------|------|---------|
| 修改 | `src/app-hosts/linnya/adapters/persistence/event-store/sqlite.implementation.ts` | §3.3 helpers 抽取规范 |

**绝对不许动的文件**：
- `event-store.interface.ts`（B3a 不改 public 接口；4 个新方法是 PR-B）
- `flow.persistence.ts`（B3c 才动）
- `conversation.schema.ts`（B3b 才加 column）
- `migrations/*`（B3b 才加新 migration）
- 任何 `src/agent/`、`src/app-hosts/linnya/adapters/flow/`、host / app / renderer 业务文件

### 3.2 实施顺序（强制按此顺序）

| Step | 动作 | 验证命令 | 通过条件 |
|------|------|---------|---------|
| 3.2.1 | 先 Read `sqlite.implementation.ts` 全文（888 行），定位 `appendRun()` 方法及其 `db.transaction(...)` 闭包 | — | 找到事务起止位置 |
| 3.2.2 | 按 §3.3 规范，把 `appendRun()` 内部的 5 段事务步骤抽成 5 个 private 方法 | `npx tsc --noEmit -p tsconfig.json 2>&1 \| grep -c 'error TS'` | ≤ 526 |
| 3.2.3 | `appendRun()` body 改为这些 helper 的串联调用，**仍在原 `db.transaction(...)` 闭包里** | 同上 | ≤ 526 |
| 3.2.4 | 既有所有相关测试跑通 | `npx vitest run src/app-hosts/linnya/adapters/persistence/event-store --reporter=basic` | 全绿 |
| 3.2.5 | flow 持久化集成测试跑通 | `npx vitest run src/app-hosts/linnya/adapters/flow/__integration-tests__/flow-persistence-real.test.ts src/app-hosts/linnya/adapters/flow/__integration-tests__/flow.edit-resend.truncate.integration.test.ts src/app-hosts/linnya/adapters/flow/__integration-tests__/flow.followup-tool-history.integration.test.ts --reporter=basic` | 全绿 |
| 3.2.6 | 全量回归（套件 D） | `npm test` | file fail ≤ 9 / case fail ≤ 14 / 耗时 ≤ 45s |
| 3.2.7 | guard 通过 | `npm run guard:agent-boundary` | 0 violations |
| 3.2.8 | codename lint 通过 | `npm run lint:codename` | 0 violations |
| 3.2.9 | 提交（commit message 见 §3.5） | `git commit` | pre-commit hook 通过 |

**任何 step 失败 → 立刻 ABORT 并记录到 §10.异常日志，不要试图自己修**（除非是明显的 typo / import 错路径这种 trivial fix）。

### 3.3 helpers 抽取规范

`appendRun()` 当前事务内做 5 件事，对应抽 5 个 private 方法：

| Helper 签名（建议） | 职责 | 抽取约束 |
|---|---|---|
| `private insertRunRecord(runId, conversationId, metadata, startTs): void` | INSERT `runs` 行（`status='running'` / `kind` / `model_key` / `toolset_version`） | 必须接受 `runId` 参数（不在内部生成；id 由 `appendRun()` 顶部 `generateRunId()` 一次性产生） |
| `private insertEventRecord(runId, event): void` | INSERT 一行 `events`（id / run_id / type / payload / ts） | 单条；不批量；不处理 UNIQUE 冲突日志（保留 `appendRun()` 现有的 try/catch + 'events.id UNIQUE 冲突' 日志） |
| `private materializeEventIfRenderable(runId, conversationId, event, seq): boolean` | 若 event 满足 `shouldPersistRuntimeEvent` 的物化条件，INSERT 一行 `messages` | 返回 bool 表示是否物化，方便 caller 累计 seq 用 |
| `private completeRunRecord(runId, endTs): void` | UPDATE `runs SET status='completed', end_ts=?` | 不更新 conversation 统计（那是下一个 helper） |
| `private updateConversationStats(conversationId, lastEventTs, addedEvents, addedUserMessages): void` | UPDATE `conversations SET last_event_at`, `total_events`, `user_message_count` | 增量加；不重新 SELECT |

**契约（必须严格遵守）**：

1. **所有 helpers 仍在 `appendRun()` 的 `db.transaction(...)` 闭包内调用**。事务边界**不变**。
2. **行为字节级一致**：`appendRun()` 的 input / output / 副作用与 PR-A 之前完全相同。
3. **失败回滚语义不变**：仍是"一个事务全 rollback"。
4. **不暴露 helpers**：保持 `private`，**不能**改成 `public` 或 `protected`（B3a.5 才做这件事）。
5. **不动 `appendRun()` 之外的方法**：`readEvents` / `truncateAfter` / `listConversations` / `ensureConversation` 等都不碰。

### 3.4 验证规范（PR-A 验收标准）

PR-A 必须满足：

- [ ] `tsc` ≤ 526
- [ ] vitest 不高于 baseline（file fail ≤ 9 / case fail ≤ 14 / 耗时 ≤ 45s）
- [ ] guard:agent-boundary 通过
- [ ] codename lint 通过
- [ ] 既有 `event-store/__tests__/eventStore.contract.test.ts` 全绿（如果存在 host 侧 contract test，目前 contract test 在 `src/agent/runtime-kernel/graph-engine/event-store/__tests__/` 下，是 linnkit kernel 的 memory adapter contract，PR-A 不涉及）
- [ ] `flow-persistence-real.test.ts` / `flow.edit-resend.truncate.integration.test.ts` / `flow.followup-tool-history.integration.test.ts` 全绿
- [ ] `appendRun()` 行数减少，但 5 个 helpers 行数加和约 = 原 `appendRun()` 内事务内行数（行为不变验证）
- [ ] `git diff src/app-hosts/linnya/adapters/persistence/event-store/sqlite.implementation.ts | grep -c '^-'` 与 `'^+'` 行数粗略持平（避免误删代码）

### 3.5 commit message 模板

```
refactor(event-store): B3a 抽 SQLiteEventStore.appendRun 内部为 5 个 private helpers（无行为变化）

按 engine/23 PR-A 规范，把 SQLiteEventStore.appendRun() 事务内的 5 段步骤
抽成具名 private 方法：

- insertRunRecord
- insertEventRecord
- materializeEventIfRenderable
- completeRunRecord
- updateConversationStats

行为字节级一致：
- 仍在原 db.transaction(...) 闭包内调用
- 失败回滚语义不变（一个事务全 rollback）
- public 接口不变
- 既有所有 host / flow 集成测试全绿

为 B3a.5（internal-public 写入会话 API + 短事务契约）做准备。详见
engine/23 §3。

验证：tsc ≤ 526 / vitest baseline 不退化 / guard:agent-boundary 通过 /
codename lint 通过。
```

---

## 4. PR-B：B3a.5 internal-public 写入会话 API + 短事务契约

### 4.1 范围（精确文件清单）

| 操作 | 文件 | 内容来源 |
|------|------|---------|
| 修改 | `src/app-hosts/linnya/adapters/persistence/event-store/event-store.interface.ts` | §4.2 新增 `RunSession` + 4 个方法签名 + JSDoc 短事务契约 |
| 修改 | `src/app-hosts/linnya/adapters/persistence/event-store/sqlite.implementation.ts` | §4.3 实现 4 个方法 + `appendRun()` 改为 helper |
| 新增 | `src/app-hosts/linnya/adapters/persistence/event-store/__tests__/sqlite.implementation.contract.test.ts`（如已存在则修改） | §4.5 contract test 规格 |

**绝对不许动的文件**：
- `flow.persistence.ts`（B3c 才动；`ConversationPersistencePort` 扩展是 PR-D 的事）
- `conversation.schema.ts`（B3b 才加 column）
- `migrations/*`（B3b 才加）
- linnkit 任何文件
- 任何 host / app / renderer 业务文件

### 4.2 4 个新方法签名（必须严格按此）

新增到 `event-store.interface.ts` 末尾：

```typescript
/**
 * 写入会话（B3a.5 引入）。
 *
 * 中文备注：
 * - 由 host 持久化协调层（EventPersistenceCoordinator）显式持有 / 按短事务序列调用；
 * - 与传统 appendRun() 一次大事务相比，本协议把 begin / append / complete 三段拆开，
 *   每段独立短事务 commit，避免 LLM/tool run 几秒到几分钟的长事务锁库。
 * - runId 在 beginRunSession 内由实现层生成；caller 通过 RunSession.runId 拿到。
 */
export interface RunSession {
  readonly runId: string;
  readonly conversationId: string;
  readonly startedAt: number;
}

export interface IEventStore {
  // ... 既有方法保持不变 ...

  /**
   * 开启一次写入会话。
   *
   * 事务契约：**一次短事务**。INSERT 一行 runs（status='running'），commit。
   * 返回的 RunSession.runId 由实现层生成（host 侧用 generateRunId()）。
   */
  beginRunSession(conversationId: string, metadata: RunMetadata): Promise<RunSession>;

  /**
   * 追加单条事件到当前会话。
   *
   * 事务契约：**每条事件一次短事务**。
   *   INSERT 一行 events
   *   + 若可渲染则 INSERT 一行 messages
   *   + UPDATE conversations.last_event_at / total_events / user_message_count
   *   commit。
   *
   * 失败语义：本条 event 不写入；之前 commit 过的 events 不回滚。
   * caller 应捕获后调用 failRun()。
   */
  appendEventToRun(session: RunSession, event: RuntimeEvent): Promise<void>;

  /**
   * 标记 run 完成。
   *
   * 事务契约：**一次短事务**。UPDATE runs SET status='completed', end_ts=now()，commit。
   */
  completeRun(session: RunSession): Promise<void>;

  /**
   * 标记 run 失败。已写入的 events 不会被删除。
   *
   * 事务契约：**一次短事务**。UPDATE runs SET status='failed', end_ts=now()，commit。
   * error.code / error.message 仅 log，不入库（B3 第一版不引入 run.error 字段，避免 schema 改动外溢）。
   */
  failRun(session: RunSession, error: { code: string; message: string }): Promise<void>;
}
```

**契约要点**：
- 4 个新方法都是 `IEventStore` 的 internal-public（同接口暴露，不另起 internal interface）。
- `RunSession` 是不透明 token：caller 不允许构造，必须通过 `beginRunSession()` 拿到。
- **绝不**要求 caller 在跨方法调用之间持有 transaction handle。
- `appendEventToRun` 失败后 `failRun` 必须能成功调用（即使数据库连接还在某种半坏状态，host 应自己处理；本协议不规定）。

### 4.3 实现规范（`sqlite.implementation.ts`）

```typescript
async beginRunSession(conversationId, metadata) {
  const runId = generateRunId();
  const startedAt = Date.now();
  this.db.prepare(`
    INSERT INTO runs (id, conversation_id, kind, status, model_key, toolset_version, start_ts)
    VALUES (?, ?, ?, 'running', ?, ?, ?)
  `).run(runId, conversationId, metadata.kind, metadata.model_key ?? null, metadata.toolset_version ?? null, startedAt);
  // 注意：不在这里 ensureConversation，conversation 必须由 caller 在 beginRunSession 之前 ensure
  return { runId, conversationId, startedAt };
}

async appendEventToRun(session, event) {
  // 单条短事务：INSERT events + 视情况 INSERT messages + UPDATE conversations
  const transaction = this.db.transaction(() => {
    // 1. INSERT events
    this.insertEventRecord(session.runId, event);  // 复用 B3a 抽出的 helper
    // 2. 物化 messages（若可渲染）
    const seq = this.computeNextSeq(session.conversationId);  // SELECT MAX(seq) + 1
    this.materializeEventIfRenderable(session.runId, session.conversationId, event, seq);
    // 3. UPDATE conversations 统计（增量 +1）
    const isUserMsg = /* 判定逻辑同既有 appendRun */;
    this.updateConversationStats(session.conversationId, event.ts, 1, isUserMsg ? 1 : 0);
  });
  transaction();
}

async completeRun(session) {
  this.db.prepare(`UPDATE runs SET status='completed', end_ts=? WHERE id=?`).run(Date.now(), session.runId);
}

async failRun(session, error) {
  logger.warn(`[SQLiteEventStore] Run ${session.runId} failed: ${error.code} - ${error.message}`);
  this.db.prepare(`UPDATE runs SET status='failed', end_ts=? WHERE id=?`).run(Date.now(), session.runId);
}
```

> **注意**：上面是骨架示意，subagent 实施时按真实 `sqlite.implementation.ts` 既有的 statement 缓存 / logger usage / 错误处理风格对齐；不要硬抄上面的 inline `prepare(...).run(...)`，看下原 `appendRun()` 是用 prepared statement 还是 transaction 内联，保持风格一致。

### 4.4 `appendRun()` 改为 helper

PR-B 的关键行为变化：原 `appendRun()` 不再持有大事务，改为短事务序列：

```typescript
async appendRun(conversationId, events, metadata) {
  const session = await this.beginRunSession(conversationId, metadata);
  try {
    for (const event of events) {
      await this.appendEventToRun(session, event);
    }
    await this.completeRun(session);
    return session.runId;
  } catch (err) {
    await this.failRun(session, {
      code: 'APPEND_ERROR',
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
```

**失败语义变化（必须固化测试）**：
- **原行为**：事务中任意 INSERT 失败 → 整个事务 rollback → run 行不存在，已写 events 不存在
- **新行为**：`beginRunSession()` 已 commit run 行；某条 `appendEventToRun()` 失败 → 已写部分保留 + run.status='failed'

这是 [`engine/22 §4.4.3`](./22-eventstore-alignment-research.md#443-事务边界短事务不长事务) 明确接受的 trade-off。

### 4.5 contract test 规格

新增 / 修改 `__tests__/sqlite.implementation.contract.test.ts`，至少覆盖：

```text
describe('SQLiteEventStore - B3a.5 internal-public write session API')
  ✓ beginRunSession 创建 status='running' 的 run，返回包含 runId 的 session
  ✓ beginRunSession + completeRun 后 run.status='completed' 且 end_ts 不为 null
  ✓ appendEventToRun 写入 events 表 + 物化 messages（可渲染时）
  ✓ appendEventToRun 不物化非渲染事件（如 tool_process）
  ✓ appendEventToRun 增量更新 conversations.last_event_at / total_events / user_message_count
  ✓ failRun 把 run.status 改为 'failed' 但不删除已写 events

describe('SQLiteEventStore - B3a.5 短事务序列下崩溃恢复')
  ✓ 模拟第 3 条 appendEventToRun 抛错 → 前 2 条 events 仍可读 + run.status='failed'（caller 显式 failRun）
  ✓ 即使 caller 没调 failRun，已写 events 仍能正常读出（run 留 'running' 但不影响读路径）

describe('SQLiteEventStore - appendRun 行为兼容性（B3a.5 后）')
  ✓ 既有 appendRun(events) happy path 仍返回 runId
  ✓ appendRun 内某条 event 失败 → throw + run.status='failed'（新失败语义）+ 已写部分可见（行为变化记录）
  ✓ 仍正确物化 messages、更新 conversations 统计、不破坏 truncateAfter / readEvents 顺序
```

**测试技法**：用真 SQLite in-memory（`new Database(':memory:')`），不 mock；按既有 contract test 风格组织。

### 4.6 验证规范（PR-B 验收标准）

- [ ] `tsc` ≤ 526
- [ ] vitest 不高于 baseline
- [ ] guard:agent-boundary 通过
- [ ] codename lint 通过
- [ ] 新 contract test 全绿
- [ ] 既有 `appendRun()` 行为测试全绿（除"事务全 rollback"那条若存在，需调整为新失败语义）
- [ ] `flow-persistence-real.test.ts` / `flow.edit-resend.truncate.integration.test.ts` / `flow.followup-tool-history.integration.test.ts` 全绿
- [ ] **没有任何文件变更超出 §4.1 范围**（`git diff --name-only` 检查）

### 4.7 commit message 模板

```
feat(event-store): B3a.5 引入 internal-public 写入会话 API + 短事务契约

按 engine/23 PR-B 规范，给 IEventStore 新增 4 个方法：
- beginRunSession(conversationId, metadata) → Promise<RunSession>
- appendEventToRun(session, event) → Promise<void>
- completeRun(session) → Promise<void>
- failRun(session, error) → Promise<void>

事务边界契约：每个方法一次短事务，绝不长事务。这避免 LLM/tool run
几秒到几分钟时锁库。

appendRun() 退化为这套 API 的 helper：
  begin → for-loop appendEventToRun → complete (or failRun on err)

失败语义变化（trade-off，详见 engine/22 §4.4.3）：
- 原：事务内任意失败 → 整个事务 rollback → run 不存在
- 新：beginRunSession 已 commit；中途失败 → 已写部分保留 + run.status='failed'

验证：
- tsc ≤ 526
- vitest baseline 不退化
- 新增 contract test 覆盖 4 个新方法 + 短事务序列下崩溃恢复
- 既有 appendRun 行为测试全绿（除事务全 rollback 那条已按新语义调整）
- flow 集成测试全绿
- guard:agent-boundary 通过

为 B3b（LinnyaEventStoreAdapter 复用这套 API）+ B3c
（EventPersistenceCoordinator 切到 event-grained core）做准备。详见
engine/23 §4。
```

---

## 5. PR-C：B3b LinnyaEventStoreAdapter + `event_store_id` schema migration

### 5.1 范围（精确文件清单）

| 操作 | 文件 | 内容来源 |
|------|------|---------|
| 修改 | `src/electron-main/services/database/migrations/v021-v030.ts` | §5.2 v23 migration |
| 修改 | `src/electron-main/services/database/migrations/index.ts` | `SCHEMA_VERSION` 22 → 23 + 注释加 v23 说明 |
| 修改 | `src/app-hosts/linnya/adapters/persistence/event-store/conversation.schema.ts` | 同步在 `events` CREATE TABLE 加 `event_store_id TEXT`（保持新装 vs 迁移行为一致） |
| 修改 | `src/app-hosts/linnya/adapters/persistence/event-store/sqlite.implementation.ts` | `appendEventToRun` 接受可选 `eventStoreId` 参数 + INSERT 写入；`insertEventRecord` 同步扩展 |
| 修改 | `src/app-hosts/linnya/adapters/persistence/event-store/event-store.interface.ts` | `appendEventToRun` 签名加可选 `eventStoreId` 参数 |
| 新增 | `src/app-hosts/linnya/adapters/persistence/event-store/linnkit-event-store.adapter.ts` | §5.3 `LinnyaEventStoreAdapter` 实现 |
| 新增 | `src/app-hosts/linnya/adapters/persistence/event-store/__tests__/linnkit-event-store.adapter.contract.test.ts` | §5.4 contract test |
| 修改 | `src/app-hosts/linnya/adapters/persistence/event-store/index.ts` | export 新 adapter（仅 host 内部用，不进 linnkit 公开面） |

**绝对不许动的文件**：
- `flow.persistence.ts`（B3c 才动）
- linnkit 任何文件（`createMonotonicEventIdFactory()` 已存在，直接 import）
- 任何 host 主链装配文件（adapter 暂不接生产 caller）

### 5.2 schema migration（v22 → v23）

在 `src/electron-main/services/database/migrations/v021-v030.ts` 末尾追加：

```typescript
/**
 * v23：events 表加 event_store_id（B3b · linnkit EventStore.range cursor）
 *
 * 设计：
 * - nullable：旧数据保留为 NULL，read 路径 fallback 到 rowid 排序
 * - UNIQUE INDEX with WHERE event_store_id IS NOT NULL（部分唯一索引）
 * - 新写入由 LinnyaEventStoreAdapter 通过 createMonotonicEventIdFactory()
 *   生成 monotonic id（已在 src/agent/runtime-kernel/graph-engine/event-store/base.ts 提供）
 *
 * 详见 engine/22 §4.3.2 + engine/23 PR-C。
 */
(db: Database.Database) => {
  db.exec(`ALTER TABLE events ADD COLUMN event_store_id TEXT`);
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_events_event_store_id_unique
     ON events(event_store_id) WHERE event_store_id IS NOT NULL`
  );
},
```

同步：
- `migrations/index.ts` 把 `SCHEMA_VERSION` 从 22 改成 23，并在文件顶部加 v23 注释（参考既有 v15-v22 注释风格）。
- `conversation.schema.ts` 在 `events` CREATE TABLE DDL 加 `event_store_id TEXT`，并在表外加同样的部分唯一索引（保持新装数据库与迁移后数据库 schema 一致）。

### 5.3 LinnyaEventStoreAdapter 骨架

新增 `src/app-hosts/linnya/adapters/persistence/event-store/linnkit-event-store.adapter.ts`：

```typescript
import {
  type EventStore,
  type PersistedEvent,
  type EventRangeOptions,
  createMonotonicEventIdFactory,
} from 'src/agent/runtime-kernel/graph-engine/event-store/base';
import type Database from 'better-sqlite3';
import type { IEventStore } from './event-store.interface';
import { Logger } from 'src/shared/logger';

const logger = new Logger('LinnyaEventStoreAdapter');

function requirePersistedRunId(event: PersistedEvent): string {
  if (typeof event.runId !== 'string' || event.runId.length === 0) {
    throw new Error(
      '[LinnyaEventStoreAdapter] PersistedEvent.runId is required for Linnya SQLite events table',
    );
  }
  return event.runId;
}

export class LinnyaEventStoreAdapter implements EventStore {
  // 注意：factory 用作 fallback —— 优先使用 PersistedEvent.eventId（caller 已生成）
  // 仅在 caller 没传 eventId（极少情况）时用 factory 兜底
  private readonly idFactory = createMonotonicEventIdFactory();

  constructor(
    private readonly db: Database.Database,
    private readonly host: IEventStore,
  ) {}

  async append(_conversationId: string, persistedEvent: PersistedEvent): Promise<void> {
    const runId = requirePersistedRunId(persistedEvent);
    const eventStoreId = persistedEvent.eventId ?? this.idFactory();
    // 通过 host.appendEventToRun 走 B3a.5 短事务路径，并把 event_store_id 一并写入
    // 需要 host.appendEventToRun 支持可选 eventStoreId 参数（PR-C 要扩展接口）
    const session = {
      runId,
      conversationId: persistedEvent.conversationId,
      startedAt: persistedEvent.timestamp,
    };
    await this.host.appendEventToRun(session, persistedEvent.event, { eventStoreId });
  }

  async range(conversationId: string, opts?: EventRangeOptions): Promise<PersistedEvent[]> {
    const fromId = opts?.fromEventId ?? null;
    const toId = opts?.toEventId ?? null;
    const limit = opts?.limit ?? 1000;

    // 优先按 event_store_id 排序（新数据），NULL 数据 fallback 到 rowid
    // 简化策略：第一版只支持读"已有 event_store_id"的数据；旧数据需要时再扩展
    const stmt = this.db.prepare(`
      SELECT e.id as id, e.run_id as run_id, e.payload as payload, e.ts as ts,
             e.event_store_id as event_store_id, r.conversation_id as conversation_id
      FROM events e
      JOIN runs r ON r.id = e.run_id
      WHERE r.conversation_id = ?
        AND e.event_store_id IS NOT NULL
        AND (? IS NULL OR e.event_store_id > ?)
        AND (? IS NULL OR e.event_store_id <= ?)
      ORDER BY e.event_store_id ASC
      LIMIT ?
    `);

    const rows = stmt.all(conversationId, fromId, fromId, toId, toId, limit) as Array<{
      id: string;
      run_id: string;
      payload: string;
      ts: number;
      event_store_id: string;
      conversation_id: string;
    }>;

    return rows.map(row => ({
      eventId: row.event_store_id,
      timestamp: row.ts,
      conversationId: row.conversation_id,
      runId: row.run_id,
      event: JSON.parse(row.payload),
    }));
  }

  async latestEventId(conversationId: string): Promise<string | null> {
    const stmt = this.db.prepare(`
      SELECT e.event_store_id as event_store_id
      FROM events e
      JOIN runs r ON r.id = e.run_id
      WHERE r.conversation_id = ? AND e.event_store_id IS NOT NULL
      ORDER BY e.event_store_id DESC
      LIMIT 1
    `);
    const row = stmt.get(conversationId) as { event_store_id: string } | undefined;
    return row?.event_store_id ?? null;
  }

  // truncate 第一版：直接 delegate 到 host.truncateAfter（run-grained 删除）
  // event-grained truncate 等 future task（详见 engine/22 §11.4）
  async truncate(_conversationId: string, _opts: { beforeEventId?: string; beforeMs?: number }): Promise<void> {
    logger.warn(
      '[LinnyaEventStoreAdapter] truncate() called but event-grained truncate not implemented in B3 v1; ' +
        'use IEventStore.truncateAfter() for run-grained truncate.',
    );
    throw new Error('LinnyaEventStoreAdapter.truncate() not implemented; see engine/22 §11.4');
  }
}
```

> **注意**：`appendEventToRun` 在 PR-B 的签名只接受 `(session, event)`。PR-C 需要把签名扩展为 `(session, event, opts?: { eventStoreId?: string })`，opts 可选；不传则 INSERT `event_store_id = NULL`。这个扩展属于 PR-C 范围，更新 `event-store.interface.ts` JSDoc 说明。

### 5.4 contract test 规格

新增 `__tests__/linnkit-event-store.adapter.contract.test.ts`：

```text
describe('LinnyaEventStoreAdapter - linnkit EventStore contract')
  ✓ append() 写入后 latestEventId() 返回最新 event_store_id
  ✓ append() 多条后 range() 按 event_store_id 升序返回
  ✓ range({ fromEventId }) 严格大于 cursor
  ✓ range({ toEventId }) 小于等于 cursor
  ✓ range({ limit }) 限制返回数量
  ✓ append 缺失 runId → throw 'PersistedEvent.runId is required'
  ✓ 同一 eventId append 两次 → UNIQUE 约束抛错（idx_events_event_store_id_unique 兜底）
  ✓ truncate() 第一版 throw NotImplemented（按 §5.3 设计）

describe('LinnyaEventStoreAdapter - 与既有 host 路径并存（旧数据 fallback）')
  ✓ 通过 host.appendRun 写入的旧数据（event_store_id=NULL）不出现在 range() 结果里（按 §5.3 第一版策略）
  ✓ host.readEvents() 仍能读到旧数据（兜底验证旧路径不退化）
```

**测试技法**：用真 SQLite in-memory + 手动 apply migration（直接 `db.exec(ALTER TABLE ...)` 模拟 v23 已 apply 的状态），不 mock。

### 5.5 验证规范（PR-C 验收标准）

- [ ] `tsc` ≤ 526
- [ ] vitest 不高于 baseline
- [ ] guard:agent-boundary 通过
- [ ] codename lint 通过
- [ ] 新 contract test 全绿
- [ ] PR-A / PR-B 既有 contract test 全绿
- [ ] flow 集成测试全绿（迁移在 startup 自动跑 + 既有路径不写 event_store_id 也不破坏）
- [ ] **手动 sanity**：跑一遍 `npm run dev:electron`，确认启动日志显示 `Migration: v22 -> v23` 且不报错；触发一次 chat，确认 events 表行写入正常（event_store_id 仍为 NULL，因为主链还没切到 adapter）
- [ ] adapter **未被任何生产 caller import**（grep 验证）

### 5.6 commit message 模板

```
feat(event-store): B3b LinnyaEventStoreAdapter + events.event_store_id schema migration

按 engine/23 PR-C 规范，引入 linnkit EventStore port 的 host 侧 adapter，
但暂不替换主写路径（B3c 才切）。

变更：
- migrations: v22 → v23，给 events 表加 nullable event_store_id TEXT +
  partial UNIQUE INDEX（idx_events_event_store_id_unique WHERE NOT NULL）
- conversation.schema.ts: 同步加字段 + 索引（保持新装 / 迁移后 schema 一致）
- IEventStore.appendEventToRun: 扩展可选 opts.eventStoreId 参数
- 新增 LinnyaEventStoreAdapter implements EventStore：
    - append(): require runId + 写 event_store_id
    - range(): 按 event_store_id 升序，旧数据（NULL）暂不返回
    - latestEventId(): SELECT MAX(event_store_id)
    - truncate(): 第一版 throw NotImplemented，event-grained truncate 留 future
- 复用 linnkit createMonotonicEventIdFactory()（已在 base.ts 提供）

未挂主链：adapter 暂不被任何生产 caller 消费。B3c 才让
EventPersistenceCoordinator.persistRun() 切到 event-grained core。

验证：
- tsc ≤ 526 / vitest baseline 不退化
- 新 contract test 全绿（append / range / latestEventId / 失败语义 / UNIQUE 兜底）
- PR-A / PR-B contract test 全绿
- flow 集成测试全绿（旧路径继续工作 + migration 自动 apply）
- 手动 dev:electron sanity 通过

详见 engine/22 §7.4 + engine/23 §5。
```

---

## 6. PR-D：B3c 切 `EventPersistenceCoordinator.persistRun()` 到 event-grained core（**主写路径上线**）

### 6.1 范围（精确文件清单）

| 操作 | 文件 | 内容来源 |
|------|------|---------|
| 修改 | `src/app-hosts/linnya/adapters/flow/flow.persistence.ts` | §6.2 `ConversationPersistencePort` 扩展 + §6.3 `persistRun` / `persistImmediately` 改造 |
| 修改 | `src/app-hosts/linnya/adapters/persistence/event-store/sqlite.implementation.ts` | `createConversationPersistencePort` 暴露 4 个新方法 |
| 新增 | `src/app-hosts/linnya/adapters/flow/__tests__/flow.persistence.event-grained.test.ts`（或并入既有 test 文件） | §6.4 双写禁止 + 集成断言 |

**绝对不许动的文件**：
- `event-store.interface.ts`（PR-B 已扩展）
- `conversation.schema.ts` / `migrations/*`（PR-C 已扩展）
- `flow.host-session.service.ts`（持久化集合不变，coordinator 内部改造对它透明）
- `LinnyaEventStoreAdapter`（PR-D 不通过 adapter，直接通过扩展后的 `ConversationPersistencePort` 接口；adapter 仍在原位待将来用）

> **关键**：B3c 走的是"扩展 `ConversationPersistencePort` 让 coordinator 直接调 `beginRunSession / appendEventToRun / completeRun / failRun`"路径，**不**通过 `LinnyaEventStoreAdapter` 中转。这是因为 host 主链不需要 linnkit `EventStore` 形态（PersistedEvent / range / latestEventId），它只需要"短事务序列写"能力。adapter 留给 linnkit dryrun / future linnsec 等真消费者。

### 6.2 `ConversationPersistencePort` 扩展

修改 `flow.persistence.ts`：

```typescript
import type {
  RunMetadata,
  RunSession,  // 从 event-store.interface 导出
} from 'src/app-hosts/linnya/adapters/persistence/event-store';

export interface ConversationPersistencePort {
  // 既有保留
  appendRun(conversationId: string, events: RuntimeEvent[], metadata: RunMetadata): Promise<string>;
  ensureConversation(
    conversationId: string,
    initialEvents: RuntimeEvent[],
    projectId?: string,
    mode?: string,
  ): Promise<void>;

  // B3c 新增（直接桥接到 IEventStore B3a.5 4 方法）
  beginRunSession(conversationId: string, metadata: RunMetadata): Promise<RunSession>;
  appendEventToRun(session: RunSession, event: RuntimeEvent): Promise<void>;
  completeRun(session: RunSession): Promise<void>;
  failRun(session: RunSession, error: { code: string; message: string }): Promise<void>;
}
```

`createConversationPersistencePort()` 同步扩展，新增 4 个方法的 bind：

```typescript
export function createConversationPersistencePort(
  persistenceDelegate: ConversationPersistencePort,
): ConversationPersistencePort {
  return {
    appendRun: persistenceDelegate.appendRun.bind(persistenceDelegate),
    ensureConversation: persistenceDelegate.ensureConversation.bind(persistenceDelegate),
    beginRunSession: persistenceDelegate.beginRunSession.bind(persistenceDelegate),
    appendEventToRun: persistenceDelegate.appendEventToRun.bind(persistenceDelegate),
    completeRun: persistenceDelegate.completeRun.bind(persistenceDelegate),
    failRun: persistenceDelegate.failRun.bind(persistenceDelegate),
  };
}
```

> **注意**：`SQLiteEventStore` 已经 implement 这 4 个方法（PR-B 实施时），所以这里只是把它们透传给 coordinator，不需要新写实现。

### 6.3 `persistRun()` / `persistImmediately()` 改造

```typescript
async persistRun(
  conversationId: string,
  events: RuntimeEvent[],
  metadata: RunMetadata,
): Promise<string> {
  if (events.length === 0) {
    throw new Error('Cannot persist empty run');
  }

  const session = await this.persistencePort.beginRunSession(conversationId, metadata);
  try {
    for (const event of events) {
      await this.persistencePort.appendEventToRun(session, event);
    }
    await this.persistencePort.completeRun(session);

    this.stats.totalRuns += 1;
    this.stats.totalEvents += events.length;
    this.stats.successCount += events.length;
    this.stats.lastPersistAt = Date.now();

    logger.info(`[PersistRun] Persisted run ${session.runId} with ${events.length} events for ${conversationId}`);
    return session.runId;
  } catch (error) {
    this.stats.failureCount += 1;
    await this.persistencePort.failRun(session, {
      code: 'PERSIST_RUN_ERROR',
      message: error instanceof Error ? error.message : String(error),
    });
    logger.error(`[PersistRun] Failed to persist run for ${conversationId}:`, error);
    throw error;
  }
}

async persistImmediately(
  conversationId: string,
  events: RuntimeEvent[],
): Promise<void> {
  if (events.length === 0) {
    return;
  }

  const metadata = this.persistImmediatelyMetadataFactory({ conversationId, events });
  const session = await this.persistencePort.beginRunSession(conversationId, metadata);
  try {
    for (const event of events) {
      await this.persistencePort.appendEventToRun(session, event);
    }
    await this.persistencePort.completeRun(session);

    this.stats.totalRuns += 1;
    this.stats.totalEvents += events.length;
    this.stats.successCount += events.length;
    this.stats.lastPersistAt = Date.now();

    logger.info(`[Immediate] Persisted ${events.length} critical events for ${conversationId}`);
  } catch (error) {
    this.stats.failureCount += 1;
    await this.persistencePort.failRun(session, {
      code: 'PERSIST_IMMEDIATE_ERROR',
      message: error instanceof Error ? error.message : String(error),
    });
    logger.error(`[Immediate] Failed to persist critical events for ${conversationId}:`, error);
    throw error;
  }
}
```

**关键不变量**：
- `events.filter(shouldPersistRuntimeEvent)` 逻辑由 caller (`flow.host-session.service.ts.persistRunEvents()`) 处理；coordinator 不重新过滤。**持久化集合零变化**。
- 一次 `persistRun` / `persistImmediately` 仍创建 1 个 `runs` 行（B3-D6：B3 第一版不动 run 粒度）。一次用户请求仍 3 个 runs（input / AI / stream_end）。
- `stats` 计数语义保持原样。

### 6.4 双写禁止 + 集成测试规格

新增 `flow.persistence.event-grained.test.ts`（或并入 `flow-persistence-real.test.ts`）：

```text
describe('EventPersistenceCoordinator B3c - event-grained core 切换')
  ✓ persistRun(events) 写入后，runs 表 +1 行 + events 表 +N 行 + messages 表只对可渲染 event 物化
  ✓ persistRun 失败时 → throw + run.status='failed' + 已写部分保留（B3a.5 失败语义）
  ✓ persistImmediately 同样语义
  ✓ persistRun 完成后 readEvents 顺序与 PR-D 之前一致（旧到新）
  ✓ truncateAfter 仍按 run-grained 删除（B3 第一版不改 truncate 粒度）

describe('EventPersistenceCoordinator B3c - 严禁双写')
  ✓ 同一 RuntimeEvent.id 写两次 → 第二次抛 events.id UNIQUE 错误
  ✓ persistRun + persistImmediately 各调一次相同 event → 同上
```

**集成测试必跑**：
- `flow-persistence-real.test.ts`
- `flow.edit-resend.truncate.integration.test.ts`
- `flow.followup-tool-history.integration.test.ts`

**桌面手测 checklist**（PR-D 必跑，因为这一步改了主写路径）：
1. 启动 `npm run dev:electron`，确认启动日志显示 `Migration: v22 -> v23` 已 apply（如果是 PR-C 之后第一次启动）
2. 新建会话 → 发起 chat（含 final answer）→ 重启应用 → history 列表显示该会话 → 点开能 replay
3. 发起 tool call → 等 final answer → 重启 → history 列表显示 + replay 顺序正确（user_input → tool_call → tool_response → final_answer）
4. 编辑某条历史消息重发 → truncateAfter 仍正确 → replay 顺序正确
5. `npm run telemetry:tail --lines 20`（B2 装的）→ 看 telemetry 流水里 `tool_call` / `llm_call` / `graph_node` / `run_lifecycle` 仍在
6. 直接 `sqlite3 ~/.../workspace.sqlite "SELECT COUNT(*) FROM runs WHERE conversation_id=...; SELECT COUNT(*) FROM events WHERE event_store_id IS NULL; SELECT COUNT(*) FROM events WHERE event_store_id IS NOT NULL"` 验证：旧数据 NULL 数量保持，新数据有 monotonic id

### 6.5 wiring flag（可选回滚保护）

第一版**不引入 flag**，直接切。理由：
- B3a.5 已让 `appendRun()` 内部就是这套逻辑，行为已验证
- coordinator 内部改造对外完全透明
- 如出问题，回滚整个 PR-D 即可

如果 subagent / 操作者评估风险高想加 flag：
- 添加 env var `EVENT_GRAINED_PERSIST=true|false`，默认 `true`
- `false` 时回退到 `appendRun(events[])` 旧调用路径
- **flag 只允许存在于本 PR**；上线 1 个稳定版本后下个 PR 必须移除 flag，不作为长期产品配置

### 6.6 验证规范（PR-D 验收标准）

- [ ] `tsc` ≤ 526
- [ ] vitest 不高于 baseline
- [ ] guard:agent-boundary 通过
- [ ] codename lint 通过
- [ ] 新 event-grained 测试全绿
- [ ] PR-A / PR-B / PR-C 既有 contract test 全绿
- [ ] flow 三个集成测试全绿
- [ ] 桌面手测 checklist 全绿（特别是 truncate / replay 顺序 / 重启后 history）
- [ ] runs 表行数与 PR-D 之前一致（一次请求仍 3 个 runs）
- [ ] events 表无双写：手测后 `SELECT id, COUNT(*) FROM events GROUP BY id HAVING COUNT(*) > 1` 返回 0 行
- [ ] **没有任何文件变更超出 §6.1 范围**（`git diff --name-only` 检查）

### 6.7 commit message 模板

```
feat(event-store): B3c 切 EventPersistenceCoordinator 到 event-grained core

按 engine/23 PR-D 规范，把 host 主写路径从"一次性 appendRun(events[])"
切到"短事务序列 begin + appendEvent + complete"。这是 B3 主写路径上线
PR，**Phase E 硬阻塞从此解除**。

变更：
- ConversationPersistencePort 扩展 4 个方法（透传 IEventStore B3a.5 接口）
- createConversationPersistencePort 同步 bind 4 个新方法
- persistRun() / persistImmediately() 改用 begin → for-loop appendEvent
  → complete 流程；失败时调 failRun

关键不变量（与 B3-D6 / B3-D10 一致）：
- 持久化集合不变（events.filter(shouldPersistRuntimeEvent) 由 caller 处理）
- 一次请求仍 3 个 runs（input / AI / stream_end，run 粒度合并是 B5）
- 严禁双写（contract test + UNIQUE 兜底）
- truncateAfter 仍 run-grained（event-grained truncate 留 future）

验证：
- tsc ≤ 526 / vitest baseline 不退化 / guard 通过
- 新 event-grained 测试全绿（含 UNIQUE 双写兜底）
- PR-A/B/C contract test 全绿
- flow 集成测试全绿（flow-persistence-real / edit-resend.truncate /
  followup-tool-history）
- 桌面手测全绿（启动 / 发 chat / 重启 / replay / truncate / telemetry）

详见 engine/22 §4.4.2 + §7.5 + engine/23 §6。
```

---

## 7. PR-E：B3d live EventBus sink（**延后，本 runbook 不实施**）

详见 [`engine/22 §4.4.4 + §11.2`](./22-eventstore-alignment-research.md#1112-live-eventbus-sink边产生边落库)。

**触发条件**（需要再开 runbook 时）：
- linnsec 立项后明确需要"边产生边落库"语义
- 或 cloud streaming / 实时审计需求出现

**前置条件**：
- B3a / B3a.5 / B3b / B3c 全部 land 且稳定
- Phase E 抽包完成

**届时新增内容**：
- 在 `EventBus.publish()` 后挂一个 `EventStoreSink`
- sink 的事件集合需要专门定义（不是 `events` 表的等价镜像）
- 可能写到独立表或外部 stream
- 与 B3c 主写路径如何并存且不冲突需要专门设计

---

## 8. 完成判据（B3 第一轮全部 PR land 后）

B3 第一轮（PR-A → PR-D）完成必须 9 项全绿：

- [ ] `tsc` ≤ 526
- [ ] `vitest` 不高于 baseline（file fail ≤ 9 / case fail ≤ 14 / 耗时 ≤ 45s）
- [ ] `npm run guard:agent-boundary` 通过
- [ ] `npm run lint:codename` 通过
- [ ] runs 表行数与 B3 之前一致（一次请求仍 3 个 runs；B3 第一版不动 run 粒度）
- [ ] `events` 表无双写重复 id（contract test + 手测 SQL 验证）
- [ ] `readEvents()` 旧到新顺序不变
- [ ] `truncateAfter()` 语义不变（按 run 删除）
- [ ] `stream_end` 仍能持久化且 replay 不退化

完成后立即同步文档（详见 §11）。

---

## 9. 异常协议

### 9.1 Step 失败

任何 step 验证不通过（tsc 增、vitest 退化、guard 红、contract test 红）→ **立刻 ABORT**：
1. 不要试图自己修，除非是明显的 typo / import 错路径这种 trivial fix（≤ 5 行）
2. 把现场 git stash 或 `git status` 输出 + 失败命令完整 stderr 抄到 §10
3. 报告给用户

### 9.2 范围越界

任何对本 PR §X.1 范围外文件的修改企图 → **立刻 ABORT 并问用户**。

不许"顺手"做的事：
- 顺手清 `src/agent/` 业务 tsc 债
- 顺手改 `src/app-hosts/linnya/` 其他模块
- 顺手改 renderer / app
- 顺手优化既有 `appendRun()` 之外的 SQL 查询
- 顺手扩展接口（如 `RunMetadata` 加字段）

### 9.3 与 22 文档不一致

如果实施过程中发现 `engine/22` 的描述与本 runbook 冲突，或与代码事实冲突 → **以 22 为准的设计意图，但 runbook 是执行口径**。

冲突要做的：
1. 不擅自按 22 改运行 runbook
2. 把冲突点抄到 §10
3. 报告给用户决定哪边为准

### 9.4 跨 PR 操作

每个 PR 独立 commit，独立 review。**禁止**：
- 把 PR-A + PR-B + PR-C + PR-D 合并成一个 commit
- 跨 PR 共享一个分支不分 commit
- PR-A 还没 land 就开始 PR-B 的代码（除非用户明确允许）

---

## 10. 异常日志（subagent 写）

> 此章节预留给 subagent 在异常发生时填写。每条记录：
> - PR-X.Y.Z 失败 step 编号
> - 完整命令 + 完整 stderr
> - 当前 git status / git diff（必要时）
> - 你的判断 / 为什么 ABORT

```
（待写）
```

---

## 11. 完成后的文档同步（B3 第一轮全部 PR land 后必跑）

### 11.1 `engine/21`

- [x] §3.2 EventStore 表更新：`B-engine` / `B-host` 标 ✅ + 链到 commit；状态从 ⏳ 改为 ✅ B3 已完成
- [x] §3.5 综合判断表 EventStore 行同步
- [x] §5.1 拆批表 B3 行：状态从 ⏳ 改为 ✅ + 加 4 个子 PR commit ref
- [x] §8 Q1 banner 加 "B3 第一轮已完成（PR-A/B/C/D land）+ link to commits"

### 11.2 `engine/22`

- [x] §8 Q1/Q2/Q3 加 "已实施 + commit ref"
- [x] §10 下一步段落更新：从 "下一步是开 runbook" 改为 "B3 第一轮已完成 + 4 个 commit ref"
- [x] §11.1 B5 / §11.2 EventBus sink / §11.3 崩溃恢复 / §11.4 event-grained truncate：维持原样（这些仍是未来 topic）

### 11.3 `engine/README.md`

- [x] L79 06/08 行进度表：B3 状态从 "进行中" 改为 ✅ 已完成
- [x] M5 Phase E 启动条件块：把 "B3 EventStore 必须先完成" 改为 "B3 EventStore ✅ 已完成"
- [x] 23 卡片：从 "executing 计划" 改为 "✅ B3 第一轮已完成（PR-A/B/C/D land）"

### 11.4 `INTEGRATION_GUIDE.md`

- [x] EventStore 段加：
  - "Linnya 采用 schema-preserving event-grained adapter"
  - 短事务边界契约说明
  - `LinnyaEventStoreAdapter` 用法（host 内消费 / 不进 linnkit 公开面）
  - `event_store_id` 字段说明 + monotonic factory 复用 linnkit 提供

### 11.5 `engine/11-phase-e-hard-blockers.md`

- [x] 检查是否有 EventStore 相关的硬阻塞条目，如有则标记为 ✅ 已解除

---

## 附录 A · 与 18 / 19 / 20 runbook 的差异

本 runbook 沿用了 [`18-d1-implementation-runbook.md`](./18-d1-implementation-runbook.md) / [`19-d2-implementation-runbook.md`](./19-d2-implementation-runbook.md) / [`20-d3-d4-port-interfaces-plan.md`](./20-d3-d4-port-interfaces-plan.md) 的格式约定：

- §0 启动准入 + checklist
- §1 已拍板决策表
- §2 PR 切片总览
- 每个 PR 独立详写：范围 / 实施顺序 / 内容规范 / 测试规格 / commit 模板
- §异常协议 + 异常日志
- §完成后文档同步

**唯一差异**：本 runbook 因为 B3 涉及数据库 schema migration（v22 → v23），PR-C 比其他 runbook 的 PR 多了"启动 sanity"手测要求；PR-D 比其他 runbook 多了"桌面手测 checklist"，因为它直接影响生产数据写入路径。

## 附录 B · 关键源文件 line ref 速查

实施时高频用到的 line ref（截至 2026-04-22）：

| 文件 | 关键位置 |
|---|---|
| `event-store/sqlite.implementation.ts` | `appendRun()` 起点约 L34；`db.transaction(...)` 闭包；事务内 5 段步骤；`generateRunId()` import 在 L7 |
| `event-store/event-store.interface.ts` | `IEventStore.appendRun()` 在 L55；`RunMetadata` 在 L12 |
| `event-store/conversation.schema.ts` | `events` CREATE TABLE 在 L42-L49 |
| `flow/flow.persistence.ts` | `ConversationPersistencePort` 在 L26；`persistRun()` 在 L99；`persistImmediately()` 在 L129 |
| `runtime-kernel/graph-engine/event-store/base.ts` | `EventStore` interface 在 L17；`createMonotonicEventIdFactory()` 在 L24 |
| `electron-main/services/database/migrations/index.ts` | `SCHEMA_VERSION` 在 L66；migrations 数组在 L77 |
| `electron-main/services/database/migrations/v021-v030.ts` | 现有 v21 / v22 migration（B3b 在末尾追加 v23） |
| `electron-main/services/database.ts` | `getConversationSchemaProviders()` 注册在 L41 |
| `flow/__integration-tests__/flow-persistence-real.test.ts` | flow 持久化端到端 |
| `flow/__integration-tests__/flow.edit-resend.truncate.integration.test.ts` | truncate 路径 |
| `flow/__integration-tests__/flow.followup-tool-history.integration.test.ts` | 多轮 + tool history |

> 实施前 subagent 应该 Read 一遍这些文件，确认 line ref 仍然准确（代码可能会演进）；如有偏移，按实际位置实施，不强求与本附录一致。
