# Workspace Sidebar 领域能力

这个目录只保留 workspace domain 自己的项目、文件树、菜单与拖放能力。

容易混淆的一点：`app/layout/sidebar` 是应用布局里的左侧栏组合面；`domains/workspace/ui/sidebar` 是 workspace 领域贡献给左侧栏的业务能力。两者不能合并。

- 放 `domains/workspace/ui/sidebar`：项目、文件树、节点菜单、拖放、项目/文件创建等只属于 workspace 的能力。
- 放 `app/layout/sidebar`：同时拼接 workspace、conversation、knowledge base、plugin store 或 app navigation 的组合代码。

跨 workspace、conversation、knowledge base 的侧边栏组合由 `app/layout/sidebar/WorkspaceSidebarSurface.vue` 持有。

## 当前形态

侧栏有两个导航形态：

- 列表态：展示新对话、新项目、知识库、插件、项目列表，以及项目展开后的对话列表。Linnya 助手入口的真实工作台能力尚未实现，当前暂不展示。
- 项目态：聚焦单个项目，顶部显示返回、项目名和“对话 / 文件”分段；文件页独占整个侧栏内容高度。

`sidebarNav` 是导航形态，归属 `app/layout`；它不能从 workspace scope 推导，因为列表态点项目对话会切 scope，但侧栏仍停留在列表态。

`sidebarMode` 只在项目态里表示子标签。列表态始终展示对话维度，不读取 `sidebarMode` 决定主分支。

## 数据流

- `app/layout/sidebar/Sidebar.vue` 持有布局壳尺寸、拖拽和布局状态连接。
- `app/layout/sidebar/WorkspaceSidebarSurface.vue` 负责跨 domain 拼接项目列表、项目文件、对话列表和知识库入口。主文件只保留 app-level 串联职责，顶部导航、内容区、资源预览等展示拆在 `app/layout/sidebar/components/`。
- `app/layout/sidebar/components/SidebarProjectGroup.vue` 负责“项目行 + 项目对话列表”的混合展示，因为它同时依赖 workspace 项目和 conversation 列表。
- workspace domain 组件只接收明确数据和回调，不直接 import conversation domain 的 store、UI 或 orchestration。
- `index.ts` 是 app 组合面使用 workspace 侧边栏能力的公开出口，避免 app 层散落依赖内部路径。
- 对话列表和历史操作属于 conversation domain；项目/文件树、项目创建和文件菜单属于 workspace domain。

## 文件结构

- `components/`：workspace 侧边栏内部弹窗、右键菜单等不依赖 conversation 的组件。
- `file-tree/FileTreeView.vue`：项目态文件树。
- `composables/`：文件拖放、文档操作、项目操作、右键菜单等侧栏业务能力。
- `store/sidebarProjectExpansionStore.ts`：列表态项目展开状态。
- `functions/`：仅存放侧栏内可测试的纯函数规则。
- `index.ts`：workspace sidebar 的窄公开入口，仅暴露 app 组合面需要的能力。

## 交互边界

- hover 偷看浮层已经删除，侧栏不再使用项目文件 / 对话历史预览弹窗。
- 底部不再放“对话 / 文件”全局切换，只保留账户区域的预留容器。
- 跨 domain 的 workspace scope、conversation 打开、VFS runtime context 刷新不写进 workspace 领域组件内部规则；app 组合面只发出明确事件或调用已有窄口。
- 文件树刷新规则位于 `app/layout/functions/workspaceVfsRuntimeContext.ts`，避免 UI 组件暗中承担跨 domain 判断。
- 对话置顶状态由后端持久化并参与列表排序，侧栏本地排序只用于点击后的即时反馈，规则需与后端保持一致。
- 项目菜单的删除可用性来自项目契约 `canDelete`。侧栏只能消费能力，不要按项目名称推断默认项目。

## 样式约定

侧栏样式由 workspace domain 样式入口聚合。普通节点样式必须收口到 `.workspace-sidebar` 和组件根类下；Teleport 菜单必须使用自身唯一 wrapper 类。

新增样式优先放到对应组件或 feature 的 domain CSS 中。只有真正跨 domain/插件稳定复用的基础浮层、控件或变量，才允许进入 `@linnya/renderer-ui` 的对应 feature；不得重新建立 Host `shared/styles` 杂物目录。
