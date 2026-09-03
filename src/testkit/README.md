# Testkit 旧根目录说明

`src/testkit/` 不再拥有活跃实现，只保留本迁移说明。

当前 testkit 已按 owner 分流：

- package-neutral primitive：独立 Linnkit 仓的 `src/testkit/*`
- Linnya Host 装配：`src/app-hosts/linnya/testkit/*`
- 旧 `default-agent-benchmark` 已删除；真实 Agent Benchmark 由独立 CLI Runner
  消费 `linnya` Conversation CLI，不再放进 Host testkit 或产品执行链。

如果你在找当前真实 harness/fixture，请优先看：

- 独立 Linnkit 仓的 `src/testkit/README.md`
- `src/app-hosts/linnya/testkit/README.md`
- `apps/linnya-benchmark/README.md`
