# Slides Engine Harness

这个 Harness 只负责确定性的 engine 回归：把 `golden-regression` fixture 编译、校验、回读、patch，并生成稳定 snapshot。它不负责真实 Agent 任务、审美评分或人工 PPT Benchmark。

真实 Agent 验收统一使用 [`apps/linnya-benchmark`](../../../../../../../apps/linnya-benchmark/README.md)，通过 Linnya CLI 发起任务、收集审计与登记人工审核结果。

## 命令

```bash
pnpm --dir packages/plugins/slides run harness batch --output-dir /tmp/slides-engine-harness
```

单项命令：

- `generate <fixture-id>`：生成 PPTX；
- `inspect <fixture-id>`：输出解析摘要；
- `validate <fixture-id>`：验证 PPTX；
- `snapshot-diff <fixture-id>`：比较稳定 snapshot；
- `layout-lint <fixture-id>`：对确定性 fixture 执行 lint。

新增 fixture 前先确认它验证的是编译/解析/patch 合同，而不是“看起来好不好”。后者应注册为 Benchmark case。
