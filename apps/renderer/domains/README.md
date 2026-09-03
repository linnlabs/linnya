# linnya 前端 `domains/` 架构总览

> 这里描述 `apps/renderer`（Electron 渲染进程）的前端架构，重点解释 `domains/*` 的定位、边界与扩展方式。

---

## 核心心智模型（TL;DR）

- **`app/` = 壳（Shell）**：应用入口、全局布局、页面/场景装配。
  - 顶层场景分发在 `apps/renderer/app/App.vue`（按 `layoutStore.state.scene` 渲染 workspace / knowledge-base / project-setup）
  - 全局布局在 `apps/renderer/app/layout/*`
  - 页面/场景壳在 `apps/renderer/app/pages/*`
- **`domains/` = 领域能力（Capabilities）**：Editor / Workspace / Conversation / MindMap / KnowledgeBase / Settings / Sheets 等“能独立成立的业务模块”。
  - 领域模块应该尽量做到：**可以被不同 Page 复用**，而不是绑定某个具体页面布局
- **`shared/` = 跨域稳定基础设施（Infrastructure）**：通用 UI primitive、平台 IPC 封装和不含业务规则的基础能力。
  - 被多个 domain 使用不是上提 `shared/` 的充分条件。有明确 owner 的业务能力应保留在原 domain，其他 domain 通过 public contract、port 或 application use case 协作；禁止用 `shared/` 规避所有权设计。

> Page vs Domain 的更详细解释见：`apps/renderer/app/pages/README.md`

---

## 渲染进程入口（应用初始化）在哪里看？

入口在 `apps/renderer/app/main.js`，它做的事情大致可以按“基础设施优先”的顺序理解：

- **Vue/Pinia 初始化**：`createApp(App)` + `createPinia()` + pinia persist
- **全局样式/指令注册**：例如某些 editor feature 的指令注册
- **本地化地基注册**：[`app/localization`](../app/localization/README.md) 注册各模块 catalog，并通过窄 port 向 shared 基础控件提供默认文案解析能力
- **关键 store 预热**：
  - `shared/stores/ui`：纯 UI 偏好、弹窗等非导航状态
  - `shared/stores/workspaceScopeStore`：当前项目 / Linnya 助手 scope 与草稿对话状态
  - `domains/model-configuration/features/model-catalog`：模型目录 lifecycle 与预加载
  - `domains/knowledgebase/stores/knowledgeBase`：知识库列表预加载
  - `app/update/store/updateStore`：更新弹窗 IPC 监听（含 renderer-ready 握手）

如果你在排查“启动阶段才会发生”的问题，优先从这里顺藤摸瓜。

---

## 工程配置速记：Vite / tsconfig（常见疑问）

### 渲染进程用的是 Vite 还是 Webpack？

- **渲染进程使用 Vite（不是 webpack）**
  - 根脚本：`package.json` 里 `dev:frontend`/`build:frontend` 都是 `vite` / `vite build`
  - 配置文件：`vite.config.mjs`

`vite.config.mjs` 里还包含一些对开发定位很重要的工程事实：

- **路径别名**：Renderer 可见入口由 `scripts/build/renderer-module-resolution/definitions/rendererModuleResolutionCatalog.ts` 唯一登记；Vite/Vitest 从目录投影，TypeScript 消费生成的 `apps/renderer/tsconfig.paths.generated.json`
- **开发代理**：`/api` 代理到 `http://127.0.0.1:3000`（TS 后端 Express）
- **WASM/顶层 await**：启用 `vite-plugin-wasm`、`vite-plugin-top-level-await`
- **dev server headers**：配置了 COOP/COEP（用于 WASM / sharedArrayBuffer 等场景）

### tsconfig 会不会“只 include src”，导致前端不参与类型检查？

- **不会。**迁移期根 `tsconfig.json` 仍覆盖 aggregate graph；正式 Renderer 生产源码由 `pnpm typecheck:renderer` 使用独立 profile 检查
  - 根 `tsconfig.json` 的 `include` 同时包含：
    - `src/**/*.ts|tsx|vue`
    - `apps/renderer/**/*.ts|vue`（以及 `apps/renderer/global-frontend-modules.d.ts`）
- **渲染进程也有自己的 tsconfig**：`apps/renderer/tsconfig.json`
  - 它继承无 paths/include 的 `tsconfig.bundler-base.json` 与 generated Renderer paths，不再继承 Host 的混合 aliases
  - 生产 profile 排除 test/spec/bench；跨层 parity 测试继续由根 aggregate tsc 检查，并通过 `vitest.renderer.config.ts` 使用 Renderer runtime resolver 执行

维护规则：

- 新增 Renderer 可见 bare specifier 只修改 catalog，然后运行 `pnpm generate:renderer-module-resolution`；禁止手改 generated paths 或在 Vite 另加同义 alias。
- `@shared/*` 在 Renderer 永远只指向 `apps/renderer/shared/*`；跨进程稳定合同必须使用明确 public specifier，不能借用 Host `@shared`。
- `@plugin/renderer/*` 是唯一 Host renderer facade；backend contract、Electron、Host application 与失效旧别名不得进入生产 profile。
- `pnpm guard:renderer-module-resolution` 会检查目录目标、生成漂移、package entry 对账与生产导入边界，并已接入 pre-commit/CI。

补充：仓库里还有 `tsconfig.package.json`，它的 `include: ["src"]` 更偏向某些“打包/产物”链路使用，不代表整个仓库的 TS 只看 `src/`。

---

## `domains/*` 的通用目录约定（推荐）

不同 domain 复杂度不同，不要求完全一致，但建议尽量收敛到下面的结构，以便“看目录就能定位到该去哪里改”。

- **`ui/`**：该领域的可视组件（Vue SFC），以及少量与 UI 强绑定的 composables  
- **`store/`**：Pinia store（领域状态/意图），尽量不要把重副作用塞进 store（除非 store 就是“编排门面”）
- **`services/`**：副作用与对外通信（IPC/HTTP/文件系统/长任务/调度器等），对上层暴露清晰 API
- **`features/`**：按“特性”拆分的组合模块（通常跨 UI + service + extension + store 的一组能力）
- **`docs/`**：领域内文档/约束/协议（有复杂约束的 domain 强烈建议维护 docs）
- **`shared/`**（domain 内部）：仅供本 domain 复用的工具/类型/纯函数（不要被其他 domain 引用）
- **`index.ts` / `index.js`**：该 domain 的统一导出入口（减少深层路径依赖）

你可以在这些现有模块里看到不同程度的落地：

- `domains/editor/`：典型“强领域”结构（blocks/extensions/features/services/ui/core）
- `domains/mindmap/`：典型“多子系统”结构（domain/interaction/presentation/features/docs/shared）
- `domains/conversation/`：典型“事件驱动 + 投影”结构（services/messageProjection、orchestration、history、store、ui）
- `domains/workspace/`：典型“文件/项目管理”结构（store + file-manager service + sidebar/home UI）
- `domains/knowledgebase/`：典型“IPC/HTTP 混合通信边界”结构
- `domains/settings/`：设置壳、contribution registry、Settings Kit 与设置本地化
- `domains/model-configuration/`：模型目录、Provider connection projection、自定义模型注册与用途绑定

---

## 顶层场景与导航怎么工作？

当前架构没有引入 Vue Router，而是由 app/layout 提供一套**明确的场景与导航编排**：

- **场景状态源**：`apps/renderer/app/layout/store/layoutStore.ts` 中的 `scene`
- **业务 scope 权威**：`apps/renderer/shared/stores/workspaceScopeStore.ts`
- **顶层分发**：`apps/renderer/app/App.vue` 按 `scene` 异步渲染 `WorkspaceStage / KnowledgeBasePage / ProjectSetupPage / PluginStorePage`
- **唯一导航入口**：`apps/renderer/app/layout/orchestration/workspaceNavigation.ts`
- **跨 domain 调用入口**：`apps/renderer/shared/ports/workspaceNavigationPort.ts`
- **文档 surface ready 契约**：`apps/renderer/shared/ports/documentSurfaceRuntimePort.ts`
- **平台 Markdown 富文本实例契约**：`apps/renderer/shared/ports/markdownDocumentEditorRuntimePort.ts`

这套设计的目标是：顶层场景切换、workspace scope、文档 runtime 生命周期各自只有一个权威来源。domain 内部如果需要“打开文档 / 进入知识库 / 切换工作台”，只能通过 `workspaceNavigationPort` 表达意图，不能直接 import app/layout 或操作 layout store。

核心边界：

- `layoutStore` 只保存 scene、pane placement、宽度、activeDocument 等布局/几何状态；
- `workspaceScopeStore` 只保存当前项目或 Linnya 助手 scope、草稿对话、最近活跃会话；
- `uiStore` 不再保存导航状态；
- `workspaceNavigation` 负责保存旧文档、停用 file-manager session、等待 DocumentSurface ready、激活新文档 runtime；
- 通用 DocumentSurface ready 不认识 Tiptap；Markdown file handler 通过独立 Markdown editor port 等待具体实例；
- 折叠 pane 只改变 `visible/occupied`，不销毁文档 runtime。

---

## 新增一个顶层场景怎么做？

这里的“顶层场景”指：新增一个和 `workspace / knowledge-base / project-setup` 同级的 app shell 场景。普通 workspace 内能力优先作为 pane、modal、popover 或 domain feature 接入，不要轻易新增顶层场景。

### 1) 新建 Page（场景壳）

在 `apps/renderer/app/pages/<NewPage>/<NewPage>.vue` 创建页面组件：

- **Page 只做装配**：组合/摆放若干 domain 的 UI，不要在 Page 内实现领域业务逻辑
- 参考：`apps/renderer/app/pages/README.md`

### 2) 扩展 app/layout scene 与导航命令

不要这么做。`uiStore` 已经退出导航主路径，不能再新增旧的顶层视图字段或 `show*`。

新增场景需要先在 app/layout 的定义层扩展 scene 契约，再由 `workspaceNavigation` 增加一个窄命令。这个命令必须说明进入场景前如何处理当前文档 runtime：保存、deactivate、保留还是拒绝切换。

### 3) 在 `App.vue` 注册该 Page

在 `apps/renderer/app/App.vue`：

- `import` 新 Page
- 在 `<template>` 里按 `layoutStore.state.scene.kind` 增加分支

### 4) 如需布局差异，在 `AppLayout.vue` 加条件

在 `apps/renderer/app/layout/AppLayout.vue` 按需处理：

- 需要全屏/特殊留白：在 `editor-shell` 上加一个 host 自有场景 class（参考 `for-workspace-stage` / `for-knowledge-base`）；插件文档的外壳样式必须放在插件自己的 `stylesheets` contribution 中
- 只在某些场景出现的全局 UI：通过 scene selector 或 app/layout composable 判断，不读取 domain 内部状态

### 5) 找到“入口按钮/触发点”，调用你的 action

触发点可能在：

- Header：`apps/renderer/app/layout/AppHeader/*`
- Workspace 侧边栏/列表：`apps/renderer/domains/workspace/ui/*`
- 对话居中工作台：`apps/renderer/app/pages/ChatCentricPage/`
- 领域内部某个 CTA：调用 `getWorkspaceNavigationPort()` 暴露的窄命令

如果切换涉及项目作用域，必须通过 `workspaceScopeStore` 的公开 action 或 `workspaceNavigation` 编排更新。禁止新增 project scope store 或让 domain 直接写 layout state。

---

## 新增一个 domain（新增一个领域能力）怎么做？

### 1) 先定义“边界”

写清楚三件事（越短越好）：

- **它的输入是什么**：来自用户 UI？来自 IPC/HTTP？来自另一个 domain 的事件？
- **它的输出是什么**：提供什么组件/服务/状态？对外暴露哪些 API？
- **它拥有哪些状态所有权**：哪些状态只能由它修改（避免“多处写同一份状态”）

### 2) 建目录 + 统一出口

建议最小结构：

```text
apps/renderer/domains/<domain>/
├─ index.ts            # 统一导出（新文件建议用 ts）
├─ ui/                 # 领域 UI
├─ services/           # 副作用/网关/调度
└─ store/              # Pinia store（可选，但常见）
```

然后在 `index.ts` 做一个“公共 API 面”导出（避免别人深层 import 你的内部文件）。

### 3) 决定它如何被“挂载使用”

常见两种方式：

- **作为某个 Page 的主体视图**：在 `app/pages/*` 组合并渲染该 domain 的 UI
- **作为全局能力/面板**：例如挂在 `AppLayout`（右侧面板、全局模态框、全局工具条等）

### 4) 避免 domain 间耦合失控

- 如果 A domain 需要依赖 B domain 的内部类型/实现，通常是架构信号：
  - **优先**把“公共契约/类型/纯函数”上提到 `apps/renderer/shared/`（或更上层 packages，如果存在）
  - 或者通过 service 层做“边界 API”，不要直接 import 对方的内部模块

---

## 现有 domains 导航（从总览跳到细节）

- **Editor**：`apps/renderer/domains/editor/README.md`
  - 相关全局文档：`apps/renderer/docs/STREAMING_PARSER_GUIDE.md`、`apps/renderer/docs/PLUGIN_INTERACTION_GUIDE.md`、`apps/renderer/docs/KEYBOARD_HANDLING_GUIDE.md`
- **Workspace**：`apps/renderer/domains/workspace/README.md`
  - 文件管理与会话打开：`apps/renderer/domains/workspace/services/file-manager/README.md`
- **Conversation（AI 助手）**：`apps/renderer/domains/conversation/docs/README.md`
- **MindMap**：已迁入插件包，见 `packages/plugins/mindmap/src/renderer/docs/README.md`
- **KnowledgeBase**：`apps/renderer/domains/knowledgebase/README.md`
- **Settings**：`apps/renderer/domains/settings/`（设置壳、contribution registry、Settings Kit 与本地化集成）
- **Model Configuration**：`apps/renderer/domains/model-configuration/`（Provider 连接、自定义模型注册、目录 projection 与用途绑定；不拥有推理运行时）

---

## 一个“快速定位”技巧（建议记住）

当你不知道“应该把代码放哪”时，优先按下面顺序判断：

1. **这是某个领域能力本身吗？** → 放 `domains/<domain>/...`
2. **这是一个顶层页面/场景装配吗？** → 放 `app/pages/...`
3. **这是跨领域的基础设施/通用能力吗？** → 放 `shared/...`
4. **这是全局布局/全局 UI（头部/侧边栏/全局模态框）吗？** → 放 `app/layout/...`
