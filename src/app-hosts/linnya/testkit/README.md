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

N-3/G-1/B.3 之后，host 级 agent 场景测试优先使用 `agent-harness/scenario/runAgentScenario.ts`：它复用真实 graph loop 装配，同时用 linnkit 的 run-harness 校验 run/audit/telemetry/cost 不变量。

推荐阅读：

- 独立 Linnkit 仓的 `src/testkit/README.md`
- `src/app-hosts/linnya/testkit/agent-harness/README.md`
- `src/app-hosts/linnya/adapters/flow/README.md`
