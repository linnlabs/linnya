### Workspace 工具概览（显式 locator + Workspace 读写工具）

> 说明：本文件只讲 **Workspace 相关工具的设计与约定**。
>
> 背景：Workspace 文档（Markdown / MindMap）都已经迁移到 `workspace.sqlite`，不再使用旧的 `.ablk` 文件架构。

---

## 1. 工具列表与职责

- **`list_files` / `read_file` / `grep` / `edit_file` / `write_file`**
  - 职责：以 `workspace:/...` locator 或稳定 inode 读写 Workspace 内容。一次调用只能选择其中一个身份；成功结果仍同时返回真实 locator 与 inode。
  - Markdown：`read_file` 读取 preview 内容；`edit_file` / `write_file` 写入 pending revisions，不直接覆盖 `document_versions.content_json`。
  - Citation：带引用 Markdown 的正文统一使用 canonical `[@ref]`，并在同一 `read_file` 结果附带当前窗口的结构化来源、受预算约束的 excerpt 与 diagnostics；`grep` 只定位并遮罩引用 ref。
  - Citation 写入：`write_file/edit_file` 只接纳当前 working history 各 producer 的严格 owner schema，未命中时才读取 conversation-scoped EvidenceStore；Knowledge 必须有 `docId + blockId`，Web 必须有 HTTP(S) canonical URL。同 ref 冲突、格式非法或来源缺失会使整个写入失败，禁止按普通文本保留假 `[@ref]`。
  - Markdown 新建：`write_file(locator="workspace:/name.md", content="...")` 会创建新 Markdown 文件，并复用 normalization 与同一 Citation admission 生成结构化 CitationMark。
  - 新建规则：尚不存在的节点没有 inode，因此新建 Markdown、MindMap、Slides 等文档只能传 locator。禁止发明 `workspace:dummy`、随机 UUID，禁止同时传 locator 与 inode。
  - Slides：读写 `.slides` source，并通过 `ppt_inspect` 做布局诊断。
  - Sheet：`read_file` / `grep` 读取 checkpoint + `sheet_ops` 回放后的可见展示值预览；写入仍使用 `sheet_*` 专用工具，避免绕过 Sheet oplog。

`read_file` 的默认结果是 VFS 的普通文本投影，保证 `read_file -> edit_file` 使用精确原文。结构化 DocumentView（例如 MindMap 的 `[#ref]`、outline 和插件 presentation）属于同一工具的显式读取模式，实施时复用 Workspace `document-read` feature，不按文件类型隐式切换默认结果。

`read_file` 是工具族里唯一跨地址空间的动作：`workspace:/...` 进入当前项目 VFS，
`conversation:/...` 进入当前对话工作目录，`file:///...` 进入宿主绝对路径。裸相对/绝对路径均拒绝，
也不会通过“哪个文件存在”猜来源。物理 reader 按 magic bytes 识别 JPEG、PNG、WebP 并附加模型输入；
AI 不声明媒体类型。图片不接纳字符窗口。inode 只属于 Workspace；每次调用与 locator 二选一。

物理文本只接受严格 UTF-8（含可选 BOM），上限 20 MiB；SVG 按文本返回。图片复用 asset domain
现有的 10 MiB、40 MP、完整解码、内容寻址和 tool-result claim。PDF、Office、压缩包、数据库、
音视频及可执行文件须先用 Shell/CLI 显式转换。`read_file` 不依赖 Commands 的三档权限，因为三档
只读范围相同，最终由操作系统权限和上述内容门禁决定。

Markdown 的普通文本与 DocumentView 共享 Citation admission，但保持各自的正文形状和 cursor。可引用的
`[@ref]` 只能与同一正文窗口的 `data.citations.citations` 一起出现；来源 appendix 和结构化 snippet
复用同一预算后 excerpt。`pendingDiffs` 与 `grep` 没有 citation metadata，因此只显示中性
`【citation】`，Agent 应读取命中文档后再引用。

写入侧与读取侧使用同一 canonical ref 口径，但职责不同：Citation domain 负责 token、完整命中与来源
冲突规则；Linnya Host 把 Knowledge/Web/read_file owner 输出和 Evidence fallback 投影为已接纳的窄 source resolver；
Markdown document-write 只把已接纳事实写成 CitationMark。Workspace 不读取 Knowledge/Web 内部服务，也不扫描
任意 `data.citations` 字段。

`read_file` 的 Citation Sources 是持久化快照，不是一次隐式实时复核；observation 会标记
`snapshot_status=persisted source_status=not_checked`。Agent 需要验证来源当前状态时，应显式使用对应
Knowledge/Web 能力，不能把 `not_checked` 理解为来源仍可访问。

当 Agent 要在回答里提供文件跳转时，直接把 `read_file` 使用的 canonical locator 放进标准 Markdown
link：Workspace 文件使用 `workspace:/...`，对话过程文件使用 `conversation:/...`，宿主文件使用
`file:///...`。不要输出裸路径、`documentId` 或 `linnya://`。Workspace 链接由回答所属 Conversation 的
项目反查真实节点，label 只作为解析中的临时文本；物理文件 label 是 authored title，点击行为是“在文件
管理器中定位”，不是启动默认程序。

所有工具统一通过 `ToolContext.databaseService` 访问 Workspace DB，不走 renderer IPC。

除了 Agent 正常调用，Conversation CLI 也可以通过 `tools call` 发起这五个工具。CLI 只负责声明工具名、参数和 Conversation/项目作用域；Host 仍把请求送入同一个 Flow、ToolNode 与 ToolContext，完整复用本文件定义的 admission、locator、权限、pending revision、审计和 UI 投影。它不是第二套 Workspace API，也不允许绕过 registry 直接调用 `run()`。CLI 合同与作用域规则见 [`apps/linnya-cli/README.md`](../../../apps/linnya-cli/README.md)。

### 1.1 单一命令身份与执行 admission

locator 表达节点当前地址，inode 表达跨重命名/移动仍稳定的节点身份。工具成功后同时返回二者，是对同一个真实节点的两项事实；下一次调用只能选择一个作为命令权威：

| 用例 | 合法输入 |
|---|---|
| 新建文件 | locator-only |
| 读取、覆盖、编辑已有文件 | locator-only 或 inode-only |
| 根目录 list/grep | 省略两者 |
| 其他 list/grep | locator-only 或 inode-only |

五个 concrete tool 必须用正式 owner schema 覆盖 `validateArguments`。ToolNode 在 `tool_process(start)` 前调用该 admission；双身份、未知字段和非法 locator 只能产生 protocol error，不得进入 provider/VFS mutation。`run()` 内再次 parse 只用于类型收窄，不能成为第一道业务合同。尤其禁止在 inode 解析失败后改按 locator 执行，否则创建看似成功，更新目标却无法证明。

五个 Tool 的完整模型 `parameters` 必须直接保留在各自 concrete tool 文件中，方便同时审查描述、字段、
`required` 与封闭 `oneOf`。Workspace shared 只复用“正式 parser 的错误如何转换为 admission 结果”这一窄逻辑，
不生成 locator/inode 分支，也不把 Workspace 身份语义下沉到 Linnkit。通用协议与测试时序见
[`src/tools/README.md`](../README.md) 和 Linnkit 的
[`tool-development-guide.md`](https://github.com/linnlabs/linnkit/blob/main/docs/integration/tool-development-guide.md)。

`write_file` / `edit_file` 在模型流式输出中一旦确定工具名，就通过通用 streaming policy 发布 ephemeral
占位事件。Renderer 先显示不可展开的“正在创建文件...”或“正在编辑文件...”标题，完整参数到达后仍由
正式 lifecycle projector 接管。两者不发布 argument snapshot：文件正文和替换文本可能很大，而占位标题
只依赖工具名，重复传输参数既无展示价值，也会放大实时事件。

## 2.2 与 Shell 物理目录的关系

Workspace 工具使用 `workspace:` 地址空间，根写成 `workspace:/`。例如 `workspace:/plan.md` 表示数据库中的项目文档节点，不表示操作系统的 `/plan.md`，也不表示当前对话工作目录。

`write_file` / `edit_file` 的 Markdown 写入走 Workspace DB 和 pending revision 事务；它们不会直接在 Shell conversation 目录创建同名物理文件。反过来，Shell 中用 `touch`、重定向或 CLI 生成的物理文件，也不会自动注册成 Workspace 的 `/name.md`。

因此，以下两个动作不能当作等价操作：

```text
write_file(locator="workspace:/notes.md", content="...")
touch notes.md
```

当前没有自动 materialize/commit 桥接。若业务需要在两套路径之间传递内容，必须由明确的后续能力负责转换，并在其文档中定义来源、目标和失败处理；不要在单个工具里偷偷建立隐式同步。Shell 的物理 cwd 规则见 [Shell 工具说明](../commands/shell/README.md)。

---

## 2. 与数据库 / Schema 的关系

### 2.1 Markdown 文档存储（后端）

后端 Schema 由 Markdown domain 的 `features/document-storage/infrastructure/sqlite/schemas/` 拥有：

- 表：`document_versions`
  - `content_json TEXT NOT NULL`：存储完整的 ProseMirror JSON 文档结构。
- Schema 本身**不关心 JSON 的内部结构**，只关心它是合法的 JSON 字符串。

前端编辑器的逻辑结构由 `apps/renderer/app/core/schema.js` + `RootBlock.js` + `BaseBlock.js` 决定：

- 文档结构：
  - `doc` → `rootBlock+` → `baseBlock | headingBlock | ...` → `text | hardBreak | mention | ...`
- 因此，**真正的“真相来源”是块结构 JSON，而不是某段 markdown 字符串。**

---

## 3. Markdown：DocumentView / ref 引用 / preview（读写协作约定）

### 3.1 DocumentView 与 `[#ref]`

Markdown 文档在 `read_file(view="document")` 的 observation 中使用 DocumentView 格式（`[#ref] 文本`），便于 Agent **精确引用块**（而不是引用“第 N 段/第 N 行”）。

`ref` 设计目标：

- **稳定**：同一块的 `ref` 与真实 `blockId` 绑定，只要块未被删除，`ref` 长期不变（跨天打开历史对话也可复现）。
- **短**：固定 **6 位**（推荐 Base62 或去混淆字符集），便于 AI 抄写/引用，显著降低 token。
- **无状态**：`ref` 由 `blockId` **确定性计算**得到，不依赖 run/session 内存快照，不要求落库。

block 身份规则：

- `@app/schemas` 的 `DocumentBlockIdSchema` 是 Editor/Workspace DocumentView 交换边界的唯一共享定义。
- rootBlock ID 只能在文档实体创建或显式插入块时生成；读取、打开、全文写入、preview 和序列化都不能补 ID。
- 持久化 Markdown 文档缺失、空白或重复 rootBlock ID 时必须失败并报告数据损坏，不升级旧结构。
- `ref` 只能由已 admission 的真实 block ID 派生，不能替代 block ID 落库或作为恢复来源。

冲突策略（同一文档内）：

- 默认认为 6 位冲突概率极低；
- 若发生冲突（两个不同块算出同一 `ref`），应显式报错提示调用方改用更长 `ref`/重新读取（或在实现中升级为“短 hash 自适应加长”，例如 6→7→8 位）。

### 5.2 Edit：只用 `ref` 定位块

### 5.3 Read：默认 preview，并提供 base 视图

`read_file(view="document")`：

- 默认返回 **preview**（AI “所见即当前状态”，便于连续编辑）
- 通过可选参数切换查看 **base**（仅当前 content_json 的文本，不合并 pending）

### 3.5 文件写入：直接传标准 Markdown

`edit_file` / `write_file` 只要求一件事：写入目标 Markdown 文本。

块边界不再由 Agent 用 `[1] [2]` 之类的 DSL 指定，而是由后端统一走：

`standard markdown -> parser-wasm -> docJson -> flattenMarkdownDocumentBlocks()`

这带来的实际语义是：

- 普通段落由解析器决定是否是一个块还是多个块；
- 多个列表项会按 canonical list item blocks 展开；
- fenced code / pipe table / LaTeX block 等需要多行保真的结构会整体保留；
- `edits[]` 顺序，就是 canonical blocks 的实际写入顺序。
- 同一次 planner 展开的多块写入会在后端 SQLite 事务里原子提交；任意一块失败会整体回滚。

## 4. 推荐测试覆盖

Workspace 工具不要只测单工具参数校验，至少应覆盖这些真实链路：

- Markdown：`write_file(locator="workspace:/name.md") -> read_file -> edit_file/update -> read_file`
- MindMap：`write_file(locator="workspace:/name.mindmap") -> list_files -> read_file(locator="workspace:/name.mindmap", view="document")`
- Sheet：当前停用；未来恢复时仍应使用 `list_files -> read_file(view="document")`，精细操作走插件 CLI/Skill。

当前回归测试入口：

- `src/tools/workspace/__tests__/fileTools.test.ts`：包含真实 ToolNode owner admission、locator-only Slides 创建、provider 调用和 VFS 双身份结果验证。直接调用 `Tool.run()` 的用例只验证工具内部业务，不能代替这条 runtime 链。

> 说明：preview 的“真相来源”仍然是块结构 JSON + pending revisions 的组合，而不是某段 markdown 字符串。

## 5. 与同目录设计文档的关系

本 `README.md` 主要回答两个问题：

1. Workspace 工具整体职责与与 DB / 前端 Schema 的关系；
2. **如何使用 write_file 创建文档，以及创建时如何处理 `[@ref]` 引用。**

更完整的工具参数、返回结构、边界条件等细节，请结合：
- 以及各 Tool 文件顶部的 `parameters/description`（权威参数说明）

---

## 6. 相关源码索引（按职责分组）

- **通用 Workspace 工具：**
  - `src/tools/workspace/list_files/ListFilesTool.ts`
  - `src/tools/workspace/read_file/ReadFileTool.ts`（普通文本与结构化 DocumentView 入口）
  - `src/app-hosts/linnya/application/file-read/`（物理文件读取合同及跨 physical/assets 编排）
  - `src/app-hosts/linnya/adapters/file-read/createNodePhysicalFileReader.ts`（Node 文件系统 adapter）
  - `src/tools/workspace/write_file/WriteFileTool.ts`
  - `src/tools/workspace/README.md`（本文）
  - `src/tools/workspace/AGENT_EDIT_TOOL_BASE_DIFF.md`

- **结构化文档读取调度：**
  - `src/features/workspace/document-read/definitions/workspaceDocumentRead.ts`（请求、结果别名与窗口常量）
  - `src/features/workspace/document-read/orchestration/readWorkspaceDocumentView.ts`（节点确认、文档类型分派、快照与图片清单装配）
  - Sheet 等插件文档读取走 `DocumentTypeBackendHook.readDocument`，Host 不再保留文档类型私有 preview 实现。
  - `src/tools/workspace/read_file/workspaceDocumentReadAdapter.ts` 只负责把 ToolContext 装配给该 feature，不能承载文档类型规则。

- **富文档 Editor 读写调度：**
  - `src/features/workspace/document-editor/` 只确认节点身份并调用 Host provider。
  - `src/domains/markdown/features/document-editor/` 拥有 Markdown normalization、pending DTO 投影和版本保存。
  - `src/app-hosts/linnya/adapters/document-editor/` 组合永久内建 Markdown provider 与插件 Editor hook；未知类型不能默认落入 Markdown。
  - 普通 `text/markdown` 内容预览不经过这条状态化文档读写链。

- **文档创建与复制：**
  - `src/features/workspace/document-lifecycle/` 拥有节点身份、唯一命名和 provider 调度。
  - `src/app-hosts/linnya/adapters/document-lifecycle/` 组合内建 Markdown 与插件生命周期 provider。
  - Markdown 节点与初始/复制正文在同一个同步 SQLite 事务内提交；插件 hook 不进入 Host 同步事务。

- **已有文档的 file-style 全文写入：**
  - `src/features/workspace/document-file-write/` 只按正式 Workspace 节点的 `documentType` 调用窄 provider。
  - `src/app-hosts/linnya/adapters/document-file-write/` 组合永久内建 Markdown provider 与插件 `writeDocument` hook。
  - `edit_file` 在 VFS 事实文本上完成一次 exact replacement，随后与 `write_file` 共用同一写回 provider。
  - 普通 `text/markdown` 预览不是文档实体，不能按扩展名或 MIME 进入 Markdown pending/版本链。

- **缺失路径的文件创建：**
  - `src/features/workspace/document-file-create/` 拥有精确文件路径创建用例，与侧边栏默认文档生命周期分开。
  - `src/app-hosts/linnya/adapters/document-file-create/` 按已声明扩展名选择插件 provider；无后缀、`.md`、`.markdown` 进入内建 Markdown provider，其他格式不做内容嗅探。
  - Markdown 在写入任何事实前完成文本编译与 Citation admission，再以同步事务一次提交节点和首个版本；失败不留下空节点。
  - 节点创建后，后续读写只按持久化 `documentType` 调度，不继续依赖扩展名。

- **Markdown 文档领域（不属于 Workspace 五件套）：**
  - `src/domains/markdown/tools/create-annotations/MarkdownCreateAnnotationsTool.ts`
  - `src/domains/markdown/features/document-read/functions/markdownDocumentView.ts`
  - `src/domains/markdown/features/normalization/markdownJsonSerializer.ts`
  - `src/domains/markdown/features/normalization/markdownBlockPlanner.ts`
  - 读取侧：
    - `src/domains/markdown/shared/markdownBlockProjection.ts`（canonical block projection）
    - `src/domains/markdown/features/document-read/functions/markdownOutline.ts`
    - `src/domains/markdown/features/document-read/functions/markdownPendingDiffs.ts`
    - `src/domains/markdown/features/document-read/functions/markdownPreviewBlocks.ts`
    - `src/domains/markdown/features/document-read/functions/markdownReadPresentation.ts`（UI 友好块列表构建）
  - ref 解析：
    - `src/domains/markdown/features/annotations/functions/resolveMarkdownAnnotationTarget.ts`
  - 创建侧：
    - `src/domains/markdown/features/normalization/functions/markdownPlaceholder.ts`
  - 全文写入：
    - `src/domains/markdown/features/document-write/orchestration/writeMarkdownDocumentFromText.ts`
    - `src/domains/markdown/features/document-write/orchestration/buildMarkdownDocumentFromText.ts`
    - `src/domains/markdown/features/document-write/orchestration/buildMarkdownPendingCitationMetadata.ts`
    - `src/features/workspace/document-mutation/`（只提供节点更新时间 port，不解释 Markdown）

- **通用列表模块：**
  - `src/tools/workspace/list/nodeNormalizer.ts`

- **共享：**
  - `src/tools/workspace/shared/numberUtils.ts`

- **MindMap 工具（插件包内）：**
  - 详见 `packages/plugins/mindmap/src/backend/tools/mindmap/README.md`
  - `packages/plugins/mindmap/src/shared/mindmapOutline.ts`
  - `packages/plugins/mindmap/src/backend/tools/mindmap/read/mindmapNodeRefViewBuilder.ts`（NodeRef View 构建）

- **ToolContext / 工具注册：**
  - `src/tools/types.ts`（`ToolContext`、`BaseTool` 等）
  - `src/tools/registry.ts`（工具注册与执行）
  - ToolContext 只承载运行时公共依赖，不注入 Markdown store/normalizer；永久内建 Markdown provider 由 `src/app-hosts/linnya/adapters/` 基于正式数据库和 Workspace port 装配。
  - `scripts/guards/markdown-domain-boundary-guard.ts` 阻止五个通用工具重新 import Markdown，并阻止 Workspace deep import Markdown 内部实现。

- **Workspace / 文档服务：**
  - `src/electron-main/services/workspace/workspace.ts`（`WorkspaceService`，项目与节点树）
  - `src/domains/markdown/features/document-storage/infrastructure/sqlite/markdownDocumentService.ts`
  - `packages/plugins/mindmap/src/backend/persistence/mindmap_document/services/mindmap_document.service.ts`
  - `src/domains/markdown/features/document-storage/infrastructure/sqlite/schemas/document.schema.ts`
  - `packages/plugins/mindmap/src/backend/persistence/mindmap_document/schemas/core.schema.ts`

- **编辑器前端逻辑：**
  - Markdown：
    - `apps/renderer/domains/editor/services/editorService.js`（Markdown Document Surface 加载入口）
    - `apps/renderer/shared/services/markdownService.js`（WASM 解析器）
    - `apps/renderer/domains/editor/extensions/clipboard/PlainTextMarkdownHandler.js`（粘贴入口编排；底层节点 materialization 已复用统一 markdown runtime）
    - `apps/renderer/shared/utils/markdownSerializer.ts`（块结构 → Markdown 导出）
  - MindMap：
    - `packages/plugins/mindmap/src/renderer/domain/types/index.ts`（`MindMapData` / `NodeObj` 定义）
    - `packages/plugins/mindmap/src/renderer/domain/core/methods.ts`（`mind.init` 等核心方法）
    - `packages/plugins/mindmap/src/renderer/domain/store/mindmapStore.ts`（插件内状态）
    - `packages/plugins/mindmap/src/renderer/page/MindmapPage.vue`（Document Surface 页面入口）

- **IPC 入口：**
  - `src/electron-main/ipc/handlers/workspace/workspace-ipc.ts`（Workspace 主 IPC）
  - `src/electron-main/ipc/handlers/workspace/documents/markdown_document/document-ipc.ts`
  - `packages/plugins/mindmap/src/backend/ipc/mindmap_document/document-ipc.ts`（MindMap 插件 IPC）
  - `src/electron-main/preload/index.ts`（`workspace:*` 与 `plugin:invoke` 通道暴露）
