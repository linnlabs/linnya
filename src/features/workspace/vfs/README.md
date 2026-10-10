# Workspace VFS

Workspace VFS 是项目节点树的路径投影和文档类型能力调度层。它不拥有文档正文，也不把 path 当作稳定身份：用户/Agent 使用 `workspace:/...` 表达当前地址，内部 inode `workspace:<workspace_node_id>` 表达稳定节点身份。

主要入口：

- `listWorkspaceVfsNodes`：列出项目路径节点；
- `resolveWorkspaceVfsNode`：按 path 或 inode 解析；
- `readWorkspaceVfsNode`：调用对应文档类型的文本投影；
- `grepWorkspaceVfsSearchIndex`：维护并查询按 `project_id + inode + path` 分区的行级搜索索引。

## grep 的搜索范围与索引覆盖

指定单文件 path/inode 时，`searchWorkspaceVfsNodes` 直接搜索当前完整 VFS 文本投影（Markdown 包含 pending），不使用目录的前缀索引。目录搜索保持有界：节点遍历预算、每文件 120,000 字符、trigram 候选预算和命中输出上限分别限制工作量。无索引数据库的目录扫描使用同样的文件前缀预算；不因使用哪条执行路径而改变完整性声明。

`truncated=true` 表示搜索范围或命中输出未完整覆盖，包含文件尾部未索引、节点未遍历、读取失败、候选预算耗尽和未返回的匹配。零命中与完整性是两个独立事实；任何未搜范围都不能被解释为“全文不存在”。指定文件是越过目录前缀限制的继续入口，仍受 `max_results` 输出上限控制。

`workspace_vfs_search_files` 按 project/inode 保存索引版本、节点版本、path、字符预算与实际截断事实，空文件也有覆盖记录。新启动通过现有 SchemaProvider 幂等创建此表；旧 lines/grams 没有覆盖记录时，即使 `updated_at` 未变也会重建。索引版本或字符预算改变也会重建；缓存命中保留真实 `truncated_files`。查询只接纳当前索引版本且本轮遍历过的节点。异步正文读取在本次索引写入 savepoint 之外完成；每个文件以同步 SQLite savepoint 原子替换 lines/grams 与覆盖记录，避免逐行、逐 gram 隐式提交。失败回滚并保留原始错误；旧完整索引保留且继续受版本检查约束，首次失败不留下半成品。savepoint 不提交调用方已有事务。此表是可重建索引，不改文档或历史工具结果。

显式单文件扫描会重新生成该文件的完整投影，适合在已定位材料中找出处；目录索引仍负责控制批量索引体积。当前 VFS provider 本就先物化正文再进行字符截断，因此目录预算限制的是索引大小，不应宣称它是流式读取或底层内存上限。

节点改名或同项目移动后，索引会在下一次完整遍历/读取时更新 path。跨项目转移必须更严格：来源项目可能因 5000 节点预算截断而无法完成全量 stale cleanup，因此 `node-transfer` 在同一数据库事务内调用公开能力 `invalidateWorkspaceVfsSearchIndexNodes`，按受影响 workspace inode 删除来源 files/lines/grams。目标项目在下一次 grep 时按新的 project/path 重建索引。

禁止事项：

- 不能在索引里把 path 提升为文档身份；
- 不能在来源项目保留跨项目转移后的可点击旧结果；
- VFS 不迁移或解释 Knowledge、Conversation、Todo、项目级资产关系；
- 新文档类型通过公开 document type hook 提供投影，VFS 不硬编码插件私有格式。

业务验证入口：`src/tools/workspace/grep/workspaceGrepCoverage.integration.test.ts`（真实 SQLite、正式 VFS/工具结果、当前写入投影、缓存及迁移）与 `node-transfer/__tests__/workspaceNodeTransfer.test.ts`（事务内跨项目失效）。
