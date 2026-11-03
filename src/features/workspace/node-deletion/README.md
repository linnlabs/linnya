# 删除节点范围

`readActiveWorkspaceSubtreeNodeIds` 是删除与删除前影响预览共用的活动节点范围。范围包含未展开后代，重叠选择按稳定 ID 去重；软删除节点不重新进入范围。WorkspaceService 在同一个同步事务中读取范围、标记删除并在提交后发布既有 mutation。

跨领域的引用提醒由 Host 组合此范围与 Document References 的只读预览，Workspace 不读取引用表或解析文档内容。
