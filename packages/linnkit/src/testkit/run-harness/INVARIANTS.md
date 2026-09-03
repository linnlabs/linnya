# Run Harness Invariants

`run-harness` 的目标不是给 agent 答案打分，而是守住协议不变量：run 生命周期、telemetry、audit、EventStore、ToolCall/ToolOutput 这些底层事实必须自洽。

## 默认严格模式

`validateRunInvariants()` 默认启用全部 15 条不变量。失败报告会返回 `id / title / message / details`，测试里可以直接用 `assertRunInvariants(report)` 抛出可读错误。

| ID | 含义 | 失败时优先排查 |
| --- | --- | --- |
| I1_FINAL_STATUS | root run 必须进入 `completed / cancelled / failed` 终态 | runner 是否漏了 `markCompleted / markFailed / cancel` |
| I2_CHILDREN_COST_TOTAL | 父 run 的 `childrenTotal` 必须等于子 run cost 之和 | `parentRunId` 是否丢失；CostCollector 是否按子 run 分桶 |
| I3_TOOL_CALL_OUTPUT_PAIR | 每个 `tool_call_decision` 必须有对应 `tool_output` | ToolNode 是否提前 yield；工具异常是否没走协议输出 |
| I4_LLM_MODEL_SELECT_AUDIT | 每次 `llm_call` 必须有 `model.select` 审计 | `PrepareCallStage` 是否没注入 AuditPort |
| I5_CANCEL_AUDIT | 每次取消必须有 `run.cancel` 审计 | `RunHandle.cancel()` 是否被绕过 |
| I6_EVENT_RUN_IDENTITY | RuntimeEvent 顶层 `run_id` 必须指向已注册 run | publisher / admission 是否被绕过；正式 routing identity 是否漂移 |
| I7_PERSISTED_EVENT_ORDER | PersistedEvent 的 `eventStoreId` 必须单调递增 | EventStore adapter 的 cursor 生成器或并发写入 |
| I8_NO_ACTION_EVENT | 禁止出现不存在的 `RuntimeEvent.type === 'action'` | host 工具是否还在读写旧协议 |
| I9_CANCEL_SIGNAL_STATUS | `signal.aborted` 与 `RunRecord.status=cancelled` 必须一致 | signal 链路和状态写入是否分叉 |
| I10_TELEMETRY_RUN_REGISTERED | telemetry 的 runId 必须能在 RunRegistryStore 找到 | telemetry scope 是否缺 runId；同步 child-run 过渡期可显式放宽 |
| I11_COST_NON_NEGATIVE | cost 的 token / latency / dollar 字段不能为负 | CostCollector 累计逻辑 |
| I12_AUDIT_RUN_REGISTERED | AuditEnvelope.runId 必须能在 RunRegistryStore 找到 | AuditPort 是否被复用到错误 run |
| I13_WAIT_USER_STATUS | `requires_user_interaction` 必须能联动到 `awaiting_user` 或终态 RunRecord | 事件顶层 `run_id` 是否正确；RuntimeEventSink 是否发布 interaction 事实 |
| I14_DETACHED_TERMINAL_OUTCOME | detached `RunOutcome` 必须有对应终态 RunRecord | `spawnDetached` executor 是否返回终态；supervisor 是否持久化 outcome |
| I15_DRAIN_NO_INFLIGHT | `drain()` 后不应残留 in-flight run | executor promise 是否泄漏；terminal waiter 是否未通知 |

## 同步 child-run 过渡口径

N-3.B.0 只解决同步 child-run 的 cost 分桶，不正式注册 child RunRecord。需要验证这类场景时，可以显式传：

```ts
await validateRunInvariants(context, {
  allowUnregisteredChildTelemetry: true,
});
```

这个开关只放宽 I10 中带 `parentRunId` 的 child telemetry，不会放宽 audit、run 生命周期或 cost 非负数校验。

## Detached run 与 wait_user

N-3.B 起，testkit 可以直接用 `createRunSupervisorHarness({ executor })` 验证后台 run：

```ts
const harness = createRunSupervisorHarness({
  executor: {
    async execute(ctx) {
      return { runId: ctx.runId, status: 'completed', completedAt: Date.now() };
    },
  },
});

const handle = await harness.spawnDetached();
const outcome = await harness.supervisor.waitForTerminal(handle.runId);
```

如果测试的是 wait-user 场景，必须让 `requires_user_interaction.run_id` 指向已注册 run，并提供完整 `lane / visibility`。`I13_WAIT_USER_STATUS` 会检查这条正式事实是否能找到对应 `RunRecord`，以及状态是否已经从 `running` 变成 `awaiting_user`（或后续恢复后进入终态）。
