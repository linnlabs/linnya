# Conversation Error Surface

该 feature 只负责 ConversationHost 横幅的来源选择，不拥有任何执行域的错误生命周期。

错误来源仍由各自 owner 持有：前台 Agent run 在 `interactive-run`，旧 contributed workflow 在
`executionState`，批注流程在 `annotationRunExecutionStore`。本 feature 按稳定优先级选择当前可见
错误，并返回来源身份；关闭动作必须根据这个身份只清理对应 owner，不能批量清除其它执行域的错误。

Runtime error 的文案归一化由 `services/errorNormalizer.ts` 和消息投影器负责；本 feature 不重新解释
错误码，也不读取网络或数据库。新增错误来源时，先补充候选定义、选择器测试和关闭 owner，再接入
`assistantStore` 聚合入口。
