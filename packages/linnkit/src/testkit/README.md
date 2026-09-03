# Agent Testkit 模块说明

Layer: `verification infrastructure`

`packages/linnkit/src/testkit/` 是 Agent 平台内部、可复用的测试基础设施主树。  
这里只放 package-neutral 的 fixture 与 harness primitive；依赖 Linnya host 默认装配的 wrapper 仍放在 `src/app-hosts/linnya/testkit/*`，但由 agent 自己拥有的 graph-loop seam 已回收到 agent 侧。

---

## 当前真实 owner

```text
packages/linnkit/src/testkit/
├── README.md
├── tool-fixtures/
├── agent-harness/        # scriptedAiEngineHarness / assertions
├── context-harness/      # replay / context pipeline / contextPolicy invariants
└── run-harness/          # RunSupervisor / AuditPort / TelemetryPort / run invariants
```

中文备注：
- `tool-fixtures / context-harness` 与 `agent-harness` 里的共享 primitive 已保留在这里。
- `graphLoop` 的内核装配 seam 已收回 agent 侧，并通过 `packages/linnkit/src/testkit` / `packages/linnkit/src/runtime-kernel` 公共入口暴露。
- `context-harness` 是 1F contextPolicy 之后的上下文测试地基：用 `ContextTrace` 校验 effective policy、预算、provider token delta、message keep/drop、工具配对与 must-keep 是否自洽。
- `run-harness` 是 N-3/G-1/N-3.B 之后的协议测试地基：一行装配 `RunSupervisor`、收集 `AuditEnvelope`、记录 telemetry、模拟 detached executor，并用 15 条不变量校验 run 是否自洽。
- 依赖 Linnya host 默认 adapter 的 wrapper 仍留在 `src/app-hosts/linnya/testkit/*`，例如 `childRunHarness / toolRegistryHarness / graphLoopHarness / inMemoryEventStore`。
- Linnya 的真实 Agent Benchmark 属于独立应用层 Runner，不纳入通用 Agent testkit。

---

## 关键不变量

1. 新测试优先从 `packages/linnkit/src/testkit/*` 引入真实 harness/fixture。
2. 任何会修改进程级 workspace root 的 fixture 都不能放在这里；这类 host-bound fixture 归 `src/app-hosts/linnya/testkit/*`。
3. `packages/linnkit/src/testkit/agent-harness/*` 只保留共享断言与 scripted AI harness；graph-loop 的 runtime-owned seam 放在 `packages/linnkit/src/runtime-kernel/testkit/*`，不再由 host 直接拼 node/checkpointer。
4. `createGraphLoopHarness()` 必须接收装配层提供的 `runtimeEventSink`；测试也应使用 `RuntimeEventPublisher`，不得让 harness 猜 run identity 或直接 route 一套简化事实。
5. `context-harness` 负责 replay / context pipeline，不混入 graph loop 闭环。
6. contextPolicy 字段是否真实影响最终上下文，优先使用 `validateContextPolicyInvariants()`；不要只断言 schema 通过。
7. run 生命周期、audit、telemetry、cost 聚合测试优先使用 `createRunSupervisorHarness()` 和 `validateRunInvariants()`；不要在业务测试里重复手写一套 mock supervisor。
8. 任何依赖 Linnya 默认 tool/runtime/event-store 的 harness 必须放在 `src/app-hosts/linnya/testkit/*`。

---

## 最小验证集合

- `packages/linnkit/src/testkit/tool-fixtures/toolContext.test.ts`
- `packages/linnkit/src/testkit/context-harness/__tests__/contextPolicyInvariants.test.ts`
- `packages/linnkit/src/testkit/run-harness/__tests__/runHarness.test.ts`
- `src/app-hosts/linnya/adapters/child-runs/__tests__/registeredSubagentInvoker.test.ts`
- `src/app-hosts/linnya/testkit/agent-harness/__tests__/graphLoop.integration.test.ts`
- `src/app-hosts/linnya/testkit/agent-harness/__tests__/graphLoop.stepPolicy.test.ts`
- `src/tools/agent_control/subrun/shared/__tests__/subagentRunner.integration.test.ts`
- `src/tools/agent_control/subrun/subagent/__tests__/subagentTool.failure-recovery.integration.test.ts`
- `src/tools/deep_research/__tests__/researchSubagentWorkspace.integration.test.ts`
- `src/app-hosts/linnya/adapters/realtime/__tests__/runtimeEventLifecycle.contract.test.ts`
- `packages/linnkit/src/context-manager/profiles/agent/context/providers/__tests__/multiToolFollowup.integration.test.ts`

---

## 相关文档

- [Agent harness](./agent-harness/README.md)
- [Context harness](./context-harness/README.md)
- [Run harness invariants](./run-harness/INVARIANTS.md)
- [Linnkit 测试接入](../../docs/integration/testing.md)
- [Linnya Host testkit](../../../../src/app-hosts/linnya/testkit/README.md)
- [Conversation 测试与门禁](../../../../docs/conversation-platform/11-testing-gates.md)
