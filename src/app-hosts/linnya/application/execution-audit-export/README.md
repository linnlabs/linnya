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
- `llmResponses` 通过 Audit owner 的只读白名单投影导出已持久化的
  `llm.response.succeeded|failed`：保留 event/envelope、attempt/trace/model 身份、时间、
  outcome 与安全 failure kind/code/retryable。父子范围只由 RunRegistry 的真实子树决定。
  它不重写 RunRegistry pause/error，不把最后一次历史失败当作当前暂停原因，
  attempt 观测数也不是重试次数、重试耗尽或可自动恢复的证明。
- response evidence 是 `best_effort`：仅 response/stream 等级生成，保留 7 天，
  每个 run 的单次 execution 最多 64 条/1 MiB，写入也可能失败。
  现有事实没有 execution identity、历史开关或丢弃计数，因此明确返回执行归属
  `unavailable`、缺失/丢弃数量 `unknown`；空 run 标记 evidence unavailable，不能解释成零失败。
  即使查询完整 EventStore，也不能声称 attempt 历史完整；64 条本身也不能证明已封顶。
- `workspaceDocuments` 单列成功 `write_file/edit_file` 的 durable 文档诊断观测，按正式
  Workspace data 合同提取严重度计数。保存成功与文档编译/质量成功是不同事实，不能把
  error 诊断改记为工具执行失败，也不能把零 error 当作验收通过。
- 诊断只输出调用身份、时间、error/warning/info 已见计数和原结果的未展示总数；
  截断项严重度未知，分严重度计数是下界。它累计每次写入的观测，不代表文档当前剩余问题，
  重复 terminal 仍由配对完整度栏揭示，不能从累计数推断“多少次独立编译失败”。
- 标准诊断 `code` 当前只有非空字符串约束，并无禁止正文的安全合同，因此和
  `message/target` 一起排除；不以正则猜测安全 code，也不解释插件 ID 或诊断正文。
- 不读取或导出 prompt、模型正文、工具参数、observation、原始错误正文和凭据。
  Workspace 写入只接纳正式结构化 data 并立即投影上述安全计数，不导出文档身份、地址、diff 或源码。
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
