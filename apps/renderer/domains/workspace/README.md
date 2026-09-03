apps/renderer/domains/workspace/
├── README.md
├── features/
│   ├── import-export/
│   ├── todo/
│   ├── tree-loading/                          # VFS 树加载、展开恢复与刷新编排
│   ├── tree-node-mutations/                   # 节点 CRUD 与提交后刷新编排
│   ├── page-selection-after-removal/
│   │   ├── definitions/                      # 节点离开当前项目后的 page 选择契约
│   │   └── functions/                        # 删除/跨项目移动共用的相邻 page 继任规则
│   └── project-overview/
│       ├── functions/                         # 概览统计纯规则
│       ├── orchestration/                     # 只读概览快照加载
│       └── ui/                                # 项目概览 Modal
├── definitions/
│   └── workspaceTree.ts                       # Renderer 树节点与 VFS runtime context
├── shared/
│   ├── workspaceTreeState.ts                  # DTO 投影、协调与树查询
│   └── workspaceTreeExpansionState.ts         # 项目级展开状态持久化
├── services/
│   └── file-manager/
│       ├── handlers/
│       │   ├── markdown.ts
│       │   └── mindmap.ts
│       ├── mindmapAdapterBridge.ts
│       ├── index.ts
│       ├── setup.ts
│       └── README.md
├── store/
│   ├── index.ts
│   ├── WorkspaceProjectsStore.ts
│   ├── WorkspaceSelectionStore.ts
│   └── WorkspaceTreeStore.ts
└── ui/
    ├── home/
    │   ├── ProjectKbSettingsPanel.vue
    │   └── README.md
    └── sidebar/
        ├── README.md                           
        │
        ├── project-list/                       # 项目列表模块
        |   └── ProjectListView.vue
        │
        ├── file-tree/                          # 文件树模块
        │   ├── FileTreeView.vue
        │   └── TreeItem.vue
        │
        ├── functions/                          # 文件树纯规则
        │   └── nodeContextMenuModel.ts         # 节点能力菜单模型
        │
        ├── components/                         # 共享组件
        │   ├── ContextMenu.vue
        │   └── CreateProjectModal.vue
        │
        └── composables/                        # 业务相关 Composables
            ├── useSidebarDragDrop.js           # 文件拖放
            ├── useTreeItemDragDrop.js          # 树节点拖放
            ├── useDocumentOperations.js        # 文档操作
            ├── useProjectOperations.js         # 项目操作
            └── useContextMenu.js               # 右键菜单

## 重要约定

- 工作区同一项目、同一父目录下的未删除节点名必须唯一；历史重名由数据库迁移自动改为 `名称 (1)`、`名称 (2)`。
- `WorkspaceTreeStore` 只持有响应式状态、同步 action 和 feature 组合；VFS 加载/刷新归属 `tree-loading`，异步节点变更归属 `tree-node-mutations`。树 DTO 投影属于 workspace domain shared，禁止全局 shared 反向依赖 Store 内部类型。
- 文件树刷新由 Workspace Mutation Bus 驱动；普通 node CRUD 走已注入 publisher 的 `WorkspaceService`，跨项目转移走独立 `node-transfer` feature 并在提交后发布 `workspace.node.transferred`。完整规则见 [Workspace Mutation Bus](../../../../docs/workspace-mutation-bus.md)。
- 节点删除由 `workspaceNodeDeletionPort` 进入 app-level 编排；UI 不得在单删、批量删除入口各自维护 active page 回退。page 只由已启用 document type 定义，图片和附件资源不属于 page。
- 真实文件和文件夹通过“移动到项目”转移到另一个项目根目录；一期只允许单节点入口，文件夹包含完整子树，不选择目标文件夹、不批量移动、不跨项目拖拽。转移保持 `workspace_nodes.id` 与文档卫星表身份，目标根目录同名时拒绝，不覆盖或自动改名。
- 跨项目转移由 `workspaceNodeTransferPort` 进入 app-level 编排：后端预检提供完整子树 ID，活动文档命中时必须先保存，事务成功后来源项目与目标项目分别按 mutation 刷新。删除与转移共同使用 `page-selection-after-removal`，不能各自维护 page 继任规则。
- 文件夹删除是完整子树软删除，`workspace.node.deleted.deletedNodeIds` 是后端确认的删除事实；只标记文件夹会产生仍可被最近文档和 Agent 读取的孤儿 page，禁止恢复这种语义。
- 默认项目在侧边栏项目菜单中禁止删除；项目身份由后端 `projects.system_role = 'default'` 契约表达，前端只读取项目能力 `canDelete`，不能再按名称判断。
- 前端菜单里的“复制相对路径”统一复制 VFS `path`；`inode` 只作为内部工具和长任务稳定寻址能力，不作为普通用户菜单项暴露。
- 前端文件树的右键菜单和 More 菜单必须从节点能力模型生成；虚拟资源不能触发真实节点的重命名、删除、复制 IPC。
- 左侧侧边栏的跨 domain 组合面位于 `app/layout/sidebar/WorkspaceSidebarSurface.vue`；`app/layout/sidebar/components/SidebarProjectGroup.vue` 承载“项目行 + 对话列表”的混合展示。workspace domain 只保留项目和文件树能力，不直接持有 conversation domain 的 UI 或 store。
- 左侧侧边栏的宽度调整属于应用布局能力，由 `app/layout/composables/useSidebarResize.ts` 统一管理；workspace domain 不得再维护独立的 resize 状态或实现。
- 工作区项目对话与项目初始化页属于 app-level 场景组合，分别位于 `app/pages/WorkspaceConversationSurface/ProjectConversationSurface.vue` 和 `app/pages/ProjectSetupPage/ProjectSetupView.vue`。前者同时服务主区首页与右侧栏，两个位置共享消息列和输入框规格，但只在首页装配建议操作和知识库预加载；workspace domain 只提供项目树、项目概览、项目统计、项目知识库设置等领域能力。项目概览可从侧边栏 More 菜单直接打开，不能为了弹窗而切换当前工作区。

## 左侧侧边栏与文件树视觉约定

左侧侧边栏由 app/layout 装配，但 workspace domain 拥有项目列表、项目文件树和文件树空状态等具体业务 UI。样式入口位于：

- `styles/components/WorkspaceSidebar.css`：侧边栏业务内容的共享行模型、局部文字 token、项目态 top/search/create 等通用规则；
- `styles/components/file-tree/FileTreeView.css`：文件树容器、标题、空状态和文件树菜单；
- `styles/components/file-tree/TreeItem.css`：文件树单行、缩进、chevron、文件/文件夹 icon、More 按钮、拖拽态；
- `styles/components/sidebar/ProjectListView.css`：外层项目列表。

文件树和项目/对话行必须共用 `.workspace-sidebar-row` 盒模型，避免三套列表在 1px 级别反复漂移。关键变量由 `.workspace-sidebar` 提供：

- `--workspace-sidebar-row-height`：统一行高，当前为 `32px`；
- `--workspace-sidebar-row-margin-x` / `--workspace-sidebar-row-padding-x`：统一外边距与行内边距；
- `--workspace-sidebar-tree-indent`：文件树层级缩进；
- `--workspace-sidebar-label-color`：侧边栏普通文字，例如项目名、对话名、文件名；
- `--workspace-sidebar-heading-color`：分组标题和项目内部 header 标题；
- `--workspace-sidebar-muted-color`：时间、空状态、搜索图标等弱文字；
- `--workspace-sidebar-placeholder-color`：搜索框 placeholder。

这些局部文字 token 是侧边栏自己的视觉契约，基于全局 `--color-text-*` semantic token 推导。不要在文件树、项目列表或对话列表里重新写一套灰阶；需要让侧边栏整体变深/变浅时，应优先调整 `WorkspaceSidebar.css` 中这几个局部变量。

文件树缩进约定：

- 文件/文件夹行左侧由 `.workspace-sidebar-row` 统一控制；
- chevron 使用独立的绝对定位，当前视觉宽度为 `10px`，不再额外占出一段空白；
- `TreeItem.css` 只能通过 `--node-depth` 和 `--workspace-sidebar-tree-indent` 派生层级，不要写死每一层 padding；
- 文件树的 row、对话 row、项目 row 的文字起点应保持同一套视觉模型，差异只能通过变量覆盖。

交互约定：

- 文件树 More 菜单和右键菜单必须来自 `ui/sidebar/functions/nodeContextMenuModel.ts` 的节点能力模型；
- “移动到项目”的目标列表来自项目 store，但执行必须交给 app-level `workspaceNodeTransferPort`；Vue 和菜单 composable 不得直接编排保存、IPC、active page 或双项目刷新；
- 文件树的 Shift 范围选择由 workspace store 持有锚点和状态，但有序区间合并必须调用 `shared/selection`，与对话列表共用同一纯函数；
- AI/导出创建的文件如果需要显示 `New` 标签，应通过 `WorkspaceTreeStore.createDocument({ markAsNew: true })` 或工具输出副作用显式标记；
- “展开显示 / 折叠显示”属于对话列表轻量文本操作，hover 只改变文字色，不显示行背景；
- 长时间 hover 文件不应出现浏览器原生 title 弹窗，文件树需要自定义悬浮信息时应使用统一 tooltip/popover。
