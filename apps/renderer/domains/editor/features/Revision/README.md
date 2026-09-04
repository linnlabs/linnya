## Revision 模块概览

`features/Revision` 模块负责实现 **AI 修订 / 行内修订模式**，核心目标是把「AI 文本替换」从“硬覆盖”变成“可视对比 + 可控接受/拒绝”。

### 架构核心原则

> **后端 `pending_revisions` 表是唯一事实源。** 前端通过 IPC 进行读/写/清理操作，文档恢复时完全信任后端数据。`content_json` 只存储基线内容，不包含 workspace pending 的投影。

当前模块只保留一条主线能力：

- **Block Pending Revisions（唯一主线）**：后端把修订保存到 `markdown_block_pending_revisions`，前端把 pending 快照构建为 `canonicalPendingSessions`，再投影成真实节点 + `revisionMark`。保存文档时会统一剥离这些投影，不污染 `content_json`。

明确边界：Revision 只接纳正文的 `insert/update/delete` 意图，不拥有 Annotation 生命周期。无论来自用户、Review 专用工具还是 file-style Markdown 写入，新批注都直接以 `confirmed` 写入所属 `rootBlock.attrs.annotations`；`creating/editing` 只是 Annotation UI 临时态。file-style 写入对 canonical comment 的编辑或删除也由 Annotation mutation 直接提交，不会伪装成正文 pending。

### 与 Markdown 统一架构的关系

如果你是为了理解“为什么 pending 里的 Markdown 现在能比较稳定地表现为标题 / 列表 / 代码块 / 表格 / 行内公式”，先看这几份文档：

- renderer 侧 runtime：[markdownRuntime](../../services/markdownRuntime/README.md)
- 后端 Markdown 文档领域：[Markdown domain](../../../../../../src/domains/markdown/README.md)

本 README 只负责说明 `Revision` 如何消费这套统一后的 Markdown 运行时与 pending 协议，不重复定义 parser / materializer 本身。

当前 Markdown 架构现状以这份 README、renderer 侧 `markdownRuntime/README.md` 和后端 `src/domains/markdown/README.md` 为准。

### 关键子系统

- **行内标记**：`revisionMark`（仅作为 pending 的投影/UI 载体）。
- **行内渲染**：通过 `revisionMark` 渲染插入/删除样式。
- **Canonical Pending Sessions**：由后端 DTO 直接构建的全局事实源（`canonicalPendingSessions`），不受虚拟化、undo/redo 影响。全局统计（块数、+N/-M）从此派生。
- **块级状态与 UI**：
  - 块右上角的修订统计指示器（`+N / -M`）。
  - 悬浮的修订工具栏（接受 / 拒绝全部）。
  - 全局修订工具栏（文档级 接受全部 / 拒绝全部）。
  - 块左侧橙色竖线，标记当前块存在待处理修订。
- **命令与 Store**：
  - 通过 `RevisionCommands.js` 提供块级命令（接受 / 拒绝 / 清除标记等）。
  - 通过 `useRevisionStore` 维护修订会话状态，包含三层：
    - **canonicalPendingSessions**（全局事实源）：后端 DTO → 全局统计、文档级操作。
    - **activeRevisions**（mark 投影层）：块级 UI 运行时状态。
    - **pendingDTOShadow**（undo 恢复缓存）：原始 DTO 的影子，供 undo 后恢复使用。
- **后端同步**：
  - 前端通过 `backendPending.ts` 的统一门面调用 IPC 进行 pending 的读/写/清理。
  - IPC 通道：`set-pending-revision`（单条写入）、`set-pending-revisions-batch`（批量写入）、`clear-pending-revision`（单条清理）、`clear-all-pending-revisions`（全量清理）、`apply-pending-revision`（块级原子接受/拒绝）、`apply-all-pending-revisions`（文档级一次性接受/拒绝）。
  - accept/reject → 清理后端 | undo → 写回后端 | 保存前 → 全文档对账。
- **保存语义（fork-reject 策略）**：
  - 保存时通过 `stripWorkspacePendingFromJSON` 从序列化 JSON 中剥离所有 workspace pending 投影：insert 块整块移除、insert 文本移除、delete 文本保留但剥离 mark。
  - 确保 `content_json` 只存储基线内容。
- **Diff 计算与应用**：
  - 使用 `diff-match-patch` 计算原文与润色后文本的差异。
  - 使用 `Rich Diff` 算法在纯文本差异基础上叠加 Markdown 格式信息。
  - 将 diff 结果映射到 ProseMirror 文档，并打上 `revisionMark`。
- **Pending 执行层（当前实现）**：
  - `applyPendingRevisionsToEditor()` 已先走统一 batch planner；insert 的 anchor 链重写与 non-insert 分批都在同一个规划入口处理。
  - pending 顶层已统一成显式 `PendingExecutionPlan`：`content-diff` / `table-insert` / `table-update-with-history`。
  - `insert/update` 均通过同一套 `toDocument` / `toTr` executor 消费 plan，不再分别拼接普通块与表格分支。
  - non-insert 批处理已统一到单个 mega-transaction：连续 `update/delete` 会共用同一批 executor；即使同一 `blockId` 连续出现，也会基于 evolving `tr.doc` 继续规划，而不是因为重复块 ID 被外层强制切批。
- **文档级 Accept/Reject All（性能基线重写）**：
  - 全局工具栏的“接受全部 / 拒绝全部”不再逐块调用 `acceptAllRevisionsInBlock` / `rejectAllRevisionsInBlock`。
  - 默认走主进程 `PendingRevisionApplyService.applyAllPendingForDocument()`：
    1. 读取当前 `content_json` 与 pending 快照；
    2. 事务外预解析 `new_markdown`；
    3. 事务内重读版本与 pending，校验没有并发变化；
    4. 在 docJson 层一次性合并；
    5. 使用 Markdown 正式 schema 严格校验最终完整 `docJson`；
    6. `updateDocument()` 保存新版本并 `clearAllPendingRevisions()`；
    7. 返回最新 `docJson`，前端通过 `loadDocumentJsonAtomically()` 严格解析并一次切换 `EditorState`。
  - 只有后端与 Renderer 均成功才清 runtime cache、标记非 dirty 并报告完成。后端未应用时保留全部本地状态；后端已应用但 Renderer 装载失败时保留旧界面、canonical、dirty 和 runtime cache，显示“重新打开文档”提示。
  - 开关：`editorFeatureFlags.enableBackendPendingApply`，默认开启。文档级 Apply All 的 IPC/后端/Renderer 任一路径失败都禁止回退旧逐块路径，因为后端事实可能已经变化，重复执行会制造错配。
- **块级 Accept/Reject（单块后端原子同步）**：
  - 前端仍先执行当前可见块的 PM 命令，保留细粒度交互语义与本地即时反馈。
  - 后端同步不再默认触发全量 `requestSave('auto')`。`persistBlockAction()` 会优先调用 `workspace:apply-pending-revision`，由主进程 `PendingRevisionApplyService.applyPendingForBlock()` 在 `content_json` 层只合并/清理目标块。
  - 如果单块 IPC 明确失败，才回退到旧的“保存全文档 + clear pending”路径，保证数据可靠性优先于性能。
  - 设计原因：万行文档里单块 reject 的 PM command 只有几十毫秒，历史卡顿主要来自全量保存 10k rootBlock。单块后端原子 apply 把这段 4s 级耗时从交互路径里移走。
- **Table materialization（当前实现）**：
  - pending table 的整表 `TableBlock.attrs` 路径与 `pipeTableParser` fallback 路径，现都复用 `markdownRuntime/materializer.ts` 的共享 row/cell builder。
  - pending 侧现在只负责表格 cell 的 Markdown 解析、projection hydration 与 block 级 replace/history 调度，不再手工创建 `tableRow/tableCell/tableCellContentBlock` 节点。

### 当前结论（2026-03-14）

- `Revision` 已不再依赖旧的本地 Markdown span parser 作为主语义源；普通块 pending 已切到 `markdownRuntime`
- `inlineLatex`、`hardBreak`、代码块字面换行、table cell materialization 都已经在 pending 路径里对齐
- pending 顶层执行已经统一到 shared batch planner + shared execution plan
- 当前**唯一明确保留的执行层特例**是：`table block` 的 replace/history 仍然是 schema 级特例

也就是说：

- 现在的问题不再是“Revision 还在自己解析 Markdown”
- 而是 `Revision` 作为消费方，仍要接受 table block 在执行语义上不是普通块同构路径

### AI 引用链路（已完成）

AI 通过 `write_file/edit_file` 写入 `[@ref]` 后，引用数据经过以下管道进入编辑器：

1. **后端**：Workspace 写工具检测 `[@ref]`，由 Citation domain + Host source provider 严格接纳
   Knowledge/Web owner 输出或 Evidence 快照，存入 `meta.citation_hydration`；失败时整次写入终止。
2. **IPC 透传**：`workspacePending.ts` 不构造局部 metadata，保持 `metaJson` 完整透传。
3. **前端解析**：`applyPendingRevisions.parsePendingRevision` 总是反序列化完整 `metaJson`。
4. **结构化附着**：`citationHydrationHelper` 复用 Citation domain Markdown parser，把 token 投影为
   `TextSpan.inlineAtom(type=citation)` 与 `citationNode` fragment；代码语义中的示例不会被水合。
5. **RichDiff**：`computeRichDiff` 将 `TextSpan.citation` 传播到 `RichDiffSegment.citation`。
6. **diffApplier**：`applyRichDiffSegmentsToTransaction` 在 insert 段创建真实 `citationNode` inline atom
   （可携带 `revisionMark`），并保留 canonical `ref` 与 Knowledge `blockId`，避免 diff 往返把精确来源
   降级成文档级身份。

> 已修复的关键 bug：`diffApplier.ts` 的中间类型 `PositionedRichSegment` 此前缺少 `citation` 字段，segments 转定位段时 citation 被静默丢弃。现已补全字段并在构建时透传。

> 重要说明：关于“用户修订（Track Changes）”
>
> - 我们当前的主线能力是 **Block Pending Revisions**：后端 pending + 前端 canonical + `revisionMark` 投影。
> - `RevisionTrackingExtension` 已被禁用，避免继续走“前端直写 revisionMark 到 doc”这条旧路径。
> - 因此请不要把它视为已上线能力；后续若要正式支持，需要独立的需求评审与专项测试。

### 与虚拟滚动 / 分层激活的关系（当前实现）

`Revision` 本身**不单独实现传统虚拟滚动**，而是接入 editor 的 **Layered Virtualization / 分层激活** 体系。

先说结论：

- editor **不会裁剪 ProseMirror 文档节点**；doc、selection、transaction、rootBlock 顺序始终完整保留。
- 当前大文档主路线已经从旧 Shell 基线路径升级为 **placeholder / hydrated NodeView 真虚拟化**：离屏 rootBlock 只保留 `root-block-outer` 级占位壳，不暴露 `contentDOM`，因此不会创建内部正文 ViewDesc。
- `Revision` 吃到的虚拟化收益来自两层：离屏块不运行块级修订 UI；离屏 pending 也不投影成 `revisionMark`，只保留 canonical 轻量索引。
- 视口内块被 hydrate 后走裸 DOM RootBlock NodeView；块级 pending 状态由 `BlockChromeHostRevisionIndicator` 通过文档流 header mount 显示，行内 diff 再由 pending 投影窗口补齐。小文档与非虚拟化路径仍保留旧 Vue `BlockView / BlockChrome` 组合。

#### 1. 为什么不是传统虚拟列表

原因不是“还没做”，而是 editor 架构不允许：

- ProseMirror 需要稳定的文档结构、selection、IME/composition、pos 映射。
- `rootBlock` 通过 NodeView 承载块级语义，`scrollEditorToBlock(blockId)`、批注定位、查找跳转都依赖真实 DOM。
- 如果把离屏块直接从 DOM 卸载，会破坏 NodeView 生命周期、光标行为和块定位能力。

所以 editor 当前方案是：

1. **Document Layer 常驻**：doc / selection / transaction / rootBlock 顺序不做裁剪。
2. **Render Window 窗口化**：大文档视口附近块是裸 DOM RootBlock NodeView，离屏块是无 `contentDOM` 的 placeholder。
3. **Heavy UI 按激活态渲染**：修订工具栏、批注、历史 UI 等只在视口附近或交互态下激活；修订指示器是 pending 常驻状态行，已经迁到 Host 的轻量文档流 mount，并只在“当前块已 hydrate 且 canonical 有 pending”时显示。

#### 2. Revision 当前是怎么接入分层激活的

当前链路如下：

- `ui/BlockView.vue`
  - 始终保留 NodeView 壳。
  - 通过 `blockVisibilityManager` 跟踪块是否在视口附近。
  - `BlockChrome` 是可回收挂载：块进入 near-viewport、被选中、处于 history viewport 或被业务 keep-alive 时才挂载；这些原因全部消失后会真正卸载，释放 `BlockChrome` 内部的 editor 事件监听和重型 composable。
  - 注意：`blockVisibilityManager` 的默认值是 true，只用于避免未初始化时误隐藏 UI；`BlockView` 不能直接用这个默认值做 `v-if`，必须通过 `useBlockChromeMountState` 等待真实进入事件或初始几何检查。
- `ui/BlockChrome.vue`
  - 这里才真正初始化 `useBlockRevision(...)`、`useBlockHistoryUi(...)`、`useBlockAnnotations(...)` 等重型 composable。
  - `RevisionIndicator` 受 `blockActivation.renderRevisionChrome` 控制。
  - `RevisionToolbar` 受 `blockActivation.renderRevisionToolbar` 控制。
- `ui/blockChromeHost/BlockChromeHostRevisionIndicator.vue`
  - 只服务大文档裸 DOM RootBlock NodeView 路径。
  - 通过 `functions/readRevisionIndicatorSummary.ts` 读取 canonical pending 摘要并复用 `RevisionIndicator` 展示，不调用 `getRevisionState()`，也不触发 mark 扫描或 pending 投影。
- `ui/blockChromeHost/BlockChromeHostRevisionToolbar.vue`
  - 只服务大文档裸 DOM RootBlock NodeView 路径。
  - 是否显示由 `RevisionOverlayLayer` 发布的 toolbar blockIds 决定，Host 不复制 hover / selection 判断。
  - 接受 / 拒绝命令通过 `orchestration/applyBlockRevisionToolbarAction.ts` 回到 Revision feature 内部，Host 不直接编写修订规则。
- `ui/composables/useBlockRevision.ts`
  - 通过 `enabled` 参数接收 `isBlockVisible`。
  - 当块离屏时，`blockRevisionState` 直接返回 `null`，`hasPendingRevision` 仍优先读取 canonical 轻量索引，但不会做 mark 扫描。
  - 当块进入激活窗口且只有 canonical、还没有 active mark 投影时，调用 `projectPendingRevisionsForBlocks([blockId])` 按需补齐该块的 `revisionMark`。该 API 必须返回显式 `PendingProjectionResult`，上层只能在 `failedCount === 0` 时把窗口记为已投影；失败窗口会保留重试机会，并暴露给诊断面板。
- `ui/composables/useShellBlockVisibilityBridge.ts`
  - 只服务非虚拟化 Shell 压测路径。虚拟化主路线中的入屏块是裸 DOM `RootBlockDomNodeView`，可见窗口由 RenderVirtualization engine 发布，块级 chrome 由 Host 消费同一套 runtime registry。
  - 该桥不决定 pending 投影或 rootBlock hydrate 窗口。
- `features/RenderVirtualization/controller/renderVirtualizationEngine.ts`
  - 渲染虚拟化的唯一运行时状态机：用 doc rootBlock 顺序、`BlockHeightCache` 和 scrollTop 计算候选窗口；普通滚动走 height cache，远距离跳转 / 累计滚动纠偏 / 外部 `editor-scroll` / 已知漂移时才采样当前屏幕真实命中的 rootBlock，再按文档顺序向前后扩成渲染窗口。
  - 窗口计算使用的是 block 的布局高度（元素自身高度 + 上下 margin），placeholder `minHeight` 使用的是元素自身高度。两者不能混用，否则 rootBlock 的块间距会在长文档里累计成巨大坐标误差。
  - DOM 采样纠偏会改变 placeholder / hydrated 的真实高度，engine 必须在 hydrate/dehydrate 前后保持视觉锚点：以采样窗口中位块为锚，按该块屏幕 top 的变化补偿 `scrollTop`。Revision 只消费稳定后的 `hydratedBlockIds`，不能自己修正滚动位置。
  - 当前屏幕 DOM 采样和纠偏只能在 engine 内部发生，且不能进入普通滚动的每帧热路径。Revision / Annotation / toolbar 等业务模块不能再各自监听滚动、`elementsFromPoint` 采样或按自己的视口判断 hydrate，否则会让 pending/header 与正文窗口重新分叉。
  - 滚动主路径直接由 engine 用一次 `renderVirtualizationPlugin` meta transaction 原子写入 hydrate/dehydrate。局部 pin / unpin 已收口到 `KeepAliveRegistry -> renderWindowCommitter` 的同步提交链路，避免第二套 rAF 队列把当前滚动窗口覆盖掉。
  - 窗口参数集中在 `features/RenderVirtualization/renderVirtualizationConstants.ts`。overscan 默认按约 `1.5` 屏动态计算，窗口块数按平均块高推导，再用上限保护内存；Revision 不能假设固定 `220` 块窗口，也不能自己扩大 hydrate 范围。
  - engine 同一帧内完成窗口 hydrate/dehydrate、交互保活、真实高度回写，并只把真实已经 hydrated 的 blockId 发布给业务模块。
  - pending 投影消费 engine 的 `hydratedBlockIds`；这保证“正文已 hydrate → 块级 chrome 可稳定渲染 → diff 再投影”的顺序，不再出现 placeholder 和 pending 各跑一条链路。
- `ui/EditorContent.vue` + `features/Revision/ui/shell/useShellBlockRevisionHeader.ts`
  - 当前虚拟化主路线已经切到裸 DOM RootBlock NodeView；修订状态行由 Host Teleport 到 `.root-block-revision-header`，这个 mount 是文档流的一部分，用来保持 pending header 不改变 overlay 坐标语义。
  - `useShellBlockRevisionHeader.ts` 只服务非虚拟化 Shell 压测路径。虚拟化主路线不能再让它写 header slot，避免 Revision 出现第二套 UI 事实源。
  - `RootBlockShellView.ignoreMutation()` 的 header/history mount 约束仍适用于 Shell 压测路径，但不能再被当作大文档主路线的 pending UI 方案。
- `features/Revision/ui/overlay/RevisionOverlayLayer.vue`
  - overlay 只适合承载 hover/selection 这类不改变布局的浮层交互。
  - 不能再承担块级 pending header 的常驻显示；常驻 header 必须在 NodeView 文档流内，避免“先测坐标、再改正文布局、再重测”的双轨错位。
- `ui/composables/useBlockActivation.ts`
  - 修订 chrome 使用 `isUiActive`。
  - 修订 toolbar 使用更严格条件：块在视口内，且 hover / focus / selected 时才渲染。

这意味着：

- **离屏块不会常驻修订指示器与修订工具栏**；入屏 hydrated 且存在 canonical pending 的块会显示常驻修订状态行。
- **离屏块不会持续触发块级 mark 扫描**
- **大文档首开不会把 10000 条 pending 一次性投影成 10000 次块内修订视图**
- **修订 UI 的成本被纳入 editor 的统一激活窗口**

#### 3. Revision 在虚拟化下“已经解决了什么”

- 长文档滚动时，离屏块的 `RevisionIndicator` / `RevisionToolbar` 不再持续参与渲染。
- `useBlockRevision` 在离屏时短路，减少了 `getRevisionState()` / `hasPendingRevision()` 带来的 store 访问与块扫描。
- Revision 的块级 UI 成本，已经和批注、历史、拖拽等一起收敛到统一的 BlockChrome 激活层。
- 渲染虚拟化路径下，Revision 的常驻 pending header 已迁到 Host 的 `revision-indicator` surface。因为 Host 只读 `canonical pending ∩ hydrated window` 的轻量摘要，离屏块仍是 placeholder，不会创建 10000 个 Vue NodeView，也不会投影 10000 个 `revisionMark`。

#### 4. Revision 在虚拟化下“还没有解决什么”

这部分很重要，避免把问题都归因到“虚拟滚动没做好”：

- **正文中的已投影 `revisionMark` 不会因为离屏而自动消失**。它属于文档层，不属于块级 chrome。
- **首次打开大文档时不会再全量投影 pending**。前端先构建 canonical + shadow，进入可见窗口后再按块投影。
- **revision-heavy 文档的首开压力**，现在主要被拆成两段：
  - 首开：构建轻量 canonical 索引，保持文档级统计和 Accept/Reject All 可用；
  - 交互：可见块按需投影 `revisionMark`，只为用户正在看的窗口付费。

也就是说：

- 分层激活主要优化的是**打开之后的持续滚动、编辑、跳转成本**。
- 如果问题表现为“文档一打开就卡死”，重点通常不在 UI 虚拟化本身，而在 **pending 注入链路 + 修订数据层恢复链路**。

#### 5. 当前与 Revision 强相关的虚拟化落点

除了本目录内代码，建议同时关注这些文件：

- `ui/BlockView.vue`：NodeView 壳常驻 + BlockChrome 延迟水合。
- `ui/BlockChrome.vue`：小文档 / 非虚拟化路径的修订指示器与工具栏挂载点；大文档裸 DOM 路径中，常驻修订指示器已由 Host 接管。
- `ui/composables/useBlockRevision.ts`：修订状态在离屏时的短路逻辑。
- `ui/composables/useShellBlockVisibilityBridge.ts`：Shell NodeView 路径的 DOM 可见性注册桥。
- `ui/composables/useBlockActivation.ts`：修订 chrome / toolbar 的激活条件。
- `features/RenderVirtualization/README.md`：editor 当前虚拟化实现总览与公开协作协议。
- `docs/virtualization-evolution-roadmap.md`：大文档虚拟化演进路线与 revision-heavy 文档相关阶段结论。

---

## 文件结构

```text
apps/renderer/domains/editor/features/Revision/
  ├─ index.ts                    // Revision 模块统一导出入口
  ├─ store/
  │   ├─ useRevisionStore.ts     // 修订会话状态管理（三层模型：canonical + active + shadow）
  │   ├─ types.ts                // Store 类型定义（含 CanonicalPendingSession）
  │   ├─ backendPending.ts       // 后端 pending 读/写/清理 IPC 门面（set/clear/read）
  │   ├─ workspacePending.ts     // pending 注入 + canonical 构建 + shadow 缓存 + 首开投影调度
  │   ├─ pendingProjectionWindow.ts // 可见块 pending mark 按需投影窗口
  │   ├─ pendingBatchDispatch.ts // pending 投影期间合并 view.updateState flush
  │   ├─ pendingWorkspaceMapper.ts // workspace DTO -> pending legacy DTO 边界映射
  │   ├─ revisionMarkScan.ts     // 扫描 revisionMark（校验/调试 + undo 状态校正用）
  │   ├─ diffStats.ts            // diff 统计更新
  │   └─ __devRevisionTest.ts    // 开发调试工具（控制台 seed/inject/dump/clear，走正式 IPC 后端链路）
  ├─ utils/
  │   ├─ stripPendingFromJSON.ts         // 保存时剥离 workspace pending 投影（fork-reject 策略）
  │   ├─ diffUtils.ts                    // 基础文本 diff 计算 + 统计
  │   ├─ diffUtils.spec.ts               // diff 行为的单元测试（Vitest）
  │   ├─ richDiff.ts                     // Rich Diff 生成器（带 Markdown 格式支持）
  │   ├─ richDiff.spec.ts                // Rich Diff 单元测试
  │   ├─ linearizeBlock.ts               // 文档内容线性化抽取器（ProseMirror Node → TextSpan[]）
  │   ├─ diffApplier.ts                  // 将 diff 应用到 ProseMirror 文档（添加 revisionMark）
  │   └─ pending/                        // Pending Revisions（后端 pending_revisions：仅元数据，不写入 doc）
  │        ├─ citationHydrationHelper.ts // citation_hydration 收窄/归一化 + span 附着
  │        ├─ applyPendingRevisions.ts   // 批量应用入口（按 operation 编排）
  │        ├─ pendingBatchPlanner.ts     // 批次规划器（insert anchor 链 + non-insert 分批）
  │        ├─ pendingExecutionPlan.ts    // 统一 pending plan/executor 协议（content-diff / table-*）
  │        ├─ pendingPlanBuilder.ts      // 统一 table/content/delete -> PendingExecutionPlan 构建
  │        ├─ updatePendingRevisionApplier.ts // 单条 update pending 应用器
  │        ├─ nonInsertPendingRevisionBatchApplier.ts // update/delete 窗口批处理：并行 prepare + 串行 megaTr
  │        ├─ insertPendingRevisionApplier.ts
  │        ├─ deletePendingRevisionApplier.ts
  │        ├─ pendingMeta.ts             // pending 元信息解析（operation / anchorBlockId）
  │        ├─ pendingRevisionHelpers.ts  // 公共工具：runtime classifier / block conversion / 表格行构建桥接
  │        ├─ pendingRevisionTypes.ts     // pending revision 类型定义
  │        ├─ pendingTableBlockApplier.ts // table block replace/history 的共享执行 helper
  │        ├─ pendingTableMarkdownRuntime.bench.ts // table markdown runtime 性能基准测试
  │        ├─ pendingMarkdownRuntime.ts  // pending 专用 markdownRuntime 门面（canonical block / table classifier）
  │        └─ pipeTableParser.ts         // Pipe table Markdown 解析（| a | b | → 表格模型）
  ├─ protocol/
  │   ├─ revisionTextSpanTypes.ts        // Revision 协议层共享的 TextSpan / MarkName / citation 类型
  │   ├─ revisionTextSpanUtils.ts        // Revision 协议层 spans 通用工具
  │   └─ index.ts                        // 协议层统一导出
  ├─ ui/
  │   ├─ RevisionToolbar.vue     // 悬浮修订工具栏（接受 / 拒绝全部）
  │   ├─ RevisionIndicator.vue   // 块右上角修订统计指示器
  │   └─ RevisionMarkPopup.vue   // 行内修订 mark 的悬浮提示（可扩展）
  ├─ blockLifecycle/               // 块生命周期监听器
  │   └─ RevisionBlockEventHandler.ts // 块生命周期监听器
  └─ README.md                   // 本文档
```

> 其他相关文件（不在本目录下，但与 Revision 强关联）：
>
> - `extensions/revision/RevisionMark.ts`：定义 `revisionMark` mark 类型及渲染样式。
> - `extensions/revision/RevisionTrackingExtension.ts`：已禁用的 Track Changes 占位扩展，保留文件仅为历史兼容与说明用途。
> - `extensions/core/commands/RevisionCommands.js`：定义修订相关的 Tiptap 命令。
> - `features/blockActionMenu/providers/commonProvider.ts`：提供「✨ AI 润色」菜单项，触发 diff 测试流程，生产环境下会移除。
> - `ui/BlockView.vue`：块级 NodeView，负责挂载 `RevisionIndicator` / `RevisionToolbar`。
> - `ui/BlockChrome.vue`：块级重型 chrome 的真实装配层，修订 UI 在这里受激活态门控。
> - `ui/composables/useBlockRevision.ts`：修订状态读取门面，离屏时通过 `enabled` 短路。
> - `ui/composables/useBlockActivation.ts`：editor 分层激活策略，决定修订 UI 何时真正渲染。
> - `features/RenderVirtualization/README.md`：editor 当前虚拟化实现总览与公开协作协议。
> - `docs/virtualization-evolution-roadmap.md`：editor 虚拟化路线，以及 revision-heavy 文档的性能边界说明。

---

## 核心概念

### 当前统一状态（2026-03-14）

- 普通块 pending 已统一到 `markdownRuntime`，`inlineLatex` / `hardBreak` 不再在 pending 路径里退化成纯文本。
- 表格 cell 的 materialization 已统一到 shared materializer；table 现在剩下的特例主要是 block 级 replace/history 语义，而不是 cell/row 节点构造。
- batch planner 已统一到单一入口：insert 的 anchor 链重写和 non-insert 分批不再散落在 `applyPendingRevisions.ts`。
- non-insert 批处理已能在单个 mega-transaction 中顺序消费连续 `update/delete`，包括重复 `blockId` 的 update。
- 当前剩余的唯一显式执行层特例是：table block 的 replace/history 仍然是 schema 特例。

### 1. revisionMark（行内标记）

- 定义位置：`extensions/revision/RevisionMark.ts`
- 类型：Tiptap `Mark` 扩展。
- 重要属性：
  - `revisionId: string`：一次修订会话的 ID（如 `ai-<timestamp>-<blockId>`）。
  - `changeType: 'insert' | 'delete'`：插入 / 删除。
  - `source: 'ai' | 'user' | ...`：修订来源（目前主要是 `ai`）。
- 渲染风格（可根据设计稿调整）：
  - `insert`：绿色下划线。
  - `delete`：红色删除线。

**约定**：  
同一个 `revisionId` 表示一次连续的「修订会话」，一个块内所有该 `revisionId` 对应的 `revisionMark` 构成可接受/拒绝的整体。

> 注意：当前 `revisionMark` 只是 pending 的投影。接受/拒绝通过 `RevisionCommands.js` 的 mark 命令完成，并会同步清理后端 pending 记录。

### 2. RevisionStore（修订会话状态管理）

- 文件：`store/useRevisionStore.ts`
- 作用：**为每个 Editor 实例维护一个修订会话 Store**，跟踪当前文档中有哪些块有 pending 修订、全局统计、以及与后端的同步。
- 单例策略：

```ts
const storeInstances = new WeakMap<Editor, RevisionStore>()

export function useRevisionStore(editor: Editor): RevisionStore {
  if (!storeInstances.has(editor)) {
    storeInstances.set(editor, createRevisionStore(editor as EditorWithRevisionCommands))
  }
  return storeInstances.get(editor)!
}
```

#### BlockRevisionState 结构

```ts
export interface BlockRevisionState {
  blockId: string            // RootBlock 的 attrs.id
  revisionId: string         // 修订会话 ID
  status: 'pending' | 'applied' | 'discarded'
  fromVersionId?: string     // 未来与版本历史打通时使用
  toVersionId?: string
  diffStats?: {              // 插入/删除统计
    insertCount: number
    deleteCount: number
  }
  createdAt: number
}
```

#### Store 暴露的主要方法

- `startRevision(params)`：记录某个 `blockId` 的一次新的修订会话，初始 `status = 'pending'`。
- `getRevisionState(blockId)`：获取当前块的修订状态；仅在 canonical 已存在时，允许用文档中的 mark 恢复投影层缓存。
- `hasPendingRevision(blockId)`：判断当前块是否存在**待处理修订**。
- `acceptAllRevisions(blockId)`：接受该块的一次修订会话（调用 `acceptAllRevisionsInBlock` 命令）。
- `rejectAllRevisions(blockId)`：拒绝该块的一次修订会话（调用 `rejectAllRevisionsInBlock` 命令）。
- `acceptSingleRevision` / `rejectSingleRevision`：保留单个片段级别操作（当前主线 UI 未接入，可用于未来细粒度交互）。

#### 状态与文档的“自动校正”

撤销 / 重做会改变文档中的 `revisionMark` 投影，如果只改 Store 而不参考文档，很容易出现：

- 已接受 -> 撤销后，文档有 mark，但 Store 还认为是 `applied`；
- 已拒绝 -> 撤销后，文档有 mark，但 Store 还认为是 `discarded`。

为了解决这一点，`getRevisionState` 会（仅针对非 `pending-xxx`）：

1. 根据 `blockId` 找到 `rootBlock` 在文档中的 `pos`。
2. 在该块范围内扫描是否有指定 `revisionId` 的 `revisionMark`。
3. 按以下规则修正：
   - 如果 **文档中有 mark** 且 `status !== 'pending'` ⇒ 恢复为 `pending`（说明撤销了）。
   - 如果 **文档中没有 mark** 且 `status === 'pending'` ⇒ 认为已“完成”，置为 `applied`。

这保证了 **canonical pending 是事实源，文档 mark 是投影层**，状态永远能在下一次读取时与 pending 对齐。

#### Undo/Redo 后端同步

当用户 accept 后撤销，`getRevisionState` / `reconcileCanonicalWithDocument()` 检测到"有 mark 但 canonical 已清"时，会：

1. 从 `pendingDTOShadow`（缓存的原始 DTO）恢复 canonical session（同步，立刻更新全局统计）。
2. 将 blockId 加入 `pendingBackendWriteQueue`，异步批量写回后端（debounce 300ms）。
3. 对离屏块，`editor.on('transaction')` 的 debounced `reconcileCanonicalWithDocument()` 做全文档对账。

> **三层数据模型**：`canonicalPendingSessions`（全局事实源，后端 DTO 构建）→ `activeRevisions`（mark 投影层，块级 UI）→ `pendingDTOShadow`（undo 恢复缓存，文档生命周期内不清除）。

### 3. pending 注入与 blockId 一致性（结构同步）

为了保证前后端 **blockId 一致性**，当 `markdown_edit` 产生新的 insert pending 时：

- 后端会先创建空 `rootBlock`（块实体），再写入 pending；
- 前端在应用 pending 前，如果发现 **editor 中缺少对应的 blockId**，会以 **后端 `content_json` 的 rootBlock 顺序为准** 同步结构：
  - 复用 editor 中已有的 rootBlock（保留用户编辑内容）；
  - 对缺失的 rootBlock 从后端内容构建并插入；
  - editor 中独有的 rootBlock 会按原顺序追加到末尾（避免数据丢失）。
- 该行为在 editor 处于 dirty 状态时同样执行，避免 “因跳过同步导致 pending 插入失败” 的问题。

> 注意：结构同步只使用后端生成的 blockId，不会引入新的 id；同步仅调整结构，不覆盖用户编辑的块内容。

---

## 命令层：RevisionCommands.js

文件：`extensions/core/commands/RevisionCommands.js`

这些是 Tiptap RawCommands，用于在「块级」上对 `revisionMark` 执行批量操作，`useRevisionStore` 会通过 `editor.commands.xxx` 调用它们。

### 1. acceptAllRevisionsInBlock(blockPos, revisionId)

**语义**：

- 只处理 `blockPos` 指定的 `rootBlock` 范围内、`attrs.revisionId === revisionId` 的 `revisionMark`。
- 行为：
  - `changeType === 'delete'`：真正删除这段文字。
  - `changeType === 'insert'`：仅移除 mark，保留文字。

实现细节：

- 使用 `doc.nodesBetween(blockStart, blockEnd, ...)` 收集所有需要处理的 `from/to/changeType`。
- 按 `from` 倒序排序，避免删除造成的位置偏移。

### 2. rejectAllRevisionsInBlock(blockPos, revisionId)

**语义**：

- 与 `acceptAllRevisionsInBlock` 相反：
  - `changeType === 'insert'`：删除文字。
  - `changeType === 'delete'`：移除 mark，恢复原文。

同样按倒序执行，避免位移问题。

### 3. clearBlockRevisionMarks(blockPos, revisionId?) 

**语义**：

- 清除某个块中全部 / 某个 `revisionId` 的 `revisionMark`，不改文字内容。
- 用于「清空修订标记」等场景。

---

## Diff 计算与应用

### 1. diffUtils.ts (基础层)

职责：**根据原文 / 新文，计算出更适合人类阅读和 UI 显示的 diff 片段**。

- 使用 `diff-match-patch`：
  - `diff_main(originalText, newText)` 获取初始 diff。
  - 使用 `diff_cleanupEfficiency` 做轻度清理（避免过度碎片化，又不会把整段当成全删全插）。
- 对外暴露基础能力：
  - `computeTextDiff(originalText, newText): DiffSegment[]`

### 2. richDiff.ts (核心层)

职责：**在纯文本 diff 的基础上，解析 Markdown 格式并附加到 insert 片段上**。

由于 AI 返回的文本通常带有 Markdown 格式（如 `**bold**`），纯文本 diff 会丢失这些格式信息。Rich Diff 流程如下：

1. **Linearize**：将编辑器中的当前文档抽取为带 marks 的 `TextSpan` 序列（`linearizeBlock.ts`）。
2. **Parse**：当前产品代码统一走 `markdownRuntime/`，不再依赖旧的本地 Markdown span parser。
3. **Basic Diff**：先计算纯文本 diff。
4. **Attach Marks**：遍历 diff 结果中的 `insert` 片段，根据新文本中的 marks 信息，**将大段 insert 拆分为多个带有精确 marks 的小片段**。
   - *修复说明*：采用逐字符扫描策略，确保如 `prefix**bold**suffix` 这样的混合文本能被正确拆分为 `insert("prefix")` + `insert("bold", {marks: ['bold']})` + `insert("suffix")`。
5. **Expand Equals**：检查 `equal` 片段，如果发现纯文本虽未变但 marks 变了（如加粗），则将其拆分为 delete（旧格式）+ insert（新格式）。

结果：`RichDiffResult`，包含带有 `marks` 属性的 diff segments。

### 3. diffApplier.ts (应用层)

职责：**把 Rich Diff 结果映射到 ProseMirror 文档**，为每一个插入/删除片段打上 `revisionMark`，如果是 insert 片段还会同时应用格式 marks。

关键点：

- 先把逻辑上的 diff 片段（insert/delete/equal）转成带位置的 diff 段（`originalStartPos/originalEndPos`）。
- 在一个 ProseMirror transaction 中统一处理所有片段，避免多次 transaction 导致 mapping 混乱。
- 对 delete 段的 end 位置映射使用 `tr.mapping.map(end, -1)`，防止删除 mark 错误“吃掉”后续插入文本。
- 对于 Rich Diff 产生的 `insert` 段，除了添加 `revisionMark` 外，还会调用 `tr.addMark` 应用加粗/斜体等格式。

---

## UI 层：BlockView + Revision UI

### BlockView.vue：挂载 RevisionIndicator & RevisionToolbar

- 挂载点：

```vue
<RevisionIndicator
  v-if="hasPendingRevision"
  class="block-revision-indicator"
  :status="blockRevisionState?.status || 'pending'"
  :insert-count="revisionDiffStats.insertCount"
  :delete-count="revisionDiffStats.deleteCount"
/>

<RevisionToolbar
  v-if="hasPendingRevision && isHovered"
  :visible="true"
  :block-id="props.node.attrs.id"
  :position="revisionToolbarPosition"
  :insert-count="revisionDiffStats.insertCount"
  :delete-count="revisionDiffStats.deleteCount"
  @accept-all="handleAcceptAllRevisions"
  @reject-all="handleRejectAllRevisions"
/>
```

- `hasPendingRevision` 由 Store 提供，自动考虑撤销/重做。
- hover 行为：
  - `pointerenter` 时立刻 `isHovered = true`。
  - `pointerleave` 时延时 200ms 再置为 `false`，允许鼠标从块移动到工具栏而不闪退。
  - 工具栏自身 hover 也会继续维持显示，避免鼠标移向右下角按钮时提前消失。
  - 由于 `BlockChrome` 是延迟水合的，挂载后还会同步检查一次 `:hover`，避免“鼠标已在块上但首次 `pointerenter` 已错过”导致工具栏不出现。

这样就完成了 **文档 + Store + UI** 三方的联动。

---

## 与 Agent 工具（markdown_edit）的集成路径（最终方案）

> 本节说明「AI 助手通过 Agent 工具编辑工作区文档」时，是如何落到 Revision 模块，并在**当前已打开文档中做到“无需切换 Tab、局部刷新修订”** 的。

### 1. 冷文档：只依赖 pending_revisions（当前方案）

- 后端工具（如 `markdown_edit`）往工作区数据库的 `markdown_block_pending_revisions` 表写入修订意图，**不直接改 content_json**。
- 当用户之后「打开 / 切换到」该文档时：
  - 前端通过 `workspaceGateway['read-document']({ documentId })` 读取文档；
  - `documentLoaderService` 在加载时会：
    - 用 `content_json` 初始化编辑器内容；
    - 将 `pendingRevisions` **注入 RevisionStore**（会应用为真实 `revisionMark`，并生成必要的块结构）；

这一条链路适用于**未在当前会话中打开过的文档（冷文档）**，行为等价于“稍后打开时看到修订标记”。

### 2. 热文档：通过 tool_output 事件触发「半条 read-document 流水线」

对于已经在 Editor 中打开的文档（热文档），如果简单复用完整的切换文件流程（重新 setContent），会覆盖用户当前未保存的编辑。因此最终方案是：

- **触发点**：  
- AI 助手在 Agent 模式下调用 `markdown_edit`；
  - 后端工具返回 `StructuredToolResult`，其中 `data` 至少包含：
    - `documentId: string`：目标文档 ID；
    - `blockId?: string`：可选，目标块 ID（若命中具体段落）；
    - `newMarkdown?: string`：本次 AI 产出的新版 Markdown 文本（主要供调试 / 观测）。
  - 该结果经 graph-engine 映射为 `RuntimeEvent(type = 'tool_output')`，再经 `SsePort` 发送为 `SSEToolOutputEvent`。

- **前端统一事件入口**（`apps/renderer/domains/conversation/store/assistant/projectionStore.ts`）：
  - 在 `handleSseEvent` 中处理 `event.type === 'tool_output'` 的情况；
  - 当满足以下条件时，触发 Revision 相关副作用：
    - `tool_name === 'markdown_edit'`；
    - `status === 'success'`；
    - 能从 `toolEvent.payload.result`（或 `output`）中安全解析出 `documentId`；
    - 当前 `fileStore.currentFilePath === documentId`（即 Editor 正在编辑同一文档）。

- **半条 read-document 流程（仅拉取 pendingRevisions）**：
  - 命中上述条件后，调用：

    ```ts
    const { pendingRevisions } = await workspaceGateway['read-document']({ documentId })
    ```

  - 与普通切换文件不同，这里**不会**重新 `setContent`，只消费 `pendingRevisions`；
  - 将这批 `pendingRevisions` **注入 RevisionStore**（会按统一主线投影为 `revisionMark`）：

    ```ts
    useRevisionStore(editor).setWorkspacePendingRevisions(pendingRevisions)
    ```

  - `useRevisionStore` 与 `BlockView` / `RevisionToolbar` 会自动响应，显示橙色竖线、`+N / -M` 等 UI。

综上，**热文档场景下的最终路径是：**

> `markdown_edit`（后端写 pending_revisions + 产出 tool_output）  
> → SSE `tool_output` 被 `projectionStore.handleSseEvent` 接收  
> → 若命中当前打开文档，仅通过 `read-document` 拉取最新 `pendingRevisions`  
> → 调用 `useRevisionStore(editor).setWorkspacePendingRevisions(pendingRevisions)` 注入 Store  
> → 应用为 `revisionMark`（含块级结构）并渲染  
> → Revision UI 自动更新，实现当前页“局部刷新”效果。

这样做的好处是：

- **与现有 Revision 模块完全对齐**：仍然通过 `useRevisionStore` 统一管理块级会话状态与 UI（Indicator/Toolbar），pending 会应用为 `revisionMark`，保证块级结构正确展示。
- **不会覆盖用户本地未保存编辑**：热文档只注入 pending metadata + 增量补齐空块实体，不重置 `content_json`。
- **冷 / 热文档共享同一套 pending_revisions 语义**：后端始终只写 pending revision，前端根据是否已打开文档选择「立刻应用」还是「下次打开时应用」。

---

## 开发注意事项

### 0. 删除块与 pending 清理（现状：前端实时 + 后端兜底）

> **背景**：pending revisions 是块级 metadata（存于 `markdown_block_pending_revisions`）。如果某个块被物理删除，而后端仍残留该 `target_block_id` 的 pending，就会产生“幽灵 pending”。

#### 当前实现（已基本解决主路径）

- **前端实时清理（主路径）**：
  - 编辑器通过统一的 `block-operation` 事件流在删块时发出 `BlockAction.DELETE`（无论键盘删除、菜单删除、合并导致的删除等）。
  - `BlockLifecycleExtension` 只把**真实用户内容事务**里的 rootBlock 缺失转换成 `BlockAction.DELETE`。
    pending 投影、RootBlock 渲染虚拟化、citation 派生等事务都必须携带 `EDITOR_EPHEMERAL_TRANSACTION_META`，
    生命周期插件会刷新 rootBlockId 快照，但不会发出删除事件。
  - Revision 在 `apps/renderer/domains/editor/features/Revision/blockLifecycle/RevisionBlockEventHandler.ts` 监听该事件：
    - 清理前端状态：`revisionStore.clearRevision(blockId)`
    - 同步清理后端：`revisionStore.clearBackendPendingForBlock(blockId)`（IPC → 删除对应 pending 行）
  - 结果：用户在前端删块时，pending 基本不会残留为“僵尸记录”。

- **接受/拒绝后清理**：
  - 对 workspace pending（`pending-xxx`）：
    - `acceptAllRevisions` / `rejectAllRevisions` 会在用户点击后调用 IPC 清理后端 pending，并同步更新 Store。
  - 对 delete 类型导致的“物理删块”：
    - 如果最终走到了删块命令路径（触发 `block-operation`），会由上面的生命周期监听器继续兜底清理。

#### 后端兜底（跨会话/异常中断）

即使前端实时清理覆盖了主路径，仍可能出现跨会话/冷文档/异常退出导致的残留。为此后端提供启动后一次性维护任务：

- 启动后维护编排器：`src/electron-main/services/startup/startupMaintenanceRunner.ts`
- Workspace 维护入口：`src/electron-main/services/workspace/workspace-maintenance.ts`
- 具体清理逻辑：`MarkdownOrphanBlockDataCleaner.cleanupDocumentOrphans(documentId)`
  - 会基于最新 `content_json` 的 rootBlockId 集合，删除所有 `target_block_id` 已不存在的 pending / blockVersions；批注随 root block 正文本身删除。

#### 仍需注意的边界

- 如果“删块”发生在**不经过当前 editor/eventBus** 的路径（例如另一个会话/后端直接改结构），实时清理不会触发，但启动维护会在下次启动时清掉孤儿记录。
- 如果控制台出现 `[BlockLifecycleExtension] 内部渲染事务出现 rootBlock 删除`，说明某个“视觉事务”真的改变了 rootBlock 结构。
  这类事务仍会被阻止触发 pending 清理，避免 10000 pending 在滚动投影中被误删；但它本身是需要继续追查的结构性 bug。

---

### 1. 严禁使用 any 进行随意断言

- Revision 模块与 ProseMirror / Tiptap / 自定义命令高度耦合，类型一旦写成 `any`，非常容易在命令调用 / attr 访问时埋雷。
- 建议：
  - 对扩展过命令的 `Editor` 定义显式交叉类型（如 `EditorWithRevisionCommands`）。
  - 对 mark attrs 定义 TypeScript 类型（如 `RevisionMarkAttrs`），并在访问时使用类型缩小。

### 2. 块级批量修改优先使用现有命令，文档级 Accept/Reject All 必须走后端 apply-all

- 块级已有命令（`RevisionCommands.js`）已经处理好了：
  - 仅在特定块范围内操作。
  - 仅针对特定 `revisionId`。
  - 倒序处理，避免位移错误。
- `useRevisionStore` 里不要重复造輪子去直接操作 `tr.delete/removeMark`，统一通过：

```ts
editor.commands.acceptAllRevisionsInBlock(blockPos, revisionId)
editor.commands.rejectAllRevisionsInBlock(blockPos, revisionId)
```

- 文档级“接受全部 / 拒绝全部”是性能敏感路径，禁止再写成“遍历所有 blockId 后逐块 dispatch”。正确入口是：

```ts
workspaceGateway['apply-all-pending-revisions']({ documentId, mode: 'accept' })
workspaceGateway['apply-all-pending-revisions']({ documentId, mode: 'reject' })
```

后端会一次性返回新的 `docJson`，前端只通过 `loadDocumentJsonAtomically()` 做一次严格原子切换；失败时保留旧 state，且不执行成功收尾或逐块 fallback。

### 3. 撤销 / 重做 一定要考虑「状态 + 文档」的同步

- 任何维护「修订状态」的逻辑，都不能只改 Store，而不参考文档中的 mark。
- 原则：**文档是真相，Store 是缓存/视图**。  
  在读取状态时，一定要有一层“和文档比对”的逻辑（当前在 `getRevisionState` 中实现）。

### 4. Hover / 工具栏行为要稳健

- 工具栏的显示条件是：`hasPendingRevision && isHovered`。
- 对于 hover：
  - 不要在 `pointerleave` 时立刻隐藏，否则用户难以从块移动到工具栏。
  - 强烈建议使用「延时隐藏 + 进入时清除定时器」的模式（当前实现已经这么做）。

### 5. Pending 注入事务的 `pendingRevisionApply` meta 约定

所有 pending revision 注入过程中 dispatch 的 ProseMirror 事务都必须携带 `tr.setMeta('pendingRevisionApply', true)`。
同时必须通过 `core/transactions/editorTransactionMeta.ts` 的 `markPendingRevisionProjectionTransaction(tr)` 或 `getPendingRevisionProjectionTransactionMeta()` 写入 `addToHistory=false`。

**目的**：pending 注入时会产生大量连续 dispatch（100+ 块全文 pending 时），每次 dispatch 都会触发所有 `appendTransaction` 插件。携带此 meta 后，以下插件会 early return：

- `UniqueIdsExtension.js`：pending 注入的块已有后端分配的唯一 ID，不需要重复校验。
- `AnnoLayoutPlugin.js`：注入完成后由用户滚动/渲染自然触发布局重算，注入期间无需逐条重排。
- `citationRenderPlugin.ts`：`state.apply` 跳过全量派生重算；插件只维护读模型，不再同步改写 token 文本。
- `CitationFeatureExtension.ts`：跳过 `scanDocForCitations` 全文档遍历。
- `TableCellInteractionExtension.js`：跳过表格交互状态更新。
- `TableVerticalNavigationState.ts`：跳过垂直导航状态更新。

`addToHistory=false` 是内存边界，不是小优化。pending 投影只是把后端事实源渲染成 `revisionMark`，不是用户编辑；如果这类事务进入 ProseMirror history，10000 块文档的旧 doc state 会被 undo 栈保留，滚动投影几轮后 JS heap 可能涨到 GB 级。所有新增 pending 投影入口、citation 派生空事务、table pending helper 都必须复用统一 helper，禁止在调用点手写一半 meta。

`EDITOR_EPHEMERAL_TRANSACTION_META` 也是生命周期边界。只要事务属于“把已有事实渲染出来”的内部过程，就不能让 `BlockLifecycleExtension` 把它解释成用户删块；否则 `RevisionBlockEventHandler` 会调用 `clearRevision` 与 `clearBackendPendingForBlock`，表现为“待处理修订块数没有点击接受/拒绝也在快速下降”。

### 5.1 Dispatch 批处理（`withBatchedPendingDispatches`）

除了单次事务的 meta 检查外，`workspacePending.ts` 与 `pendingProjectionWindow.ts` 还通过 `withBatchedPendingDispatches` 包装器在整个投影期间拦截 `view.updateState`，将 N 次 DOM 协调降为 1 次。同时在 editor 实例上设置 `_isPendingRevisionBatch` 标志，`editorFactory.js` 的 `onUpdate`/`onTransaction` 检查此标志并 early return，跳过字符统计、批注重算、dirty 标记等副作用。

`withBatchedPendingDispatches` 还承担同一 editor 上的 pending 批次串行化。大文档虚拟化下，Shell 可见性桥和块级 `useBlockRevision` 可能在同一帧内为多个 rootBlock 触发窗口投影；如果这些异步批次并发执行，每个批次都会基于各自开始时的旧 doc 创建 transaction，先完成的批次改变 doc 后，后完成的批次再 dispatch 旧 transaction 就会触发 ProseMirror 的 `Applying a mismatched transaction`。因此并发入口必须统一经过这个批处理器排队，不能在调用点自行 patch `view.updateState`。

投影内部又拆成两段：

1. **并行 prepare**：对不同 blockId 的 update/delete pending 并行做 citation hydration、Markdown runtime 解析、块类型探测和 RichDiff 计划构建。这些步骤不写 `megaTr`，只读稳定的 `editor.state.doc`，避免 20 个可见 pending 串行等待 WASM / diff。
2. **串行 apply**：prepare 完成后，按输入顺序在同一个 `megaTr` 上重新按 blockId 定位、做必要的块类型转换，再执行 `executePendingPlanToTr`。这一步必须串行，因为前一个 `replaceWith` 会改变后续节点的 position。

如果同一批里出现重复 blockId，会自动回退旧串行路径，保留“同块连续 pending 复用演进中 megaTr doc”的语义；真实大文档可见窗口的主路径通常是一批不同 blockId，因此会走并行 prepare。

注入完成后，`workspacePending.ts` 只在必要时触发 `forceCitationDerivation`：

- 当前 citation render plugin state 已经存在 citation 实例；
- 或本批 pending 的 `newMarkdown` 包含 `[@...]`；
- 或 pending `metaJson` 包含非空 `citation_hydration`。

无引用的普通 pending 文档不会再额外 dispatch 一次空 transaction，避免 citation 插件做无意义的全文档派生。
必要的 citation 派生空事务同样是视觉/派生刷新，必须通过 `markCitationDerivationTransaction(tr)` 标记为非 history。

### 5.2 Pending 注入性能埋点

`workspacePending.ts` 会记录一次 pending 注入内部各阶段耗时，并把最近 20 次采样挂到：

```ts
window.__REVISION_PERF__
```

可用命令：

```ts
window.__REVISION_PERF__.getLast()
window.__REVISION_PERF__.getHistory()
window.__REVISION_PERF__.clear()
window.__REVISION_PERF__.setVerbose(true)
window.__REVISION_PERF__.setConsoleEnabled(false)
```

采样字段：

- `pendingCount`：本次 pending 数量。
- `canonicalBlockCount`：canonical session 数量。
- `successCount / failedCount`：投影成功/失败数量。
- `forceCitation`：本次是否触发 citation 强制派生。
- `totalMs`：从 `setWorkspacePendingRevisionsImpl` 入口到 flush/citation 结束的总耗时。
- `stages.shadow`：写入 `pendingDTOShadow` 耗时。
- `stages.canonical`：构建 canonical sessions 耗时。
- `stages.parse`：解析 pending DTO metadata 耗时。
- `stages.plan`：构建 pending execution batches 耗时。
- `stages.apply`：执行 pending projection / RichDiff / transaction 构建耗时。
- `stages.flush`：`withBatchedDispatches` 最终 `view.updateState` flush 耗时。
- `stages.citation`：注入后的 citation 强制派生 dispatch 耗时。

低噪声策略：

- 采样始终记录到 `window.__REVISION_PERF__`；
- 控制台默认只在 `pendingCount >= 20`、`totalMs >= 100ms`、或发生错误时输出一条汇总；
- 需要临时看所有采样时，用 `window.__REVISION_PERF__.setVerbose(true)`。

#### 5.2.1 Pending 投影批次诊断

首开注入埋点只能告诉我们 `stages.apply` 很慢，但不能区分慢在 Markdown runtime、RichDiff、transaction 构建还是真正的 ProseMirror dispatch。窗口化投影因此额外维护一个低噪声批次诊断入口：

```ts
window.__REVISION_BATCH_PERF__.getLast()
window.__REVISION_BATCH_PERF__.getHistory()
window.__REVISION_BATCH_PERF__.clear()
```

控制台默认只在以下情况输出一条 `[RevisionPerf] non-insert pending batch` 汇总：

- 单批总耗时 `>= 500ms`；
- 单批存在失败、异常或 fatal error；
- `editorFeatureFlags.revisionDebugLogging` 显式开启。

报告里的关键字段：

- `stages.hydrationMs / resolveMs / planMs`：准备阶段耗时。`planMs` 高通常指向 RichDiff 或 table 计划构建，`resolveMs` 高通常指向 Markdown runtime / WASM 解析。
- `stages.yieldMs`：准备阶段主动让出主线程的等待耗时。短普通单行文本走 `plain-text-fast-path` 时会跳过这层固定让帧；复杂 Markdown、引用水合、delete、超长纯文本等路径仍然保守让帧，避免把同步计算堆进同一帧。
- `stages.locateMs / convertMs / executeMs`：把准备好的计划写入 `megaTr` 的串行应用耗时。
- `dispatchMs`：真正 `editor.view.dispatch(megaTr)` 的耗时。如果它很低但 `totalMs` 很高，卡顿不在 PM flush，而在 dispatch 前的同步 CPU。
- `registerMs`：投影成功后写入 `RevisionStore.startRevision` 的耗时。
- `slowestPrepare / slowestApply`：最多保留 3 个最慢块样本，避免刷屏但能定位具体块类型。
- `errors`：最多保留 8 个错误样本。单块 prepare 异常会被记录为失败 detail，不会让整批静默中断。

`slowestPrepare[].resolutionSource` 用来判断 Markdown 解析路径：

- `plain-text-fast-path`：确认是单行普通文本且没有真正 Markdown 结构，直接构造 `baseBlock` spans，不进入 WASM runtime。行内 `#` 与裸 `[]()` 本身不算 Markdown 结构，只有 link / image / footnote / reference link 等组合语法才会回退 runtime。
- `runtime-single-block`：通过 Markdown runtime / WASM 解析得到语义块，适用于 table、heading、inline latex、link、citation 等复杂语义。
- `heuristic-fallback`：runtime 无法直接消费时，回退到历史启发式路径。

#### 5.2.2 Shell header / 渲染窗口诊断

大文档滚动时，Shell header 和 render engine 都会跟随窗口高频运行，不能逐帧 `console.log`。当前诊断默认写入内存 ring buffer：

```ts
window.__RENDER_VIRT_ENGINE_PERF__.getLast()
window.__RENDER_VIRT_ENGINE_PERF__.getHistory()
window.__SHELL_REVISION_HEADER_PERF__.getLast()
window.__SHELL_REVISION_HEADER_PERF__.getHistory()
window.__SHELL_PENDING_PROJECTION_PERF__.getLast()
window.__SHELL_PENDING_PROJECTION_PERF__.getHistory()
```

控制台只在慢刷新、miss 异常、早退异常，或显式开启调试时节流输出：

```ts
window.__EDITOR_FLAGS__.set('renderVirtualizationDebugLogging', true)
```

关键判断：

- `__RENDER_VIRT_ENGINE_PERF__.getLast().hydratedCount`：真实已 hydrate 的窗口大小，Shell pending 投影只消费这个集合。
- `__SHELL_REVISION_HEADER_PERF__.getLast().slotMissCount`：大于 0 说明 ProseMirror NodeView 没给 hydrated 块创建 header slot。
- `__SHELL_PENDING_PROJECTION_PERF__.getLast().reason`：`no-candidates` 表示当前 hydrated window 没有可投影 canonical pending，`projected` 表示已经把候选块交给 RevisionStore，`in-flight` 表示上一批还在执行。
- `__SHELL_PENDING_PROJECTION_PERF__.getLast().candidateCount`：真实会进入投影的块数。它只统计 canonical pending 存在且尚未 active 的块，不等于 hydrated 块总数。
- `candidateBlockIds / skippedActiveBlockIds / skippedNonPendingBlockIds`：每类最多保留 12 个 blockId 样本。排查“往下滚动没有 pending”时，先看目标块是否落在 `skippedNonPendingBlockIds`；如果是，问题在 canonical / 后端 pending 匹配，不在虚拟化 hydrate。
- `outerMissCount`：大于 0 说明 engine state 与 DOM 查询不一致。
- `sessionMissCount`：接近 hydratedCount 通常表示当前窗口没有 pending，或 pending blockId 与文档块不匹配。

当前窗口可以用开发工具进一步摊平成表格：

```ts
await window.__REVISION_TEST__.diagnoseWindow()
```

`diagnoseWindow()` 默认优先按当前 DOM 视口重新采样 `.root-block-outer`，不再把 render engine / pending projection / header 三个 perf ring buffer 的历史样本混在一起。表格里的 `sampleSource` 用来说明样本来源：

- `current-dom`：当前屏幕真实采样，最可信；
- `engine-perf`：当前 DOM 没采到时，退回最近一次 render engine 样本；
- `projection-perf` / `header-perf`：只作为兜底，可能不是当前帧，不能当作当前屏幕结论。

如果 `sampleSource=current-dom` 的行里 `backendPending=false` 且 `canonical=false`，说明当前滚动窗口本来没有测试 pending。常见原因是只执行了 `seed(220)`，或者历史 `seed(10000)` 写库只成功了一部分。现在 `seed(count)` 会做严格覆盖校验：后端读回的 pending 必须与目标 rootBlock 一一对应，否则直接中止并打印缺失样本，禁止继续用不完整数据做压测。要测试真正的“一万块一万条 pending”，应该使用：

```ts
await window.__REVISION_TEST__.clear()
await window.__REVISION_TEST__.seed(10000)
await window.__REVISION_TEST__.diagnose()
```

`diagnose()` 的期望结果是 `documentBlockCount=10000`、`pendingCount=10000`、`matchingPendingCount=10000`、`missingPendingCount=0`、`duplicatePendingCount=0`。

Shell header 首次出现/消失会改变块高度。现在只调用 `RenderVirtualizationEngine.remeasureHydratedWindow(...)` 回写高度缓存，不再触发完整 engine refresh / notify，避免形成 `header layout -> engine refresh -> header sync` 的滚动期反馈环。

这个快路径只覆盖“确定不是 Markdown 的单行纯文本”。任何包含 `* _ [ ] ( ) ! # | \\ $`、代码反引号、引用/列表/标题前缀、表格或换行的内容都会继续走 runtime，避免为了性能猜错语义。

大文档策略：

- `editorFeatureFlags.deferPendingProjectionForLargeDocuments` 默认开启；
- 当文档 `rootBlock >= 1500` 或 pending 数量 `>= 100` 时，首开只构建 canonical pending sessions，不同步投影 `revisionMark`；
- 这样文档级 Accept/Reject All 仍然走后端 apply-all，能覆盖所有 pending；
- 块内行级修订视图通过 `pendingProjectionWindow.ts` 按需补齐，避免在首开阶段一次性改写 10000 个块。

### 5.3 Pending 投影窗口（大文档第一阶段）

大文档首开时，`setWorkspacePendingRevisions` 只完成两件轻量工作：

1. 把后端 DTO 写入 `pendingDTOShadow`。
2. 构建 `canonicalPendingSessions`，让全局统计、块级橙线状态、文档级 Accept/Reject All 立刻可用。

真正把 pending 应用成 `revisionMark` 的动作推迟到窗口内：

- `useBlockRevision` 只在块被激活且存在 canonical pending 时触发 `projectPendingRevisionsForBlocks([blockId])`。
- 大文档虚拟化主路线里，入屏块是裸 DOM `RootBlockDomNodeView`；`orchestration/shellPendingProjection/setupShellPendingProjectionBridge.ts` 作为 Revision 侧 editor 级编排，订阅 render engine 的 hydrated window，并先筛出“canonical pending 存在、且尚未 active 投影”的候选块，再批量传给同一个入口。`EditorContext.vue` 只负责安装 / 卸载这条桥接，不承载 pending 投影规则。滚动刷新由 editor 主滚动入口统一驱动；pending 加载、visibility 变化只调度同一份快照，不再各自维护投影队列。
- `useShellBlockVisibilityBridge.ts` 只服务非虚拟化 Shell 压测路径的 DOM 可见性注册；虚拟化主路线由 RenderVirtualization engine 的 hydrated window 驱动。
- Shell 压测路径的块级 pending UI 仍可通过 `RootBlockShellView` 的 header slot 验证原生壳能力；虚拟化主路线不使用这套 header，避免和 Host 修订状态行形成两套 UI。
- `RevisionOverlayLayer` 不发起 pending materialize，也不再渲染 pending header；它只负责 hover / selection 时的块级 Accept/Reject 工具栏判定并发布 blockId。虚拟化主路径下，按钮本体由 `BlockChromeHostRevisionToolbar` 渲染到当前 `.root-block` 内；非虚拟化 Shell 压测路径仍可使用 overlay 旧渲染。toolbar 只测量 hover / selection / toolbar 保活的少量强制块，不能再遍历整个 viewport snapshot。这样 pending 投影只有一个调度入口，header 也不再需要 overlay 量坐标后再改真实布局。
- Shell 压测路径的 header 必须保持块顶部文档流语义：禁止用 `padding-top`、absolute overlay 或“测量后再改布局”的方式制造占位。虚拟化主路线中，placeholder 块不显示 header；块被 hydrate 成 `RootBlockDomNodeView` 后，由 `BlockChromeHostRevisionIndicator` 显示修订状态。
- `pendingProjectionWindow.ts` 根据 `canonicalPendingSessions + pendingDTOShadow` 选择还没有 active 投影的块。
- `setupShellPendingProjectionBridge.ts` 只投影已经 hydrated 且仍有 canonical pending 的候选块。placeholder 快照只负责唤醒 RenderVirtualization hydrate；等 hydrate dispatch 完成并重拍快照后，pending 才进入 Markdown resolve / RichDiff。投影候选按 `visibleBlockIds` 优先、`hydratedBlockIds` 补充排序；普通首开仍优先走 `requestIdleCallback`，让正文和 header 先 paint，滚动纠偏 / 跳转 / 键盘定位后的当前可见窗口则走下一帧补齐，避免远距离滚动后眼前 pending 长时间空白。Shell bridge 单次只投影少量候选块，剩余候选块排到后续 idle/帧调度，这样用户拖动到新窗口时不会被旧窗口的大批 pending 长时间占住。候选块筛选发生在 bridge 内部，节流 key 也只使用候选块，避免 pending 快照到达前的“空候选窗口”污染后续投影。
- 同一个块正在投影时会进入 `projectingBlockIds`，避免滚动和 hover 重复触发。Shell snapshot 的重复投影节流为 `80ms`，底层 prepare 并行后不再用长节流掩盖慢投影。
- 单批默认最多 20 个块，批内仍复用 `applyPendingRevisionsToEditor` 与 `withBatchedPendingDispatches`，保证执行路径与旧全量投影一致。
- `revisionReconciliation.ts` 只允许清理“同一个 revisionId 已经进入 active 投影层、但文档 mark 后来消失”的 canonical session。canonical-only 块没有 `revisionMark` 是懒投影的正常状态，不能再按旧逻辑当成已应用，否则 10000 pending 会在虚拟化滚动中被误清。

这一步不是完整的 render placeholder 虚拟化，但它把 Revision 自己的责任边界先切干净了：

- `Revision` 只负责“哪些 pending 需要投影，以及如何投影”；
- editor 的 RenderVirtualization 只需要在 hydrate 某个 rootBlock 后调用同一个公开入口；
- 文档级 Accept/Reject All 不依赖 active 投影，所以即使用户没有滚到某些块，也不会丢 pending。

注意：Revision 模块只负责 pending 的数据与投影成本，超长文档真正的渲染成本由 editor 层统一治理。完整链路请看 `apps/renderer/domains/editor/README.md` 的“超长文档渲染性能方案”，核心包括：

- pending 首开暂缓全量 `revisionMark` 投影；
- `direct-state` 原子文档切换，绕过 Tiptap 全文 replace transaction，并同步 `@tiptap/vue-3` 的内部 `reactiveState`；
- `RootBlockShellView` 原生 Shell NodeView，避免为 10000 个块创建完整 Vue UI 树；
- `editorOpenPerf` + `revisionPendingPerf` 双埋点，区分瓶颈是在 pending 投影还是 ProseMirror 渲染。

**新增/修改 `appendTransaction` 插件时务必注意**：如果插件在注入期间不需要执行，应检查此 meta 并 early return；如果必须在注入期间执行（例如维护某种不可延迟的一致性约束），则不加此检查。

**涉及的 dispatch 点**：
- `diffApplier.ts`（通过 `transactionMeta` 参数）
- `pendingRevisionHelpers.ts` 的 `markWholeBlockAsInsert`
- `updatePendingRevisionApplier.ts` / `nonInsertPendingRevisionBatchApplier.ts` / `insertPendingRevisionApplier.ts` 的表格替换事务
- `workspacePending.ts` 的清理事务

### 6. 扩展 / 新功能的建议路径

- **细粒度接受/拒绝**：
  当前仍以块级 `RevisionToolbar` 为主；`acceptSingleRevision` / `rejectSingleRevision` 与 `RevisionMarkPopup` 仍可作为未来细粒度交互的扩展基础。
- **与 BlockHistory 集成**：  
  利用 `fromVersionId` / `toVersionId` 将一次 AI 修订与历史版本关联起来，实现「AI 结果 vs 历史版本」的对比。
- **多来源修订**：  
  使用 `source` 字段区分 `ai` / `user` / `import` 等来源，可以在 UI 层通过不同颜色 / 图标区分。

---

### 7. 保存语义：fork-reject 策略

> **核心原则：`content_json` 只存储基线内容，不包含 workspace pending 的投影（revisionMark、insert 块等）。**

保存时通过 `utils/stripPendingFromJSON.ts` 在 JSON 层面剥离投影：

- **insert 块**（`operation='insert'`）：整个 rootBlock 移除（AI 新增的占位块，基线中不存在）。
- **update/delete 块中的 revisionMark**：
  - `changeType='insert'` 的文本节点：移除（AI 新增的文字）。
  - `changeType='delete'` 的文本节点：保留文字，剥离 revisionMark（恢复原始文字）。

调用点：`workspace/services/file-manager/handlers/markdown.ts` 的 `serializeEditorContent`。

保存前还会调用 `reconcileCanonicalWithDocument()` 做全文档对账，确保 undo 恢复的离屏块也能在保存前同步到后端。注意：对账只把文档 mark 作为“投影层证据”，不会因为 canonical-only 块尚未投影 mark 就清理后端 pending。

### 8. 后端 IPC 通道一览

| 通道 | 方向 | 用途 |
|---|---|---|
| `workspace:read-document` | 后端→前端 | 读取文档 + pendingRevisions |
| `workspace:set-pending-revision` | 前端→后端 | 写入/覆盖单条 pending（upsert） |
| `workspace:set-pending-revisions-batch` | 前端→后端 | 批量写入 pending（测试工具/undo 恢复） |
| `workspace:clear-pending-revision` | 前端→后端 | 清理单条 pending（accept/reject） |
| `workspace:clear-all-pending-revisions` | 前端→后端 | 清理文档下所有 pending |

前端统一门面：`store/backendPending.ts`。

### 9. 接受 / 拒绝操作性能诊断

万行 pending 文档下，接受 / 拒绝的耗时需要拆开看：

- **块级接受 / 拒绝**：入口在 `store/revisionBlockActions.ts`。默认路径是 `resolve`（必要时 hydrate + 投影）→ `command`（PM 块内接受/拒绝）→ `save` → `backend` 清理。
- **canonical-only 快路径**：
  - `reject update/delete`：正文无需变化，直接清本地 canonical + 后端 pending，不再为了拒绝而先 materialize `revisionMark`。
  - `reject insert`：直接删除 insert 占位 rootBlock。
  - `accept delete`：直接删除目标 rootBlock。
  这些路径避免了 Markdown 解析、RichDiff 和 PM mark 投影，尤其适合用户在 header 先出现、diff 尚未投影时立即操作。
- **文档级接受 / 拒绝全部**：走 `workspace:apply-all-pending-revisions`，由主进程一次性在 docJson 层合并并校验，再由前端严格原子装载。IPC 失败、后端拒绝或 Renderer 装载失败都不执行逐块 fallback；只有两端都成功才清 canonical/runtime 并标 clean。

调试入口：

```js
window.__REVISION_ACTION_PERF__.getLast()
window.__REVISION_ACTION_PERF__.getHistory()
window.__REVISION_ACTION_PERF__.setVerbose(true)
```

采样会记录 `resolve / command / save / backend / backendIpc / replaceDocument` 等阶段，默认只在大批量、慢操作或失败时输出一条汇总日志，避免刷屏。

---

## 如何快速上手开发 / 调试

1. 在编辑器中输入一段较长文本。
2. 通过块菜单点击「✨ AI 润色」：
   - 文本中应出现绿色下划线（插入）和红色删除线（删除）。
   - 左侧块边出现橙色竖线，右上角显示 `+N / -M`。
   - hover 块时，在右下角出现修订工具栏。
3. 点击「接受」/「拒绝」：
   - 检查文本是否符合语义；
   - 工具栏与指示器是否消失。
4. 立刻按 `Cmd+Z`：
   - 文本恢复带 mark 的状态；
   - 再 hover 块，工具栏和指示器应自动恢复。
   - **验证后端同步**：全局工具栏应重新出现，说明 canonical session 已从 shadow 恢复。
5. 如需观察 diff 行为细节，可运行：

```bash
npx vitest --reporter=dot apps/renderer/domains/editor/features/Revision/utils/richDiff.spec.ts
```

并在 `richDiff.ts` 中使用 `console.log` 观察 `attachMarksToSegments` 的拆分逻辑。

### Pending Citation 链路调试

当 AI 插入 `[@ref]` 没有被解析为 `[1]` 时，按以下日志逐层排查：

| 层 | 日志关键字 | 正常值 | 异常排查方向 |
|---|---|---|---|
| 后端 | `[MarkdownEditTool] hydration 完成` | `hydratedCount > 0` | ref 格式不合法 / knowledgeBaseService 缺失 |
| 桥接 | `[applyPendingRevisions] pending metadata 快照` | `hasCitationHydration: true` | `workspacePending.ts` 是否构造了局部 metadata 导致短路 |
| 水合 | `[applyInsertPendingRevision] hydration 准备完成` | `hasHydration: true` | `citation_hydration` 类型收窄失败 |
| Span 附着 | `[citationHydrationHelper] span 附着完成` | `token附着 > 0` | hydration key 与 `[@token]` 不匹配 |
| RichDiff | `[applyInsertPendingRevision] RichDiff统计` | `citationInsertSegments > 0` | `attachCitationHydrationToSpans` 未正确挂载 |
| diffApplier | `[diffApplier] citation 注入结果` | `appliedSegments > 0` | `PositionedRichSegment` 是否漏传 `citation` atom / schema 未注册 `citationNode` |
| 渲染 | `citationRenderPlugin` 派生 | instances > 0 | CitationNode attrs 不完整 / NodeView 未读取当前 state |

### 开发调试工具（`__devRevisionTest.ts`）

在 DevTools 控制台使用，走正式 IPC 后端链路（写 pending → read-document → 注入 store）：

> 重要：`seed()` / `inject()` 会先把**当前编辑器内容**强制同步到后端，再写入 pending。
> 这是为了兼容大文档 benchmark 的 `openDetached` / direct-state 压测路径：这些路径会替换编辑器内存态，但不一定触发普通 `requestSave('auto')` 的 dirty 保存。
> 如果不先强制同步，后端 `set-pending-revisions-batch` 会因为 `content_json` 中不存在当前 rootBlock ID 而拒绝写入，表现为“写入进度到了 N/N，但后端返回 0 个 pending revisions”。

```js
// 注入 100 个假修订（块不够会自动创建；先强制同步当前编辑器内容再写后端）
window.__REVISION_TEST__.inject(100)

// 注入 400 个
window.__REVISION_TEST__.inject(400)

// 只在后端生成 10000 条 pending，不立刻投影前端；
// 用于测试“重新打开文档时加载超大 pending”的真实首开链路。
await window.__REVISION_TEST__.seed(10000)

// 如果之前生成过坏数据，先清理再重新生成。
await window.__REVISION_TEST__.clear()
await window.__REVISION_TEST__.seed(10000)

// 可选：调大每批写入数量；默认 500，文档很大时建议先用默认值。
await window.__REVISION_TEST__.seed(10000, { chunkSize: 1000 })

// 可选：保留已有 pending 继续追加；默认会先清空当前文档旧 pending。
await window.__REVISION_TEST__.seed(10000, { clearExisting: false })

// 生成后立刻投影当前前端，用于测试当前会话投影耗时。
await window.__REVISION_TEST__.inject(10000)

// 打开/注入完成后查看最近一次 pending 注入性能分解
window.__REVISION_PERF__.getLast()

// 查看超长文档首开整体性能分解，包括 direct-state / NodeView / pendingInject
window.__EDITOR_OPEN_PERF__.getCurrent()
window.__EDITOR_OPEN_PERF__.finalize()

// 诊断后端 pending 是否都能匹配当前编辑器里的 rootBlock
await window.__REVISION_TEST__.diagnose()

// 查看当前 canonical sessions 状态
window.__REVISION_TEST__.dump()

// 清除所有修订（后端 + 前端 + marks 全清）
window.__REVISION_TEST__.clear()
```

**验证步骤**：
1. `inject(100)` → 全局工具栏出现，统计正确。
2. 切到其他页面 → 再切回来 → 全局工具栏仍然出现（后端持久化验证）。
3. 点击"接受全部" → 全局工具栏消失。
4. `Cmd+Z` → 全局工具栏重新出现（undo 后端同步验证）。
