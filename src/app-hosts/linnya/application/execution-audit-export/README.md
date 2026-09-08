# Execution Audit Export Use Case

这是 Linnya Host 的只读执行摘要 use case。它关联 RunRegistry 的权威生命周期、
统一 Audit Domain 在 EventStore 中的 durable 工具事实、Command feature 的命令终态与
Telemetry 安全观测，供 Conversation CLI 等入口读取。它不能写审计，也不能创建第二个
recorder。

边界：

- Run、父子关系、Agent 和终态来自 RunRegistry。
- 工具决策与终态来自 EventStore，以 `runId + toolCallId` 形成
  `paired / decision_missing / terminal_missing / duplicate_terminal` 派生视图。
- `tool_process` 是 realtime-only 进度，不进入 EventStore；历史审计不虚构工具开始时间。
- Shell 子进程退出来自既有 `command.execution.terminal` 审计信封，与 Tool success/error
  分栏展示，因此非零 exit 不会被误报为工具基础设施错误。
- 模型耗时、canonical token usage、工具完成、context compaction 和 run terminal 观测来自 Telemetry。
- 不读取或导出 prompt、模型正文、工具参数、工具输出、原始错误正文和凭据。
- Telemetry 默认只保留 7 天，而且写入失败不阻断业务，因此对外必须标为
  `best_effort`，缺失 usage 必须计入 `missing_usage_calls`，不能补成 0。
- `context_compaction` 按 root / child run 分栏聚合触发水位、前后 token、请求成本、
  Provider actual cache read、耗时、outcome 和护栏；只保留安全数值与稳定错误分类，不读摘要正文。
- `contextCompaction.attempts` 只统计已经发往 Provider 的摘要生成请求；发送前的容量或护栏阻断仍计入 `observations` 与对应 outcome，但不会污染 attempts 和 usage 覆盖。`providerActualCalls / estimateCalls / missingUsageCalls` 三者共同解释这些真实请求的 usage 质量。
- RunRegistry 仍是 lifecycle owner；`run_lifecycle` 只补充 `steps used / max steps / terminal reason`
  观测。同一 run 经 `wait_user` 恢复可能有多条 terminal observation，对外返回最新一条并保留观测数。
- 本阶段只提供 Benchmark 所需的安全执行摘要，不等同于完整审计查询器；扩大导出范围时必须复用统一 Audit Domain 的查询能力并同步本文。

`functions/` 只负责 run scope 选择和纯聚合；`orchestration/` 只负责并行读取三个
owner 并组装结果；EventStore 与 Telemetry 查询分别位于 Host persistence adapter。
Benchmark 只能消费这份
安全投影，不能绕开 CLI 直查 `engine_telemetry`。
