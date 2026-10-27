# 当前运行输入引语

本用例通过 RunDescriptor 与 EventStore 两个正式 owner，向已授权插件 CLI 提供当前 root 接纳的用户角色文本中的有界引语。它不是通用会话检索、来源认证或执行批准。

`@plugin/backend/runInputQuote` 的 facade 只接线；adapter 使用 CLI bridge 的 conversationId、agentRunId、projectId 与已准入的 ToolContext，核对真实会话项目。用例读取原 descriptor 的 currentUserEventId，且该事件必须属于原 incomingEventIds。child 委派、其他历史、缺失 descriptor 或不可见事件均拒绝。恢复沿原 descriptor，不根据最近消息猜输入。终态清理 descriptor 后不再提供新的引用。

本版本不覆盖同一 root 暂停后经 ask/respond 追加的补答；它们没有成为首次 descriptor 的 currentUserEventId。调用方应如实保留为未绑定的作者报告，不借用原输入或把最近事件替换进去；未来扩展补答须先明确该类正式事件的准入与恢复合同。

functions 只规范化空白进行精确子串匹配，1–2000 字符；Host 生成事件/run 身份及原输入文本 SHA-256。输出不包含全文、附件或任意历史。返回的 quote 已规范化空白，hash 对应 getRenderableRuntimeEventContent 的正式原输入文本，不含模型侧时间包装。

证明范围仅为“原句出现在本次接纳的用户角色输入”。该输入可以由前端或外部 CLI（包括另一个 Agent 操作 CLI）产生，不证明人类手工键入、真实行动发生、摘要忠实或任何授权。调用方持久化后的引语是独立快照，删除原会话不会自动删除该快照；调用方必须按自己的数据生命周期处理。端口不扩大权限、不接受调用方自选事件，也不把引语内容当指令执行。

通用 DTO 归 packages/schemas，插件合同归 plugin-host-contract；业务记录由各调用方保存。业务回归见 packages/plugins/__tests__/decisionInputQuote.sqlite.integration.test.ts，包含真实 SQLite 接纳、CLI、事件事实、项目/运行隔离、跨 turn、原子拒绝、暂停重开和历史保留；研究三层组合测试另验证真实 child 拒绝。
