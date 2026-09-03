### app/pages 层说明（场景壳 vs 领域 UI）

> **目标**：区分 `app/pages/*` 和 `domains/*` 的职责，避免以后「这个文件是不是多余」的困惑。

---

## 1. 核心概念对齐

- **domains/\*/ui/\***（领域 UI）
  - **关注点**：某个「能力」本身怎么工作。
  - 例子：`domains/editor/ui/EditorContext.vue`、`domains/mindmap/ui/MindMapView.vue`、`domains/conversation/ui/LinnyaAssistantChatSurface.vue`。
  - 里面会有：领域自己的 store / IPC / 内部子组件（如 MindMapToolbar / ContextMenu / NodeEditor）。
  - **不关心**自己出现在什么页面，只要能被挂载使用即可。

- **app/pages/\***（页面 / 场景壳）
  - **关注点**：在「某个应用场景」下，如何组合/摆放各个领域 UI。
  - 例子：`ChatCentricPage`、`MarkdownEditorPage`、`MindmapPage`、`ProjectSetupPage`；Sheet / Slides 这类插件文档 surface 由 renderer contribution 注册。
  - 未来会负责：跨领域组合、路由参数解析、权限/守卫、场景级 Header / 操作条等。
  - **不实现具体领域业务逻辑**，只做「装配」。

这与 `apps/renderer/docs/DIRECTORY-STRUCTURE-PLAN.md` 中的设计是一致的：

- `domains/*` = 领域能力（Editor / Mindmap / Workspace / Conversation / KnowledgeBase / Settings）。
- `app/pages/*` = 场景页面（编辑模式、项目对话、导图视图、初始化向导等）。

### 当前工作台模型

当前长期页面心智是：

- `WorkspaceStage`：左侧 sidebar、主区、右 pane 的几何壳。
- `ChatCentricPage`：对话主区的首页壳。
- `WorkspaceConversationSurface`：主区与右侧共用的工作区对话装配面，统一分派项目 / `Linnya 助手`，并把应用场景映射为空态 composer 位置。
- `DocumentSurface`：统一承载 Markdown / Mindmap / Sheet / Slides 的文档 runtime surface。
- `KnowledgeBasePage` 与 `ProjectSetupPage`：旁路全屏视图。

顶层场景由 `app/layout/store/layoutStore.ts` 中的 `scene` 表达；当前项目、Linnya 助手、草稿对话和历史会话由
`shared/stores/workspaceScopeStore.ts` 作为唯一 scope 权威表达。Page 层只做场景装配，不保存第二份导航状态。

右 pane 的开合是外框裁剪式抽屉：frame 动画占位宽度，内部 Document / Conversation surface
始终保持最终内容宽度。Conversation 只能在收起动画结束后释放活动渲染实例，避免展开期间
逐帧重排正文以及 settled-width 锚点二次收敛。

### 构建加载边界

- `App.vue` 中的 `WorkspaceStage / ProjectSetupPage / KnowledgeBasePage / PluginStorePage` 是互斥 scene，必须通过 `defineAsyncComponent` 按当前 `scene` 加载；禁止恢复顶层静态导入。
- `WorkspaceStage` 中的 `DocumentPane` 与 `ConversationSidePane` 由现有 `v-if` 决定是否存在，组件本身也必须异步加载。折叠已挂载文档仍只改变可见性，不能借代码分包改变 runtime 生命周期契约。
- `AppLayout` 中只在 editor 文档激活时出现的 menu、outline、LaTeX 面板和 block action menu 必须保持异步；全局导航、通知和模态框仍属于常驻 app shell。
- `vite.config.mjs` 的手工 chunk 先按稳定第三方包族拆分，再按 `domains/` 和 editor / conversation 内部既有职责边界拆分。它只决定缓存与解析边界，不改变 domain 依赖方向。
- 前端生产构建以 Vite 默认 500 kB chunk 告警为门禁。出现超限时应先研究同步装配和模块归属，不得通过提高 `chunkSizeWarningLimit` 消音。
- 插件 contribution 同样只声明能力，Konva、ECharts、Univer 等重型文档 surface 必须在用户打开对应文档时
  异步加载；插件自己的生产构建应把默认体积告警升级为失败门禁。

补充导航：如果你想从“领域模块的组织方式/新增 domain/新增页面类型”角度看整体架构，请看 `apps/renderer/domains/README.md`。

---

## 2. 当前各 Page 的职责

### `DocumentSurface`

- **作用**：文档 runtime surface。
- 当前实现：根据 `activeDocument.type` 分发到 Markdown / Mindmap / Sheet / Slides，并在挂载后向 `documentRuntime` 注册 ready。

约束：折叠/展开 pane 只能改变可见性和占位宽度，不能销毁文档 runtime；关闭文档和切换文档必须通过 `workspaceNavigation` 编排 save/deactivate。

`DocumentSurface` 只拥有通用挂载与 ready 生命周期，不暴露 Tiptap/ProseMirror。平台 Markdown contribution 挂载 `MarkdownDocumentSurface -> MarkdownEditorPage`，并通过独立的 `markdownDocumentEditorRuntimePort` 向 Markdown file handler 提供富文本实例；其他插件不进入这条 port。

### `ChatCentricPage/ChatCentricPage.vue` 与 `WorkspaceConversationSurface`

- **作用**：对话居中工作台页面壳。
- `ChatCentricPage` 只选择 `home` presentation；`ConversationSidePane` 选择 `side-pane` presentation，并继续作为 `WorkspaceStage` 异步加载的布局壳。
- 两个位置都必须进入 `WorkspaceConversationSurface/WorkspaceConversationSurface.vue`。scope 分派、项目活动态同步和 presentation 映射只能在这里装配，禁止右侧直接挂载 `ConversationHost` 或复制内容相位判断。
- `home` 与 `side-pane` 统一装配、内容相位、消息列和输入框规格；页面排版仅有一项差异：前者使用居中首页输入框，后者复用历史对话空态视觉并把同一个 regular 输入框放在底部 footer。禁止把 `side-pane` 映射成 `compact`，否则消息边距和“+ / Agent”选择区会一起被压缩。
- 中央对话面板统一复用 `domains/conversation/ui/ConversationChatSurface.vue`，项目概览、知识库关联与统计保留在 workspace domain。
- 项目对话容器 `WorkspaceConversationSurface/ProjectConversationSurface.vue` 只负责 app-level 装配：conversation 提供对话表面，workspace 提供项目与项目概览，knowledgebase 只在 `home` presentation 通过幂等入口准备首页数据。

### `MindmapPage/MindmapPage.vue`

- **作用**：思维导图视图的页面壳。
- 当前实现：

```vue
<MindMapView />
```

- 注意：
  - 真正的 Mindmap 能力在 `domains/mindmap/ui/MindMapView.vue`。
  - 工具栏 / 右键菜单 / NodeEditor / RichContentHost 都在领域内部组装。
  - Page 层只关心「在这个场景下展示一个 MindMap 视图」。
- 未来如果需要**场景级工具条**（例如「返回项目主页」「导出为图片」「和 Workspace 联动」），应加在 `MindmapPage.vue` 中，而不是侵入 `MindMapView.vue`。

### 插件文档 surface（Sheet / Slides 等）

- **作用**：由插件 renderer contribution 向 `DocumentSurface` 注册具体页面组件、file handler、图标、外壳 class 与文档动作。
- 当前实现：Sheet 的 surface 位于 `packages/plugins/sheet/src/renderer/page/SheetPage.vue`，工作台在插件自己的 `src/renderer/domain/ui/SheetWorkbench.vue`。
- 设计意图：
  - `app/pages` 不再保存具体插件文档页面壳，host 只通过 document type registry 挂载 surface。
  - 插件 surface 的 CSS、page context、header action 和 file lifecycle 都跟随插件启停收缩。

### `ProjectSetupPage/ProjectSetupPage.vue`

- **作用**：项目初始化向导页面壳（AI + Workspace）。
- 当前由 `App.vue` 根据 `layoutStore.scene === 'project-setup'` 渲染。
- `workspaceNavigation.enterProjectSetup` 负责进入该旁路场景前的文档保存与关闭。
- `ProjectSetupPage/ProjectSetupView.vue` 是 app-level 跨领域容器：conversation 负责对话和输入，workspace 负责项目树刷新与项目信息读取，外层 `.editor-shell.for-project-setup` 由 `AppLayout` 统一标记。

---

## 3. 为什么现在的 Page 看起来「很薄」也值得保留？

即使当前很多 Page 只是简单一行：

```vue
<template>
  <SomeDomainView />
</template>
```

它们仍然有几个重要价值：

- **保持目录结构与设计文档一致**
  - 以后看目录就能直接对应到 `DIRECTORY-STRUCTURE-PLAN.md` 里的那张结构图。
  - App.vue 只和 `app/pages/*` 打交道，形成稳定的心智模型。

- **为未来扩展留出清晰位置**
  - 当某个场景需要跨领域组合 / 特殊布局时，只需要往 Page 里加代码，而不动 App 根组件或 domains。
  - 避免未来再大规模“抽壳”的重构。

- **方便迁移到路由 / 其他壳（例如 React 侧）**
  - Vue Router 接入时，直接把 `app/pages/*` 映射到路由即可。
  - 未来如果在 `apps/ide-react` 里重用逻辑，`domains/*` 可以直接共用，而 `pages/*` 形态上也一一对应。

---

## 4. 记忆小结（给未来的自己）

- **当纠结「要不要再建一个 Page 文件/目录」时：**
  - 如果这是一个**host 自有顶层视图模式**（WORKSPACE / EDITOR / MINDMAP / PROJECT_SETUP 等），**就应该有对应的 Page**；插件文档 surface 则放到对应插件 renderer 包。
  - 哪怕现在只是一层简单包裹，将来也很可能慢慢长成「场景组合中心」。

- **当纠结「这个东西是 Page 还是 Domain」时：**
  - 如果它只关心某个能力自身（编辑器、导图、Workspace 列表等），放到 `domains/*`。
  - 如果它关心整个页面的布局/场景（header、跨领域组合、路由参数），放到 `app/pages/*` 或 `app/layout/*`。
