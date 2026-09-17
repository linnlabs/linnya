# Markdown 文档会话

本 feature 是 Renderer 中 Markdown 文档打开、数据库快照刷新、草稿保存及修订提交的唯一生命周期 owner。Workspace file-manager 负责文档类型分派与导航顺序，App mutation orchestration 只转发数据库变更通知，Revision 负责显示投影；这些调用方不再自行拼接或合并文档 JSON。

## 状态与流程

每次打开生成独立会话身份，绑定 documentId、最后安装的正文/Pending 快照、正文基线和 UI 通知端口。即使 A→B→A 复用同一个 Editor，旧 A 的异步响应也不属于新的 A。关闭首先解除身份，再通过同一个串行队列清理投影。

打开、刷新、保存、决策及按需投影共用 Editor 域的 `serializeEditorMutation`。每次异步读取后都验证会话归属，首开、刷新和提交结果共用同一个基线安装端口，确保大文档虚拟化准备不会只在首开执行。完整打开流程可被调用方等待；禁止使用未等待的 nextTick 异步任务完成正文安装。

快照包含严格校验后的正文、Pending 清单和正文版本。空 Pending 清单同样是必须安装的完整事实。正文与 Pending 都未变时无需重建编辑器。批注位于正文 rootBlock attrs，随同一份快照更新，不再独立发起第二次读取。

## 本地草稿

Revision 的行内显示不是可保存正文。会话通过 Revision 的公开基线读取方法还原投影，再按 rootBlock 身份把本地草稿与远端基线作三方合并。不同块、独立属性以及无冲突的新增块可以合并；同一内容的并发修改、删除与编辑冲突、并发重排会保留本地内容并报错，不猜测用户意图。

普通自动保存不重置光标或撤销历史。保存期间的新输入继续保留为 dirty；外层 file-manager 不得在 handler 返回成功后无条件清除 dirty。离开文档要求所有本地输入已经落库。

## 提交合同

保存、块决策、全部决策和行内部分决策统一使用 `workspace:commit-markdown-revision`。请求与响应由 `@app/schemas` 校验，正文结构由生产 Markdown/Editor schema 校验。正文版本与 Pending revision 同时作为并发校验条件，防止对旧显示执行新提议。

决策期间暂时停用输入，提交完成后恢复；提交失败保留草稿和 Pending。后端已提交但前端装载失败时，前端不得标记 clean 或把旧视图再次写回。后续刷新必须先解决草稿冲突。数据库提交后的恢复使用正式文档历史，不能靠扫描 mark 重建 Pending。

## 修改地图

- `definitions/`：会话状态合同。
- `store/`：Editor 与会话绑定、快照状态更新。
- `orchestration/`：打开、刷新、保存、提交和关闭流程。
- Editor 域 `functions/rebaseEditorDocument.ts`：可测试的文档合并规则，同时供 Revision 投影还原使用。
- `__tests__/markdownDocumentSession.test.ts`：真实 Tiptap/ProseMirror 的生命周期与并发回归。
