# Conversation activity（侧栏运行状态）

侧栏对话行行首显示 Agent 运行状态：进行中（Linnya 摇曳动态）、等你回答、等你审批（强调色圆点，行尾写“待回答 / 待审批”并提亮标题）、已中断（小红点，打开后消失）；空闲不显示。收起的项目只在行尾显示里面最需要处理的一种，悬停看数量。右侧面板的历史下拉不显示。

## 数据与刷新

事实只来自 Host 的 `GET /api/v1/conversation/activity`（`ConversationActivityListSchema`），本 feature 不从消息、选中的 Agent 或本窗口的运行快照推断状态。审批端读不到（`unavailable`）时按进行中显示。

不轮询。`orchestration/conversationActivityLifecycle.ts` 先订阅 App Server 的 `conversation-activity-changed` 失效信号，再初次读取；另外在审批推送变化（`command-approval` 的公开投影 store）和窗口回到前台时重读。同一时刻只有一个请求，请求期间来的信号在结束后补读一次；读取失败保留上一份结果。信号来源和合并见 Host 的 [conversation-activity](../../../../../../src/app-hosts/linnya/application/conversation-activity/README.md)。

## 看过的中断

`store/conversationActivitySeenStore.ts` 用 Renderer 持久存储记“对话 → 看过的运行编号”，重启后保留；只影响红点，不改运行事实，也不回写 Host。

- 首次启用时写入 `baselineAt`，更早结束的中断算看过，上线不会冒出一批旧红点。
- 正在看的对话（`assistantStore.activeConversationId`）出现中断当场记下，打开带红点的对话同理。
- 本窗口发起暂停或取消时立刻记下那次运行，避免操作后马上切走时红点出现。
- 每次读取后只保留当前运行仍是记下那次的条目；新运行开始或对话回到空闲就删除。

## 文件

- `functions/resolveConversationRunStatus.ts`：状态映射、看过判断、项目汇总与记录裁剪，纯函数。
- `store/`：`conversationActivityStore` 持有最近一次列表；`conversationActivitySeenStore` 持有看过记录。只有状态与同步 action。
- `composables/useConversationRunStatus.ts`：侧栏唯一读取入口，给出记号、行尾文字与项目汇总的文案。
- `ui/ConversationRunStatusIndicator.vue`：行首记号；样式在 `styles/features/conversation-activity/`。
