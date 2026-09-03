# Runtime Kernel Run Supervisor

Layer: `runtime-kernel/run-supervisor`

这里承载 run 生命周期管理协议：注册、取消、观察、终态等待、后台 detached run、启动恢复和并发背压。

---

## 1. 模块定位

本目录负责：

- `RunSupervisor` / `RunHandle` 对外契约
- `RunRegistryStore` port 与内存实现
- run lifecycle 状态写入与终态投影
- per-execution `AbortController`、可换绑 transport EventBus 的观察通道与终态资源释放
- `maxActiveRuns` 并发宽度限制
- detached run 执行、终态等待通知、boot recovery

本目录不负责：

- graph 执行细节（`graph-engine` 负责）
- SSE wire 投影（host realtime adapter 负责）
- EventStore 具体数据库实现（host persistence adapter 负责）
- host 的排队策略（`maxActiveRuns` 是拒绝式背压，不是队列）

---

## 2. 详细目录树

```text
packages/linnkit/src/runtime-kernel/run-supervisor/
├── README.md
├── index.ts
├── runSupervisor.ts                 # 默认编排实现，委托 functions/*
├── runHandle.ts                     # RunHandle 实现
├── runErrors.ts                     # RunAlreadyRegistered / RunNotFound / concurrency errors
├── runRegistryStorePort.ts          # RunRegistryStore port
├── memoryRunRegistryStore.ts        # 内存 registry store
├── definitions/
│   └── runSupervisorContracts.ts    # RunSupervisor / RunOutcome / registration contracts
└── functions/
    ├── awaitingUserWatcher.ts       # EventBus requires_user_interaction 监听
    ├── detachedRunExecutor.ts       # detached run executor + outcome persistence
    ├── runConcurrencyKeyRegistry.ts # host 业务并发 key 的活跃期原子占用
    ├── runLifecycleTransition.ts    # terminal transition 规则
    ├── runRecordProjection.ts       # RunRecord -> DTO / outcome 投影
    ├── runRecovery.ts               # recoverOnBoot
    ├── runRegistration.ts           # 初始 RunRecord + parent AbortSignal 转发
    ├── runSlotLimiter.ts            # maxActiveRuns 信号量
    └── terminalWaiterRegistry.ts    # waitForTerminal waiter 通知；结果始终读取 RunRegistryStore
```

---

## 3. 关键语义

### registerRun

`registerRun(spec)` 是同步 run 的入口。它会：

1. 生成或使用调用方传入的 `runId`
2. 先向 `runSlotLimiter` 申请活跃 slot
3. 创建 `AbortController` 并转发 `parentSignal`
4. 持久化初始 `RunRecord`
5. 创建 `RunHandle`
6. 订阅 per-run EventBus 的 `requires_user_interaction`

如果 `registryStore.save()` 或 `RunHandle` 创建失败，slot 和 handle/controller 资源必须回滚释放。

`RunRegistrationSpec.concurrencyKey` 是可选的业务并发边界。同一 supervisor 内，共享 key 的活跃 run 只能注册一条；key 在 completed/failed/cancelled 后释放。Host 可以用它表达“同一 conversation 只允许一个 foreground”，而不给可并行的 auxiliary 设置 key。

### maxActiveRuns

`DefaultRunSupervisorOptions.maxActiveRuns` 是拒绝式背压：

- 未配置时不限流
- 配置后，活跃 slot 达上限会抛 `RunConcurrencyLimitExceededError`
- slot 只在 run 进入 completed/failed/cancelled 后释放；transport EventBus close 不释放 awaiting_user
- detached run 外部取消时即使已写 `cancelled`，仍等 executor settlement 后释放 slot，避免后台执行绕过并发上限

中文备注：这里的“活跃”指尚未终态的逻辑 run，不是某条 SSE 是否仍连接。`awaiting_user` 正常占用 slot；恢复时换绑新的 transport EventBus。

### waitForTerminal

`waitForTerminal(runId)` 的结果只从 `RunRegistryStore` 投影，不缓存第二份完整 `RunOutcome`。实现会先注册 waiter 再读取 store，避免终态写入恰好发生在查询与订阅之间而漏通知。

detached run 被外部取消时，第一次 `cancel()` 只写取消事实并触发 abort；`waitForTerminal()` 要等 executor settlement 把最终节点和迭代数写入 store 后才返回并释放资源。同步 registered child 由 invoker 自己等待 settlement；调用方应先等待 invoker 返回，再通过 `list / peek / waitForTerminal` 读取最终 lifecycle。

### cancel 与 lifecycle 汇总

`RunRegistryStore` 是 run / subrun lifecycle 汇总的唯一 owner。需要读取某个父 run 的 child
状态时，使用 `list({ parentRunId })`；EventStore、parent `subrun_trace`、Telemetry、成本
聚合和开发审计都是事实或观测下游，不得再维护第二套 child 状态统计。

取消分成两个时刻：`cancel(opts)` 先触发 abort 并写入 `cancelled`，执行器收口后可再次调用
`cancel(opts, { currentNode, iterationsUsed })` 补全真实进度。只允许
`cancelled → cancelled` 的字段补全，且不得重复发审计、回调或终态清理；completed / failed
仍不可被迟到取消覆写。同步 child 和 detached executor 都必须在取得执行结果后传入该 patch。

### awaiting_user

`awaitingUserWatcher` 监听 `requires_user_interaction`，并按 runId 过滤。命中后调用 `markAwaitingUser()`，让 `RunRecord.status` 从 `running` 联动到 `awaiting_user`。host runner 仍应在自己的主链路里显式处理 wait_user；watcher 是 supervisor 侧兜底和 contract guard。

RunHandle 的 realtime observe 与 EventStore replay 都只按 RuntimeEvent 顶层 `run_id` 归属事件。`metadata.runId`、`metadata.run_id`、`metadata.run_context.runId` 和“缺身份默认属于当前 run”均不是兼容入口；缺少正式身份应在 EventBus / EventStore admission 处失败。

HITL 通过 `claimResume()` 原子认领 interaction。host 在响应事实落盘成功后调用 claim 的 `activate()`，落盘前失败调用 `release()`；activate 会让原 run 回到 running，把同一 RunHandle 换绑到当前 transport EventBus，并为新的 execution 轮换 `AbortController`。旧 transport 的迟到 abort 因此不能取消新 execution。观察通道独立于 transport，因此 `observeRun()` 可跨多次请求连续消费。

---

## 4. 禁止项

1. **禁止** 在 `RunRegistryStore` 里临时补 lifecycle 规则；状态迁移规则应在 `functions/runLifecycleTransition.ts`。
2. **禁止** 把 host queue 排队策略塞进 `runSlotLimiter`；limiter 只负责拒绝式背压。
3. **禁止** 让 `DefaultRunSupervisor` 主文件重新持有大段业务逻辑；新增规则优先落到 `functions/*` 并补单测。
4. **禁止** 绕过 `RunHandle.signal` 给 graph/tool 另建取消信号。
5. **禁止** 用 `findActiveByConversation()` 后再 `registerRun()` 实现唯一性；这是非原子的检查后执行，应使用 `concurrencyKey`。
6. **禁止** 从 trace 数量、LLM audit bucket 或 telemetry 行推导 authoritative child lifecycle；统一读取 `RunRegistryStore.list({ parentRunId })`。
7. **禁止** 在 terminal waiter、detached executor 或 host 中缓存完整 lifecycle outcome；waiter 只负责通知，结果统一从 `RunRegistryStore` 投影。

---

## 5. 最小回归集合

改 supervisor 主链时至少复跑：

- `src/runtime-kernel/run-supervisor/__tests__/defaultRunSupervisor.test.ts`
- `src/runtime-kernel/run-supervisor/__tests__/defaultRunHandle.test.ts`
- `src/runtime-kernel/run-supervisor/functions/__tests__/*`
- `src/testkit/__tests__/supervisorGraphLoop.e2e.contract.test.ts`

取消回归必须覆盖“外部先取消、执行器后返回进度”的两阶段流程，并断言取消副作用只发生一次。detached 路径还必须断言 settlement 前 waiter 不返回、slot 不释放；host child 路径必须用真实 SQLite 验证最终读取。

---

## 6. 相关文档

- `packages/linnkit/docs/integration/run-supervisor.md`
- `packages/linnkit/src/runtime-kernel/graph-engine/README.md`
- `src/app-hosts/linnya/adapters/flow/README.md`
