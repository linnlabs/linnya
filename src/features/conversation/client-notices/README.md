# Conversation client notices

客户端提示是 Conversation 产品事实，不是 Agent 运行事件。`PUT /api/v1/conversation/:id/client-notices/:noticeId` 使用 UUID 幂等接纳严格的 `ConversationClientNoticeCommandSchema`。尚未存在的 Conversation 返回 404，不替客户端创建空会话；同 identity 的不同内容或归属返回 409。成功回执明确 retained/removed：removed 表示历史已经被截断，重发不能让其复活。

持久适配器负责事实、UI 投影的单一事务；History 通过现有 ui-messages 窗口读取。此入口不依赖 Flow、模型或 RuntimeEvent。共享身份及安全字段的真源为 `@app/schemas/conversation/client-notice`（经公共入口导出）。数据库 owner 见 EventStore README。
