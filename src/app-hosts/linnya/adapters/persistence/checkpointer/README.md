# Linnya Host SqliteCheckpointer

Linnya 宿主对 linnkit `Checkpointer` port 的 SQLite 实现。

## 1. 这是什么

`Checkpointer` 是 linnkit 平台层的 port（定义在 独立 Linnkit 仓的 `src/runtime-kernel/graph-engine/checkpointer/base.ts`）。它的语义是 **保存 graph engine 的执行状态快照** `EngineState`：

- `nodeId`：图执行当前停在哪个节点
- `pendingToolCalls`：已发出还没回收结果的 tool call
- `executorLocal.stepCount`：循环步数
- `local`：节点间共享的中间字典（含 history、executorLocal 等）

`SqliteCheckpointer` 把这些快照落到 `workspace.sqlite` 的 `engine_checkpoints` 表，以 `checkpointKey` 为主键。Linnya 所有独立 run 都传稳定 `runId`。当前表列仍叫 `conversation_id`，这只是历史物理列名，不表示会话身份；本次不迁移表结构，也不读取旧 checkpoint 兼容。

## 2. ⚠️ 术语警告：跟另外几个 "checkpoint / event / history" 不是一回事

本仓库里有 3 套**性质完全不同**的执行快照与历史持久化。第一次接触时极容易混。对照表：

| 名字 | 存什么 | 落到哪 | 用来干啥 |
|---|---|---|---|
| **本目录 / `engine_checkpoints` 表** | `EngineState`（图执行循环的中间态） | `workspace.sqlite` `engine_checkpoints`（一行一个 checkpointKey） | `GraphExecutor.runUntilYield` 在新循环开始时 `load`，让 run 能从断点继续推理 |
| **`SQLiteEventStore` / `events` 表** | `RuntimeEvent` 流（user / llm_response / tool_call / tool_result / answer …） | `workspace.sqlite` `events`（一行一个事件） | 事实源；前端历史；下一轮 LLM 上下文重建（HistoryRepository） |
| **`messages` 表** | 前端渲染优化的物化视图 | `workspace.sqlite` `messages` | 前端列表渲染 |

本目录的 checkpoint 只服务 Graph 执行控制（“让 run 中断后能从断点续跑”）。自动上下文压缩产生的 `history_summary` 属于 `events` 事实，HITL 的 `checkpoint_revision` 属于交互控制身份；三者不共享事实存储。唯一的执行层关联是 `executorLocal.contextCompaction`：它只保存本逻辑 run 的 `attemptCount`、`committedCount` 与 `lastCommittedFingerprint`，wait-user resume 时 GraphExecutor 会把它与**新 execution 的策略**合并，既限制真实 Provider 成本，也避免重复提交同一计划；不会恢复旧的收尾或提醒策略，也不会重置 `stepCount / maxSteps`。

## 3. 为什么"events 表已经存了完整对话，还要这张表"

合理的疑问。诚实回答：

1. **events 表是事件流溯源**：能 replay 出"用户说了什么、模型回了什么、工具调了哪些、返回了什么"。但**没有图执行的中间态**——比如"当前停在 LLM 节点、有 2 个待回收的 tool call、下一步要进 toolNode"这种循环内信息。
2. **`engine_checkpoints` 表是循环内状态快照**：让 GraphExecutor 在新循环开始时直接 `load(checkpointKey)` 拿到上一次循环停下的精确位置，不必从 events 表全量 replay 重建。
3. **B1 之前**的实现是 `MemoryCheckpointer`（进程内存），重启就丢。但因为有 events 表 replay 兜底（`HistoryRepository` 把整条历史 replay 进新 `EngineState`），用户层面**感受不到 checkpoint 丢失**——只是每次重启都退化成"全量 replay"模式。
4. **B1 之后**的 SQLite 落表，让"中断后从循环内精确断点恢复"成为可能。当前 Linnya 同步请求模型下，这个能力的可观察收益有限；它的真正价值在未来的**异步 Run 模型**（`engine/01-async-runs-and-handles.md`）：长 run（Deep Research 几十分钟那种）、跨请求 run、人工断点续跑等场景下，必须有真正的 EngineState 持久化才能玩得转。

## 4. 表结构

见 `checkpointer.schema.ts`。

```
engine_checkpoints (
  conversation_id          TEXT    PRIMARY KEY,
  state_json               TEXT    NOT NULL,    -- 完整 EngineState 序列化
  schema_version           INTEGER NOT NULL,    -- EngineState schema 版本
  saved_at                 INTEGER NOT NULL,    -- 写入时间戳 (ms)
  current_node             TEXT,                -- 元数据冗余：当前节点
  iterations               INTEGER,             -- 元数据冗余：步数
  has_pending_tool_calls   INTEGER NOT NULL DEFAULT 0  -- 元数据冗余
);
CREATE INDEX idx_engine_checkpoints_saved_at ON engine_checkpoints(saved_at DESC);
```

冗余存元数据列的目的：让 `peekMeta` / `list` 不用反序列化整个 `state_json`。

> `conversation_id` 是 legacy 物理列名，行语义是 run-scoped checkpoint key。foreground、auxiliary、detached run 使用各自 runId；同步 child-run 使用内部 run-scoped key。RuntimeEvent / Audit / Telemetry 的 conversationId 不能从这里反推。

## 5. 装配位置

在 `src/electron-main/routes/index.ts` 主路径里：

```ts
const checkpointer = new SqliteCheckpointer(dbService.getDb());
const executor = new GraphExecutor(checkpointer, { maxSteps: ... });
```

同步子 agent (独立 Linnkit 仓的 `src/runtime-kernel/child-runs/childRunInvoker.ts`) **不**走这个，仍用 `MemoryCheckpointer`：

- 子 agent 是短生命周期（一个 tool call 内完成），父 run 失败可整体重试，不需要持久化

真实 Agent Benchmark 通过 Conversation CLI 驱动正在运行的 App，因此自然复用这里的生产 checkpoint owner，不再启动第二套测试 runtime。

## 6. GC 策略

`engine_checkpoints` 表如果长期不清理会随对话累计无限增长。`GraphExecutor` 在某些终态会调 `clear`，但 abort / 异常路径不保证清理。所以宿主侧补了显式 GC：

```ts
checkpointer.purgeStale({
  olderThanMs: 30 * 24 * 60 * 60 * 1000, // 30 天
  // includePending: false (默认) — 保留 has_pending_tool_calls=1 的行
});
```

**触发位置**：`src/electron-main/routes/index.ts` 在会话服务初始化时同步跑一次（启动时清理足以避免长期堆积；当前 Linnya 没有 scheduler，不需要 cron）。

**保留窗口**：`ENGINE_CHECKPOINT_RETENTION_MS = 30 天`（在 `routes/index.ts` 里调）。

**为什么默认保留 pending tool call 的行**：运行中的 `wait_user` checkpoint 需要跨 HTTP transport 保留，直到同一 run 恢复、取消或终止。进程重启时 RunSupervisor 会把遗留活跃 run 标记为 abandoned/failed；当前不承诺跨进程 HITL 续跑。如果要强制清理陈旧行，传 `includePending: true`。

**purgeStale 不在 `Checkpointer` port 接口上**：平台层不该规定 GC 策略，留给宿主自定义。所以这是 `SqliteCheckpointer` 这个具体实现的方法，不是平台契约。

## 7. 已知风险 / TODO

- **不在事务内**：`save` 是单条 UPSERT，不跟 events 表的写入绑在同一个事务里。当前业务模型下 `save` 失败会被 `engine.ts` 直接抛出，宿主侧会终止 run，所以一致性影响有限。但严格意义上是个 TODO。
- **物理列无外键**：checkpoint key 是 runId，不是 conversationId，因此不能对 conversations 建 cascade。正常 completed/failed/cancelled 由 AgentRunner/host 按 runId 清理，启动 GC 只处理异常遗留。

## 8. 测试

- 契约测试：`__tests__/sqlite.implementation.contract.test.ts`（9 个用例，包含同会话 foreground/auxiliary 两个 run 的独立行与定向清理，以及 GC 行为）
- 基础 4 个用例与 `MemoryCheckpointer` 契约一致（见 独立 Linnkit 仓的 `src/runtime-kernel/graph-engine/checkpointer/__tests__/memoryCheckpointer.contract.test.ts`），只是后端从内存 Map 换成 in-memory SQLite

## 9. 参考

- linnkit Checkpointer port：独立 Linnkit 仓的 `src/runtime-kernel/graph-engine/checkpointer/base.ts`
- runtime-kernel 总入口：独立 Linnkit 仓的 `src/runtime-kernel/README.md`
- 开发指南术语小节：独立 Linnkit 仓的 `docs/DEVELOPMENT_GUIDE.md`
- B0 研究文档：独立 Linnkit 仓的 `docs/archive/engine-phases/21-host-port-adapter-research.md` §6（B1 实施背景）
