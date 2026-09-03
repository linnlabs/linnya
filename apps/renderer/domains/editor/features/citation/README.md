# Editor Citation

本 feature 管理编辑器正文引用、引用交互和文末参考文献。Conversation、Markdown、Knowledge 与 Web
只通过公开数据合同向它提供来源事实，不依赖这里的组件、store 或内部文件。

## 核心合同

正文引用是 `citationNode` inline atom，不是 text mark。

- `citationId`：当前文档内一次引用 occurrence 的实例 ID；复制粘贴时重建。
- `ref`：Agent/Markdown 边界的 6 位 canonical 短句柄；不能从 `[1]` 反推。
- `sourceId`：稳定来源 ID。Knowledge 使用文档 ID，Web 使用 canonical URL，Manual 使用 UUID。
- `blockId`：Knowledge 的精确块锚点。
- `title/snippet/snippets/authors/date/url/containerTitle`：引用发生时保存的来源快照。
- `[1]`、`[2]` 或 author-date label：只存在于 NodeView 的派生显示，不进入 ProseMirror 文本和持久化身份。

Knowledge 的事实身份是 `sourceId(docId) + blockId`；Web 的事实身份是 HTTP(S) URL。目录路径不是
引用合同的一部分。Workspace 移动文件只改变 tree 的 `parent_id`，不会改变文档 ID，因此移动后仍可用
稳定 ID 跳转，也始终可以从 CitationNode 自带快照查看当时引用的标题和原文。若来源后来被删除，快照仍
可读，但“跳转到当前来源”会明确不可用，不能通过同名文件猜测替代来源。

## 为什么使用 inline atom

旧实现把引用保存成带 `citationMark` 的真实文本，再由 `appendTransaction` 把 `[@ref]` 改写成 `[1]`。
direct-state 文档装载不会天然产生这笔后续事务，因此正文可能暴露原始 token，而参考文献又已经按 mark
派生成功，形成两套不同步的真相。

现在 CitationNode attrs 是唯一持久化真相：

- NodeView 直接从当前文档派生模型显示编号，不改正文；
- 删除、选择和光标跨越使用 ProseMirror 原子节点语义；
- Markdown/HTML 边界投影为 `[@ref]`，因此仍兼容正式 Markdown 引用语法；
- 参考文献块和正文编号读取同一份 derivation；
- direct-state 装载在唯一一次 view update 前发出通用 document-load projection，引用 feature 可先补齐
  `BibliographyBlock`，不会出现等待下一笔用户事务的窗口。

## 正式写入链路

### Editor 面板

Knowledge/Web/Manual adapter 先形成严格 attrs，`CitationPanel` 再创建 CitationNode。Knowledge 缺少
`blockId` 时拒绝创建，Web/Manual 表单规则位于当前 feature 的 functions/adapters，Vue 只负责连接交互。

### AI Markdown 与 Pending Revision

后端先由 Citation domain 接纳 `[@ref]` 对应的来源，再把 `citation_hydration` 交给 Markdown/Revision。
Markdown 新建链路直接生成 CitationNode；Pending Revision 使用结构化 Citation atom 穿过
`TextSpan -> RichDiff -> diffApplier`，最终物化为 CitationNode，并允许同时携带 `revisionMark`。

Markdown 解析统一复用 Citation domain 的浏览器安全公共入口
`@linnya/citation-domain/markdown-reference`：支持单条、聚合和模型转义写法，严格校验 canonical Base58
ref，并跳过 fenced code、inline code 和 code mark。禁止再添加 `\w{6}` 或局部 citation 正则。

### Conversation 复制与另存

Conversation 只消费当前消息的 dependency snapshot，再由
Conversation citation-presentation 的 `projectConversationCitationsToEditorHtml.ts` 生成 Editor 可解析的
HTML。边界文本是 canonical
`[@ref]`，不是 Conversation 当时的 `[n]`；完整来源快照随 data attributes 一起传入。

粘贴边界由 `remapPastedCitationIdentities` 只重建 `citationId`，保留 ref、稳定来源锚点和快照，避免复制后
两个 occurrence 共用实例 ID。另存为文档和文件移动不依赖原 Conversation 的生命周期。

## 派生与状态边界

- `citationDerivation.ts`：纯函数扫描 CitationNode，按 `sourceId` 生成编号和 bibliography entries。
- `citationRenderPlugin.ts`：只保存派生读模型，绝不修改文档正文。
- `CitationFeatureExtension.ts`：维护文末唯一 `BibliographyBlock`；编排 transaction，不承载来源规则。
- `citationUpdateService.ts`：按 `sourceId` 更新同源基础信息，按 `citationId` 更新当前 occurrence 的摘录。
- `useCitationPanelStore.ts`：只持有面板、popover 和 edit panel UI 状态。

能从 ProseMirror 文档计算的编号、条目和来源数量不重复写入 store。

## 目录职责

- `nodes/`：CitationNode schema、HTML/NodeView/粘贴边界装配。
- `functions/`：attrs 读取、可移植文本投影、粘贴实例身份重建等纯规则。
- `render/`：编号与 bibliography 派生读模型。
- `plugins/`：bibliography 扫描和修正动作计算。
- `extension/`：ProseMirror 流程装配与 UI 事件桥接。
- `adapters/`：外部来源 DTO 到 CitationNode attrs 的转换。
- `services/`：文档内引用查询与更新用例。
- `ui/`、`store/`：薄 UI 与 feature 级状态。

## Renderer referenceRuntime 公共 UI 合同

Mindmap evidence 与 Editor Citation 使用同一套 Web/Manual 来源输入结构、交互控制和视觉规则。真源位于：

- `ui/useWebManualCitationForm.ts`：聚焦、来源类型切换、字段同步、重置和 textarea 自动高度；
- `ui/styles/WebManualCitationForm.css`：以 `.web-manual-citation-form` 为根的稳定表单样式；
- `adapters/webCitationAdapter.ts`：输入类型与校验规则。

App installer 通过 `@plugin/renderer/referenceRuntime` 向 Mindmap 暴露行为和校验，Host composition 在 domain/plugin
样式之后按固定顺序装载公共 CSS。该合同带有 Citation 业务语义，因此不进入 `@linnya/renderer-ui`；插件不得
deep import Editor 文件，也不得复制或覆盖这份样式。调整 DOM class、字段行为或校验结果时，必须同时验证 Editor 与
Mindmap 两个消费者。

## 风险与不变量

- 来源移动/重命名：稳定 ID 不变，快照不变；禁止保存或比较目录路径。
- 来源内容变化：默认展示引用发生时的快照。当前来源内容属于另一项显式“重新核验”能力，不能静默覆盖。
- 来源删除：离线快照继续可读；跳转失败必须可观察，不能按标题或路径猜新来源。
- 粘贴：只改变 occurrence `citationId`，不得改变 ref/sourceId/blockId/快照。
- Markdown 往返：只输出 canonical `[@ref]`；手工来源输出显式 manual marker，不伪造 RAG ref。
- 大文档：citation/bibliography 目前在相关文档变更和装载投影时做全文扫描，复杂度为 O(n)。若真实性能
  数据证明成为瓶颈，应做可重建的增量索引，不能新增第二套持久化真相。

Conversation 合同见 [Citation domain](../../../../../../src/domains/citation/README.md#conversation-展示链路)，Agent 文档读取
合同见 [`src/domains/citation/features/document-read/README.md`](../../../../../../src/domains/citation/features/document-read/README.md)。
