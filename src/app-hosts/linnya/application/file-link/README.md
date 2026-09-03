# Conversation File Link Use Case

该 app-host use case 拥有回答中文件 locator 的 metadata resolve 与物理文件 reveal 编排。共享 wire 合同位于
`packages/schemas/src/conversation/file-link.ts`，文件地址格式继续由 `packages/schemas/src/file-locator.ts` 拥有。

Workspace resolve 先按 `conversation_id` 读取持久化的 `project_id`，再在该项目 VFS 中精确解析 path；它不
读取正文、不按当前 Renderer 项目猜测，也不扫描相似文件。返回值只包含内部导航所需的 node identity、
node type、真实标题和 parent identity。

Conversation/Host resolve 与 reveal 复用 `file-read` 的普通文件检查。Conversation 文件必须在
work-directory admission 回调内完成 symlink 与 realpath containment 校验；Host 文件遵循操作系统 symlink
语义，但最终目标仍必须是普通文件。绝对路径只在 backend 内流转，reveal 时 admission 必须覆盖
`shell.showItemInFolder` 调用，避免目录清理与迟到 shell 操作竞态。

该 use case 不启动默认应用，不接纳 Workspace folder/system view，也不提供从 `linnya://`、inode、
documentId 或裸路径到 locator 的兼容转换。
