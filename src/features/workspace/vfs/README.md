# Workspace VFS

Workspace VFS 是项目节点树的路径投影和文档类型能力调度层。它不拥有文档正文，也不把 path 当作稳定身份：用户/Agent 使用 `workspace:/...` 表达当前地址，内部 inode `workspace:<workspace_node_id>` 表达稳定节点身份。

Host 的研究交接通过公开 index 读取同一次 Markdown current 正文和 Citation projection，包含 pending；
必须拒绝 `truncated`，不能对窗口文本打完整版本戳。内容与引用版本绑定归 Host 应用用例，VFS 不持有研究阶段状态。

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

## 调用方节点访问范围

Host 在每次工具调用入口取得当前范围，按本次操作传入 `WorkspaceVfsNodeAccessScope.excludedNodeIds`，其中只保存真实
`workspace_nodes.id`，不保存文件名或路径。VFS 不解释业务阶段；普通调用省略范围保持原行为。
限制同时适用于节点的 `workspace:<id>` 身份和带有 `payload.workspaceNodeId` 的系统视图，
因此重命名、同项目移动和 `.linnya/views/by-inode` 别名不会解除限制。

列表在分页前移除受限节点；显式 path/inode 解析抛出 `WorkspaceVfsNodeAccessDeniedError`，
不能把拒绝当作“路径缺失”，否则 `write_file` 可能错误地进入新建流程。文本读取、DocumentView
身份确认和写入前解析共用这一边界。范围按节点身份约束，不是目录子树授权或操作系统沙箱。

搜索索引仍维护项目完整事实，调用方范围只作用于候选 SQL，且在 `LIMIT` 之前排除真实节点和
对应系统视图。受限调用不得删除其他调用方可见的共享索引；无索引搜索在读取正文前过滤节点。
