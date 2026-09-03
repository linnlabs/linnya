# Message Canvas

> **权威规范**：[`docs/conversation-platform/07-render.md`](../../../../../../docs/conversation-platform/07-render.md) 与 [`10-subruns.md`](../../../../../../docs/conversation-platform/10-subruns.md)。本目录只说明共享展示层的实现边界。

本目录是 Conversation 域内完整消息的共享展示层。它消费已经完成 admission 与 visual-row 语义投影的数据，统一渲染行结构、轮次间距、streaming 归属、回答操作和 `Message.vue` leaf；它不读取 Pinia，不加载历史，不决定窗口，也不执行滚动。

```text
ConversationMessageCanvas
  └─ ConversationVisualRow
       ├─ Message
       └─ tail region（仅 turn-end owner）
            ├─ ConversationWorkDurationHint
            ├─ ConversationVisualRowActions
            └─ ConversationMessageCanvasTrailingStatus
```

两种宿主只提供 placement：

- 主时间线由 `conversationView/VirtualConversationCanvas.vue` 提供 TanStack 可见行、绝对位置和 `measureElement`。
- Subrun 详情不提供 placement，画布按普通文档流渲染全部已接纳 child rows。

因此，语义行距只能由 `ConversationVisualRow.css` 的 turn 边界规则产生。宿主不得再给消息列表增加统一 `gap`，也不得直接循环 `Message.vue`。反过来，共享画布不得 import `ConversationView`、foreground store、message-window、timeline 或 TanStack；这些都属于宿主编排。

`resolveConversationRowTailLayout` 是尾部布局的纯规则 owner。最后一个 turn-end row 在存在回答操作或
主时间线 waiting 时只保留一块 tail region；duration、actions 与 waiting 在区域内共享位置，显隐不改变
高度。waiting 只由最后一行拥有，terminal 后释放；有回答操作时 tail 继续存在。Subrun 详情不传
trailing status，不能从 foreground store 反向推断生成态。

回答复制/转存的离屏真实渲染宿主跟随 `ConversationMessageCanvas` 存续，因为它服务 visual-row 操作，而不是虚拟列表。画布只通过 `ui/tools/knowledge/clipboard/index.ts` 的窄公开出口消费既有能力，不依赖该 feature 内部目录。新增完整消息 surface 时应复用画布公开入口，不应自行复制 provider。
