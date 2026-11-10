# Project Conversations

回答“这个项目里有哪些对话，各自谁在用、聊了几轮、改过哪些文档、占了多少存储”，并给其他 Agent 读别的对话。
共享合同在 `packages/schemas/src/project-conversations.ts`，走本地 HTTP `/api/v1/project-conversations`
（路由见 `src/features/project-conversations`）：占用测量要读对话工作目录，这个端口只在 HTTP 装配层可用。

- 列表：对话持久化里属于本项目的对话。Agent 只取对话选定的 Agent，选的就是默认 Agent 或没选时为 `null`；
  不从运行记录推断，标题生成等内部运行也是对话里的根运行。轮次是用户消息数。置顶在前，再按最近活动。
- 改过的文档：[行动账本](../../../../domains/action-ledger/README.md)按对话去重计数；详情另给每份文档的类型、最近改动时间、
  是否已删除（已删除不可打开），内建 Markdown 再给待审阅修订数。
- 详情的第一个问题与最后的答复取自[可读对话](../../../../../docs/conversation-platform/06-read-model.md#8-可读对话)，
  各截取开头 600 字。
- 搜索：标题命中在前；内容只搜可读对话，三字以上经 FTS5 trigram 缩小候选，不足三字逐条扫描，都按字面再比较，
  给出命中处前后一小段。最多 200 个对话，超出时 `truncated`。
- 读别的对话（`readConversationTranscript`）：按序号翻页读一个对话的可读消息，范围由调用方传入；
  现在只有项目范围，范围外的对话与不存在的对话一样返回空。Agent 入口是 Shell 内建的 `linnya conversations`。

## 占用

对话占用分三项：对话记录（这个对话在数据库里的全部记录，含执行过程：事件、UI 消息、子运行轨迹）、
附件（它引用的资产字节，被多个对话共用时每个对话都计入并标出共用）、过程文件（对话工作目录，读不出时为 `null`，不当作 0）。

全量测量在大库上要几秒（2026-11 开发库约 7 秒），所以结果缓存在 `conversation_storage_usage`：
测量时间早于对话最近活动即视为过期，列表里给 `null`，由界面在打开对话页时分批（每批 8 个）补测。
清理过程文件复用存储空间的接口，清理后界面重测这个对话。删除对话时缓存随对话级联删除。

不负责：对话的写操作（置顶、改名、删除）归对话领域；跨对话的任务状态尚未开放。

```bash
pnpm exec vitest run src/app-hosts/linnya/application/project-conversations src/app-hosts/linnya/adapters/persistence/readable-conversation
```
