# Workspace Node Transfer

本 feature 拥有“文件或文件夹保持身份转移到另一个项目根目录”的后端用例。

一期合同：

- 输入只有 `nodeId + targetProjectId`；目标 parent 固定为 `null`；
- 来源节点必须存在且属于有效项目，目标项目必须存在且不同；
- 目标根目录同名时拒绝，不覆盖、合并或自动改名；
- 文件夹连同所有后代在一个 immediate transaction 中更新 `project_id`；根节点 `parent_id` 置空；
- 已软删除的历史后代也更新 project，避免制造父子跨项目关系；对外 `movedNodeIds` 只包含活动节点；
- node id、文档内容表和插件卫星表关系保持不变；项目级 Knowledge/Conversation/Todo/asset 关系不迁移；
- 来源 VFS search index 在同一事务内按 inode 失效；
- 事务提交后重查最终状态，再发布一个 `workspace.node.transferred`。

`inspectWorkspaceNodeTransfer` 只服务 Renderer “活动文档先保存”的预检。`transferWorkspaceNode` 必须在写事务内重新执行全部校验；禁止信任预检结果，也禁止在 IPC 层直接写表。

同项目父目录移动不属于本 feature，由 `node-move/orchestration/moveWorkspaceNode.ts` 拥有查询、校验和写入，`WorkspaceService` 只做薄委托与 mutation 发布。跨项目转移不能复用 `move-node`，因为后者的正式语义是同一个 project 内改变 parent。
