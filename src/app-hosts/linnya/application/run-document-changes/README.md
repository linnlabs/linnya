# Run Document Changes

回答对话里“这一轮回复改了哪些文档”。Renderer 只提交会话编号和这一轮出现过的根运行编号，
项目由会话持久化的 `project_id` 决定，不信任 Renderer 传入。共享合同位于
`packages/schemas/src/conversation/run-document-changes.ts`，channel 为 `conversation-run-document-changes:list`。

- 读取：对每个根运行调用[行动账本](../../../../domains/action-ledger/README.md)的 `listDocumentChanges`
  （含各层子运行），按文档合成一项：是否新建、只有主运行 / 只有子运行 / 两者都改过、最近改动时刻。
  只看运行身份；用户、插件和外部入口的改动不属于这一轮回复。
- 身份：标题与 VFS 展示名一致；已删除的文档仍返回名字并标记 `deleted`，不返回路径，不能借此打开或读取。
  已转到其他项目的文档不列出。
- 状态：只给各 owner 自己的事实。内建 Markdown 返回当前待审阅修订数（文档整体的，不只本轮）；
  其他类型为 `null`，由 Renderer 按文档类型注册的能力决定显示（例如有文档历史的类型显示“已生效”并进历史）。
- 不负责：接受、拒绝、撤回或恢复。它们仍由 Markdown 修订、文档历史等 owner 执行。
- 上限：每个根运行按账本上限 200 项读取，超出时 `truncated` 为 true，界面须说明列表不完整。

```bash
pnpm exec vitest run src/app-hosts/linnya/application/run-document-changes
```
