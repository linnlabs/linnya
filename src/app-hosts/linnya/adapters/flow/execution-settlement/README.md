# Execution Settlement

该 feature 独占一次 Agent execution 的结算顺序，Graph Runner 不再直接修改 RunSupervisor 状态。

终态错误事实只发布一次：LlmNode 已发布的 classified error 通过 `RuntimeFailureFactSink` 交给 AgentRunner；Graph 尚未发布错误时，AgentRunner 使用 `publishRunFailureFact` 创建事实。Settlement 只消费这条已发布事实来落 RunHandle 状态，不再创建第二条 run-level error。

固定顺序是：发布 durable `run_execution_metrics`，等待 persistence drain，再落定 RunHandle 状态和终态资源。`awaiting_user` 保留 checkpoint 和 run 资源，供下一次 resume execution 使用。

`completed` 是不可逆终态，因此必须在清理 checkpoint 后才写入；否则清理失败后再尝试 `markFailed` 会被 RunSupervisor 正确拒绝，留下“结果报错但 run 已 completed”的分裂状态。failed / cancelled 分支优先保证权威终态，再清理 checkpoint 和成本资源；此时 checkpoint 清理失败属于可观察的运维故障，不能阻止 run 离开 running，也不能反复重试同一次失败清理。

一次 execution 最多发布一条 metrics。Graph 已完成后若 persistence drain 失败，RunHandle 必须进入 failed，但不能补造第二条 `outcome=failed` 覆盖既有 Graph execution 事实。metrics 不驱动前端控制态，权威控制态始终来自后续 `run_status`。

`run_execution_metrics.context_usage` 是可选的最近成功 Prompt 快照。成功路径从 Graph 返回 checkpoint 读取；失败/取消路径必须在 checkpoint 清理前读取持久 checkpoint，并通过 LinnKit 公共 schema admission。它只属于当前 foreground conversation execution，不从 telemetry、成本账本或开放 metadata 补值。读取可选快照失败时记录完整错误并继续收口 failed/cancelled 权威终态，不能让展示事实反向卡住 run lifecycle。

Graph 运行中已经通过 ephemeral `context_usage_snapshot` 提供更高频的 live 值；settlement 不重放这些中间事件，也不按工具
数量补发。它只把 checkpoint 中最近一次成功快照写入唯一 metrics，作为 EventStore、reload 与断线客户端的最终收敛事实。
被 `admit_prompt_capacity` 以 `llm.prompt.input_budget_exceeded` 拒绝的候选测量没有进入 checkpoint，settlement 只结算该 typed error，不得把候选值补成 metrics 的 `context_usage`。

`wait_user` 是成功结算的特殊分支：Graph checkpoint 必须同时返回已经由统一 publisher 发布的 `requires_user_interaction` 事实。settlement 会在发布 metrics 和 drain 前校验该不变量，避免落下一条无法 resume 的 `awaiting_user` 记录。

本 feature 不负责 Graph 执行、SSE transport 收尾、RuntimeEvent 到 SSE 的映射或 Renderer 投影。

禁止事项：

- 禁止在 AgentRunner、Host finalizer 或错误 catch 中复制 metrics / drain / mark 状态顺序；
- 禁止 Settlement 为已经发布的 LLM failure 再创建 run-level error；
- 禁止在 persistence drain 成功前写 completed / awaiting_user；
- 禁止从 transport EOF、EventBus close 或 Renderer 状态反推 run 终态；
- 禁止在没有正式 interaction 事实时把 checkpoint 结算为 `awaiting_user`；
- 禁止通过开放 metadata 在 hook 与 settlement 之间传递关键结果。
