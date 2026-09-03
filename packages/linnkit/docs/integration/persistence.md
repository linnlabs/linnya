# Persistence · 接持久化（3 个 port）

> **What** · 三个持久化适配 port —— `Checkpointer`（断点续推）/ `EventStore`（事件归档）/ `RunRegistryStore`（run 元数据）。
> **When to read** · 要让 run 跨进程崩溃后恢复；要审计 / 回放 agent 历史；要把 in-memory 默认实现换成真实 DB。
> **Prerequisites** · [`02-quickstart.md`](./02-quickstart.md)；建议与 [`run-supervisor.md`](./run-supervisor.md) 并读。
> **Key exports** · `Checkpointer` / `EventStore` / `RunRegistryStore` from `@linnlabs/linnkit/runtime-kernel`。
> **Related** · [`run-supervisor.md`](./run-supervisor.md) · [`audit.md`](./audit.md) · [`realtime.md`](./realtime.md) · [`glossary.md`](./glossary.md)

> **术语提醒**：这里的 `Checkpointer` 是 **engine-state checkpoint**——保存 graph engine 执行状态（`nodeId / pendingToolCalls / executorLocal.stepCount / local`），用来"中断后从断点继续推理"。它**不是**任何"对话总结/上下文裁剪"语义；后者是上下文工程层面的 RuntimeEvent，应当走你自己的 `EventStore`，跟本接口无关。详见 [glossary.md](./glossary.md)。

## 1. linnkit 给你的合同

- `Checkpointer`（来自 `@linnlabs/linnkit/runtime-kernel`，在 `graph` namespace 下）：`load` / `save` / `clear` 三个必需方法 + `peekMeta` / `list` 两个可选。
- `Checkpointer` 的 key 参数叫 `checkpointKey`：它是 EngineState 快照索引。所有可独立运行的顶层、foreground、auxiliary、detached run 都必须使用稳定 `runId`；同步 child-run 使用自己的内部 run-scoped key。禁止用 `conversationId`，否则同会话并行 run 会互相覆盖。
- `EventStore`（来自 `@linnlabs/linnkit/runtime-kernel`，在 `graph` namespace 下）：`append` / `range` / `latestEventStoreId` 三个必需 + `truncate` 可选。配套 `createMonotonicEventStoreIdFactory()` 帮你生成单调 storage cursor。
- `RunRegistryStore`（来自 `@linnlabs/linnkit/runtime-kernel`，在 `runSupervisor` namespace 下）：run lifecycle 元数据落库。
- `RuntimeEvent` / `RoutedRuntimeEvent` / `EventEnvelope` / `PersistedEvent` 类型来自 `@linnlabs/linnkit/contracts` 与 `runtime-kernel`。

## 2. linnkit 自带的 mock primitive

`memoryCheckpointer` / `memoryEventStore` / `memoryRunRegistryStore` 都是 in-memory contract-test 用实现。它们藏在 runtime-kernel 内部，外部消费者一般不需要直接引用——通过 `@linnlabs/linnkit/runtime-kernel` 的 namespace 访问。如果某个未导出，请告诉框架维护方补出口。

## 3. 你必须做的

1. 决定真后端：SQLite / Postgres / IndexedDB / 文件 都行。linnkit 不规定。
2. 实现 3 个 port，作为 host runtime-assembly 的依赖注入点。
3. 写入时使用 `createMonotonicEventStoreIdFactory()` 生成非空 `eventStoreId`。它只用于稳定分页，不等同于 `RuntimeEvent.id`，禁止缺失时用业务 event ID 或时间戳 fallback。
4. 使用**短事务**：每个 lifecycle 调用各自独立 commit，**不要**跨整个 LLM/tool 执行过程持有数据库事务。

EventStore 是 durable fact 边界，只接收：

- 已通过 `parseRoutedRuntimeEvent()` 语义的 `RoutedRuntimeEvent`；
- `describeRuntimeEventLifecycle(event).persist === true` 的事实；
- 非空、单调、由 storage owner 分配的 `eventStoreId`。

`ephemeral=true`、`final_answer_chunk`、`tool_process` 等实时进度直写 EventStore 必须失败，不能 silent no-op。过滤发生在 EventBus persistence consumer，EventStore 的拒绝用于暴露绕过正常发布链的调用。

generated facts 的持久化入口只能是 EventBus persistence consumer。Graph journal、quickstart callback、child result 和 transcript 都读取 admission 后的同一 `RoutedRuntimeEvent`，不得在执行结束时遍历返回事件补写 EventStore。Host incoming fact 若采用 durable-first transaction，也必须先由同一个 publisher route，提交成功后再 `publishRouted`，并显式登记已提交事实，避免 persistence consumer 重复写入。

## 4. 实现 EventStore 的常见落地形态

- 已有 `conversations / runs / events` 表？采用 **event-grained core**：只保留一张事件事实表，不新增第二份事实源。
- 你的 `EventStore` 实现可以同时对外暴露两组 API：
  - host 主写链直接用的短事务会话 API（`beginRunSession` / `appendEventToRun` / `completeRun` / `failRun`）；
  - 给 linnkit `EventStore` port 消费的 adapter（把 `append/range/latestEventStoreId` 桥接到底层）。

UI 历史应由 `events` 派生为可重建 read model。read model 可以与事实在同一短事务更新，但不能成为审计、Agent context 或 replay 的第二事实源。

## 5. 你不要做的

- 不要把"数据库就是平台默认实现"的假设写死。
- 不要跳过 `schemaVersion` / `CheckpointMeta` 这些契约字段。
- 不要一边写库一边偷偷吞掉冲突或重复事件——push 到上层做幂等判断。
- 不要在 `PersistedEvent` 外层重复保存 `conversationId / runId / timestamp`；这些字段以 `event` 内的正式事实为准。
- 不要从 metadata、session 参数或 active conversation 补齐事件身份；参数只用于与正式字段做一致性校验。
- 不要让 mapper、Graph node、collector 或 test harness 直接承担 EventStore 写入；它们不是 persistence owner。

## 6. 最小验证

linnkit 在内部对每个 port 都跑了 contract test。你的实现必须通过这些**等价的契约测试**。建议在 host 测试里 mirror linnkit 的 contract test，把 memory 实现 → 你的实现做参数化，确保行为 1:1。
