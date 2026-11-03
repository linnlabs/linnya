# 文档间引用的 Renderer 能力

本 domain 展示文档之间的正式反向索引，不拥有正文、树或插件生命周期。`DocumentBacklinksPanel`
由 App 文档菜单装配，图标通过窄展示回调传入；Panel 不读取插件 store。

列表通过 `@plugin/renderer/documentReferences.readDocumentBacklinks`
按来源文档分页，聚合同一来源里的多处引用，并展示文档数与引用数。Backend 复用已有 typed
backlinks 与当前项目过滤；已删除或越界来源不展示。Workspace 正式事件触发重新读取，导航前再次核对来源身份，关闭面板后异步结果失效。来源插件停用时可进入已有插件可用性界面，引用关系仍保留。

行内 atom、@ 候选与悬浮预览仍由 Editor 的 document-references
feature 拥有；后端身份规则与 SQLite 索引由 `src/domains/document-references`
拥有。
