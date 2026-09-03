# Workspace Document Read

`document-read` 是 Workspace domain 内的结构化文档读取调度 feature。它拥有 Workspace 节点确认、文档类型分派和统一结果 admission，不拥有任何文档类型的内部投影规则，也不拥有 Agent 工具名或 URI 路由。

## 两种读取投影

Workspace 文档对 Agent 有两种不同合同，不能因为都返回文本就合并实现：

- `DocumentTypeBackendHook.readVfsContent` 提供“代码即文档”的事实文本，供 `read_file`、`grep` 和 VFS 使用。
- `DocumentTypeBackendHook.readDocument` 提供结构化 DocumentView，可包含稳定 block/node ref、outline、pending diff、插件 presentation 和图片 locator 清单。

Markdown 图片清单只表达文档私有媒体事实：block id、`doc-image` locator、alt 和尺寸。正常插图流程不创建 asset 身份，因此 DocumentView 不输出 `assetId`，也不把 locator 提升为跨文档读取协议。

Markdown 是永久启用的平台内建文档领域，不是插件。它的块身份、outline、pending preview、DocumentView 和 Citation 视图由 `src/domains/markdown/features/document-read` 拥有；Workspace 当前只装配该公开 provider。插件文档按 docType 查询 backend hook。插件禁用时只能读取已经持久化的 `workspace_node_text_snapshots`，不能借读取链重新启用插件或猜测私有格式。

`text/markdown` 是一种可复用的文本内容格式，不等于 Markdown 文档实体。Web、Knowledge、会话文件或插件可以返回 Markdown 格式文本并由各自界面预览；只有依赖 `document_versions`、rootBlock identity、pending revisions 和批注的能力才进入 Markdown 文档领域。

## 数据流

```text
Agent Tool / 内部调用方
  -> 参数 admission 与 plugin-aware ToolContext 派生
  -> Host document-type provider resolver
     -> 永久内建 Markdown provider（恒定启用）
     -> 或插件 readDocument hook（保留 enabled）
  -> readWorkspaceDocumentView(request, dependencies)
     -> workspace_nodes 身份确认
     -> 已解析的统一 document-type provider
     -> Markdown domain 内部执行：
        -> normalization
        -> base CitationMark + pending citation_hydration 同视图 admission
        -> citation-aware blocks -> pending preview -> refs/presentation
     -> 或禁用态事实文本快照
  -> WorkspaceDocumentReadResultSchema
```

`readWorkspaceDocumentView` 返回正式结果对象，不返回 JSON 字符串。Tool facade 才负责 wire 序列化，避免 domain feature 依赖工具协议。

本 feature 与 VFS 普通文本投影保持两条明确合同：`readVfsContent` 服务 `read_file` 默认读取和 `grep`，`readWorkspaceDocumentView` 服务显式请求的结构化读取。不能把 DocumentView 默认塞进普通 `read_file`，否则会破坏编辑流程依赖的精确文本。

底层 `serializeRootBlockToMarkdown` 只提供 Markdown 结构序列化所需的可选 inline projector。它不知道 CitationMark、
Knowledge 或 Web；Citation-aware 阅读由 Markdown document-read orchestration 调用 Citation public contract 后
注入 projector。每次正文序列化创建独立 projector，避免 VFS text 与 DocumentView 共享“已输出”状态。
在 pending revision 的 hydration facts 与 base content 尚未合成同一 admitted view 前，不得只给 base
blocks 开启 Citation 投影，否则 preview 会出现正文与 metadata 分叉。

Markdown domain 的 `buildMarkdownCitationReadProjection` 已提供该纯装配：original 只接纳 persisted Mark；preview 按正式
`pending.operation` 排除 update/delete 覆盖的旧 Mark，并从当前 pending Markdown 与 hydration 建立
新 facts。缺 hydration 的 canonical token 输出 explicit invalid marker。

Markdown DocumentView 已一次性接入 citation-aware blocks、正文窗口选择、独立预算 source appendix 与
显式 diagnostics。`WorkspaceDocumentReadResultSchema` 的 `citationSources/citationDiagnostics` 是 provider
结果事实，不含 Agent turn 的全局 `index`；`read_file` facade 才能在 Host sequence admission 后生成
最终 wire citations。历史 replay schema 没有增加这些 live 字段。

普通 VFS text 仍保持独立的代码即文档结果形状，并由 Markdown domain 的 `readMarkdownVfsContent`
读取版本、pending 和同一 admitted citation projection；Workspace VFS 不查询 Markdown 表。默认
`read_file` 先按正文字符 cursor 裁剪，再为窗口内完整 token 构建来源、预算与 diagnostics；不会把
DocumentView 的 XML、块 ref 或 presentation 塞进默认 text。

`pendingDiffs` 是旁路详情，不拥有正文窗口 metadata，因此 citation ref 会显示为中性
`【citation】`。可引用 token 只来自 DocumentView/普通 text 的正式正文及同结果 citation facts。

## 目录职责

- `definitions/`：请求、结果别名和窗口常量。
- `functions/`：Workspace observation、Citation wire projection 等通用结果转换。
- `orchestration/`：节点确认、provider 调用、快照 fallback 和统一结果 admission。
- `src/app-hosts/linnya/adapters/document-read/`：组合内建 provider 与插件 hook；这里拥有跨领域调度，不下沉到 Workspace 或 Markdown。
- `src/domains/markdown/features/document-read/`：Markdown 文档实例的 DocumentView、outline、pending preview/diff、presentation 与 Citation 读取投影。

## 迁移边界

`read_file(view="document")` 是结构化 DocumentView 的唯一入口，通过 Workspace tool adapter 调用本 feature。该 adapter 只把工具参数交给 Host provider resolver，不 import 或实例化 Markdown service。Workspace 文档身份使用 VFS path/inode，不经过 URI parser 或跨领域 dispatcher。
