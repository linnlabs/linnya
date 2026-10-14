# Conversation Error Surface

该 feature 负责错误来源选择与时间线通知的安全展示，不拥有执行状态或重试调度。

运行内 `error / llm_retry` 经实时 reducer 与 Host durable projector 汇合为 `execution_notice`；UI 只按通知事实计算文案、当前次数和等待时间。计时不增加重试、不改变生命周期。终态保留在消息列表与历史，raw Provider 响应和堆栈不进入展示。

错误文案继续由 `services/errorNormalizer.ts` 统一解释，保留认证、额度与模型兼容等既有指引。`interactive-run` 持有暂停/继续状态，通知不建立第二套控制状态。Runtime error 的 notice identity 只用来避免同一运行错误同时出现在本地诊断与已投影的消息中。

未取得 Runtime fact 的错误由 interactive-run、annotation execution 等原 owner 分类后交给 [client-notices](../client-notices/README.md) 保存安全的产品事实，并通过同一历史窗口呈现。没有 Conversation 或 Host 离线时先持久保留本地条目、明确尚未同步；不伪造运行身份、不进入模型上下文。运行控制仍由原 owner 负责。
