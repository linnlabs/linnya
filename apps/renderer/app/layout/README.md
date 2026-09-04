# app/layout 架构说明

`app/layout` 是 linnya 渲染进程的应用壳层。它不拥有具体业务数据，也不实现 editor、conversation、workspace、knowledgebase 等领域规则；它负责把这些领域能力装配成用户看到的窗口结构，并统一处理跨领域导航、布局几何和文档 runtime 生命周期。

本目录的核心目标：

- 顶层场景只有一个权威来源；
- workspace scope 和 layout state 分离；
- 文档打开、保存、关闭有统一编排；
- 左中右三栏几何可预测、可测试；
- domain 通过 port 表达意图，不反向依赖 app/layout；
- conversation 需要读取当前 workspace 上下文时，只能通过 `shared/ports/workspaceContextPort.ts`，不能直接读取 workspace store 或 file-manager；
- 折叠/展开只影响布局可见性，不销毁文档 runtime。

## 当前目录

```text
app/layout/
├── AppLayout.vue
├── GlobalModals.vue
├── AppHeader/
│   ├── index.vue
│   ├── HeaderLeftSection.vue
│   └── HeaderRightSection.vue
├── chat/
│   └── ConversationSidePane.vue
├── components/
│   └── PaneDivider.vue
├── composables/
│   ├── index.ts
│   ├── useCssVariables.ts
│   ├── useGlobalKeyboardShortcuts.ts
│   ├── useRightPaneResize.ts
│   ├── useSidebarAnimationEvents.ts
│   ├── useSidebarLayoutWidth.ts
│   ├── useSidebarResize.ts
│   ├── useSidebarSelectionVisibility.ts
│   ├── useStartupWorkspaceScope.ts
│   ├── useThemeManager.ts
│   ├── useWorkspacePaneGeometry.ts
│   ├── useWorkspaceStageMeasurement.ts
│   └── useWorkspaceVfsRuntimeContextSync.ts
├── definitions/
│   ├── layoutState.ts
│   └── workspacePaneGeometry.ts
├── document/
│   ├── DocumentPane.vue
│   └── DocumentSurface.vue
├── functions/
│   ├── documentSelectionPresentation.ts
│   ├── headerPaneGeometry.ts
│   ├── layoutStateTransitions.ts
│   ├── workspacePaneGeometry.ts
│   ├── themeClassManagement.ts
│   └── workspaceVfsRuntimeContext.ts
├── orchestration/
│   ├── documentRuntime.ts
│   ├── markdownDocumentEditorRuntime.ts
│   ├── resolveCurrentOpenDocument.ts
│   ├── workspaceContext.ts
│   ├── workspaceDocumentExport.ts
│   ├── workspaceMutationEffects.ts
│   ├── workspaceNodeDeletion.ts
│   ├── workspaceNodeRemoval.ts
│   ├── workspaceNodeTransfer.ts
│   ├── workspaceReferenceContent.ts
│   └── workspaceNavigation.ts
├── sidebar/
│   └── Sidebar.vue
├── store/
│   └── layoutStore.ts
└── styles/
    ├── editor-shell.css
    ├── index.css
    ├── layout-transitions.css
    └── layout-variables.css
```

## 分层职责

| 层级 | 职责 | 禁止 |
|---|---|---|
| `definitions/` | layout 领域的状态类型、pane 类型、scene 类型 | 写业务流程或副作用 |
| `functions/` | 纯函数：状态转换、几何计算、展示判断 | 读取 store、访问 DOM、调用 IPC |
| `store/` | 持有 layout state，并暴露同步 mutation | 读写业务 scope、执行异步流程、调用 orchestration |
| `orchestration/` | 跨 store / runtime / file-manager 的流程编排 | 写复杂计算规则、直接做 UI 展示 |
| `composables/` | Vue 生命周期接线、DOM 事件、app-level 状态同步 | 承载业务规则或代替 orchestration |
| `document/` | 文档 pane 与文档 surface 装配 | 决定打开哪个文档、直接保存文档 |
| `chat/` | 右侧对话 pane 壳层 | 复制 conversation domain 逻辑 |
| `sidebar/` | 左侧 sidebar 壳层 | 操作 workspace domain 内部 store 细节 |
| `AppHeader/` | Header 的三栏视觉投影与全局按钮 | 手写 workspace pane 几何魔数 |
| `styles/` | app layout 全局变量、壳层动画、编辑器 shell 样式 | 写 domain 组件私有样式 |

## 状态边界

### `layoutStore`

`layoutStore` 只保存布局和几何状态，例如：

- `scene`：`workspace`、`knowledge-base`、`project-setup`
- `layoutMode`：`chat-centric` 或 `editor-centric`
- `sidebarMode`：对话/文件模式
- `activeDocument`：当前打开文档引用
- `documentPane` / `conversationPane`：placement、visible
- `workspaceSplit.preferredRightPaneWidth`：当前物理分割的右侧宽度偏好；拖拽时直接更新，交换主/右 pane 时按实际宽度镜像更新
- `workspaceStageWidth`：不持久化的实时内容区测量值

它不保存：

- 当前项目 scope；
- 当前 conversationId；
- 草稿对话；
- domain 的业务状态；
- 旧顶层视图字段。

`layoutStore` 的 action 应保持同步、简单。涉及保存、关闭、打开、等待 surface ready 的流程必须放在 `orchestration/`。

### `workspaceScopeStore`

当前项目、Linnya 助手 scope、草稿对话、最近活跃会话属于 `apps/renderer/shared/stores/workspaceScopeStore.ts`。layout 层只在编排中读取或更新 scope，不能把 scope mirror 到 `layoutStore`。

### `uiStore`

`uiStore` 只用于 UI 偏好、模态框、临时显示状态。它不再参与顶层导航，也不再保存当前文档 id。

## 顶层场景

`App.vue` 根据 `layoutStore.state.scene` 分发顶层场景：

- `workspace`：显示 `WorkspaceStage`，内部承载对话和文档；
- `knowledge-base`：显示知识库页面；
- `project-setup`：显示项目设置页面。

进入知识库或项目设置前，必须先通过 `workspaceNavigation` 保存并停用当前文档 runtime。不能直接让 `App.vue` 或组件切场景，否则会产生“文档 surface 已卸载，但 file-manager session 仍然活着”的断层。

## 导航入口

`orchestration/workspaceNavigation.ts` 是唯一 app-level 导航入口。它负责：

- 进入项目 workspace 或 Linnya 助手 workspace；
- 打开草稿对话或历史对话；
- 打开 Markdown、Mindmap、Sheet、Slides；
- 交换对话和文档位置；
- 折叠/展开右 pane；
- 进入知识库和项目设置；
- 关闭文档；
- 取消旧文档打开 intent。

侧边栏项目入口通过 `orchestration/openProjectWorkspaceFromSidebar.ts` 组织“导航提交 → 项目领域投影 → 新草稿 → 文件树加载”。跨项目时禁止在调用 `workspaceNavigation.openWorkspace` 前直接改写 `workspaceScopeStore`，否则导航会误判为同一 scope，并把上一个项目的活动文档带入新项目。

domain 内部需要导航时，调用 `apps/renderer/shared/ports/workspaceNavigationPort.ts`。domain 不能 import `app/layout`，也不能直接调用 `layoutStore`。

`orchestration/workspaceContext.ts` 是 app-level workspace 上下文读取入口。它负责把 workspace store 与 file-manager 的内部状态投影为窄接口：

- 当前活动文档 session；
- 文档节点摘要；
- 当前项目摘要；
- 项目文件概要；
- AI 调用前的最佳努力保存。

conversation domain 只能通过 `workspaceContextPort` 获取这些信息，避免在对话编排、页面上下文和 API 网关里散落 workspace store/file-manager 依赖。

内置 renderer plugin ports 中的 `@plugin/renderer/aiInvocationPort` host 实现是可插拔业务域调用平台 conversation 的 app-level 入口。它负责把 conversation store、workspaceScopeStore 和 chatFlowOrchestrator 的内部协作投影成插件 SDK 的窄能力：

- 为指定 workflow materialize / 选择一个 AI 会话；
- 在指定会话里发送带 `fences` / `userQuote` 的消息；
- 把业务域错误展示到平台对话错误面板。

slides/mindmap 这类可安装插件应在自己的包内生产业务引用和 AI 上下文，再通过 `@plugin/renderer/aiInvocationPort` 交给 conversation。插件/domain 不能直接 import conversation store、workspaceScopeStore 或 chatFlowOrchestrator。

`orchestration/workspaceReferenceContent.ts` 是 workspace `[#ref]` 引用解析所需内容的 app-level 读取入口。conversation domain 可以计算和展示引用，但不能直接通过 `workspaceGateway` 读取 Markdown 文档内容；需要候选根块 ID 时，只能通过 `workspaceReferenceContentPort` 获取。

`orchestration/workspaceDocumentExport.ts` 是“把对话 HTML 另存为工作区 Markdown 文档”的 app-level 编排入口。它负责：

- 根据 workspace 当前选择推导新文档父目录；
- 调用 workspace tree 创建文档并标记 New；
- 通过 workspace navigation 打开新文档；
- 通过 Markdown document editor runtime 取得 Tiptap 实例并写入 HTML；
- 标记 dirty 并触发 file-manager 保存。

conversation domain 只能通过 `workspaceDocumentExportPort` 表达导出意图，不能直接 import workspace store、file-manager 或 document runtime。

`orchestration/workspaceMutationEffects.ts` 是 workspace mutation bus 的前端消费入口。它只处理 app 级工作区事实事件，不读取 conversation run / tool output 结构：

- `workspace.node.*`：刷新文件树、标记新节点、处理 active document 删除；
- `workspace.document.updated(pending)`：当前 Markdown 文档匹配时同步 pending revisions；
- `workspace.document.updated(version)`：当前插件文档匹配时派发给插件 renderer document mutation handler。

`orchestration/workspaceNodeDeletion.ts` 统一编排用户删除与 mutation bus 外部删除：关闭被删 active runtime、刷新树、按删除前树顺序选择相邻 page，并在项目没有 page（只剩图片/附件也算没有）时让原文档 pane 显示“暂无文件”。文件空态只能替换文档内容，必须保留对话原本位于中间或右侧的布局与可见状态。删除按钮只通过 `workspaceNodeDeletionPort` 表达意图，不能直接拼接 selection、layout 和 navigation 状态。

`orchestration/workspaceNodeTransfer.ts` 是文件/文件夹跨项目转移的 app-level workflow。它先调用后端预检取得完整子树 ID；活动文档命中时先通过 file-manager 保存；再执行原子 transfer，并修正来源项目的树、runtime 和 page 选择。外部 `workspace.node.transferred` 事件在来源项目执行移除，在目标项目刷新根目录。Workspace UI 只能通过 `workspaceNodeTransferPort` 请求转移，不能直接调用 transfer IPC。

`orchestration/workspaceNodeRemoval.ts` 提供删除与跨项目移动共同需要的“节点离开当前项目”流程：保存删除/移动前的树顺序、选择相邻 page、查询最近 page、刷新来源 parent 或根目录。具体删除/转移用例拥有自己的写入时序和本地 mutation 去重，不得复制这套规则。

`orchestration/resolveCurrentOpenDocument.ts` 以 `layoutStore.activeDocument` 为当前打开文档权威，并通过 document type registry 把 active document type 映射回 workspace node type。Slides 这类没有 file-manager session 的 surface 也必须走这个 resolver，禁止再用 conversation/tool-output 结构猜测当前文档。

Workspace Mutation Bus 的完整契约、发布规则和插件接入规范见 [Workspace Mutation Bus](../../../../docs/workspace-mutation-bus.md)。

## 文档 runtime

文档 runtime 由三部分协作：

1. `workspaceNavigation` 决定打开意图、保存旧 session、更新 layout；
2. `DocumentSurface` 根据 `activeDocument` 挂载具体 surface；
3. `documentRuntime` 通过 `documentSurfaceRuntimePort` 提供 ready 等待和清理。

`documentSurfaceRuntimePort` 只表达任意插件 Document Surface 的挂载就绪事实，不认识 Markdown、Tiptap 或具体 editor 实例。平台 Markdown file handler 和 HTML 导出编排需要访问 Tiptap 时，必须通过独立的 `markdownDocumentEditorRuntimePort`；其他插件拥有自己的 renderer runtime，不把类型特判加回通用 surface 流程。

规则：

- Markdown / Mindmap / Slides：先挂 surface，等 surface ready，再激活 file-manager 或加载 deck；
- Sheet：先由 file-manager handler 准备 pending open context，再挂 `SheetCanvas`；
- 每次打开文档都有 AbortController，旧 intent 不能继续写入新 surface；
- 折叠右 pane 只改变 `visible/occupied`，不关闭文档；
- 同一 workspace scope 内遵循“点哪哪出/换”：主区是对话时点击文档会打开/切换右侧文档 pane；主区是文档时点击对话会打开/切换右侧对话 pane；点击与主区同类内容只切主区，不影响右 pane；
- 跨 workspace scope 点击对话或文档时，必须关闭当前右 pane，避免一个工作台同时展示两个项目的上下文；
- 关闭文档、切换文档、离开 workspace 才允许保存、deactivate、销毁 runtime。

## 三栏几何

workspace 视觉上是三栏：

```text
左侧 sidebar | 主 pane | 右 pane
```

Header 也必须投影同样的三栏结构：

- 左侧 Header：全局按钮；
- 中间 Header pane：跟随主 pane，显示主 pane 的标题和操作；
- 右侧 Header pane：跟随右 pane，显示右 pane 的标题和操作。

Header 只拥有 pane 几何和标题 segments 的摆放，不拥有具体业务 surface 的导航状态。文档标题由
workspace 投影为 `项目 / 文档路径`；Conversation 标题由 Conversation 域投影：普通对话显示
`对话标题`，Subrun 详情显示 `父对话标题 / Subrun 标题`。Subrun 的临时 scope 归
`features/subrun-detail`，`HeaderRightSection` 只能通过其公开只读 selector 消费，不能把 scope
复制进 `layoutStore`，也不能从 DOM、消息文本或当前 Agent 类型猜标题。

同一份 Conversation 标题 segments 必须同时供主 pane 和右 pane 使用，左右交换只改变摆放位置，
不能创建第二份 Header 状态。Subrun 的父对话 segment 可以发出返回意图，但不直接操作详情
surface 或 DOM；返回行为仍归 `ConversationHost` 的精确消息锚点导航，Header 不绕过该 owner。

几何规则集中在：

- `composables/useSidebarLayoutWidth.ts`
- `composables/useWorkspacePaneGeometry.ts`
- `composables/useWorkspaceStageMeasurement.ts`
- `composables/useRightPaneResize.ts`
- `functions/headerPaneGeometry.ts`
- `functions/workspacePaneGeometry.ts`

对话 pane 的最小宽度为 `360px`，文档 pane 的最小宽度为 `480px`。两者都没有固定最大宽度；右 pane 在当前窗口里的动态上限，只用于给主 pane 留出对应的最小宽度。窗口无法同时容纳两个最小 pane 时，右 pane 保持挂载但暂不占位，窗口恢复后自动重新出现。

几何计算优先使用 `WorkspaceStage` 的 `ResizeObserver` 实测宽度。侧栏展开、收起和拖拽过程中，Header 与内容 pane 必须逐帧消费这一个测量结果，不能分别使用目标 sidebar 宽度推算。

分割线属于 `WorkspaceStage`，不能再放回 `DocumentPane`、`ConversationSidePane` 或具体空态。真实文档、文件空态和右侧对话必须复用同一个拖拽入口和同一份宽度偏好。

交换主 pane 与右 pane 时，内容和当前实际宽度必须一起交换。交换编排使用 `WorkspaceStage` 的实测宽度和统一几何函数镜像分割线，不能只改 `layoutMode` 而把宽度留在物理槽位上。

`ConversationSidePane` 是异步加载的纯布局壳，只拥有 `aside` 语义、尺寸和活动态透传。主区与右侧的 scope 分派、项目/Linnya 选择、草稿空态和历史 Host 装配统一归 `app/pages/WorkspaceConversationSurface`；SidePane 禁止直接读取 conversation store、判断内容相位或挂载 `ConversationHost`。

Header 和 `WorkspaceStage` 中的中右分割线通过 `interactionGroup="workspace-split"` 表达同一条物理边界。内容区分割线 hover、键盘 focus 或拖拽时，Header 对应线段必须同步高亮，不得各自维护交互状态。

不要在 Vue 组件里手写按钮宽度、窗口控制区宽度、pane 边界魔数。Header 和 WorkspaceStage 必须从同一套语义派生边界。

## Pane 显隐契约

`mounted`、`visible`、`occupied` 是三件不同的事：

| 状态 | 含义 |
|---|---|
| `mounted` | runtime 是否存在 |
| `visible` | 用户是否看得见 |
| `occupied` | 是否占布局宽度 |

折叠右 pane：runtime 保持挂载，`visible=false`、`occupied=false`。  
关闭文档：保存并 deactivate 后，清 `activeDocument`，runtime 才卸载。

右侧 pane 的展开 / 收起必须使用抽屉几何：外层 frame 只动画 `occupied width` 并裁剪内容，
内部 Document 或 Conversation surface 始终使用 `rightPaneWidth`。禁止让内部对话跟随 frame 从
`0 → target` 逐帧变宽，否则 Markdown 会连续换行，Conversation virtualizer 还会在稳定宽度
提交时再次恢复锚点，表现为正文先上移再归位。右侧 Conversation 在展开前恢复活动，在收起
动画结束后才停用虚拟列表与 observers；不能提前清空退出动画，也不能在完全隐藏后继续工作。

不要用一个 `v-if` 同时表达“用户看不见”和“runtime 应该销毁”。

## Sidebar 协作

`sidebar/Sidebar.vue` 是 app 壳层，负责给 workspace sidebar 注入：

- 当前 scene；
- sidebar mode；
- 切换 mode 的入口；
- 进入知识库等 app-level 导航动作。

内容区始终保留 300ms `margin-left / margin-right` 过渡，让 Sidebar 打开、关闭时正文宽度
平滑变化；不能因 Conversation 是否生成而切换成瞬时宽度。生成期的高成本 Markdown 提交
由 Conversation 根据真实内容列 resize 自己调度，AppLayout 不依赖 conversation store。
AppLayout 的 `.content-area` 规则必须限定到 `> .main-container > .content-area`，不能命中
AnswerMessage 等 domain 内部的同名局部 class。

`useSidebarAnimationEvents` 以真实 `transitionend` 结束正常动效事务；拖拽侧栏时 CSS 已进入
`panel-resizing` 并取消 transition，因此在当前 Vue 提交后主动结束事务。批注位置的逐帧计算
只由 EditorContext 响应 `sidebar-anim-start/end`，AppLayout 不再建立第二套 300ms rAF 重算。

文件树、项目列表、对话历史等具体 UI 仍在对应 domain 内。app/layout 不应该深入操作 workspace domain 内部树结构；确实涉及跨 domain 的同步，例如 conversationId 影响 VFS runtime context，应放在 app-level composable：

- `composables/useWorkspaceVfsRuntimeContextSync.ts`
- `functions/workspaceVfsRuntimeContext.ts`

### Sidebar 视觉边界

左侧侧边栏的跨 domain 组合面位于 `sidebar/WorkspaceSidebarSurface.vue`。它可以拼接 workspace 项目/文件树、conversation 对话列表和 app-level 导航动作，但不能把某个 domain 的业务规则搬进 layout store。

`WorkspaceSidebarSurface.vue` 只保留 app-level 串联职责，单文件必须保持在 700 行以内。这里虽然会组合 workspace 内容，但它不是 workspace domain：凡是同时拼接 conversation、knowledge base、plugin store 或 app navigation 的代码，都留在 `app/layout/sidebar`。

具体 UI 片段拆到 `sidebar/components/`：

- `SidebarListNav.vue`：列表态顶部导航入口，包含新对话、知识库、插件等 app-level 入口；
- `SidebarProjectNav.vue`：项目态顶部返回、分段切换、搜索与新建菜单；
- `SidebarContent.vue`：列表态/项目态内容区拼装，会同时组合 workspace 文件树和 conversation 对话列表；
- `SidebarAssetPreview.vue`：文件树资源预览弹窗。

文件树点击打开、资源预览、项目删除确认等局部流程放在 `sidebar/composables/useSidebar*.ts`，避免主组合面继续膨胀。只有纯 workspace 的项目、文件树、菜单、拖放能力才放到 `domains/workspace/ui/sidebar`。

侧边栏壳层样式分工：

- `app/layout/styles/components/SidebarShell.css`：只负责固定定位、尺寸和壳层背景；
- `app/layout/styles/components/PaneDivider.css`：统一承接左、中、右 pane 的边界线、hover 强调线、拖拽热区和光标；左侧栏的分割线由 Sidebar 向上贯穿 Header，不得再单独绘制 Header 边界；
- `app/layout/styles/components/SidebarProjectGroup.css`：只承接 app-level 项目行与其内嵌 conversation 列表的组合样式；
- `app/layout/styles/components/SidebarConversationList.css`：承接对话列表在外层项目列表和项目页中的宿主组合样式；
- `domains/workspace/styles/components/WorkspaceSidebar.css`：侧边栏业务内容共享行模型与局部文字 token；
- `domains/workspace/styles/components/file-tree/*`：文件树容器、节点行、缩进、菜单和空状态；
- `domains/conversation/styles/components/SidebarChatList.css`：对话列表自身的状态、时间、More 菜单和展开/折叠文本操作。

侧边栏文字颜色必须使用 workspace sidebar 的局部 token，而不是在各子模块直接散落 `--color-text-tertiary`：

- 普通项文字：`--workspace-sidebar-label-color`；
- 分组/header 文字：`--workspace-sidebar-heading-color`；
- 时间、空状态、搜索图标等弱文字：`--workspace-sidebar-muted-color`；
- 搜索 placeholder：`--workspace-sidebar-placeholder-color`。

这些 token 定义在 `WorkspaceSidebar.css`，由全局 semantic token 推导。需要调整整个侧边栏文字深浅时，只改这组局部 token；不要分别改项目列表、对话列表和文件树，否则三套列表会再次出现视觉不一致。

对话列表的“展开显示 / 折叠显示”是文本型轻操作，不属于普通 row hover。hover 只允许文字变为 `--color-text-primary`，不能显示容器背景。

## 可测试规则

新增规则优先放进 `functions/` 并补单测。当前已有测试覆盖：

- layout state transitions；
- header pane geometry；
- sidebar 文件选中态展示；
- VFS runtime context 是否需要重载项目树。

组件层只做连接和展示，复杂判断不要散落在 template 或 watcher 里。

## 禁止事项

- 禁止新增旧式顶层视图字段或 `show*` 导航 action；
- 禁止 domain import `@/app/layout`；
- 禁止 UI 组件直接调用 file-manager 打开文档；
- 禁止 store watch 另一个 store 来 mirror 同一份语义；
- 禁止通过 `setTimeout` 或轮询等待 Vue DOM ready；
- 禁止折叠 pane 时卸载文档 runtime；
- 禁止把 scope、conversationId、draft conversation 写入 `layoutStore`；
- 禁止把不好归类的代码放进 `utils/helpers/common`。

## 常用验收

```bash
# app/layout 内不应重新出现旧顶层导航入口
rg "activeView|useActiveViewLayoutSync|safeSwitchView|uiStore\\.show(Editor|Mindmap|Sheet|Slides|ProjectWorkspace|LinnyaAssistantWorkspace|KnowledgeBase|ProjectSetup)|currentDocumentId|setCurrentDocumentContext" apps/renderer/app/layout -g'*.ts' -g'*.vue' -g'*.js'

# domain 不应反向依赖 app/layout
rg "from ['\\\"]@/app/layout|useLayoutStore" apps/renderer/domains -g'*.vue' -g'*.ts' -g'*.js'

# file-manager 不应恢复视图 watch 或 editor 轮询
rg "waitForEditorInstance|Editor instance not ready within timeout|viewSwitchWatcher|setInterval\\(.*getEditor" apps/renderer/domains/workspace/services/file-manager apps/renderer/app/layout/orchestration -g'*.ts' -g'*.js'

# layout 纯函数测试
npm test -- apps/renderer/app/layout/functions/headerPaneGeometry.test.ts apps/renderer/app/layout/functions/layoutStateTransitions.test.ts apps/renderer/app/layout/functions/workspaceVfsRuntimeContext.test.ts
```

完整前端构建仍以 `npm run build:frontend` 为准。
