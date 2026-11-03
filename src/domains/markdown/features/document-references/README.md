# Markdown 文档引用

`documentReference` 是行内 atom，只持久化 `documentId` 和独立的 `referenceId`。名称、类型、项目边界与路径不进入正文属性。Markdown 只通过数据库作用域的 `MarkdownDocumentReferencesPort` 请求投影、准入和反向索引；Workspace 路径和通用引用关系由 Host 组合，不在本域直接读其他领域表。

正文版本、未决修订和引用索引在同一 SQLite 事务内更新。baseline 与 pending 都仍可见，因此两者的引用共同参与索引；拒绝、接受、取消插入或 orphan 清理后立即收敛。恢复旧版本只允许实际持久化历史中相同 appearance/target 配对，不授予新引用跨项目权限，也不建立永久失效墓碑。

Agent 读取投影为当前名称和 `workspace:` 链接。VFS 的 `metadata.documentReferences` 与 DocumentView 的 `data.details.documentReferences` 提供同次读取的 sourceKey、bindings 和不可投影 appearance IDs；可信 Host 在实际投递到 conversation/run 时登记。没有可信读取时，替换已有标签正文明确返回 `reference_read_required`。读取后旧路径改名、移动或被新文档复用，后续写旧路径返回 `reference_path_changed`。异步图片、来源与 Markdown 准备结束后，在提交事务中再次检查路径和完整来源版本。

Pending 的 Markdown 是修订意图真源，`document_reference_bindings` 仅保存已经准入的稳定身份。读预览时复用正式 Node WASM parser、schema 和 bindings 恢复 atom，再投影当前标题/路径。接受修订按这份持久绑定恢复身份，绝不重新解析旧路径指向哪个文档。部分决策按实际剩余节点刷新绑定，已移除的 appearance 不继续占用索引；相同 Markdown 的多个提案块按 targetIndex 绑定，不复用 appearance。失效/越界 atom 无法无损投影成链接，因此全文替换明确拒绝，部分处理改用整块接受/拒绝；独立 UI 操作与保存原 canonical 节点不受影响。

`markdownDocumentReferences.integration.test.ts` 经过真实创建/写入 provider、SQLite、WASM、Pending 接受/拒绝、同路径替换与回滚验证完整链路。Renderer Revision 的真实 parser→projection→diff→节点物化用同一纯 JSON bindings 规则。
