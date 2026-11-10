# Workspace Document Activity

本 feature 负责 Workspace 文档的最近打开列表和访问元数据更新。

可参与最近文档的 node type 来自内置类型与已注册的 DocumentType backend hook；项目过滤在 SQL 层完成，保证 limit 的语义准确。Electron `WorkspaceService` 仅保留兼容委托。

打开文档只更新最近打开时间和访问次数，不改 `updated_at`：节点时间表示正文、名称或位置的改动，项目概览的“最近修改”和搜索索引的新旧判断都依赖它。
