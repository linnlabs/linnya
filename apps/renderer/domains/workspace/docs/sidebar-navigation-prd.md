# 侧边栏导航改造 PRD（列表态 / 项目态）

> 状态：已实现
> 范围：左侧 Workspace 侧边栏的导航形态与状态模型
> 关联文件：`app/layout/sidebar/Sidebar.vue`、`app/layout/sidebar/WorkspaceSidebarSurface.vue`、`domains/workspace/ui/sidebar/*` 等（见「受影响文件」）

---

## 1. 背景与问题

当前侧边栏用一个**全局开关** `sidebarMode: 'chat' | 'files'`（位于底部切换条）在「对话」和「文件」之间硬切：

- `chat` 模式：助手零散对话 + 项目列表（项目可展开成对话列表）。
- `files` 模式：上半截项目列表 + 下半截选中项目的文件树。
- 另有一套 hover「偷看」浮层（`ProjectFilesPopover` / `SidebarChatHistoryPopover`）用于悬停瞄一眼另一维度。

存在三个问题：

1. **底部全局切换条占了未来「账户」要放的位置**，且语义别扭。
2. **文件视角是上下两段式**：项目列表挤在上面、文件树挤在下面，文件一多就不可用。
3. **「对话」和「文件」是同一项目的两个视角，却用一个全局开关在切**，心智不顺。

> 注：本应用历史上做过 App Home（聚合首页），后来迁移掉了。本次**不重新引入 App Home**。

---

## 2. 目标 / 非目标

### 目标
- 把侧边栏拆成两个明确的导航形态：**列表态**（浏览全部项目 + 对话）与**项目态**（聚焦单个项目，文件独占高度）。
- 删除底部全局 `对话/文件` 切换条，**底部空间让给「账户」**（本次只预留位置，不实现账户功能）。
- 文件视角在项目态里**独占整个侧栏高度**，解决「文件多了不可用」。
- 删除 hover「偷看」浮层及其全部定时器逻辑，简化代码。

### 非目标
- 不实现 App Home 聚合首页。
- 不实现「账户」具体功能（仅预留底部容器）。
- 不改动中间区（对话流 / 编辑器）本身的渲染逻辑；只在「打开项目」时复用既有的切 scope 能力。
- 启动恢复策略的「设置项」本次不做（仅做默认行为，见 §5）。

---

## 3. 核心概念与状态模型

引入**侧栏导航形态**这一独立状态，它**不能由 scope 推导**（因为列表态里点对话会切 scope，但仍要停留在列表态）：

```
sidebarNav: 'list' | 'project'
```

并保留现有的 `sidebarMode: 'chat' | 'files'`，但**重新定义其语义**：

- 只在 `sidebarNav === 'project'` 时有意义，表示「项目态内部的子标签」（对话 / 文件）。
- 在 `sidebarNav === 'list'` 时无意义（列表态恒定展示对话维度）。

形态与 scope 的关系：

| 动作 | sidebarNav | scope | 中间区 |
|---|---|---|---|
| 列表态点项目名 / 箭头 | `list`（不变） | 不变 | 不变（只就地展开该项目对话列表） |
| 列表态点某条对话 | `list`（**保持**） | 切到该项目 | 显示该对话 |
| hover 项目 →「打开」 | `project` | **切到该项目** | **切到该项目对话（草稿）** |
| 项目态「返回」 | `list` | 不变 | 不变 |
| 顶部「Linnya 助手」 | `list` | 切到助手 | 助手对话 |

**一致性护栏**：若出现 `sidebarNav === 'project'` 但 `scope.kind !== 'project'`（理论上不该发生），渲染时回退为 `list`，避免空项目态。

---

## 4. 交互规格

### 4.1 列表态（默认）

- 顶部固定入口保持不变：新对话 / 新项目 / 知识库 / Linnya 助手。
- 助手 scope 下：显示助手零散对话（`SidebarChatList scope=linnya-assistant`）。
- 「项目」分区：每个项目一行（`SidebarProjectGroup`）。
  - **单击项目名 / 前置箭头** = 就地展开/收起该项目的对话列表（`SidebarChatList scope=project`）。保持列表态。
  - **点对话** = 打开该对话（切 scope + 中间区显示），**保持列表态**。
  - **hover 项目行** = 右侧出现「打开」按钮（见 §6 可发现性）。点击「打开」= 进入项目态。
  - 「更多」菜单（编辑 / 删除）保持不变。

### 4.2 项目态（点「打开」后）

- 侧栏顶部新增**项目态头部**：
  - 左侧：返回箭头 / 面包屑（点击 → 回列表态，scope 与中间区不变）。
  - 项目名。
  - 一个 `对话 | 文件` 分段切换（复用 `sidebarMode`）。
- `对话` 子标签：显示该项目对话列表（`SidebarChatList scope=project`）。
- `文件` 子标签：`FileTreeView` **独占整个内容区高度**（不再上下两段）。沿用现有 `project-setup` 空状态、加载态。
- 项目态内**不再显示其他项目**（聚焦）；要换项目需先「返回」列表态。

### 4.3 底部

- 删除 `mode-toggle`（对话/文件 切换条）。
- 底部 `sidebar-footer` 保留为**账户预留容器**（本次可放占位元素或留空，不做功能）。

### 4.4 删除 hover 偷看

- 删除 `ProjectFilesPopover` 与 `SidebarChatHistoryPopover` 在侧栏的使用。
- 删除相关 state 与方法：`hoverPeek`、`openProjectPeek` / `scheduleProjectPeek` / `keepProjectPeekOpen` / `scheduleCloseProjectPeek` / `closeProjectPeek` / `createProjectPeek`、`openPeekTimer` / `closePeekTimer`、`handlePeekFileOpen` / `handlePeekFileCreate`、以及 `handleProjectPeekKeydown` / `handleProjectPeekPointerDown` 两个全局监听。
- `SidebarProjectGroup` 删除 `peek` / `hover-open` / `hover-close` 事件与 peek 按钮，新增「打开」按钮（emit `open`）。

---

## 5. 启动恢复

- **本次默认行为**：把 `sidebarNav` 一并持久化，启动时**恢复上次的导航形态**（与现有「恢复上次 scope/对话」一致）。
  - 上次在项目态 → 恢复项目态（需 `scope.kind==='project'`，否则回退列表态）。
  - 上次在列表态 → 恢复列表态。
- **未来（本次不做，仅记录）**：在「设置」里加一个启动恢复策略项，例如：
  - `restore-last`（恢复上次，默认）
  - `always-list`（每次都从列表态开始）

---

## 6. 可发现性（待定，二选一）

「打开」按钮只在 hover 出现，新用户可能不知道项目里还有「文件」层。两个方案：

- **(A) 常驻淡图标**：项目行右侧常驻一个很淡的进入箭头，hover 时高亮。始终可见，略增视觉噪音。
- **(B) 纯 hover 出现**：干净，但靠摸索。

> 已采用 (B)：项目行右侧「打开」按钮仅在 hover / focus 时出现，保持列表态干净。

---

## 7. 受影响文件与改造计划

### 7.1 状态层

1. `app/layout/definitions/layoutState.ts`
   - 新增类型 `SidebarNav = 'list' | 'project'`。
   - `LayoutState` 增加字段 `sidebarNav: SidebarNav`。
   - `sidebarMode` 注释更新为「仅项目态内有效」。

2. `app/layout/functions/layoutStateTransitions.ts`
   - `createInitialLayoutState()` 增加 `sidebarNav: 'list'` 默认值。
   - 新增（或在 store 内）`setSidebarNav` 对应的纯函数转换（保持现有风格，state transition 走纯函数）。

3. `app/layout/store/layoutStore.ts`
   - 新增 `setSidebarNav(nav)` action。
   - `persist.pick` 增加 `'state.sidebarNav'`。

4. `app/layout/sidebar/Sidebar.vue`
   - `WorkspaceSidebar` 透传新 prop `:sidebar-nav="layoutStore.state.sidebarNav"`。
   - 新增 `@set-sidebar-nav` 事件 → `layoutStore.setSidebarNav`。
   - 「打开项目」时确保同时：切 scope（已有 `navigation.openWorkspace({kind:'project'})`）+ 设 `sidebarNav='project'`。

### 7.2 VFS 运行时（重要，勿漏）

5. `app/layout/functions/workspaceVfsRuntimeContext.ts`
   - 现有判断 `if (input.sidebarMode !== 'files') return false;` 的语义是「文件树是否正在展示」。
   - 新语义下「文件树正在展示」= `sidebarNav==='project' && sidebarMode==='files'`。
   - 需把 `sidebarNav` 纳入入参，更新判断；同步改 `useWorkspaceVfsRuntimeContextSync.ts` 的调用与 `workspaceVfsRuntimeContext.test.ts`。

### 7.3 侧栏组件

6. `app/layout/sidebar/WorkspaceSidebarSurface.vue`
   - 新增 prop `sidebarNav`；模板主分支由 `sidebarMode === 'chat'` / else 改为 `sidebarNav === 'list'` / `'project'`。
   - **列表态**：助手对话 + 项目分组（`mode` 固定按「对话展开」语义）。
   - **项目态**：新增头部（返回 + 项目名 + `对话|文件` 分段）；`文件` 时 `FileTreeView` 占满；`对话` 时 `SidebarChatList scope=project`。
   - 删除底部 `mode-toggle`，`sidebar-footer` 改为账户预留容器。
   - 删除 §4.4 列出的全部 hover 偷看逻辑与两个 `Teleport` 浮层。
   - 新增 `handleOpenProject(projectId)`：调用既有 `activateProjectScope(projectId,{startDraft:true})` 后 `emit('set-sidebar-nav','project')`。
   - 新增 `handleBackToList()`：`emit('set-sidebar-nav','list')`（不动 scope / 中间区）。
   - `emits` 增加 `set-sidebar-nav`，移除 peek 相关。

7. `app/layout/sidebar/components/SidebarProjectGroup.vue`
   - 移除 peek 按钮与 `peek` / `hover-open` / `hover-close` 事件。
   - 新增「打开」按钮（hover 可见或常驻淡图标，见 §6），emit `open: [projectId]`。
   - `mode` prop 可简化：列表态恒为对话展开；如不再需要 `files` 分支可一并清理。

### 7.4 删除文件（确认无其他引用后）

8. 删除 `domains/workspace/ui/sidebar/components/ProjectFilesPopover.vue`
9. 删除 `domains/conversation/ui/SidebarChatHistoryPopover.vue`
   - 已确认历史上仅侧边栏组合面引用；删前再全局搜一次确保无残留。
10. 删除 `domains/workspace/ui/sidebar/functions/projectPeekPosition.ts` 及其测试 `projectPeekPosition.test.ts`
    - 仅服务于偷看浮层定位，偷看删除后即无用。

### 7.5 样式与文档

11. `domains/workspace/styles/components/sidebar/index.css`
    - 移除 `mode-toggle` 相关样式；新增项目态头部、分段切换、账户预留容器样式；调整文件区占满高度。
12. `domains/workspace/ui/sidebar/README.md`
    - 更新数据流（新增 `sidebarNav`）、形态说明、移除偷看浮层描述。

---

## 8. 分阶段实施建议

- **阶段一（状态模型）**：改 §7.1 + §7.2，先把 `sidebarNav` 引入并持久化、修好 VFS 判断与测试。此阶段 UI 可暂不变（沿用旧渲染），保证编译与现有行为不回归。
- **阶段二（列表态 / 项目态 渲染）**：改 §7.3 的 `WorkspaceSidebarSurface.vue` 渲染分支与 `SidebarProjectGroup.vue`，实现「打开 / 返回」。
- **阶段三（删除偷看 + 底部账户位 + 样式 + 文档）**：删 §7.4 文件、清理底部、补样式与 README。

每阶段用 `npm run dev:electron` 自测（不需要 build）。

---

## 9. 边界与风险

1. **scope 与形态错位护栏**：项目态必须有项目 scope，否则回退列表态（§3）。
2. **VFS 重载优化回归**：§7.2 若漏改，会出现「文件树展示中切换对话却不刷新 SharedMemory 节点」或「列表态下多余重载」。务必同步测试。
3. **持久化迁移**：`layout-state-v2` 新增 `sidebarNav` 字段；旧用户本地无此字段，`createInitialLayoutState` 默认 `'list'` 即可兜底，无需写迁移。
4. **删除浮层前再次全局搜索**：避免别处（含测试、样式）残留引用导致编译失败。
5. **可发现性**：见 §6，hover-only 方案需接受新用户学习成本。

---

## 10. 决策记录（已确认）

- 不做 App Home。
- hover 偷看浮层：删除。
- 列表态点对话：保持列表态。
- 「打开」= 进入该项目 scope，中间区同时切到该项目对话。
- 启动恢复：本次做「恢复上次形态」默认行为；设置项留待未来。
