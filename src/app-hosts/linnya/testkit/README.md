# Linnya Host-Bound Testkit

Layer: `app-host verification`

`src/app-hosts/linnya/testkit/*` 放所有依赖 Linnya host 装配的测试支撑。

这里负责：

- graph loop host harness
- child-run host harness
- tool runtime harness
- host-bound in-memory event store
- host-bound agent scenario runner
- temporary workspace fixtures that override global workspace root
- 独立构建的 [historical-runtime](./historical-runtime/README.md) 语料实验 Host；生产入口不识别实验政策

这里不负责：

- package-neutral 的 scripted AI harness
- 通用断言
- context pipeline 的共享 harness
- linnkit package 的 run/audit/telemetry primitive

真实边界：

- 通用测试底座：
  - 独立 Linnkit 仓的 `src/testkit/*`
- Linnya host-bound harness：
  - `src/app-hosts/linnya/testkit/*`

Host 级 Agent 场景测试优先使用 Flow 场景 [`createFlowScenario`](../adapters/flow/__test-helpers__/flowScenario.ts)：真 SQLite、生产 Runtime 装配与 Flow 编排，只替换模型和工具，能在模型调用或工具执行的任意时刻插话、撤回、暂停，并检查实时 / 重载 / 模型请求三方一致。运行与生成骨架见 [`pnpm -s scenario`](../../../../scripts/development/features/agent-scenario/README.md)。只验证 Linnkit Graph 本身的行为时，到 Linnkit 仓用 `createGraphScenario`。

推荐阅读：

- 独立 Linnkit 仓的 `src/testkit/README.md`
- `src/app-hosts/linnya/testkit/agent-harness/README.md`
- `src/app-hosts/linnya/adapters/flow/README.md`
