# Golden Regression Fixtures

这里保存稳定、可控、可复现的 engine 输入，验证生成、解析、patch 与 snapshot 合同。

- 消费入口：`golden-regression.test.ts` 与 `run-harness.ts batch`；
- 所有布局必须是 fixture 中的显式事实，不依赖已退役的自动 layout/solver；
- 不作为当前 Agent 视觉质量真值，也不新增“主审美样本”；
- 真实 Agent 与人工 PowerPoint 验收进入 `apps/linnya-benchmark`。
