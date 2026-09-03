# Linnya Agent Harness

Layer: `host-bound regression harness`

`src/app-hosts/linnya/testkit/agent-harness/*` 承接所有直接依赖 Linnya host 装配的闭环 harness。

当前 owner：

- `graphLoopHarness.ts`
- `childRunHarness.ts`
- `toolRegistryHarness.ts`
- `scenario/runAgentScenario.ts`

`graphLoopHarness` 的 `modelInput` fixture 用于 host-bound 图片闭环：它复用生产模型目录、Context 图片估算/物化、ToolNode capability validator 与 workspace tool selection resolver，不在测试里复制兼容性判断。

这些 harness 依赖：

- `src/app-hosts/linnya/adapters/*`
- `src/app-hosts/linnya/agent-registry/*`
- `src/app-hosts/linnya/context-policies/*`

`runAgentScenario` 的定位是协议一致性测试，不是评分系统。它默认启用 linnkit `run-harness` 的严格不变量，适合覆盖：

- run 生命周期是否进入终态；
- `model.select / run.cancel / tool.allow` 等审计是否发出；
- telemetry runId 是否能追到 RunRecord；
- cost 是否非负、父子 cost 是否能聚合；
- EventStore 回放顺序和 RuntimeEvent 类型是否仍在协议内。

如果你只需要：

- scripted AI turns
- 通用消息断言

请优先使用：

- 独立 Linnkit 仓的 `src/testkit/agent-harness/*`
