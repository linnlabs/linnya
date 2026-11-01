# App Server Activity RPC

Electron Main 通过本 feature 询问 App Server 当前有哪些工作会被退出或安装更新打断，并在重启前暂停可恢复的 Agent 任务。Main 只拿到展示与决策所需的事实，不取得 Commands owner、RunSupervisor、数据库或 run 身份。

| 方法 | 请求 | 响应 |
| --- | --- | --- |
| `backend.app_activity.read` | `null` | `has_executing_commands`、`active_agent_runs[{conversation_id, conversation_title}]`、`knowledge_ingestion_active` |
| `backend.app_activity.pause_agent_runs` | `null` | `paused_conversation_ids`、`unpausable_conversation_ids` |

- `active_agent_runs` 每个对话最多一项，只包含 `pending/running` 的前台根 run（无 parent 且 `lane=foreground`）。child/subagent、标题/补全/翻译等 auxiliary run、`awaiting_user` 与已暂停 run 不在其中；`conversation_title` 在对话元数据缺失时为 `null`。
- `pause_agent_runs` 对每个执行中的前台根 run 调用与 HTTP pause 相同的 `FlowOrchestrator.pauseRun`，并等待原 execution 收口；只暂停，不取消或丢弃。缺少恢复输入、execution 身份过期等情况归入 `unpausable`，重启会直接中断它们；暂停期间自然结束的 run 不出现在任何列表中。Desktop 侧 deadline 为 120 秒，超时不撤销 Backend 侧已发出的暂停。
- `knowledge_ingestion_active` 表示知识库摄入队列仍有待处理或执行中的任务。
- 编解码严格：缺字段、多余字段、空对话 ID、重复对话或同一对话同时出现在两类暂停结果都会被拒绝。

Agent run 活动端口由会话路由在挂载后注册到 `BackendRuntimeOwner`（实现位于 [Flow interactive-run](../../../adapters/flow/README.md)）。注册前或 Backend 开始收口后，`read` 返回空 run 列表，`pause_agent_runs` 返回两个空列表。`has_executing_commands` 的语义保持不变。
