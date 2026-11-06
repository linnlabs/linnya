# Markdown 引用组合

本入口组合 Markdown 正文/Pending 生命周期、Workspace 稳定身份和通用引用索引。每个 SQLite 实例拥有独立 runtime，`getMarkdownDocumentReferenceRuntime(db)` 供可信 file-read 投递观察点与 file-write adapter 共用；禁止由模型提供 readerId 或伪造读取凭据。

runtime由SDK的数据库级读取作用域登记，终态由Flow/child生命周期释放，暂停及awaiting_user保留；sourceKey仍包含版本，不能靠去掉版本掩盖陈旧写入。

readerId 为 `JSON.stringify([conversationId, runId])`。sourceKey 包含同次读取的完整正文、Pending 和版本；投递观察点登记返回 metadata 中的 bindings，不重新读取当前路径，以免异步投递窗口中的 rename 隐藏过时输入。文件工具的最终同事务写入同时核验完整来源快照及已接纳路径。

启动与 `createMarkdownDocumentStore` 绑定 capabilities；Markdown 服务通过窄 port 维护索引，不直接读 Workspace 或 Core 引用表。同步 VFS 不加载 Tiptap/DOM，只在有引用的 Pending 中复用 Node target WASM 同步解析。
