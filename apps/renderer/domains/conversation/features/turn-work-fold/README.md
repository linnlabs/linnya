# Turn Work Fold

主时间线的终态折叠：一轮正常结束且有最终回答后，把本轮的思考、叙述与工具调用收成一行“已工作 x 分 x 秒”，
写法与“已思考”一致，只写时长、不写步骤摘要。点击原地展开，展开状态只在本次打开应用期间有效。

## 规则

`functions/projectTurnWorkFolds.ts` 是唯一规则 owner：

- 一轮 = 从一条用户消息到下一条用户消息；运行中途的插话（`delivery: 'mid_run'`）不算新一轮。
- 折叠条件：用户消息的 `agent_work.outcome` 为 `completed`、本轮没有仍在进行（含等回答、已暂停）的运行、
  有最终回答、且有过程可收。失败、停止或没有结算时长的历史轮次保持原样。
- 收起：思考、叙述、部分回答、重试/错误通知、上下文摘要，以及不是交付成果的工具调用。
- 留在外面：用户消息、插话、最终回答、客户端提示、命令权限变化，以及工具 owner 声明为 `image` 的工具
  （生成的图片是交付成果）。
- 时长取 `agent_work.duration_ms`。它是最后一次执行的时长；暂停后继续的轮次只算继续后的那一段。

## 接线

- `composables/useTurnWorkFoldRows.ts` 套在增量 visual-row builder 之后，只被 `ConversationView` 使用；Subrun 详情不折叠。
- 投影会按最终顺序重算视觉轮次首尾标记，没变的行沿用原对象，流式输出时不让整屏行组件重渲染。
- `store/turnWorkFoldStore.ts` 只存用户点开过的轮次，不持久化。
- 折叠或展开删去视口内的行时，阅读位置由 `ui/conversationView/functions/removalViewportAnchor.ts` 锚定，
  见 [conversation-virtualization](../../docs/conversation-virtualization.md)。

## 验证

`__tests__/projectTurnWorkFolds.test.ts` 覆盖收起与展开、仍在进行/失败/停止/没有结算的轮次不折叠、
插话与图片留在外面并重算轮次边界、对象复用。真机效果用 Desktop 探针验收。
