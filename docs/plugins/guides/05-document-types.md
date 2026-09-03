# 05 · 文档类型插件

> 适用场景：插件拥有自己的文件格式（自带后缀），需要创建/打开/写入/读取/搜索全链路。

文档格式插件需要**同时**声明前端 document type 和后端 document type hook。

## 前端 DocumentTypeContribution

负责：

- 文件树与新建菜单的展示名、图标和排序。
- active document type、file session type、create request type。
- surface component。
- file handler。
- 跨插件引用实体声明。

host UI（工具卡、header、pageContext 等）显示文档类型信息时必须从 documentType 注册表读取 label/icon，**不要**在组件里按类型字符串写 switch（审计 F-08 为现存反例）。

这里的 surface 是通用 **Document Surface** contribution。平台 Markdown 文档的具体实现名为 `MarkdownDocumentSurface`，其 Tiptap/ProseMirror 实例通过独立的 `markdownDocumentEditorRuntimePort` 交给 Markdown file handler；这个 port 不是插件合同。插件应拥有自己的 renderer runtime，并在通用 surface ready 后由本类型 file handler 完成进一步准入。

## 后端 DocumentTypeBackendHook

类型契约真源在契约包 `packages/plugin-host-contract/backend/documentTypeBackendHook.ts`（插件经 `@plugin/backend/documentTypeBackendHook` 消费）；宿主注册表在 `src/plugin-sdk/backend/documentTypeBackendHook.ts`。hook 负责：

- `createDocument` / `writeDocument` / `duplicateDocument`：创建、写入、复制。
- `readDocument`：给 `read_file(view="document")` 的结构化读取模式读取。
- `readVfsContent`：给 VFS/read/grep 读取事实文本。
- `readEditorDocument` / `writeEditorDocument`：编辑器 surface 的读写入口（与给 tool/VFS 用的 `readDocument`/`readVfsContent` 是不同入口，sheet/slides 均实现）。
- `readProjectCharCount`：项目字符统计。
- `fileExtension` / `systemView`：文件后缀与系统视图。

## 关键边界

- **创建和写入必须走 enabled hook**。插件未启用或未安装时，宿主应报告「不支持/插件不可用」，不能保存错误格式。
- **插件生命周期的原子性由 hook 自己负责。** Host 不会在 `better-sqlite3` 同步事务回调里 `await createDocument` / `duplicateDocument`；插件必须在 hook 内原子维护节点、私有内容和事实文本快照。永久内建 Markdown provider 则由 Host 在同步事务内同时提交节点和正文。
- **读取入口不得在 hook 前写核心类型白名单**。`read_file(view="document")`、普通 `read_file`/grep/VFS、workspace metadata 和引用解析都必须先确认 workspace node 存在，再按核心 reader 或已注册 `DocumentTypeBackendHook` 分发；未知插件类型返回明确诊断，不能被 host 提前判成 `Document not found`。
- **Editor 入口不能把 hook 缺失解释为 Markdown。** Host resolver 会先匹配永久内建 Markdown provider，再匹配插件 Editor hook；未知类型、插件禁用或缺少 `readEditorDocument` / `writeEditorDocument` 时必须明确拒绝，防止非 Markdown 节点误写 `document_versions`。
- **通用文件写入同样只按正式节点类型分派。** `write_file` / `edit_file` 在 VFS 已解析出节点后，Host resolver 才选择内建 Markdown provider 或插件 `writeDocument`；不得根据 `.md` 后缀、`text/markdown` MIME 或预览正文猜测文档身份。插件、Web、Knowledge 与会话文件都可以返回 Markdown 格式文本，但不会因此进入平台 Markdown 的版本和 pending 生命周期。
- **只有缺失路径创建可以按扩展名选 provider。** 此时还没有节点身份，Host 依据插件声明的 `fileExtension(s)` 或内建 Markdown 创建约定选择 `createDocument`；创建成功后立刻以持久化节点类型为准。插件 hook 必须原子提交节点、私有正文和事实文本快照，Host 不为异步 hook 包伪同步事务。
- 通用 workspace tools、VFS、read/grep/create/write 不 import 具体插件实现，只按文档类型查询 hook。Markdown 是无插件的平台默认格式；任何其他文档类型都必须由已装配插件的 `DocumentTypeBackendHook` 提供，不能因为下游仓库里存在源码就把它当作平台内建格式。
- VFS / read / grep 的节点可见性与禁用文案走**统一的插件节点访问策略**，由 `formatOwnershipCatalog` + 插件运行态驱动；禁止按具体插件硬编码节点类型分支。新代码一律引用 `pluginWorkspaceVfsNodeTypeAccessPolicy.ts` 这份通用实现。
- `ownedFileTypes` 是格式归属目录，插件 missing 时仍可用于提示「这个文件由哪个插件支持」。
- 读取和搜索既有事实可以走 host 的 `workspace_node_text_snapshots` 降级。这个快照只服务 read/grep，不代表插件可以编辑。
- 插件启用时，创建和更新应同步写入事实文本快照，建议由插件自己的 DocumentService 在同一事务里保存。
- `workspace:create-document` 的默认名称来自 hook 的 `displayName` / `fileExtension`，不在 workspace IPC 里按具体插件写“未命名演示文稿”这类字符串。
- AI project metadata 与前端引用不维护 `markdown/mindmap` 二元模型：文档类型、图标、可定位引用能力都从 document type registry / document reference runtime 读取。新增文档类型时，Host 不应再改 conversation 组件里的 switch。

## ToolContext 派生（与通用工具协作时）

宿主工具调用 hook 前若需要派生 `ToolContext`（例如补 `workspaceService`），必须使用 `derivePluginAwareToolContext`，禁止 `{ ...context }` 裸 spread——细则见 [07 工具与 ToolContext](./07-tools.md)。

hook 实现侧的纪律：**不要从 `ToolContext` 公开插件专属 service 后门，也不要自建全局缓存实例**。Document hook 不经过 tool decorator；需要文档服务时，应基于 hook 收到的 `databaseService` / `workspaceService` 构造无状态服务，或消费插件自己的 runtime effect 绑定。能由同一 SQLite 与 workspace port 重新构造的轻量 document service 不属于 fallback；真正危险的是“绑定缺失就 new 一个全局单例并缓存”，那会制造双实例和状态分裂。

平台 Markdown 遵守同一装配纪律：它是永久内建 provider，不是插件，但其 store/normalizer 也不进入 ToolContext。Host adapter 基于本次调用的正式数据库构造短生命周期 provider。`text/markdown` 预览无需也不得构造该 provider；只有正式文档节点身份或缺失路径的明确 Markdown 创建声明才进入有状态文档链。
