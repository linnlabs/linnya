# RunSupervisor · RunHandle / cost / cancel / observe

> **What** · 每次 agent 调用的"身份证 + 遥控器" —— `RunSupervisor` 注册 + `RunHandle` v2 暴露 `cancel` / `observe` / `cost` + `spawnDetached` 异步后台 run。
> **When to read** · 要支持用户取消 agent；要做长任务后台运行；要做父子 run 成本聚合；要崩溃恢复 `recoverOnBoot`。
> **Prerequisites** · [`02-quickstart.md`](./02-quickstart.md)。
> **Key exports** · `RunSupervisor` / `RunHandle` / `createInMemoryRunRegistry` from `@linnlabs/linnkit/runtime-kernel`。
> **Related** · [`child-runs.md`](./child-runs.md) · [`persistence.md`](./persistence.md) · [`audit.md`](./audit.md)

RunSupervisor 是每次 agent 调用的"身份证 + 遥控器"。host 应在一次用户请求进入 runner 前注册 run，拿到 `RunHandle` 后再把 `handle.signal` 交给 GraphExecutor / 工具上下文。

## 1. 5 行骨架

```ts
import { runtimeKernel } from '@linnlabs/linnkit';

const supervisor = new runtimeKernel.runSupervisor.DefaultRunSupervisor({
  registryStore: new runtimeKernel.runSupervisor.MemoryRunRegistryStore(),
  maxActiveRuns: 16, // 可选：拒绝式并发宽度上限，不配置则不限流
});

const handle = await supervisor.registerRun({
  runId: turnId,                 // 推荐：host 用 turnId 对齐 RuntimeEvent / EventStore / RunRecord
  concurrencyKey,                // 可选：活跃期内原子唯一的 host 业务并发边界
  parentSignal: requestSignal,   // HTTP request cancel / 上层 run cancel 会级联到 handle.signal
  conversationId,
  agentSpec,
  request: invokeRequest,
  eventBus,
  eventStore,
  costCollector,
});
```

## 2. 接入规则

- `runId` 建议由 host 显式传入。如果 host 已有稳定的 `turnId` / request id，可以直接用 `runId = turnId`，这样 `RunHandle.observe({ includePersisted: true })` 能复用 EventStore 里的 runId 索引。
- `conversationId` 是 host 的审计/事件归属；`runId` 是本次 run 身份；`parentRunId` 表达 run registry 的父子链，供 lifecycle 查询、成本与审计关联使用，但不替代事件 routing identity。不要把 GraphExecutor 的 checkpoint key 当成这三个字段之一。
- `RunHandle.signal` 是 runner 内部当前 execution 的唯一信号来源；不要缓存首次读取结果，也不要再给 GraphExecutor 另起一根 ad-hoc `AbortController`。HITL resume 激活时 supervisor 会在同一 handle 内轮换 signal，隔离前后两条 transport。
- `AgentRunnerService.run()` 一类 host runner 应同步返回 `{ handle, result }`：UI 可以立刻拿 handle 做 cancel/observe/cost，执行结果继续等 `result`。
- runner 生命周期必须显式写：启动前 `markRunning()`，正常结束 `markCompleted()`，异常结束 `markFailed()`。取消请求先由 `handle.cancel({ reason })` 写 `cancelled` 并触发 abort；执行器取得真实结果后，再用第二个 lifecycle patch 补全 `currentNode / iterationsUsed`。
- `WaitUserNode` 创建的 `requires_user_interaction` 是正式 pause 事实。它必须经 `RuntimeEventPublisher` 附着正式 `run_id / lane / visibility`，与其他事实一起发布和持久化。host runner 在 persistence drain 成功后才能调用 `markAwaitingUser()`，不得从 Graph 返回值 cherry-pick 后补发第二份事件。
- HITL 恢复使用 `claimResume(runId, interaction, eventBus, signal)`。返回的 `RunResumeClaim` 先原子占用一次性 interaction，但保持 `awaiting_user`；host 只有在响应事实持久化成功后才能调用 `activate()`，持久化前失败调用 `release()`。这样并发/重复提交只有一个能激活，也不会在 runner 启动前留下半恢复的 running run。
- `RunResumeInteraction` 必须完整匹配 `interactionId / toolCallId / checkpointRevision / resumeToken`。host 必须让 GraphExecutor 用同一 `runId` 的 checkpoint 恢复，禁止注册替代 run 或按 conversation 查“最近 checkpoint”。
- 多个 run 共享观察通道时，已发布事件必须带正式 `run_id`。`RunHandle.observe()` 只接收当前 run 的事实；缺少 run identity 是 publisher 边界错误，不能通过 metadata 别名或无差别透传补救。
- `registerRun()` / `spawnDetached()` 会把 `AgentSpec` 与 request 作为注册时快照保存；`spawnDetached()` 的 executor 也读取这份快照。调用方后续修改原始对象不会改变已经注册的后台 run。
- `waitForTerminal()` 不保存第二份完整 outcome；它先订阅终态通知，再从 `RunRegistryStore` owner 读取并投影结果，因此后续调用能看到 lifecycle patch 补全后的最终节点和迭代数。
- `spawnDetached()` 正常完成或失败后会释放 handle、abort controller 和 EventBus 监听。外部取消只先触发 abort；必须等 executor settlement 写入最终进度后，`waitForTerminal()` 才返回并释放资源。
- `maxActiveRuns` 是拒绝式背压，不是队列。超限时 `registerRun()` / `spawnDetached()` 会抛 `RunConcurrencyLimitExceededError`，host 应在上层 orchestration 决定是提示用户、排队还是重试。
- `concurrencyKey` 是 host 定义的进程内原子唯一键。适合表达 `conversation:<id>:foreground` 这类业务约束；允许并行的 auxiliary 不应复用 foreground key。禁止用“先 list/find、再 register”替代，因为两个请求可同时通过查询。
- transport `EventBus.close()` 不等于 run 终态。`awaiting_user` 会保留 handle/slot；恢复时 `claimResume.activate()` 把同一 RunHandle 换绑到新的 transport EventBus，并轮换 execution controller，`observeRun()` 可跨 transport 连续观察。同步 run 在 completed/failed/cancelled 后释放；detached 取消还必须等 executor settlement。
- detached run 执行中如果 EventBus 提前 close，不会提前释放 active slot，避免后台 run 绕过并发限制；slot 会等 detached executor 终态 cleanup。
- `RunHandle.pause()/resume()` 仍是冷暂停占位；不要与已实现的 HITL `RunSupervisor.claimResume()` 混淆。`runTree/handleFailure` 仍未实现。

## 3. RunHandle 完整 API（截至 0.5.0）

| Method | 用途 |
|---|---|
| `runId` / `spec()` / `request()` | run 身份、对应 AgentSpec、invoke request 快照 |
| `signal` | 当前 execution 的唯一 abort 信号；级联到 GraphExecutor 与所有 tool context，resume 后重新读取 |
| `cancel({ reason }, patch?)` | 写 `cancelled`、触发 abort、发一次 audit；执行收口后可补全 `currentNode / iterationsUsed`，不重复副作用 |
| `markRunning()` / `markCompleted()` / `markFailed(error)` | runner 必须显式写生命周期，否则 run 永久停在 `pending` |
| `markAwaitingUser()` | `WaitUserNode` 暂停后 host runner 调用，更新 RunRecord 到 `awaiting_user` |
| `claimResume()` | 原子认领一次性 interaction 并挂载新的 transport；`activate/release` 明确命令接受边界 |
| `observe(options?)` | 事件流：`includePersisted` 复用 EventStore replay，`signal` 控制订阅生命周期 |
| `cost()` | 读 `RunCostCollector.snapshot(runId)` |
| `traceContext()` | 返回 `{ runId, parentRunId?, turnId?, traceId? }`，给 telemetry / audit / child-run 派生用 |

## 4. 进程恢复（recoverOnBoot）

进程启动时建议调用 `recoverOnBoot()`，把上次进程遗留的 `pending/running/awaiting_user/paused` run 标记为 `RUN_ABANDONED`，避免管理面板里永远挂着"运行中"。

## 5. Cost 统计

`RunHandle.cost()` 只读你注入的 `RunCostCollector`。最小实现可以监听 `TelemetryPort.emit({ kind: 'llm_call', usage })`，按 `scope.runId ?? scope.turnId` 聚合 token 与 latency。

同步 child-run 场景建议把 `scope.runId` 设为 child run / subrun ID，并把 `scope.parentRunId` 设为父 run ID。这样父子 cost 可以分桶统计，父 run 的 `childrenTotal` 能覆盖同步子 agent 的 LLM cost。美元成本、quota ledger、跨进程 / detached 后台 run 的长期持久化账本属于后续阶段。

### 5.1 Child lifecycle 汇总 owner

`RunRegistryStore` 是 lifecycle 状态的唯一 owner。Host 查询一个父 run 的 child 汇总时必须调用
`supervisor.list({ parentRunId })`，读取每条 run 的 `status / currentNode / iterationsUsed /
errorIfAny`。EventStore 保存运行事实，`subrun_trace` 和工具 `subrun_ids` 服务 UI 定位，
Telemetry 与 LLM Audit 服务诊断；它们都不能替代 runs，也不能在各自存储中复制生命周期表。

`waitForTerminal()` 同样遵守该 owner：内存 waiter 只防止漏通知，不携带或缓存 lifecycle
快照。禁止为了减少一次 store read，在 Supervisor、executor 或 Host 重新维护 terminal outcome LRU。

外部取消通常早于执行器返回。执行器收口时必须用 lifecycle patch 补齐取消 run 的真实节点与
迭代数；这属于同一 `cancelled` 终态的完成，不是允许终态反向迁移。

## 6. 最小验证

- 单测：显式 `runId` 注册后，`handle.runId` 和 `registryStore.load(runId)` 对齐。
- 单测：同一个 `runId` 注册两次抛 `RunAlreadyRegisteredError`。
- 单测：`parentSignal.abort('reason')` 后 `handle.signal.aborted === true`。
- 单测：`spawnDetached()` executor 收到的 `runId / parentRunId / conversationId / AgentSpec / request / metadata` 与注册时一致。
- 集成测：取消时 `RunRecord.errorIfAny.message` 能投影到 `run_status.reason_message`，`transport_end` 仅收尾当前 execution。
- 集成测：`maxActiveRuns=1` 时第二个并发 run 被拒绝；第一个 run 的 EventBus close 后仍被拒绝，直到逻辑 run 进入终态。
- 并发测：两个共享 `concurrencyKey` 的注册同时到达时只有一个成功，成功 run 终态后 key 可复用。
- 业务测：同一 interaction 并发提交只有一个 claim 成功；落盘失败 release 后可重试；观察流跨首次 transport close 后继续收到恢复 transport 事件；旧 transport abort 不会取消新 resume execution。
- 业务测：detached run 外部取消后，executor settlement 前 `waitForTerminal()` 不返回；settlement 后读取到最终 `currentNode / iterationsUsed`，取消审计只产生一次。
