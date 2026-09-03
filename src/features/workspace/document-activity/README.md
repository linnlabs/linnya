# Workspace Document Activity

本 feature 负责 Workspace 文档的最近打开列表和访问元数据更新。

可参与最近文档的 node type 来自内置类型与已注册的 DocumentType backend hook；项目过滤在 SQL 层完成，保证 limit 的语义准确。Electron `WorkspaceService` 仅保留兼容委托。
