# Conversation Error Surface

该 feature 负责错误来源选择与时间线通知的安全展示，不拥有执行状态或重试调度。

运行内 `error / llm_retry` 经实时 reducer 与 Host durable projector 汇合为 `execution_notice`；UI 只按通知事实计算文案、当前次数和等待时间。计时不增加重试、不改变生命周期。终态保留在消息列表与历史，raw Provider 响应和堆栈不进入展示。

错误文案继续由 `services/errorNormalizer.ts` 统一解释，保留认证、额度与模型兼容等既有指引。`interactive-run` 持有暂停/继续状态，通知不建立第二套控制状态。Runtime error 的 notice identity 只用来避免同一运行错误同时出现在本地诊断与已投影的消息中。

错误正文只说明已知原因与下一步操作，HTTP 编号留在错误详情。未知的重试结果直接说明“结果未确认”，不展示内部结算术语；额度恢复时间没有事实依据时不得承诺“明天恢复”。中英文 catalog 保持同样的含义。

OpenCode Go 的缺失会话标识由 Host 产品分类器读取结构化错误类型后投影为 `llm.opencode_session_required`；Renderer 只按该稳定码提示更新客户端，不解析上游正文或把普通 HTTP 400 猜成接入错误。

未取得 Runtime fact 的错误由 interactive-run、annotation execution 等原 owner 分类后交给 [client-notices](../client-notices/README.md) 保存安全的产品事实，并通过同一历史窗口呈现。没有 Conversation 或 Host 离线时先持久保留本地条目，投递状态留在 outbox 内；面向用户只呈现失败操作、已知原因和操作指引，不展示内部来源或记录同步标签。不伪造运行身份、不进入模型上下文。运行控制仍由原 owner 负责。
