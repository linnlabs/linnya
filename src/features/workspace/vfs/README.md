# Workspace VFS

Workspace VFS 是项目节点树的路径投影和文档类型能力调度层。它不拥有文档正文，也不把 path 当作稳定身份：用户/Agent 使用 `workspace:/...` 表达当前地址，内部 inode `workspace:<workspace_node_id>` 表达稳定节点身份。

主要入口：

- `listWorkspaceVfsNodes`：列出项目路径节点；
- `resolveWorkspaceVfsNode`：按 path 或 inode 解析；
- `readWorkspaceVfsNode`：调用对应文档类型的文本投影；
- `grepWorkspaceVfsSearchIndex`：维护并查询按 `project_id + inode + path` 分区的行级搜索索引。

节点改名或同项目移动后，索引会在下一次完整遍历/读取时更新 path。跨项目转移必须更严格：来源项目可能因 5000 节点预算截断而无法完成全量 stale cleanup，因此 `node-transfer` 在同一数据库事务内调用公开能力 `invalidateWorkspaceVfsSearchIndexNodes`，按受影响 workspace inode 删除来源 lines/grams。目标项目在下一次 grep 时按新的 project/path 重建索引。

禁止事项：

- 不能在索引里把 path 提升为文档身份；
- 不能在来源项目保留跨项目转移后的可点击旧结果；
- VFS 不迁移或解释 Knowledge、Conversation、Todo、项目级资产关系；
- 新文档类型通过公开 document type hook 提供投影，VFS 不硬编码插件私有格式。
