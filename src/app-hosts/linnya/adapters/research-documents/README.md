# Research document adapter

Research 的文档端口属于 `application/research/definitions/researchDocumentPort.ts`；本 adapter
仅连接 Workspace、Markdown、Citation 和 EventStore 的正式入口，不保存阶段游标或解释评审结论。

版本表示固定为 `workspace-markdown-current-v1`。一次 VFS 读取提供包含 pending、批注和 canonical
Citation token 的完整 current 正文，以及同视图的完整 Citation sources/diagnostics。SHA-256 绑定
表示、内容类型、正文和引用快照 hash；inode 单独保存，重命名不会被误认为换稿。它不是数据库 revision，
也不能充当写入锁。读取范围与普通文件读取的 source admission 同为 20 Mi 字符；缺稿、空稿、截断和
invalid citation 均不进入交接。来源快照不代表来源已经联网复核，摘录缺失等诊断仍保持原义。

研究角色不持有正式 Workspace mutation 工具。每阶段的主要 Markdown 正文由 Host 从 finalAnswer
送入正式 create-only provider，写入预定新路径；同名冲突失败，不覆盖、不自动重命名。
保存只表示正文已存入 Workspace，不表示内容正确或评审通过。共享 Shell/Process 仍不是操作系统隔离。

保存必须给出产出回答的 conversationId/sourceRunId。adapter 从正式 EventStore 分页读取该 run
的 producer facts，复用 Citation resolver 和 Markdown hydration；不读取协调者或同伴 run 的引用，
不进行跨 run Evidence fallback。跨会话交接必须通过正式 read_file 重读文档并绑定当前作用域 ref，
裸短 ref、旧 blob 调用或路径不能替代这个入口。Host 的完整读取仅用于版本核对，不能作为模型已经
读完原文的证据。

创建复用 document-file-create provider 的 `resultCommit` 同步事务合同：调用方的 `receipt.prepare`
在异步编译前核对已准备的阶段身份，不能作为输入版本锁；新稿正文、稳定 inode 与引用进入同一事务后，adapter 同步回读正式
Markdown current 投影，并调用 `receipt.commit(binding)`。回调不得异步，失败与新稿一起回滚。
研究 receipt 必须使用同一个 Workspace SQLite 连接，在 `commit` 内同步核对阶段与输入绑定；不能把
异步写 receipt 当成原子交接。应用用例保存时发现 stale 可保留独立候选与旧绑定，但不得接纳后继。

应用用例在后继接纳前比较 inode、representation、sha256；输入变化时保留独立候选稿和旧版绑定，
停止旧版后继。阶段 receipt 负责恢复时证明既有产物身份，本 adapter 不根据同名路径猜测成功。
