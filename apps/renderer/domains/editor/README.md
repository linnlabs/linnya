## 平台 Markdown 富文本 Editor 概览

本目录是平台 Markdown 文档基于 **Tiptap / ProseMirror** 的块级富文本运行时，目标是提供类似 Notion 的“以块为中心”的编辑体验（块级拖拽、块级菜单、结构化扩展、Markdown 输入/流式写入等）。

这里的 `editor` 是平台 Markdown 文档的历史技术 domain 和 `activeDocumentType` 身份，不是插件体系中所有文档类型的通用“编辑器”。通用前端贡献统一称为 **Document Surface**：Markdown 使用本 domain，MindMap、Slides 和未来插件使用各自 surface，不实现或依赖 Tiptap 接口。

跨 domain 边界也按这个口径拆分：`documentSurfaceRuntimePort` 只负责任意文档 surface 的 ready 生命周期；`markdownDocumentEditorRuntimePort` 才负责取得或等待平台 Markdown Tiptap 实例。Workspace Markdown handler 只能通过后者访问实例，不能 deep import 本 domain 的 store 或实现。

相关架构文档：

- RootBlock 渲染虚拟化实现：[`features/RenderVirtualization/README.md`](features/RenderVirtualization/README.md)
- 大文档虚拟化演进路线：[`docs/virtualization-evolution-roadmap.md`](docs/virtualization-evolution-roadmap.md)
- 大文档性能基线与回归记录：[`docs/perf-baseline-2026-Q2.md`](docs/perf-baseline-2026-Q2.md)
- renderer 侧 Markdown 语义运行时：[markdownRuntime](./services/markdownRuntime/README.md)
- 后端 Markdown 文档领域：[Markdown domain](../../../../src/domains/markdown/README.md)
- Revision / Pending 性能链路：[Revision](./features/Revision/README.md)
- Provider outbound 开发调试面：[ProviderOutboundDebug](./features/ProviderOutboundDebug/README.md)

**设计原则（高信号）**：

- **高内聚、低耦合**：一个能力尽量在同一处闭环（UI / 扩展 / service / store），减少跨目录跳转。
- **职责清晰**：编辑器领域只关心“编辑器能力本身”，页面/布局/顶层视图切换属于 `app/`（见 `apps/renderer/app/pages/README.md`）。
- **扩展点收敛**：Tiptap 扩展的注册点以 `core/extensionRegistry.ts` 为唯一事实来源；跨模块依赖优先走注入（`core/types.ts` 的 `ExtensionDependencies`）。
- **大批量结构变更后移**：像 Revision “接受全部 / 拒绝全部”这类全文档操作，优先在后端 docJson 层一次性完成，再让前端通过严格原子装载入口切换一次 `EditorState`。不要在 renderer 里循环触发大量 ProseMirror transaction。

### 持久化 schema 与完整文档装载

- `core/extensionRegistry.ts` 是生产 Editor schema 的唯一注册点；正式持久化语义由后端 Markdown domain 的 `workspaceMarkdownSchemaContract` 拥有，`core/extensionRegistry.conformance.test.ts` 负责验证生产 Editor 覆盖全部 node、mark 和属性。
- `link` 是正式 Editor mark，唯一实现位于 `marks/Link.ts`，`href/title` 与后端合同一致；输入规则、HTML parse/render、命令和 Markdown 导出不得再各自维护替代实现。
- 普通首开、大文档首开、文档切换和 Revision Apply All 都必须调用 `services/editorDocumentStateLoader.ts` 的 `loadDocumentJsonAtomically()`。该入口先严格检查未知 node、mark、属性和内容表达式，再构建新 `EditorState`；prepare 成功前不得触碰当前 state。
- View/NodeView 切换抛错时，入口会恢复旧的 ProseMirror state 与 Tiptap Vue reactive state。失败调用方不得回退到宽松 `setContent`、不得把非法内容转成空文档，也不得继续执行标 clean 或清业务缓存等成功收尾。
- 大文档与普通文档的正确性语义相同；`rootBlock >= 1500` 只决定是否启用临时 DOM detach 性能策略，不再决定是否严格校验。

### 块身份

- `rootBlock.attrs.id` 是块实体身份，创建规则由 Editor schema/命令拥有；序列化器不生成、修剪或替换它。
- 跨 Editor 与 Workspace DocumentView 的共享校验定义是 `@app/schemas` 的 `DocumentBlockIdSchema`。
- `documentViewSerializer.ts` 在生成引用前校验每个 rootBlock ID 非空且文档内唯一；失败代表上游文档结构损坏，不能按位置补造 `unknown-block-N`。
- 虚拟化的 placeholder、height cache、runtime registry 和 scroll handshake 都继续使用同一个真实 block ID；本次合同收紧不引入新 key，也不改变虚拟化身份。

## 大文档内存诊断

编辑器有两类内存指标，不能混着看：

- `window.__EDITOR_MEMORY_PERF__`：只看当前 renderer 的 JS heap，适合判断 store、history、diff 计划等 JS 对象是否泄漏。
- Linnya 全局“设置 → 内存诊断”：通过主进程 `app.getAppMetrics()` 看 Electron 多进程 working set，并区分主界面、GPU 与隐藏 Worker。该能力归 app system，不再由 Editor 挂载。

常用压测命令：

```ts
await window.__LINNYA_MEMORY_DIAGNOSTICS__.start()
window.__LINNYA_MEMORY_DIAGNOSTICS__.mark('before-open')
// 打开 / 滚动 10000 pending 文档
await window.__LINNYA_MEMORY_DIAGNOSTICS__.sample('after-scroll')
await window.__LINNYA_MEMORY_DIAGNOSTICS__.stop()
window.__LINNYA_MEMORY_DIAGNOSTICS__.getLatestSample()
window.__LINNYA_MEMORY_DIAGNOSTICS__.getReport()
```

`totalWorkingSetMB` 是所有 Electron 相关进程的 working set 合计；它会包含 Browser / Tab / GPU / Utility 等进程，和 JS heap 不同。macOS 上 `privateMB` 可能为空，这是 Electron API 暴露能力限制，不代表没有私有内存。

## 目录结构

> 本 README 描述的是 **`apps/renderer/domains/editor/`** 目录下的平台 Markdown 富文本领域模块，不再使用旧的 `app/editor` 目录。当前不机械迁为 `domains/markdown-editor`，因为物理搬动九百余文件不会改善依赖边界；对外名称与 port 已先完成语义收敛。

```
apps/renderer/domains/editor/
├── blocks/                     # 所有 Block 类型（简单 = 单文件，复杂 = 子目录）
│   ├── BaseBlock.js
│   ├── HeadingBlock.js
│   ├── HorizontalRuleBlock.js
│   ├── ListItemBlock.js
│   ├── QuoteBlock.js
│   ├── AudioBlock/
│   ├── ImageBlock/
│   ├── LatexBlock/
│   ├── CodeBlock/
│   └── TableBlock/
├── core/                       # 编辑器核心（工厂 / 扩展注册 / schema / tokens 等）
│   ├── editorFactory.js
│   ├── extensionRegistry.ts
│   ├── lowlight.ts
│   ├── tokens.ts
│   ├── types.ts
│   └── schema/
│       ├── CustomDocument.js
│       └── RootBlock.js
├── docs/                       # 编辑器架构文档
│   ├── virtualization-evolution-roadmap.md # 大文档虚拟化演进路线
│   ├── perf-baseline-2026-Q2.md            # 性能基线与回归记录
│   └── html-preview-design.md              # HTML 预览方案
├── extensions/                 # 非块类扩展：位置 / 交互 / 快捷键 / 占位符等
│   ├── clipboard/
│   ├── core/
│   │   ├── index.js
│   │   ├── schema.js
│   │   ├── BlockLifecycleExtension.js
│   │   ├── CoreCommandsExtension.js
│   │   ├── SchemaProviderExtension.js
│   │   ├── UniqueIdsExtension.js
│   │   └── commands/
│   │       ├── index.js
│   │       ├── BlockQueryCommands.js
│   │       ├── ConversationCommands.js
│   │       ├── HorizontalRuleCommands.js
│   │       ├── InsertCommands.js
│   │       ├── RemoveCommands.js
│   │       ├── ReplaceCommands.js
│   │       ├── RevisionCommands.js
│   │       ├── SplitCommands.js
│   │       ├── MergeCommands.js
│   │       ├── MoveCommands.js
│   │       └── UpdateAttributesCommands.js
│   ├── interaction/
│   ├── keyboard/
│   ├── plugins/
│   ├── position/
│   └── revision/               # 修订相关扩展
│       ├── RevisionMark.ts
│       └── RevisionTrackingExtension.ts
├── features/                   # 编辑器特性模块（组合多个扩展/服务/UI）
│   ├── AiWriting/
│   ├── Annotation/
│   ├── AutoComplete/
│   ├── BlockHistory/
│   ├── FindReplace/
│   ├── RenderVirtualization/    # RootBlock 渲染虚拟化实现与运行协议
│   ├── Review/                 # AI 审阅功能
│   ├── Revision/               # 修订追踪
│   ├── SlashMenu/
│   ├── blockActionMenu/
│   ├── citation/               # 引用与参考文献
│   ├── floating-toolbar/
│   ├── outline/
│   └── table-fill-write/       # 表格批量填充的稳定 unit 写入 port 与 FIFO session
├── marks/                      # 文本 Mark 类型
├── services/                   # 与编辑器相关的服务 & Composable
│   ├── markdownRuntime/        # renderer 侧统一 Markdown 语义运行时（parser / projection / materializer）
│   │   ├── README.md
│   │   ├── index.ts
│   │   ├── parser.ts
│   │   ├── inlineProjection.ts
│   │   └── materializer.ts
│   ├── markdownConversion/     # Markdown ⇄ Tiptap 双向转换统一门面（更高层 facade）
│   │   ├── index.ts            # 对外入口（导入+导出+低层原语）
│   │   └── markdownImporter.ts # Markdown → doc JSON 纯函数
│   ├── editorService.js        # 文档加载/保存/首开迁移
│   └── ...                     # 其他 Composable（streaming / AI / mouse / panel 等）
├── shared/                     # Editor 领域内部共享工具
├── styles/                     # Editor 领域样式
├── ui/                         # Editor 领域 UI 组件
│   ├── EditorContext.vue       # 编辑器上下文提供者
│   ├── EditorContent.vue       # 编辑器内容容器
│   ├── BlockView.vue           # RootBlock 的 NodeView 壳组件（轻量，负责延迟水合）
│   ├── BlockChrome.vue         # 块级重型 UI（拖拽、批注、修订、历史等），由 BlockView 按视口/交互态可回收挂载
│   ├── components/             # BlockView 子组件
│   │   ├── BlockLeftHandleGroup.vue # 左侧控制岛（拖拽 + 版本等入口）
│   │   └── BlockVersionHandle.vue   # 块版本入口按钮
│   └── composables/            # BlockView 等 UI 逻辑的组合式函数
│       ├── index.ts                   # 统一导出入口
│       ├── useBlockNodeView.ts        # NodeView 基础状态/样式/DOM 观察
│       ├── useBlockDragAndMenu.ts     # 拖拽柄交互与块菜单
│       ├── useBlockAnnotations.ts     # 批注状态与悬停高亮
│       ├── useBlockRevision.ts        # 修订模式状态与操作
│       ├── useBlockHistoryUi.ts       # 块历史模式 UI 状态
│       ├── useBlockVersionHandle.ts   # 块版本按钮状态与自适应布局
│       ├── useBlockVisibilityManager.ts # 共享块可见性管理（虚拟化基础设施）
│       ├── useBlockActivation.ts      # 块级分层激活策略（虚拟化核心）
│       ├── useCurrentBlockActivation.ts # 子组件注入父块激活状态
│       └── useBlockKeepAlive.ts       # 子块保活白名单机制
├── index.ts                    # 统一导出入口
└── README.md                   # 本文档
```

---

## 模块职责

### UI 层

#### `ui/EditorContext.vue`
- 编辑器上下文提供者
- 负责创建编辑器实例
- 通过 provide/inject 提供编辑器和相关服务
- 管理编辑器生命周期

#### `ui/EditorContent.vue`
- 仅负责渲染编辑器内容
- 处理轻量交互（调试面板、查看选区等）
- 使用 composables 处理复杂逻辑
- 挂载 editor 级单例 overlay（例如 `RevisionOverlayLayer`），补齐 Shell / 渲染虚拟化路径下不再由每块 Vue NodeView 承载的块级 UI

#### `ui/BlockView.vue`（壳组件）
- 单个 RootBlock 的 NodeView **轻量壳**
- 职责收敛为：DOM 结构搭建、可见性注册（`blockVisibilityManager`）、延迟水合控制
- 根据视口可见性、选中态、history viewport 与业务 keep-alive 决定是否挂载 `BlockChrome`；离开激活窗口后会真正卸载，避免访问过的块永久保留重型监听器。
- 通过 `provide` 将默认的 `currentBlockActivation` 和 `blockKeepAlive` API 注入子组件

#### `core/schema/RootBlockShellView.js`（原生 Shell 压测路径）
- 受 `editorFeatureFlags.rootBlockShellEnabled` 控制，默认关闭。
- 使用原生 DOM NodeView 只创建 `.root-block-outer > .root-block > .content` 结构，不创建 Vue 组件实例。
- 用于验证超大文档 `setContent` 的纯文档层成本；Shell 本身不承载拖拽、批注入口、块级修订工具栏、历史 UI 等 `BlockChrome` 行为。当前 `virtualRootBlockRendering` 主路线使用 `PlaceholderShellView + RootBlockDomNodeView + BlockChromeHost`，不是这条压测 Shell。
- `destroy()` 不主动清空 DOM；ProseMirror 自己负责移除 NodeView DOM，避免 NodeView 重绑时出现“大量块先出现又被清空”的闪烁。
- DevTools 临时开启方式：`window.__EDITOR_FLAGS__.set('rootBlockShellEnabled', true)`，然后切换到另一个文档再切回；RootBlock 会在每次创建 NodeView 时动态读取该 flag。
- 运行时自动策略：`autoRootBlockShellForLargeDocuments=true` 时，`editorService` 会在 `rootBlock >= 1500` 的文档首开前启用 `largeDocumentShellMode`；控制台可用 `window.__EDITOR_FLAGS__.getRuntime()` 查看实际是否走 Shell。

#### `ui/BlockChrome.vue`（重型 UI）
- 小文档 / 非虚拟化路径由 `BlockView` 延迟水合挂载，仅在块进入/靠近视口时创建；大文档裸 DOM 路径由 `BlockChromeHost` 接管轻量块级入口。
- 在旧 Vue 路径承载块级交互 UI：拖拽手柄、批注高亮、修订状态、历史面板入口
- 运行所有重型 composable（`useBlockDragAndMenu`、`useBlockAnnotations`、`useBlockRevision`、`useBlockHistoryUi`、`useBlockActivation` 等）
- 管理 `rootBlockOuterEl` 上的交互 CSS class（`is-dragging`、`is-block-selected` 等）
- 使用 `<Teleport>` 渲染历史面板等全局浮层

#### `ui/composables/` — 虚拟化相关

- **`useBlockVisibilityManager.ts`**：共享的 IntersectionObserver 实例，观察所有块的可见性，避免每个块各自创建 Observer
- **`useBlockActivation.ts`**：核心激活策略。综合可见性、焦点、选中、悬停、历史模式、保活等多个信号，输出 `isUiActive`（带去抖延迟），供各块 `v-if` 消费
- **`useCurrentBlockActivation.ts`**：子组件用 `inject` 获取父 `BlockView` 的激活状态（`isUiActive` / `isBlockVisible` 等）
- **`useBlockKeepAlive.ts`**：provide/inject 模式的保活白名单。`BlockView` 调用 `provideBlockKeepAlive()` 创建；子块调用 `useBlockKeepAlive()` 注入后可 `register(reason)` / `unregister(reason)`

### 核心层

#### `core/tokens.ts`
- 定义所有 Vue 依赖注入的 Symbol Key
- 提供类型安全的注入/提供机制
- 避免字符串魔法值

**导出的 Key:**
- `EDITOR_KEY` - 编辑器实例
- `PANEL_MANAGER_KEY` - 面板位置管理器
- `ANNOTATION_STORE_KEY` - 批注存储
- 等...

#### `core/lowlight.ts`
- 提供 lowlight 语法高亮单例
- 确保整个应用使用同一个实例
- 预注册常用语言（JavaScript, Python, CSS, HTML, Bash）

**API:**
```typescript
import { getLowlight } from '@editor/core/lowlight'
const lowlight = getLowlight()
```

#### `core/editorFactory.js`
- 创建 Tiptap 编辑器实例
- 配置编辑器生命周期钩子（onCreate、onUpdate、onTransaction）
- 处理批注存储、布局管理器等初始化
- 注册事件总线
- 首次打开时不再为每个 `rootBlock` 写入 `attrs.position`；块位置统一按 ProseMirror runtime position 计算，避免大文档 onCreate 阶段产生 O(N) 次 transaction。
- 首开自动聚焦通过 `core/initialFocusPolicy.js` 统一调度：小文档仍聚焦第一个 `baseBlock`，超长文档 / RootBlock Shell 模式跳过自动 selection，避免大文档刚完成 direct-state 切换时额外派发 selection transaction。

#### `core/initialFocusPolicy.js`
- 负责首开延迟聚焦策略，不在 `editorFactory.js` 内直接操作 selection。
- 小文档使用 `editor.chain().focus().setTextSelection(...).run()` 合并为一次 dispatch。
- 当文档 `rootBlock >= 1500` 或运行时处于 RootBlock Shell 模式时跳过聚焦，只完成 editorReady 性能标记。
- 设计原因：超长文档首开时，自动 focus 不是必要体验，却会在 ProseMirror / Tiptap 状态刚切换完成后制造额外 selection transaction。

#### 超长文档渲染性能方案

这一轮性能整治的核心结论是：`10000 rootBlock + 10000 pending` 的卡顿不是单点问题，而是四层成本叠加：

```text
后端 pending 读取
  → 前端 pending canonical / revisionMark 投影
  → 严格 JSON prepare + EditorState 原子切换
  → ProseMirror View 落 DOM + RootBlock NodeView 创建
```

因此当前方案不是只优化某个组件，而是把超长文档首开拆成“数据层、投影层、文档切换层、NodeView 层”四个边界分别治理。

**1. 数据层：文档级 Accept/Reject All 后端合并**

Revision 的文档级 Accept/Reject All 已改为后端一次性合并：

```text
RevisionToolbar
  → useRevisionStore.acceptAllRevisionsInDocument / rejectAllRevisionsInDocument
  → workspace:apply-all-pending-revisions
  → PendingRevisionApplyService 合并并校验最终 docJson 后保存/清 pending
  → loadDocumentJsonAtomically(docJson)
```

这条链路的目标是避免 `N pending = N 次 ProseMirror transaction + DOM 协调`。块级 Accept/Reject 仍使用编辑器命令保证本地即时反馈，但后端同步优先走 `workspace:apply-pending-revision` 做单块原子合并；只有单块 IPC 失败时才回退到旧的全量保存 + 清 pending。调试开关：`enableBackendPendingApply`。

**2. 投影层：大文档首开暂缓 revisionMark 全量投影**

打开含大量 pending 的文档时，pending 投影链路会自动记录最近 20 次注入耗时。控制台查看：

```ts
window.__REVISION_PERF__.getLast()
window.__REVISION_PERF__.getHistory()
```

默认只在大批量、慢注入或异常时输出一条汇总日志，避免普通编辑过程刷屏。

当 `deferPendingProjectionForLargeDocuments=true` 时，大文档首开只建立后端 pending 的 canonical 索引，不在首开阶段同步把所有 pending 改写成 `revisionMark`。这样全局统计与文档级 Accept/Reject All 仍可用，但块内行级修订视图会进入后续的按需投影阶段；这是避免 `10000 块 + 10000 pending` 首开冻结的必要拆分。

按需投影的触发分两条：

- 普通 Vue `BlockView` 路径：块进入 `BlockChrome` 激活窗口后，`useBlockRevision` 调用 `projectPendingRevisionsForBlocks([blockId])`。
- 超长文档虚拟化路径：离屏块是 `PlaceholderShellView`，进入窗口后是裸 DOM `RootBlockDomNodeView`；`BlockChromeHost` 负责轻量块级入口，Revision 的 `orchestration/shellPendingProjection/setupShellPendingProjectionBridge.ts` 订阅共享视口快照，每次快照更新都以“当前已 hydrate 的 blockId”为准，通过同一个 Revision 公开入口投影。`EditorContext.vue` 只安装这条桥接，不承载 pending 规则。
- 非虚拟化 Shell 压测路径：`RootBlockShellView` 仍保留 `root-block-revision-header` slot 和 `useShellBlockRevisionHeader.ts`，用于验证原生壳能力。它不是当前大文档正常编辑体验的主路径。

注意：Shell 可见性桥只做 `DOM blockId -> visibilityManager`，不读取 Revision 内部状态；Revision 也不读取 Shell 内部状态。两边只通过 blockId 和公开 API 交互，避免把渲染虚拟化和 pending 语义绑死。

`RevisionOverlayLayer` 是另一条边界：它不参与 pending materialize 算法，也不再承担 pending header。虚拟化主路线的块级 chrome 由 `BlockChromeHost` 按 hydrated window 承担；离屏块仍是 placeholder，因此不会把 10000 个 pending 的 UI 成本重新带回首开路径。

Shell 路径下的修订 header 保持“块顶部占位”的视觉语义，但不再走“overlay 量坐标 + CSS padding 补空间”的双轨方案。header DOM 是 `.root-block-outer` 的真实 flex 子项，位置和高度由浏览器正常布局决定；overlay 不再写 `data-revision-overlay-active`，因此滚动、hydrate、pending 投影完成时不会出现先错位再回正的一帧。

Shell pending 投影调度必须以 `RenderVirtualizationEngine` 的 hydrated window 为准，而不是累计所有路过的 blockId。快速滚动时，业务模块不能各自监听滚动、采样 DOM 或排队沿途块；否则用户滚到底部后真正可见的 pending 会被旧块挡在队列后面，表现为修订一个个慢慢出现但当前视口没有 diff。`setupShellPendingProjectionBridge.ts` 因此只订阅 engine 发布的 `hydratedBlockIds`，并在调用 RevisionStore 之前先筛出“canonical pending 存在、且尚未 active 投影”的候选块；去重和节流也只基于这些候选块，不能把 pending 快照到达前的空窗口误记为已投影。投影入口返回 `PendingProjectionResult`，只有 `failedCount === 0` 才会更新已投影窗口 key；失败窗口会继续保留重试机会，并通过 `__SHELL_PENDING_PROJECTION_PERF__` 暴露 `failedCount` 和样本 blockId。`RevisionOverlayLayer` 只负责 hover / selection 的浮动工具栏，不再发起 pending materialize，也不再承担常驻 header。

滚动窗口事实源集中在 `features/RenderVirtualization/controller/renderVirtualizationEngine.ts`：

- 它是 editor 级单例状态机，负责 rAF 合批、scrollTop 窗口计算、hydrate/dehydrate、交互保活和真实高度回写；
- 主窗口输入来自 ProseMirror doc 的 rootBlock 顺序、`BlockHeightCache`、editor-shell scrollTop / clientHeight；普通滚动走 height cache 便宜路径。只有拖动滚动条远跳、外部 `editor-scroll` 或已知窗口漂移时，才额外采样当前屏幕真实命中的 `.root-block-outer`，再按文档顺序向前后扩成渲染窗口。这个 DOM 命中只允许留在 RenderVirtualizationEngine 内部，业务模块不能重复采样。
- `BlockHeightCache` 同时维护两种高度：placeholder 使用的元素自身高度，以及滚动窗口计算使用的布局高度（元素高度 + marginTop + marginBottom）。不要直接把 `getBoundingClientRect().height` 当作虚拟滚动坐标系高度；`root-block-outer` 的 margin 不在 rect 内，10000 块会累计成数万像素误差，表现为越往下滚屏幕里 hydrated 内容越少，最后白屏。
- 滚动窗口 hydrate/dehydrate 是 engine 的原子事务：当前窗口需要 hydrate 的 blockId 和旧窗口需要 dehydrate 的 blockId 必须在同一次 ProseMirror transaction 里写入 `renderVirtualizationPlugin`。pointer/focus/IME/toolbar 这类局部保活也已经收口到 `KeepAliveRegistry -> renderWindowCommitter` 的同步 pin/unpin 提交链路，不再经过第二套 rAF 队列；否则旧队列会覆盖当前窗口，表现为 `requestedHydrate>0` 但当前屏仍是 placeholder。
- 普通滚动走 rAF 合批和 height cache 便宜路径；拖动滚动条这类远距离跳转走 `scroll-jump` 同步刷新，并启用当前屏幕 DOM 采样。浏览器有时会把拖动到中段拆成多次小 scroll，单次 delta 不够触发 `scroll-jump`，但累计误差已经足够让窗口错位；engine 因此还有一个低频 `scroll-correction`，当累计滚过几屏后同步采样当前屏幕。远跳 / 累计纠偏时 engine 会先采样浏览器当前屏幕真实命中的 `.root-block-outer`，再围绕这些真实屏幕块扩窗；只有采样不到 DOM 时才退回单 anchor / 高度缓存估算。这样可以避免“engine hydrate 的窗口”和“用户实际看到的窗口”分叉，同时不把 `elementsFromPoint` 变成每帧滚动税。这个纠偏路径只属于 RenderVirtualizationEngine，业务模块不要各自监听滚动或重复采样 DOM。
- DOM 采样纠偏会触发 placeholder → hydrated NodeView 切换，真实块高度通常会比 placeholder 高，pending header / diff 出现后更明显。engine 在这条路径上必须保持视觉锚点：水合前记录采样窗口中位块的屏幕 top，水合后按同一块 top 的差值补偿 `scrollTop`。否则用户拖到中段或底部时，当前屏幕会被上方新增高度推走，表现为“往下滚显示变多、往上滚显示变少”或中段长白屏。
- 输出分为 `visibleBlockIds` 和 `hydratedBlockIds`，业务模块只能消费真实已 hydrated 的 blockId；
- pending 投影和块级 chrome 都读这份状态，不再保留各自 `requestAnimationFrame + elementsFromPoint` 的 fallback；
- `RevisionOverlayLayer` 的几何读取只允许测量 hover / toolbar hover / selection 这 1-3 个强制目标块，不能扫描视口或全量 rootBlock。

核心约束是：**首开和滚动路径不能全量测量 rootBlock，也不能让业务模块各自用 DOM 命中测试作为事实源**。万行文档里可见块通常只有几十个；engine 通过高度缓存和滚动位置计算候选窗口，再用少量 DOM anchor 纠偏，避免 `BlockHeightCache` 在 pending header / table / heading 等混合高度场景里累计偏差。

触发条件目前是：

- 文档 `rootBlock >= 1500`；
- 或 pending 数量 `>= 100`。

这一步解决的是“pending 注入是否拖慢首开”。如果 `window.__REVISION_PERF__.getLast()` 里 `pendingInject/apply/flush` 已经很小，后续瓶颈就不在 Revision 模块。

细粒度 diff / projection 调试日志默认关闭。只有需要看每个块的 diff 细节时才手动打开：

```ts
window.__EDITOR_FLAGS__.set('revisionDebugLogging', true)
```

**3. 文档切换层：严格原子装载绕过全文 replace transaction**

首开整体链路由 `ui/services/editorOpenPerf.ts` 采集，并挂到：

```ts
window.__EDITOR_OPEN_PERF__
```

常用读取方式：

```ts
window.__EDITOR_OPEN_PERF__.getCurrent()
window.__EDITOR_OPEN_PERF__.finalize() // 重新打印一次完整报告
```

关键字段：

- `timings.setContentMs`：历史指标名，当前表示完整文档原子装载总耗时。
- `setContentStats.method`：本次内容加载策略；完整文档首开当前应为 `direct-state`，`command` 只用于尚未迁移的局部历史路径诊断。
- `timings.setContentNodeFromJsonMs`：JSON content 转 ProseMirror doc 的耗时。
- `timings.setContentStateCreateMs`：基于新 doc 重建 `EditorState` 的耗时。
- `timings.setContentViewUpdateMs`：内容加载过程中 ProseMirror View 状态切换与 DOM 更新耗时。
- `timings.setContentNonViewUpdateMs`：内容加载总耗时扣除 View 更新后的剩余开销，用于判断问题是否落在命令/事务构建阶段。
- `setContentStats.viewUpdateCount`：本次内容加载触发了几次 View 状态切换。
- `setContentStats.directStatePluginsStabilized`：direct-state 是否复用了上一份 `plugins` 数组引用，避免 ProseMirror 误判插件变化。
- `setContentStats.directStateDomDetached`：direct-state 是否在离线 DOM 上执行 `view.update`，用于降低大量 DOM 插入对布局/样式计算的冲击。
- `setContentStats.directStateDomDetachMs / directStateDomReattachMs`：DOM 摘下与挂回耗时。
- `nodeViewStats.rootBlockVueNodeViewCount / rootBlockShellNodeViewCount`：首开创建了多少 Vue NodeView / 原生 Shell NodeView。
- `nodeViewStats.rootBlockVueNodeViewCreateMs / rootBlockShellNodeViewCreateMs`：两类 RootBlock NodeView 的累计创建耗时。

排查大文档首开卡顿时，先看 `pendingInject` 与 `setContent` 的占比：如果 `pendingInject` 很小但 `setContent.updateState` 很大，说明瓶颈已经不在 Revision pending 投影，而在 ProseMirror 文档落 DOM / NodeView / 样式布局链路。

所有完整文档都会走 `services/editorDocumentStateLoader.ts` 的 `loadDocumentJsonAtomically()`：先用生产 schema 严格解析 JSON，再重建 `EditorState` 并一次性更新。`rootBlock >= 1500` 且 `useDirectStateDocumentLoadForLargeDocuments=true` 时只额外启用大文档 DOM 性能策略。这个入口必须同时做四件事：

- 在改变 state 前拒绝未知 node、mark、属性以及非法内容表达式；
- 用 `view.update({ ...view.props, state })` 同步 ProseMirror `view.state` 与 `view.props.state`；
- 同步 `@tiptap/vue-3` 的内部 `reactiveState.value`，因为 Vue 版 `editor.state` 读的是这层响应式 state，而不是直接读 `view.state`；
- 清理 ProseMirror DOMObserver 的旧 mutation / selection 队列；View 更新失败时用同一官方入口恢复旧 state。

这里真正的根因边界是“direct-state 绕过了 Tiptap 的 `dispatchTransaction / beforeTransaction` 生命周期”。如果只更新 `view.state`，`editor.state` 会短暂停留在旧文档，后续 `editor.commands` 或 ProseMirror 内部 selection transaction 就可能把新文档回滚，或者触发 `Applying a mismatched transaction`。因此业务调用方只允许使用 `loadDocumentJsonAtomically()`；`loadDocumentJsonViaDirectState()` 是内部底层能力，业务代码不能直接调用 `view.updateState` / `view.update`。

这条路径用于绕过 Tiptap `setContent(... preserveWhitespace='full')` 内部的全文 `replaceWith` transaction；它只用于完整文档打开/切换和 Apply All 返回文档，不用于普通编辑命令。

R0 基线优化已经并入 direct-state 路径，两个开关都可以在 DevTools 中独立对照：

- `stabilizeDirectStatePluginsForLargeDocuments`：默认开启。`EditorState.create` 会复制 `plugins` 数组，ProseMirror View 又用数组引用判断插件是否变化；对“只换 doc、不换插件”的打开文档场景，这会误触发 redraw / nodeViews 检查。该开关会在确认插件实例与顺序完全一致后，把新 state 的 `config.plugins` 指回上一份数组。
- `detachDirectStateDomForLargeDocuments`：默认开启。`view.update` 期间临时把 editor DOM 从文档流摘下，完成 ProseMirror 的 DOM 重建后再挂回，减少 10000 个 rootBlock 首开时 `insertBefore` 对浏览器 layout/style 的连锁影响。该路径会恢复滚动位置，并只在 direct-state 大文档加载中使用。

这一步解决的是 Tiptap `setContent` 在超大文档上构造全文 replace transaction 的成本。最近的 10000 块压测基线里，旧路径 `setContent` 约 22-26s，新路径 `direct-state` 约 1.3s；具体数值以 `window.__EDITOR_OPEN_PERF__.getCurrent()` 为准。

**4. NodeView 层：placeholder + 裸 DOM hydrated window**

超长文档自动启用 `virtualRootBlockRenderingActive` 后，`RootBlock.addNodeView` 的职责分成两段：离屏块走 `PlaceholderShellView`，只创建必要占位 DOM；进入窗口的块走 `RootBlockDomNodeView`，正文仍交给 ProseMirror `contentDOM`，块级 chrome 由 `BlockChromeHost` 通过 runtime registry 定位后 Teleport。

```text
.root-block-outer
  ├─ placeholder：无 contentDOM，只保留估算高度
  └─ hydrated：RootBlockDomNodeView + contentDOM + BlockChromeHost 轻量 surface
```

这避免首开为每个块创建 Vue `BlockView`、`BlockChrome` 以及内部正文 ViewDesc，同时保证用户真正看到和编辑的窗口仍有拖拽、菜单、批注入口、修订指示、修订工具栏和历史面板这些必要轻量入口。`RootBlockShellView` 只保留给非虚拟化 Shell 压测路径；如果把它作为大文档主路线，拖拽柄、批注入口和块级修订 UI 会天然缺失。

Shell 路径仍需要块可见性信号，用于批注布局、后续 overlay，以及 pending 行内投影。当前由 `ui/composables/useShellBlockVisibilityBridge.ts` 在文档加载后扫描 Shell DOM 并注册到 `blockVisibilityManager`：

```text
file-content-loaded
  → refresh Shell DOM visibility registration
pending-revisions-loaded
  → refresh Shell DOM visibility registration
  → get near viewport blockIds
  → RevisionStore.projectPendingRevisionsForBlocks(blockIds)
```

早期 Shell 可见性桥只用于压测路径；当前完整 `virtualRootBlockRendering` 已经把离屏 rootBlock 退化成无 `contentDOM` 的 placeholder，入屏块则使用裸 DOM `RootBlockDomNodeView`。

R1 前置能力已经拆到 `features/RenderVirtualization/view`：

- `policy/shouldEnableVirtualization.ts`：纯函数启用策略，默认阈值 `rootBlock >= 1500`，调用方必须显式传入 feature flag 状态。
- `state/blockHeightCache.ts`：placeholder 高度缓存，只做 `blockId → height` 存储与高度归一化，不读取 Revision / Annotation / NodeView 状态。
- `state/blockHeightCacheRegistry.ts`：当前文档的高度缓存门面。文档切换时由 `editorService` reset，Shell/placeholder 与 UI bridge 通过它共享真实高度。
- `state/renderVirtualizationPlugin.ts`：ProseMirror 状态骨架，`enabled=true` 时默认离屏块是 placeholder，只为 hydrated / pinned 小集合生成 node decoration，避免为 10000 个 placeholder 反向制造 10000 个 decoration。
- `state/renderVirtualizationPlugin.ts` 同时负责 selection 保活：当前光标所在 rootBlock 会被自动纳入 hydrated decoration，即使滚动 controller 请求 dehydrate，也不会把光标块切成 placeholder。
- `state/keepAliveRegistry.ts`：保活租约表，统一收集 composition / pointer / focus / toolbar / annotation 等原因；集中定义 keep-alive reason 列表、类型与运行时校验函数；按 `blockId + reason` 记录租约次数，同一块只有最后一个租约释放后才通过 `renderWindowCommitter` 同步 `unpin`。`getDebugSnapshot()` 会输出每个 pinned block 的 reasons 与 leaseCount，用于排查内存占用。
- `state/keepAliveEvents.ts`：DOM 级保活事件协议。BlockChrome / Revision / History 只向当前块 DOM 派发“需要保活/释放”的声明，bridge 统一写入 `KeepAliveRegistry`，避免业务 UI 直接依赖 controller。
- `state/nodeViewKeepAlive.ts`：NodeView 浮层保活工具。ImageBlock / CodeBlock 这类块内 Teleport 浮层只传 `editor + getPos + reason`，工具负责解析外层 rootBlockId 并派发 keep-alive 事件。
- `state/positionKeepAlive.ts`：position 级保活工具。TableBlock 这类只有 `tablePos` / `cellPos` 的复杂块，不需要读取 DOM，只通过 doc 结构解析外层 rootBlockId 并派发 keep-alive 事件。
- `RenderVirtualizationExtension.ts`：把 plugin 注册进 Tiptap 扩展链路；plugin 初始 disabled，不影响普通文档。
- `controller/renderWindowPlanner.ts`：只负责把 doc rootBlock 顺序、高度缓存、viewport 和可选 DOM 采样转换为窗口计划，不提交 transaction。
- `controller/renderWindowCommitFlow.ts`：负责把窗口计划提交到 `renderVirtualizationPlugin`，并从 plugin state 读回真实 hydrated 集合；远跳时的视觉锚点补偿也集中在这里。
- `renderVirtualizationConstants.ts`：集中管理窗口、纠偏、DOM sample、scroll handshake 的调优参数。默认窗口不再写死为固定块数，而是按视口高度、overscan 和平均块高动态推导，再用上限保护内存。
- `rootBlockRenderMode.ts`：只负责从 ProseMirror node decoration 解析 `hydrated / placeholder`，默认 `hydrated`，避免插件未启用时改变行为。
- `resolveRootBlockRenderMode.ts`：NodeView 的 mode 解析入口，显式 decoration 优先，其次读取 plugin state。
- `PlaceholderShellView.ts`：离屏块占位 NodeView，不暴露 `contentDOM`，只维护 `.root-block-outer[data-id]`、`data-placeholder=true` 与估算高度。
- `RootBlockShellView.js`：非虚拟化 Shell 压测路径。它不承载拖拽、批注、修订和历史等正常编辑 chrome，因此不能作为当前大文档主路线。
- `editorDocumentStateLoader.ts`：direct-state 支持 `prepareState` 钩子，虚拟化可以在首次 `view.update` 前写好 plugin state，避免 NodeView 初建时读到旧的 `editor.state`。
- `controller/renderVirtualizationEngine.ts`：统一运行时状态机，把 scrollTop 窗口计算、hydrate/dehydrate、composition / pointer / focus / keepAliveEvents 保活、真实高度测量收在同一个地方；pending 投影只能消费它发布的 `hydratedBlockIds`。新增 keep-alive reason 时只改 registry 的集中列表，并补 engine 单测，避免业务事件被静默丢弃。
- `features/Revision/ui/overlay/RevisionOverlayLayer.vue`：editor 级修订 overlay。虚拟化主路线的常驻 pending/header 由 `BlockChromeHostRevisionIndicator` 承担；overlay 只发布 hover / selection 工具栏 blockId，不再直接渲染按钮。
- `controller/keyboardPreHydration.ts`：键盘跨 rootBlock 前的预水合。它在 editor DOM 的 keydown capture 阶段只同步 hydrate 可确定的目标块：方向键覆盖相邻块，Ctrl+Home/End 与 Cmd+Home/End / Cmd+ArrowUp/Down 覆盖文档首尾块；不写 pin，避免键盘临时状态误释放其他保活来源。
- `controller/scrollHandshake.ts`：统一 `blockId/pos -> hydrate/pin -> 等待 hydrated DOM -> selection/scroll` 协议。等待依据是 NodeView 生命周期事件，不是逐帧轮询 DOM；默认超时给到 `600ms`，低性能设备遇到主线程长任务时也不会因为旧的短超时过早失败。目录、会话引用、Workspace ref、Review 批注定位都应走这个入口；AnnotationPanel 保存/取消后恢复光标到块尾走 `positionCursorAtBlockEndWithHandshake`，AI 批注流式插入结束后的最终光标走 `positionTextSelectionWithHandshake`；AI 流式写入结束后的最终光标也走 `positionTextSelectionWithHandshake`；FindReplace 主编辑器命中、BlockActionMenu 打开历史后的文本选区收缩走 `positionTextSelectionWithHandshake`；拖拽移动后恢复 source 块尾光标走 `positionCursorAtBlockEndWithHandshake`。块级 Revision Accept/Reject 这种不需要滚动但需要进入块内部的交互走 `hydrateRootBlockForInteraction`，先短暂 pin，再按需把 canonical-only pending 投影成 `revisionMark`。调用方不再直接对 placeholder 块执行 `nodeDOM/coordsAtPos/setSelection`。

当前 `virtualRootBlockRendering` 默认开启，但只在 `rootBlock >= 1500` 且当前文档进入 direct-state 大文档加载链路时激活；小文档仍保持原有 hydrated 路径。大文档 direct-state 会先给首屏附近一个初始 hydrated 窗口，其余块按 placeholder 协议渲染；文档加载事件到达后，engine 会按当前真实视口和高度缓存重新规划窗口，覆盖“切回文档时滚动位置不在开头”的场景。窗口 overscan 默认约 `1.5` 屏，最小 `900px`；窗口块数按平均块高动态推导，保留 `220` 的稳定下限，并用 `480` 的硬上限保护内存。可见块高度会被记录到 `blockHeightCacheRegistry`，后续 placeholder 创建时复用真实高度，降低滚动条抖动。未知块的 placeholder 默认高度为 `120px`；rootBlock 已移除全局 `content-visibility` 估高，避免 hydrated 块滚入视口时从估算高度跳到真实高度。selection 块已经具备基础保活；composition 输入、块内 pointerdown、块内 focus 会通过 `KeepAliveRegistry` pin 当前块，结束后成对释放。BlockChrome 的修订工具栏、历史模式和拖拽状态已经改为通过 `keepAliveEvents` 声明保活；AnnotationPanel 的创建 / 编辑 / 悬停面板也会通过同一协议声明 `annotation` 保活；AI Writing Prompt 打开期间会通过 `ai-writing` reason 保活目标块；SlashMenu 打开期间会通过 `interaction-open` 保活 trigger 所在块；ImageBlock 的 resize / preview 浮层、CodeBlock 的语言菜单也通过 `interaction-open` 保活所在 rootBlock；TableBlock 的坐标轴和单元格 handle 会把 table/cell position 解析为 rootBlockId 后声明 `interaction-open` 保活，跨块方向键进入表格会走 `positionTextSelectionWithHandshake`，表格内部 Enter / Tab / Shift+Tab 的 TextSelection 必须落在 `tableCellContentBlock` 内容区，ArrowUp / ArrowDown 的自定义几何回退会深度遍历嵌套 inline 文本行并把垂直空白坐标夹回真实文本行，点击类入口统一归一化 DOM target 后再查询 closest，Table AI 选区上下文统一通过 `tableAiSelectionContext.ts` 从最新 doc 刷新 table node、校验保存 rect、修正输出列插入坐标，侧边栏激活期间使用独立 `table-ai` reason 保活表格 rootBlock；ImageBlock 命令插入、粘贴 / 拖放插入后都会选中新图片节点，让 selection keep-alive 接管保活；通用 `createRootBlock` 会按内容类型选择 TextSelection 或 NodeSelection，避免 atom 块被错误设置文本光标。方向键在块边界移动时会先预水合相邻 placeholder 块，Ctrl+Home/End 与 Cmd+Home/End / Cmd+ArrowUp/Down 会先预水合文档首尾目标块，再交给 ProseMirror 原生 keydown 链路。业务 UI 不直接碰虚拟化 controller。外部按 blockId 跳转、AnnotationPanel 块尾光标恢复、AnnotationPanel AI 插入后光标定位、AI 流式写入结束光标定位、FindReplace 主编辑器命中跳转、BlockActionMenu 历史入口选区收缩、拖拽移动后光标恢复、块级 Revision Accept/Reject、AI Writing 取消恢复光标已经接入 handshake。`renderVirtualizationPlugin` 生成 hydrated decorations 时复用 `blockPosIndex`，避免 selection 频繁变化时为了少量 active block 全量扫描 10000 个 rootBlock。后续交互排查与阶段收口记录在 `docs/virtualization-evolution-roadmap.md`，性能回归记录在 `docs/perf-baseline-2026-Q2.md`，继续按这个协议收束新出现的深层 position 命令。

相关开关：

- `autoRootBlockShellForLargeDocuments`：默认开启，`rootBlock >= 1500` 时自动启用运行时 Shell 模式。
- `rootBlockShellEnabled`：手动压测开关，默认关闭。
- `blockChromeLayerEnabled / revisionOverlayEnabled`：默认开启，但只在 Shell / 大文档运行态生效；当前分别用于 `BlockChromeHost` 和 `RevisionOverlayLayer`。
- `virtualRootBlockRendering`：默认开启，但必须同时满足当前文档进入 `virtualRootBlockRenderingActive` 运行态。开启后，RenderVirtualization 插件可以用 decoration 把离屏 rootBlock 切成无 `contentDOM` 的 placeholder。

控制台查看：

```ts
window.__EDITOR_FLAGS__.get()
window.__EDITOR_FLAGS__.getRuntime()
window.__EDITOR_FLAGS__.set('renderVirtualizationDebugLogging', true)
```

虚拟化真实浏览器诊断：

```js
window.__EDITOR_VIRTUALIZATION_DIAG__.print()
window.__EDITOR_VIRTUALIZATION_DIAG__.key('End', { ctrlKey: true })
window.__EDITOR_VIRTUALIZATION_DIAG__.key('ArrowDown', { metaKey: true })
window.__RENDER_VIRT_ENGINE_PERF__.getLast()
window.__SHELL_REVISION_HEADER_PERF__.getLast()
window.__SHELL_PENDING_PROJECTION_PERF__.getLast()
window.__VUE_NODEVIEW_PERF__.getSnapshot()
window.__BLOCK_CHROME_LIFECYCLE_PERF__.getActiveCount()
window.__BLOCK_ACTIVATION_PERF__.getSnapshot()
window.__EDITOR_LISTENER_PERF__.getSnapshot()
window.__DECORATION_SET_PERF__.getSummary()
await window.__REVISION_TEST__.diagnoseWindow()
```

`print()` 会输出当前 doc rootBlock 数、DOM 中 hydrated / placeholder 数、虚拟化 plugin 的 hydrated / pinned 数，以及文档首尾块状态。`key(...)` 会通过真实 DOM `keydown` 事件路径触发 bridge 的 capture 预水合，并返回按键前后的快照；适合手动验证 Ctrl+Home/End、Cmd+Home/End、Cmd+ArrowUp/Down 这类确定目标键。

运行时性能样本默认写入内存，不逐帧刷 console。`__RENDER_VIRT_ENGINE_PERF__` 看 engine 每次窗口刷新，`__SHELL_REVISION_HEADER_PERF__` 看 Shell header 同步，`__SHELL_PENDING_PROJECTION_PERF__` 看 hydrated window 到 canonical pending 候选块的筛选、节流、in-flight 和真实投影；`__VUE_NODEVIEW_PERF__` 看当前仍活跃的 Vue rootBlock 壳数量，`__BLOCK_CHROME_LIFECYCLE_PERF__` 看 BlockChrome 挂载数量，`__BLOCK_ACTIVATION_PERF__` 看 active chrome 的原因分布，`__EDITOR_LISTENER_PERF__` 看 BlockChrome 当前挂载的 editor `update/selectionUpdate` 监听器数量，`__DECORATION_SET_PERF__` 看虚拟化和 placeholder 等 plugin decoration 的构建次数、数量、耗时与访问节点数。pending 投影样本会保留少量候选 / 已 active / 非 pending 的 blockId 样本，方便判断问题是在 canonical 匹配还是投影执行。只有慢样本、异常样本，或显式开启 `renderVirtualizationDebugLogging` 时才会节流输出控制台汇总。

内存预算按 renderer JS heap `600MB` 作为红线。`pending revisionMark` 投影、RootBlock hydrate/dehydrate、citation 派生这三类事务都是渲染/派生状态，不是用户编辑，必须通过 `core/transactions/editorTransactionMeta.ts` 统一标记 `addToHistory=false`，避免 ProseMirror undo history 保留 10000 块文档的旧状态。手动压测时可用：

```js
window.__EDITOR_MEMORY_PERF__.sample('before-seed')
window.__EDITOR_MEMORY_PERF__.start(3000)
window.__EDITOR_MEMORY_PERF__.getHistory()
window.__EDITOR_MEMORY_PERF__.stop()
```

该工具只采样 Electron/Chromium 暴露的 JS heap，默认不刷屏；超过 `600MB` 时最多每 30 秒输出一次 warning。如果系统任务管理器看到的进程 RSS 明显高于 JS heap，需要再查图片/Canvas/原生 DOM 或 Electron 进程级内存。

Revision 当前性能验收只使用整篇 10000 pending 的口径：

```js
// 前 10000 个块都有 pending，适合压测首开、滚动投影和 Accept All。
await window.__REVISION_TEST__.seed(10000)

// 当前窗口表格诊断：确认 blockIndex、backendPending、canonical、active、docMark、header DOM 是否一致。
await window.__REVISION_TEST__.diagnoseWindow()
```

如果 `diagnoseWindow()` 里当前窗口 `backendPending=false` 且 `canonical=false`，说明当前数据不是 10000 pending；这时先重新执行 `seed(10000)` 并切换文档重开，再继续排查虚拟化 hydrate / 投影。

**当前验收口径**

- 大文档首开先看 `editorOpenPerf`：`method=direct-state`、`rootBlockShellNodeViewCount` 接近 rootBlock 数量、`pendingInject` 不应成为主耗时。
- 再看 `revisionPendingPerf`：大文档下 `activeRevisionCount` 可以为 0，因为行内 `revisionMark` 投影被暂缓；但 `canonicalBlockCount` 应能覆盖后端 pending。
- 文档级 Accept/Reject All 不依赖行内投影，仍通过后端 apply-all 覆盖所有 pending。
- 大文档首开不应自动把光标强行定位到第一块；`initialFocusPolicy` 会在 Shell 模式或 `rootBlock >= 1500` 时跳过 selection dispatch。
- 如果点击后出现 `Applying a mismatched transaction` 或“一万块先出现又消失”，优先检查 direct-state 原子切换是否仍走 `services/editorDocumentStateLoader.ts`，并确认 `editor.state.doc` 与 `editor.view.state.doc` 指向同一份新文档。

文档级修订工具栏的“接受全部 / 拒绝全部”直接执行后端 apply-all，不再做二次确认。大文档 pending 已经通过 canonical 索引保证全局统计可见，行内预览暂缓只作为提示文案，不改变按钮的单击执行语义。

#### `core/extensionRegistry.ts`
- 集中管理所有 Tiptap 扩展
- 提供 `getAllExtensions` 函数统一配置
- 支持依赖注入（layoutManager、findReplaceStore、audioEditorsStore、audioContentStore、audioRuntimeStore 等）

#### `core/types.ts`
- 定义编辑器核心类型
- `ExtensionDependencies` 接口：定义扩展所需的依赖
- 使用通用类型（`unknown`），避免直接依赖其他模块的具体实现
- 保持模块独立性，不导入其他特性模块的具体类型

#### `core/schema/`
- `CustomDocument.js` - 自定义文档节点定义
- `RootBlock.js` - 根块节点定义

---

## 文档结构（Schema）与块级模型（强烈建议先理解）

编辑器的核心结构是：

```text
doc
└─ rootBlock (容器块，可拖拽/带块级属性)
   └─ blockContent（恰好 1 个；如 baseBlock / headingBlock / listItemBlock / quoteBlock / codeBlock / latexBlock / table / imageBlock / audioBlock / bibliographyBlock）
      └─ inline*（文本/marks/inline nodes）
```

对应实现与约束：

- **`core/schema/CustomDocument.js`**：约束 `doc` 只能包含 `rootBlock`（通过 `NODE_GROUPS.BLOCK_CONTAINER`）。
- **`core/schema/RootBlock.js`**：约束 `rootBlock` 必须包含且只包含 1 个“内容块”（`NODE_GROUPS.BLOCK_CONTENT{1}`）。
- **`extensions/core/schema.js`**：集中定义 `NODE_GROUPS.BLOCK_CONTENT`（这决定了 rootBlock 允许承载哪些块类型）。

这套结构的意义：

- **块级交互统一落在 RootBlock**：拖拽、块级菜单、块级属性（如背景色）更容易保持一致。
- **内容块专注表达语义**：Heading/Quote/Table 等只需要关心各自的 DOM 与命令行为，不承担“块容器职责”。

---

## DOM 结构（渲染层）速记

当 workspace 的 `activeDocument.type === 'editor'` 且 `DocumentSurface` 挂载 Markdown 编辑器 surface 后，页面大致会装配出如下层级（省略无关 UI）：

```text
AppLayout
└─ WorkspaceStage
   └─ DocumentPane
      └─ DocumentSurface
         └─ MarkdownEditorPage
            └─ EditorContext
               └─ EditorContent
                  └─ .ProseMirror
                     └─ .root-block-outer (RootBlock NodeViewWrapper, 多个)
                        └─ .root-block
                           └─ (node-view-content)
                              └─ <具体内容块的 outer/inner>
```

其中：

- RootBlock 的 DOM 结构来自 `core/schema/RootBlock.js` 的 `renderHTML()`
- 内容块（例如 `BaseBlock`）通常是“两层 DOM”：outer 负责装饰/布局，inner 是实际的 `contentDOM`（见 `blocks/BaseBlock.js`）

这部分结构在做：

- placeholder CSS、缩进样式（`data-indent`）、块级装饰（列表点/引用线等）
- NodeView（`ui/BlockView.vue`）对块级交互入口的挂载

---

## ProseMirror 的位置（pos）心智模型（调试/写命令时很关键）

当你在写命令（`extensions/core/commands/*`）或排查“选区/插入位置不对”时，要记住：

- ProseMirror 的位置是“标记点”而不是“字符索引”，一个节点会占用起止标记位置。
- 以 `rootBlock -> baseBlock -> text` 为例（简化）：
  - `rootBlock` 的内容起点通常是 `rootPos + 1`
  - `baseBlock` 的内容起点通常是 `rootPos + 2`

一个更“可计算”的记忆方式（示意）：

- 任意节点满足：`node.nodeSize = node.content.size + 2`
- 以“rootBlock 内只有一个空 baseBlock”为例：
  - `baseBlock.content.size = 0` → `baseBlock.nodeSize = 2`
  - `rootBlock.nodeSize = baseBlock.nodeSize + 2 = 4`
  - 如果 `rootBlock` 的起始位置是 `rootPos`：
    - `rootBlock` 占用区间大致是 `[rootPos, rootPos + 4]`
    - `baseBlock` 的起始位置通常就是 `rootPos + 1`
    - baseBlock 的内容位置通常从 `rootPos + 2` 开始（即便空块也仍然存在边界位置）

两个常见场景：

1) **空 baseBlock（无文本）**时，`baseBlock` 内部也仍然存在“边界位置”，这会影响你在 `deleteRange/insert` 时的区间计算。  
2) **有文本**时，文本的开始/结束位置会把区间拉长，但节点边界位置依旧存在。

建议做法：

- 优先用 ProseMirror 提供的 `ResolvedPos`（`state.doc.resolve(pos)`）去推导相对位置，不要凭感觉写“+1/+2”。
- 若需要在 rootBlock 内定位内容块：可以先 `state.doc.nodeAt(rootPos)` 取到 node，再用 `node.nodeSize` 计算边界范围。

---

## 新增一个块类型（Block）的流程（最新版）

> 旧版全局 AI 指南里曾有一份“新增块”的流程，但路径/注册点已经过时。这里是按当前 `domains/editor` 架构校准后的版本。

### 0) 先判断：这应该是“Block”还是“Feature”？

- **Block**：主要是一个新的内容节点（Node），有自己的 DOM/parseHTML/renderHTML，可能带少量键盘/命令。
- **Feature**：跨多个扩展/服务/UI 的组合能力（例如 SlashMenu、FindReplace、Revision、Citation）。

不确定时经验规则：

- 只要你需要“独立的 UI 面板/全局 Teleport/跨块状态/与保存加载深度耦合”，优先考虑做成 `features/*`。
- 只是多一种块的语义与渲染，优先做 `blocks/*`。

### 1) 创建块扩展文件

推荐位置：

- 简单块：`apps/renderer/domains/editor/blocks/<MyBlock>.js`
- 复杂块：`apps/renderer/domains/editor/blocks/<MyBlock>/...`（并提供自己的 `index.js` 统一出口）

实现要点（对齐现有块）：

- **name**：唯一（会进入 `NODE_GROUPS.BLOCK_CONTENT`）
- **属性**：至少要考虑 `id` / `blockType`（若需要），以及该块自身状态（缩进/对齐/元数据等）
- **DOM**：推荐 outer + inner 两层；inner 作为 `contentDOM`（可编辑内容块）  
  - 参考：`blocks/BaseBlock.js`
- **parseHTML/renderHTML**：必须能稳定往返（尤其是 data-* 属性）

### 2) 把新块加入“允许承载的块集合”

更新 `apps/renderer/domains/editor/extensions/core/schema.js`：

- 把你的 `name` 加到 `NODE_GROUPS.BLOCK_CONTENT` 字符串里  
  - 这一步决定 `rootBlock` 是否允许包含该块

### 3) 注册到编辑器扩展列表（唯一事实来源）

更新 `apps/renderer/domains/editor/core/extensionRegistry.ts`：

- import 你的块扩展
- 在 `getAllExtensions()` 返回数组里加入（通常放在其它“自定义块扩展”附近）

> 备注：如果你的块在 `blocks/index.js` 里重导出，也可以从 `../blocks` 聚合导入，保持 import 路径简洁一致。

### 4) 补齐样式

主要样式入口在：

- `apps/renderer/domains/editor/styles/components/Block.css`

通常需要关心：

- outer/inner 的布局与交互区域
- 与 `data-indent/data-is-empty/data-block-type` 等属性联动的样式

### 5) 让“转换/插入/快捷键”认识它（按需）

取决于你希望用户怎么创建/转换成这个块：

- **转换命令**：通常在 `apps/renderer/domains/editor/extensions/core/commands/ConversionCommands.js`
- **插入命令**：通常在 `apps/renderer/domains/editor/extensions/core/commands/InsertCommands.js`
- **回车/退格等块级行为**：通常在 `apps/renderer/domains/editor/extensions/keyboard/handlers/*`
- **Markdown 输入规则**：在 `apps/renderer/domains/editor/extensions/clipboard/markdown/*`（更复杂的流式行为请同时参考 `apps/renderer/docs/STREAMING_PARSER_GUIDE.md`）

### 6) 最后：验证“序列化/粘贴/表格等边界”

编辑器里最容易被忽略但会出大问题的边界是“粘贴结构纠错”。建议至少覆盖：

- 从外部粘贴富文本（尤其 Word/网页）
- 表格单元格内的粘贴（避免把块节点塞进 cell 的 inline schema）
- 导出/保存后 reload 的一致性

---

## 依赖与耦合约束（Editor 内）

这部分来自旧文档的“依赖规则”思想，但已按当前 `domains/editor` 架构改写：

- **Editor 内部层级**（从底到顶）：
  - `extensions/core/schema.js` / `core/schema/*`：结构约束（尽量纯、少依赖）
  - `blocks/*` / `marks/*` / `extensions/*`：编辑器扩展与协议
  - `features/*`：组合能力（可依赖 blocks/extensions/services/ui）
  - `ui/*` + `services/*`：编辑器挂载与副作用入口
- **跨 domain 依赖**：
  - Editor 领域尽量不要直接 import 其它 domain 的内部实现/类型。
  - 需要跨域信息时，优先通过注入（`ExtensionDependencies`）、共享 store（`apps/renderer/shared/stores/*`）或上层装配（Page/Layout）传递。

### 服务层

#### `services/editorService.js`
- 加载文件内容到编辑器
- 收集编辑器数据用于保存
- 设置和管理自动保存

#### `services/bootstrapEditorServices.ts`
- 统一启动所有编辑器服务
- 集中管理副作用（IPC、自动保存、全局注册）
- 返回单一 dispose 函数用于清理

#### `services/markdownConversion/` — Markdown ⇄ Tiptap 双向转换门面
- **统一入口**：所有 Markdown ↔ Tiptap doc JSON 的转换需求均从此模块导入
- 内含两个方向：
  - **导入**（`markdownImporter.ts`）：Markdown 文本 → WASM StreamingParser → BlockEvent[] → ProseMirror doc JSON
  - **导出**（re-export `shared/utils/markdownSerializer.ts`）：ProseMirror Node → Markdown 文本
- 详见下方独立章节 "Markdown 导入/导出机制"

#### `services/useStreamingHandlers.ts`
- 封装 WASM Streaming Parser 的事件处理
- 管理流式内容的解析与队列处理
- 流式写入结束后的最终光标定位走 `positionTextSelectionWithHandshake`，确保目标块在 placeholder 渲染下先 hydrate 再设置 selection
- 提供统一的 SSE 事件处理接口

**API:**
```typescript
const streamingState = { wasmStreamingParser: null, aiError: ref(null) }
const { handlers, initializeParser } = useStreamingHandlers(editor, streamingState)
```

### `services/useAiWritingController.ts`
- 封装 AI 提示提交逻辑
- 简化为编辑器内“写作/续写”单一路径（不再提供 Agent 模式）
- 处理流式写入与错误（仅影响编辑器内生成）

**API:**
```typescript
const { handleAiPromptSubmit } = useAiWritingController({
  editor,
  uiStore,
  handlers,
  initializeParser,
})
```

### `services/useMouseInteractions.ts`
- 封装 MouseListener 的初始化与清理
- 自动管理生命周期（onMounted/onBeforeUnmount）

**API:**
```typescript
useMouseInteractions({ editor, editorContainerRef })
```

### `services/usePanelPositioning.ts`
- 管理面板位置重算
- 处理窗口 resize 事件（带防抖）
- 监听编辑器变化并触发重算

**API:**
```typescript
usePanelPositioning({ editor, panelPositionManager })
```

## 迁移映射

| 原位置 | 新位置 | 说明 |
|--------|--------|------|
| `app/core/editor.js` | **已废弃** | 功能分散到各个新模块 |
| `editorFactory.js` 中的 lowlight 创建 | `editor/core/lowlight.ts` | 单例模式 |
| `EditorContent.vue` 中的流式处理 | `editor/services/useStreamingHandlers.ts` | Composable |
| `EditorContent.vue` 中的 AI 提交 | `editor/services/useAiWritingController.ts` | Composable |
| `EditorContent.vue` 中的鼠标监听 | `editor/services/useMouseInteractions.ts` | Composable |
| `EditorContent.vue` 中的面板定位 | `editor/services/usePanelPositioning.ts` | Composable |
| 字符串注入 Key | `editor/core/tokens.ts` | Symbol Key |

## 使用示例

### 在组件中使用

```vue
<script setup>
import { inject } from 'vue'
import { EDITOR_KEY, PANEL_MANAGER_KEY } from '@editor/core/tokens'
import { usePanelPositioning, useAiWritingController } from '@editor'

const editor = inject(EDITOR_KEY)
const panelPositionManager = inject(PANEL_MANAGER_KEY)

// 使用 composables
usePanelPositioning({ editor, panelPositionManager })

const { handleAiPromptSubmit } = useAiWritingController({
  editor,
  uiStore,
  handlers,
  initializeParser
})
</script>
```

### 在其他模块中使用 lowlight

```typescript
import { getLowlight } from '@editor/core/lowlight'

const lowlight = getLowlight()
// lowlight 已经注册好常用语言，直接使用即可
```

## 优势

1. **职责清晰**: 每个模块只负责一个特定功能
2. **易于测试**: Composables 可以独立测试
3. **类型安全**: TypeScript + Symbol Key 提供完整类型支持
4. **可复用**: Composables 可在多个组件中复用
5. **易于维护**: 逻辑集中，修改影响范围明确
6. **统一入口**: `index.ts` 提供清晰的导出接口

## Markdown 导入/导出机制

编辑器需要在 **Markdown 纯文本** 与 **Tiptap(ProseMirror) doc JSON** 之间做双向转换。两个方向由不同技术实现，但统一收敛在 `services/markdownConversion/` 门面模块中。

### 数据流概览

```text
┌──────────────┐   importMarkdownToDocJson()   ┌──────────────────┐
│  Markdown    │ ────────────────────────────►  │  ProseMirror     │
│  纯文本       │                                │  doc JSON        │
│              │ ◄────────────────────────────  │  (Tiptap 编辑器)  │
└──────────────┘   markdownSerializer.serialize()└──────────────────┘
```

### 导入方向（Markdown → Tiptap）

链路：`Markdown string` → `WASM StreamingParser` → `BlockEvent[]` → `blockEventsToDocJson()` → `doc JSON`

- **WASM StreamingParser**（`shared/services/markdownService.js`）：Rust 编写、编译为 WASM 的 Markdown 解析器，功能最全（支持 table / latex / 嵌套列表等），是唯一推荐的解析实现。
- **markdownRuntime materializer**（`services/markdownRuntime/materializer.ts`）：将 WASM 产出的 `BlockEvent[]` 按编辑器 Schema（rootBlock → 内容块 → inline）生成 ProseMirror doc JSON。Schema 中缺少某节点类型时做文本降级而非崩溃。
- **markdownImporter**（`services/markdownConversion/markdownImporter.ts`）：组合以上两步的纯函数，返回 `{ docJson, blockEvents }`。

**使用方式：**

```typescript
import { importMarkdownToDocJson } from '@editor/services/markdownConversion'
import { loadDocumentJsonAtomically } from '@editor/services/editorDocumentStateLoader'

const { docJson } = await importMarkdownToDocJson({
  markdown: '# Hello\n\nSome **bold** text',
  schema: editor.state.schema,
})

if (docJson) {
  loadDocumentJsonAtomically(editor, docJson)
}
```

**已有消费场景：**
- `editorService.js` 的"首开迁移"（rawMarkdownSource 占位块 → 完整块结构 JSON）

### 导出方向（Tiptap → Markdown）

链路：`ProseMirror Node` → `prosemirror-markdown MarkdownSerializer` → `Markdown string`

- **markdownSerializer**（`shared/utils/markdownSerializer.ts`）：基于 `prosemirror-markdown` 的自定义序列化器，覆盖所有自定义块/Mark 类型。
- 支持两种模式：`standard`（标准 Markdown 换行）和 `newline`（字面量 `\n` 单行输出，用于剪贴板等场景）。

**使用方式：**

```typescript
import { markdownSerializer } from '@editor/services/markdownConversion'

const markdown = markdownSerializer.serialize(editor.state.doc)
```

### 注意事项

- **不要直接引用底层实现**：所有转换需求应从 `services/markdownConversion/` 导入，避免散落在各文件中直接 import WASM service 或 converter。
- **导入/导出不保证字节级往返一致**：例如有序列表统一输出 `1.`、图片导出为 `[图片：alt]` 占位。这是已知的设计取舍。
- **Schema 依赖**：导入方向需要 `editor.state.schema`，因此只能在编辑器实例存在时调用。

## 虚拟化与大文档性能

> 当前实现总览见 [`features/RenderVirtualization/README.md`](features/RenderVirtualization/README.md)，演进路线与阶段记录见 [`docs/virtualization-evolution-roadmap.md`](docs/virtualization-evolution-roadmap.md)，性能基线见 [`docs/perf-baseline-2026-Q2.md`](docs/perf-baseline-2026-Q2.md)。

### 核心思想：分层激活，而非卸载

编辑器采用 **分层激活（Layered Activation）** 策略而非传统虚拟滚动。ProseMirror 要求文档 DOM 完整存在，因此不能卸载不可见的块节点。取而代之的方案是：**保留文档结构，按块级粒度关闭屏幕外的重型 UI 层**（浮动面板、控件、ResizeObserver、全局事件监听等）。

### 架构层级

```text
小文档 / 非虚拟化路径：
BlockView.vue（Vue 轻量壳，默认路径，始终存在）
├── useBlockVisibilityManager  ← IntersectionObserver 判断块是否在视口内
├── provide 默认 blockActivation / blockKeepAlive
├── v-if="isHydrated" → BlockChrome.vue（延迟水合，进入视口后挂载）
│   ├── useBlockActivation     ← 综合可见性/焦点/选中/hover/历史模式/保活 → 输出 isUiActive
│   ├── useBlockDragAndMenu    ← 拖拽手柄 & 块菜单
│   ├── useBlockAnnotations    ← 批注状态 & 悬停高亮
│   ├── useBlockRevision       ← 修订模式
│   ├── useBlockHistoryUi      ← 块历史面板
│   └── useBlockKeepAlive      ← provide/inject：子块注册"保活原因"阻止冻结
└── 各内容块 NodeView
    └── v-if="blockActivation.isUiActive" 控制重型 UI 挂载

大文档 virtualRootBlockRendering 路径：
PlaceholderShellView（离屏，无 contentDOM）
RootBlockDomNodeView（入屏，原生 DOM + contentDOM）
└── BlockChromeHost（left-handle / annotation / revision / history 轻量 surface）

RootBlockShellView.js（原生 Shell 压测路径，rootBlockShellEnabled=true）
└── .root-block-outer > .root-block > .content
```

关键设计：小文档继续使用 `BlockView + BlockChrome` 的分层激活；大文档把离屏块降级为 placeholder，把入屏块降为原生 DOM NodeView，再由 `BlockChromeHost` 承担轻量交互入口。旧 Vue 路径仍是小文档回归边界，不能因为大文档 Host 收口而删除。

### 激活判定

`useBlockActivation` 的 `isUiActive` 由以下条件的 OR 组合得出：

| 条件 | 说明 |
|------|------|
| `isBlockVisible` | IntersectionObserver 判定在视口内 |
| `isFocused` | 块内有文本光标 |
| `isBlockSelected` / `isHandleSelected` | 块被选中或拖拽柄被选中 |
| `isHovered` | 鼠标悬停在块上 |
| `isInHistoryMode` | 处于历史查看模式 |
| `isKeepAlive` | 子组件通过 `useBlockKeepAlive` 注册了保活原因 |

上述条件全部为 false 后，经过一段延迟（避免快速滚动闪烁），`isUiActive` 变为 `false`，触发各块内部重型 UI 的 `v-if` 卸载。

### 保活白名单

某些块在屏幕外仍需保持激活（如录音中的 AudioBlock）。子组件通过 `useBlockKeepAlive()` 注入 API，动态注册/注销保活原因：

```typescript
const keepAlive = useBlockKeepAlive()
keepAlive.register('audio-busy')   // 录音开始时
keepAlive.unregister('audio-busy') // 录音结束时
```

### 已完成的优化阶段

| 阶段 | 名称 | 内容 |
|------|------|------|
| Phase 0 | 数据/测量卸载 | 前置优化，减少 onUpdate 布局开销 |
| Phase 1 | 重型 UI 激活窗口 | 建立 `BlockActivation` 机制 |
| Phase 2 | 分层激活细化 | 各 Block 接入激活控制（CodeBlock / ImageBlock / AudioBlock / TableBlock 等） |
| Phase 3 | 深度冻结与测量压缩 | PM 插件 early return、修订系统清理、保活白名单、**Pending 注入 dispatch 批处理**（N 次 DOM 协调→1 次） |
| Phase 4 | BlockView 拆分 + 延迟水合 | 将 BlockView 拆分为壳组件 + BlockChrome，仅对视口内块水合重型 UI；字符统计 debounce + requestIdleCallback；`content-visibility: auto`；textUnits 热路径优化 |

各阶段详细方案、改动文件清单和当前进度见 `docs/virtualization-evolution-roadmap.md`；压测数据与回归记录见 `docs/perf-baseline-2026-Q2.md`。

### 块级激活接入模式

新增或修改 Block 时，如果该 Block 有重型 UI（浮动面板、控件、ResizeObserver、全局事件监听等），应遵循以下模式：

```typescript
// 在 Block 的 NodeView setup 中
import { useCurrentBlockActivation } from '../../../ui/composables/useCurrentBlockActivation'

const blockActivation = useCurrentBlockActivation()
```

```html
<!-- 在模板中，用 v-if 控制重型 UI -->
<div v-if="blockActivation.isUiActive.value" class="heavy-controls">
  ...
</div>
```

如果块在屏幕外有持续操作（录音、转录等），还需注册保活：

```typescript
import { useBlockKeepAlive } from '../../../ui/composables/useBlockKeepAlive'

const keepAlive = useBlockKeepAlive()
watch(isBusy, (busy) => {
  if (busy) keepAlive?.register('my-reason')
  else keepAlive?.unregister('my-reason')
}, { immediate: true })

onBeforeUnmount(() => keepAlive?.unregister('my-reason'))
```

## 后续计划

1. 考虑添加 `bootstrapEditorServices.ts` 统一管理副作用启动
2. 可选：将 `EditorContext.vue` 进一步简化
3. 可选：添加单元测试覆盖各个 composable
4. 为 `markdownImporter` 添加纯函数单元测试（headings / lists / table / code / latex 等）
5. 可选：提供用户可触达的"导入 Markdown"UI 入口（菜单/命令/拖拽）
6. 完成虚拟化 Phase 3 剩余批次（批注系统按激活消费、ProseMirror 装饰集压缩等）

## 依赖注入

编辑器扩展通过 `ExtensionDependencies` 接口接收依赖：

```typescript
interface ExtensionDependencies {
  layoutManagerInstance: Ref<LayoutManager>
  findReplaceStore: unknown        // FindReplace Store
  audioEditorsStore: unknown       // AudioBlock 编辑器注册表
  audioContentStore: unknown       // AudioBlock 内容管理
  audioRuntimeStore: unknown      // AudioBlock 运行时状态
}
```

这些依赖在 `EditorContext.vue` 中创建并传入 `getAllExtensions()`。

## 注意事项

- 所有新代码应使用 `@editor` 导入而非直接路径
- Composables 遵循 Vue 3 组合式 API 最佳实践
- Editor 模块不直接依赖其他特性模块的类型，保持模块独立性
