# Execution Settlement

该 feature 独占一次 Agent execution 的结算顺序，Graph Runner 不再直接修改 RunSupervisor 状态。

终态错误事实只发布一次：LlmNode 已发布的 classified error 通过 `RuntimeFailureFactSink` 交给 AgentRunner；Graph 尚未发布错误时，AgentRunner 使用 `publishRunFailureFact` 创建事实。Settlement 只消费这条已发布事实来落 RunHandle 状态，不再创建第二条 run-level error。

固定顺序是：发布 durable `run_execution_metrics`，等待 persistence drain，再落定 RunHandle 状态和终态资源。`awaiting_user` 保留 checkpoint 和 run 资源，供下一次 resume execution 使用。

步数必须区分本次 Graph 调用与同一 run 的累计预算。成功和失败/取消都优先采用 checkpoint
提供的绝对 `runIterationsUsed`，不能与旧 Registry 再相加。只有明确拿到本次 `stepCount`
且没有绝对累计输入的非恢复接入才使用增量结算。Graph 异常退出时本次 attempt 计数可以未知，
metrics 省略该字段；checkpoint 读取也失败时不覆盖 Registry 预算，不补造零或从遥测反推。

`completed` 是不可逆终态。生产 durable continuation 先保存 yielded checkpoint，再写 completed，最后清理恢复资源；清理失败只能记录为运维故障，不能把 completed 改成 failed。这样避免“run 尚未完成却已丢失断点”的崩溃窗口。未启用 durable continuation 的接入仍先清理 checkpoint 再写 completed。failed / cancelled 分支优先保证权威终态，再清理 checkpoint 和成本资源；清理失败不能阻止 run 离开 running，也不能反复重试同一次失败清理。

一次 execution 最多发布一条 metrics。Graph 已完成后若 persistence drain 失败，未启用恢复的接入进入 failed；生产 durable continuation 保留最后提交的 checkpoint，由 Flow 收口为 paused，等待显式恢复。两者都不能补造第二条 `outcome=failed` 覆盖既有 Graph execution 事实。metrics 不驱动前端控制态，权威控制态始终来自后续 `run_status`。

`run_execution_metrics.context_usage` 是可选的最近成功 Prompt 快照。成功路径从 Graph 返回 checkpoint 读取；失败/取消路径必须在 checkpoint 清理前读取持久 checkpoint，并通过 LinnKit 公共 schema admission。它只属于当前 foreground conversation execution，不从 telemetry、成本账本或开放 metadata 补值。读取可选快照失败时记录完整错误并继续收口 failed/cancelled 权威终态，不能让展示事实反向卡住 run lifecycle。

Graph 运行中已经通过 ephemeral `context_usage_snapshot` 提供更高频的 live 值；settlement 不重放这些中间事件，也不按工具
数量补发。它只把 checkpoint 中最近一次成功快照写入唯一 metrics，作为 EventStore、reload 与断线客户端的最终收敛事实。
被 `admit_prompt_capacity` 以 `llm.prompt.input_budget_exceeded` 拒绝的候选测量没有进入 checkpoint，settlement 只结算该 typed error，不得把候选值补成 metrics 的 `context_usage`。

`wait_user` 是成功结算的特殊分支：Graph checkpoint 必须同时返回已经由统一 publisher 发布的 `requires_user_interaction` 事实。settlement 会在发布 metrics 和 drain 前校验该不变量，避免落下一条无法 resume 的 `awaiting_user` 记录。

本 feature 不负责 Graph 执行、SSE transport 收尾、RuntimeEvent 到 SSE 的映射或 Renderer 投影。

可恢复 execution 的暂停原因由 `resolveExecutionPauseReason` 分类后交给 RunSupervisor
持久保存：用户暂停和工具对账优先，其余只接纳 Linnkit `ENGINE_ERROR_CODES` 的稳定错误码（例如
`tool.protocol_fuse`），未知异常保持 `execution_interrupted`。不把错误 message、stack 或
Provider 自定义正文塞入 pause reason，也不从工具卡或日志反推控制态。CLI status 直接读取
这份持久事实，paused 仍不是 failed；继续必须由用户显式触发。

禁止事项：

- 禁止在 AgentRunner、Host finalizer 或错误 catch 中复制 metrics / drain / mark 状态顺序；
- 禁止 Settlement 为已经发布的 LLM failure 再创建 run-level error；
- 禁止在 persistence drain 成功前写 completed / awaiting_user；
- 禁止从 transport EOF、EventBus close 或 Renderer 状态反推 run 终态；
- 禁止在没有正式 interaction 事实时把 checkpoint 结算为 `awaiting_user`；
- 禁止通过开放 metadata 在 hook 与 settlement 之间传递关键结果。
