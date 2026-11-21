# Conversation activity HTTP

`GET /api/v1/conversation/activity` 返回全工作区不空闲的对话（`ConversationActivityListSchema`），每条带 `project_id` 与 Host 的运行状态投影；不在列表里的对话就是空闲。侧栏用一次请求同时得到展开列表与收起项目的汇总。

状态解释、候选查询与失效信号由 [conversation-activity](../../../app-hosts/linnya/application/conversation-activity/README.md) 负责；本入口不缓存，不记录“看过”，响应 `Cache-Control: no-store`，错误只返回 `conversation_activity.list_failed`。挂载在 History 之前，避免被 `/:id` 形式的路由截走。
