# App Host File Read Use Case

该 use case 负责把操作系统普通文件变成 `read_file` 可消费的稳定文本或图片事实。它是
Workspace VFS、conversation 工作目录、Assets 和工具运行时之间的 app-level 编排边界，
不是新的文件数据库，也不拥有 locator 语法。

## 责任边界

- locator owner 先把 `conversation:` 或 `file:` 解析为宿主绝对路径；本 use case 不猜地址空间；
- conversation 调用必须位于现有 work-directory lifecycle admission 回调内，并提供 root 约束；
- Node adapter 在打开前拒绝目录、FIFO、socket 和设备文件，文本执行 20 MiB 门禁与 strict UTF-8；
- host 文件遵循操作系统 symlink 语义，结果保留调用方 locator，真实 target 只作为内部读取事实；
- 图片只用现有 magic bytes 能力做分支，完整解码、10 MiB / 40 MP 门禁、内容寻址登记继续归
  `managed-image-ingress`；模型附件继续使用 tool-call scoped claim；
- 图片 ingress 得到内容 SHA-256 后，只查询 admitted working history 中当前 run 的正式附件事实；相同像素
  已附加时返回 `attachment_status=already_attached` 且不再签发 claim。其他 run、已被压缩移除的附件或仅同名文件
  都不能命中；
- PDF、Office、压缩包、数据库和可执行文件不在 generic Read 内提取，由 Shell/CLI 显式转换。

普通文本在该 use case 中统一投影为 1-based 行窗口，`offset/limit` 分别表示起始行和最大行数；
模型看到的 `行号 | 原文` 前缀只用于定位，不属于文件字节。Workspace DocumentView 是不同的结构化
读取合同，只使用 `offset_chars/max_chars`。图片不得携带其中任何一种窗口字段。超长 observation 的
持久化和字符 cursor 续读仍归 ToolOutputStore，file-read 不复制该能力。

普通文本的源分页提示排在正文后、Citation 附录前；正文到末行但仍附来源时明确标注源 EOF。
附录保持同次读取自包含，不因曾经返回过来源就省掉快照，也不从附录字符量生成新的文件行号。

普通文本的 `text_metrics.window` 只数本次实际返回的裸正文窗口；`full_text` 数同一次读取已取得的完整
源文本。字符按 Unicode code point（含空白与标点），汉字按 `Script=Han`；物理全文保留已解码的源换行，
行窗口使用既有 LF 投影。计量在加入行号、来源附录和分页提示之前完成，正文 ref 别名变换后计窗口，
完整源文本不会因跨会话别名改写而变化。DocumentView 与图片不从展示文本推造这两项值。

## Citation 投影边界

Workspace 文档中的 `CitationNode` 是 Editor 自包含的持久化快照：ref、Knowledge `docId + blockId`、Web
URL、标题和摘录都随文档保存，目录路径不参与来源身份。因此文件移动或重命名不会破坏原引用。

`read_file` 先在未添加展示行号的原始行窗口上完成 Citation 选择，再把文档交给某个 Conversation，调用 Citation allocator 为这些稳定来源分配当前 Conversation
的 6 位别名，并只改写本次返回的正文、DocumentView、citation facts 与 diagnostics。该过程不回写 Editor
文档，也不从旧 ref 猜来源。这样文档可脱离原 Conversation 独立存在，同时进入新 Conversation 后仍满足
ref 唯一性。正文改写复用 Citation domain 的 Markdown parser，fenced/inline code 中的 `[@ref]` 示例保持
普通代码。`grep` 和 pending diff 继续遮罩 citation，不构成旁路 producer。

Host `file:` 读取需要注入内部存储访问 port 和当前 run 的权限快照。Node adapter 先解析
真实目标，再在读取文件头、正文或导入图片前等待授权：1/2 档访问内部存储须审批，完全访问
直接放行；外部普通文件保持原读取行为。授权规则由 App Host adapter 与 Commands 公共审批
合同承担，本 use case 只传递上下文，不复制规则。`conversation:` 继续在原生命周期准入内
执行目录包含检查和 leaf symlink 拒绝，不把等待用户审批放进删除屏障。
