# Workspace Project Lifecycle

本 feature 管理 Workspace 项目的创建、默认项目初始化、更新、列表和物理删除规则。

- 默认项目身份由 `projects.system_role` 表达，不能依赖显示名称；
- 默认项目禁止删除；普通项目删除依赖数据库外键级联；
- 历史软删除项目只在同名重建时清理，避免旧生命周期污染当前唯一性规则；
- Electron `WorkspaceService` 只保留兼容门面，具体规则由本 feature 持有。
