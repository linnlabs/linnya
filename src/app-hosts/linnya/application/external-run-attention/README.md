# External run attention（外部发起的运行等人时叫到人）

外部入口（Linnya CLI）发起的运行停下来等用户批准命令或回答提问时，发起它的往往是另一个 Agent，用户并不在 Linnya 窗口前。本模块在这种等待开始时通知用户一次。

只管“叫一声”。等待状态的事实仍来自 [`conversation-activity`](../conversation-activity/README.md)，侧栏的“待审批 / 待回答”标记由 Renderer 的同名 feature 负责；谁能批准由命令权限设置决定，与本模块无关。

## 规则

- 只通知外部发起的运行：根运行登记元数据里有 `externalSender`（Conversation Control 接收 `send` 时写入）。用户在界面里自己发起的运行不通知，审批卡就在眼前。
- 一段等待通知一次。“一段等待”按 `运行编号 + 等待种类` 识别：同一运行先等批准、处理后又等回答，算两段；同一段等待期间的其他状态变化不重复通知。
- 已通知记录只在内存里。App 重启后遗留运行会被启动恢复收口成中断，不存在跨重启仍在等的运行，所以不持久化。
- 通知失败只记日志，不影响运行，也不重试；侧栏标记仍然在。
- 调用方自己能处理的等待（提问可由 `respond` 回答，或用户已允许命令行代批）同样通知：分不清调用方会不会处理，漏叫比多叫代价大。出现实际打扰问题再收紧。

## 流程

`connectExternalRunAttention` 订阅两路不带内容的失效信号——运行状态变化（`run-activity-signal`）与命令审批变化（Commands 审批 owner 的 `subscribe`），50 ms 内合并成一次检查：重读 `listConversationActivities`，由 `selectWaitingEpisodes` 取出正在等待的对话，对未处理过的那段读根运行的发件人，有才调用 `notify`。

`notify` 是组合根注入的端口。Desktop 下经 `desktop.conversation_attention.notify` RPC 交给 Electron Main：窗口不在前台发系统通知，点击后拉起窗口并让 Renderer 打开那段对话；窗口在前台转给 Renderer 做应用内提示。源码 Runtime（`linnya runtime start`）没有桌面，不注入该端口，本模块不接线。

## 文件

- `definitions/externalRunAttention.ts`：等待段与四个窄端口（读运行状态、读发件人、读对话标题、通知）。
- `functions/selectWaitingEpisodes.ts`：从运行状态列表取等待段及其身份，纯函数。
- `orchestration/connectExternalRunAttention.ts`：订阅、合并、串行检查与去重。
- `__tests__/externalRunAttention.integration.test.ts`：真实数据库、运行登记与审批 owner 上的业务用例。

提醒事件的形状见 `@app/schemas` 的 `conversation-attention.ts`；Main 侧的投递是与定时任务通知共用的 `src/electron-main/desktop-capabilities/desktop-notice/`。
