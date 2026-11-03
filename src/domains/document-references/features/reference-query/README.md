# 文档引用候选与展示

本 feature 提供同项目活动文档的名称候选及稳定身份的当前标题、路径、可用状态。数据由 Workspace 窄投影提供；不读文档正文。删除、越界、插件不可用分别表达，越界时不返回目标标题和路径。停用插件仍保留身份牌，重新启用后恢复打开。

Renderer 与插件统一通过 `@plugin/renderer/documentReferences` 的 `queryDocumentReferences` / `readDocumentReference` 消费。选择后持久化 documentId；候选里的 title/path 只作当时展示。所有文档类型可使用该候选，不按调用插件维护另一套搜索或类型判断。名称中的 `%`、`_`、`!` 作为字面搜索，不能扩展 SQL 模式。

候选优先按 Workspace 正式 last_opened_at 排序，再按 updated_at 与名称排序；不另存“最近”状态。`readDocumentBacklinks` 复用 reference-index 的 typed 反向关系，先核对目标当前项目，再按来源文档聚合、分页；同一来源中的行内标签、卡片引用统一计数，来源被软删或移动越界时由索引读取规则过滤。
