# Run Scheduled Tasks

一轮回复里 Agent 用 `linnya schedules create|update` 建了或改了定时任务时，回答末尾每个任务一张卡片：
任务名、时间表、下次运行、命令权限，右侧“查看”。完全访问时整卡换警告底色并单独一行写风险，另给“改为标准”。

- 运行中不显示，本轮结束后才读（与改动清单同一时机）；任务有变化时重读，卡片显示当前事实，已删除的只剩名称。
- Conversation 只负责摆放：卡片的文字、警告和按钮都由 port 给出，这里不解释定时任务的规则。
- port 实现位于 `apps/renderer/app/workflows/conversation-run-scheduled-tasks/`，读 App Server 的
  `conversation-run-scheduled-tasks:list`，“查看”进入定时任务页并选中该任务。
- 未注册 port（夹具、单测）时不显示。
