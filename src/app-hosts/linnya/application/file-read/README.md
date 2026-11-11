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
- 图片能否附带由 Host 的 `toolResultImagePolicy` 判断（结果交给 Agent 时按本 run 模型在模型目录中的工具结果图片能力，
  CLI 调用方默认接收）；判定为 `metadata_only` 时只校验图片并返回 `attachment_status=not_delivered` 与尺寸，
  不进入 ingress、不签发 claim，observation 明确告知模型没有看到像素；
- PDF 由 Node adapter 按 `%PDF-` 签名识别（100 MiB 门禁），只返回文件身份，不读入正文；按页读取见下节；
- Office、压缩包、数据库和可执行文件不在 generic Read 内提取，由 Shell/CLI 显式转换。

## PDF 按页读取

`read_file` 对 PDF 复用知识库同一套本地 PDF.js 文字层与几何版面（XY-Cut），不调用模型、不做 OCR，
也不经过任何解析 API。[`readPdfForTool`](./orchestration/readPdfForTool.ts) 只认三种请求：

- 默认或 `pages:"a-b"`：按页返回文字层，每页以 `[Page n]` 开头。不给 `pages` 时从第 1 页起；范围最多 20 页，
  超出总页数时截到末页，起始页越界返回 `READ_FILE_PDF_PAGE_OUT_OF_RANGE`。页文字累计超过 15,000 字符或
  900 行时在页边界停下（第一页总会返回），保证结果不被 Host 的 20,000 字符工具输出预览截断；末尾给出下一段
  的完整 `read_file` 调用，提前停下时续读本次请求剩余的页；
- `find`：在 `pages` 范围（默认全书）内查找，NFKC、大小写和空白不敏感，单次最多扫描 300 页、展示 30 处上下文，
  返回命中页列表并提示按页读取；范围未扫完时给出续查调用；
- `view:"page_image"` + 单页 `pages`：把该页渲染为 1536px 长边 JPEG，经 `ingestImageBytes` 内容寻址登记后
  走与普通图片相同的 claim、`already_attached` 和 `not_delivered` 规则。selection id 由 locator 与页码派生。

没有文字层的页列入 `pages_without_text`，版面无法用几何方式稳定排序的页列入 `complex_layout_pages`。
能否看图沿用读图片的同一判断（Host 的 `toolResultImagePolicy`）：可附带图片时，observation 建议对无文字层页用
`page_image`；不可附带时明确说明这些页读不到、不得猜测内容，`page_image` 本身也只返回尺寸（`not_delivered`）。
这里不调用知识库另配的 PDF OCR 或图片理解模型，用户没有配置它们也不影响读取。CLI `tools call` 的调用方默认接收
图片，`page_image` 的原件由 CLI 写成本地文件。文字层原样返回，不承诺表格结构。PDF 参数与
`offset/limit` 互斥（`READ_FILE_PDF_WINDOW_CONFLICT`），用在非 PDF 上返回 `READ_FILE_PDF_OPTION_UNSUPPORTED`，
PDF.js 打不开返回 `READ_FILE_PDF_UNREADABLE`；这些检查在任何副作用之前完成。

页窗口、跨页查找、缓存与串行由 pdfParser 的共用会话
[`pdfTextSession`](../../../../features/parsers/pdfParser/orchestration/pdfTextSession.ts) 提供，`web_read` 读网页下载的
PDF 也用它；本目录只把结果映射成 read_file 的回执与错误码。同一进程内 PDF 解析经 `SerialGate` 串行，避免多次并发读取
叠加 PDF.js 内存；已取得的页文字按 `resolvedPath + byteLength + mtime`（网页下载的 PDF 按 sha256）缓存在
`PdfPageTextCache`（默认 8M 字符、16 份文件，LRU），文件被改写后身份不同，不会读到旧文字。PDF 只在缓存缺页时打开，
读完即关闭，不常驻文档句柄。

参考测量（Apple Silicon，tsx 下）：85 页日文政策文件全书解析约 0.6 秒；70 MB、1492 页的关税表单页读取约
0.5 秒、整本扫描约 27 秒；单页渲染约 70 ms、JPEG 约 170 KB。单页事件循环阻塞约 11–40 ms，首次加载 PDF.js
约 370 ms。

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

Host `file:` 读取遵循当前操作系统用户权限，不增加内部存储专用审批。Shell 中的可见凭据
路径风险提示不约束文件工具，也不构成同用户文件读取隔离。`conversation:` 继续在原生命周期
准入内执行目录包含检查和 leaf symlink 拒绝，不引入额外权限等待。
