# 文档标签

文档区顶部的标签栏状态：每个项目各自一组已打开的文档，只在内存里，重启不恢复，没有数量上限。

- 单击打开的是临时标签（斜体），下一次打开新文档时被替换；双击标签、双击侧栏条目或第一次编辑后固定。
- 新标签插在当前标签右侧；关闭当前标签后回到最近用过的标签，一个不剩时关闭文档区域。
- 放不下时横向滚动，有标签的一端淡出；右端“全部标签”按最近使用列出并可筛选。
- 右键：关闭、关闭其他、关闭右侧、全部关闭、重新打开刚关闭的（最多回溯 20 个）。
- 快捷键：`Ctrl+Tab` / `Ctrl+Shift+Tab` 按最近使用切换，`⌘W` 关闭当前标签，`⇧⌘T` 重新打开（Windows/Linux 用 `Ctrl`）。
- 文档被删除时标签随之移除，不进入“重新打开”记录；项目被删除时整组丢弃。

目录：

- `definitions/`：标签、标签组和关闭结果的类型。
- `functions/`：全部状态变换的纯函数（打开、固定、关闭、重新打开、按最近使用循环、删除）。
- `store/`：按项目存取标签组，以及双击侧栏时“打开后再固定”的待办标记。

标签只记录状态，不打开文档。点标签、关标签、删除后的切换都经 `app/layout/orchestration/documentTabs.ts` 回到正式文档导航（`WorkspaceNavigationPort.openDocument` / `closeWorkspaceDocument`），任何来源打开的文档都通过监听活动文档记成标签。

验证入口：`pnpm exec vitest run apps/renderer/app/document-tabs apps/renderer/app/layout/orchestration/workspaceNodeDeletion.test.ts`。
