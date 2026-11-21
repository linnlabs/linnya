# Linnya Agent Harness

Layer: `host-bound regression harness`

`src/app-hosts/linnya/testkit/agent-harness/*` 承接所有直接依赖 Linnya host 装配的闭环 harness。

当前 owner：

- `graphLoopHarness.ts`
- `childRunHarness.ts`
- `toolRegistryHarness.ts`

`graphLoopHarness` 的 `modelInput` fixture 用于 host-bound 图片闭环：它复用生产模型目录、Context 图片估算/物化、ToolNode capability validator 与 workspace tool selection resolver，不在测试里复制兼容性判断。

这些 harness 依赖：

- `src/app-hosts/linnya/adapters/*`
- `src/app-hosts/linnya/agent-registry/*`
- `src/app-hosts/linnya/context-policies/*`

运行场景（插话、暂停、取消、失败、用量等跨层行为）不在这里写：用 Flow 层的
`src/app-hosts/linnya/adapters/flow/__test-helpers__/flowScenario.ts`（`createFlowScenario`）。它走真 SQLite 与生产 Runtime 装配，
自动校验实时与重载一致、插话去向和 Linnkit 运行不变量；入口与命令见 [构建与测试](../../../../../docs/development/build-and-test.md#agent-运行场景)。

如果你只需要：

- scripted AI turns
- 通用消息断言

请优先使用：

- 独立 Linnkit 仓的 `src/testkit/agent-harness/*`
