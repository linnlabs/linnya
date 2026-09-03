# 插件系统架构参考

本文档是 Linnya 插件系统的**架构参考**，描述系统的结构、模块、数据流、状态管理、加载时序和边界约束。如需了解如何开发插件，请查阅 [guides/](./guides/) 目录下的开发指南。

---

## 1. 进程架构

插件系统横跨 Electron 的 Main Process 和 Renderer Process，两侧各有独立的注册表、加载器和状态管理，通过 IPC 通道连接。

```mermaid
graph TB
    subgraph Main Process
        PR[plugin-registry<br/>插件注册表]
        PL[plugins/loader<br/>磁盘发现与加载]
        IPC[plugins-ipc<br/>IPC 处理层]
        FP[features/plugins<br/>安装/卸载/升级编排]
        PS[plugins/store<br/>商店详情构建]
        DB[(SQLite)]
    end

    subgraph Renderer Process
        RR[registry.ts<br/>renderer 注册表]
        DTR[documentTypeRegistry.ts<br/>文档类型注册表]
        COM[composables.ts<br/>响应式查询层]
        EPS[enabledPluginsStore<br/>Pinia Store]
        RDL[runtimeRendererPluginLoader<br/>运行时加载器]
        BLT[builtin/<br/>内置 platform 插件]
    end

    PL --> PR
    IPC --> PR
    IPC --> FP
    FP --> DB
    IPC --> PS
    PR --> DB

    RDL -->|IPC: plugins:renderer-entries| IPC
    EPS -->|IPC: plugins:list| IPC
    COM --> RR
    COM --> EPS
    RDL --> RR
    BLT --> RR
    RR --> DTR
```

### Main Process 侧

| 模块 | 路径 | 职责 |
| --- | --- | --- |
| 插件注册表 | `src/app-hosts/linnya/plugin-registry/` | builtin 插件登记、backend contribution 管理（工具类、IPC 注册、schema provider、sandbox profile、runtime effect 等）、运行态状态管理 |
| 插件加载器 | `src/electron-main/plugins/loader/` | 磁盘插件发现与加载 |
| IPC 处理层 | `src/electron-main/ipc/handlers/plugins/` | 暴露 `plugins:list`、`plugins:renderer-entries`、`plugins:set-enabled`、`plugins:installFromRemote`、`plugins:uninstall` 等通道 |
| 安装/卸载编排 | `src/features/plugins/` | 插件安装/卸载/升级的多步骤编排、SQLite 持久化服务（`PluginStateService`、`PluginActiveVersionService`）、数据迁移 |
| 商店详情 | `src/electron-main/plugins/store/` | 从磁盘 `plugin.json` + `package.json` 构建商店展示用的详情数据 |

官方插件包位于 `packages/plugins/*`，也是 pnpm workspace 成员；workspace 只负责依赖安装、typecheck 和本地开发协作。公开插件 backend 可在开发 bundle 中 inline；不进入公共 Core 模块图的插件由自身 package metadata 选择 `disk` 开发装配，先独立构建，再经 backend 专用 direct-dir 合同加载。Renderer 开发态仍可通过 Vite 读取插件源码。生产态统一使用插件 artifact；electron-builder 明确排除 `node_modules/@plugin/**`，避免 workspace 软链被打进 asar。

#### 加载器子模块

| 文件 | 职责 |
| --- | --- |
| `pluginLayout.ts` | 从 `LINNYA_PLUGIN_ROOT`、通用 artifact direct dirs、backend 专用 direct dirs 和开发态 monorepo 插件目录发现插件；读取 `active.json` 解析版本指针；读取 `plugin.json` 解析 manifest 摘要 |
| `pluginProtocol.ts` | 注册 `plugin://` 自定义协议；拦截 `plugin://host/*` 请求返回宿主依赖 shim（Vue、Pinia、SDK 门面模块）；拦截 `plugin://{pluginId}/*` 请求映射到插件磁盘文件 |
| `rendererPluginEntries.ts` | 为 renderer 构建插件入口列表；区分 direct / official-source / active 三种来源；开发态优先返回 Vite `/@fs/` 源码路径 |
| `diskPluginLoader.ts` | 从磁盘加载 backend contribution（`require` 插件 backend 入口）；校验 manifest 与 contribution 一致性；加载失败时尝试回滚 `active.json` |

### Renderer Process 侧

| 模块 | 路径 | 职责 |
| --- | --- | --- |
| renderer 注册表 | `apps/renderer/app/plugins/registry.ts` | 管理已注册的 renderer contribution（pluginMeta、documentType、toolCard、documentActionMenu、documentRuntimeLoader、conversationWorkflow）；模块级 `Map`，非响应式 |
| 文档类型注册表 | `apps/renderer/app/plugins/documentTypeRegistry.ts` | documentType 的多键索引（按 activeDocumentType、nodeType、createRequestType、fileSessionType 查找）；普通 `Map`，非响应式 |
| 响应式查询层 | `apps/renderer/app/plugins/composables.ts` | 桥接非响应式 registry 与 Vue 响应式系统的 composable 集合 |
| Pinia Store | `apps/renderer/app/plugins/enabledPluginsStore.ts` | 管理插件启用态的响应式状态；从 IPC 读取 SQLite 状态；提供安装/卸载/启停的 action |
| 运行时加载器 | `apps/renderer/app/plugins/loader/runtimeRendererPluginLoader.ts` | 动态 import 插件 renderer 入口 → 校验 contribution → 注册到 registry → 注入 CSS → 激活 |
| 内置插件 | `apps/renderer/app/plugins/builtin/` | 同步注册 platform 插件（文档/表格的 documentType、工具卡、对话工作流）；安装宿主模块到 `globalThis` |

---

## 2. 插件生命周期状态机

插件有三种状态，以 SQLite 为唯一真源：

```mermaid
stateDiagram-v2
    [*] --> missing: 应用首次启动 / 已知但未安装
    missing --> enabled: 安装（远程下载 + activate）
    enabled --> disabled: 用户禁用
    disabled --> enabled: 用户启用
    enabled --> missing: 卸载（磁盘删除 + DB 清理）
    disabled --> missing: 卸载
```

| 状态 | 含义 | SQLite 表现 |
| --- | --- | --- |
| `enabled` | 已安装且启用，backend/renderer contribution 参与运行 | `installed_plugins` 有记录 + `enabled_plugins` 有记录 |
| `disabled` | 已安装但被用户停用，contribution 不参与能力筛选 | `installed_plugins` 有记录，`enabled_plugins` 无记录 |
| `missing` | 官方 registry/catalog 已知，但当前未安装 | `installed_plugins` 无记录 |

真源表结构：

- `installed_plugins` — 已安装插件的版本和元信息
- `enabled_plugins` — 已启用插件 ID 集合
- `plugin_active_versions` — 当前磁盘活跃 artifact 的版本指针
- `plugin_migrations` — 数据库迁移执行记录

---

## 3. 启动时序

### Main Process

```mermaid
sequenceDiagram
    participant App as Electron App
    participant Env as 环境准备
    participant Protocol as 协议注册
    participant DB as DatabaseService
    participant Bootstrap as PluginLifecycleBootstrap
    participant IPC as plugins-ipc
    participant Window as BrowserWindow

    App->>Protocol: registerPluginProtocolSchemeAsPrivileged<br/>（app.ready 前注册特权 scheme）
    App->>Env: 开发数据 epoch 预检<br/>（业务初始化前）
    App->>Env: prepareBuiltinPluginRuntimeEnvironment<br/>（设置 PLUGIN_ROOT、seed 预置插件）
    App->>Protocol: registerPluginProtocolHandler<br/>（注册 plugin:// 请求处理）
    App->>DB: DatabaseService 初始化
    DB->>Bootstrap: bootstrapBuiltinPluginLifecycle<br/>（登记已装配 contribution meta、reconcile active versions）
    App->>IPC: registerPluginsHandlers(serviceManager)<br/>（在 App Server 注册所有插件业务通道）
    IPC->>IPC: syncPluginRuntimeState<br/>（同步 sandbox/worker/adapter 运行态资源）
    App->>Window: createWindow
```

### Renderer Process

```mermaid
sequenceDiagram
    participant Script as script setup（同步）
    participant Builtin as builtin/index.ts
    participant Registry as registry.ts
    participant Store as enabledPluginsStore
    participant Mounted as onMounted（异步）
    participant Loader as runtimeRendererPluginLoader
    participant IPC as Main Process IPC

    Script->>Builtin: ensureBuiltinRendererPluginsRegistered()
    Builtin->>Registry: registerRendererPlugin(platform)
    Script->>Store: seedFromRegisteredRendererPlugins()<br/>（用已注册的 platform meta 填充初始状态）

    Mounted->>Store: initialize()
    Store->>IPC: plugins:list
    IPC-->>Store: PluginStateView[]

    Mounted->>Loader: loadRuntimeRendererPlugins()
    Loader->>Loader: installHostModules()<br/>（注入 Vue/Pinia/SDK 到 globalThis）
    Loader->>IPC: plugins:renderer-entries
    IPC-->>Loader: RendererPluginEntry[]
    loop 每个 entry
        Loader->>Loader: import(entryUrl)
        Loader->>Registry: registerRendererPlugin(contribution)
        Loader->>Loader: ensureCssLink()
        Loader->>Registry: activateRendererPlugin(pluginId)
    end

    Mounted->>Mounted: syncFileManagerHandlers(enabledPluginIds)

    Script->>Store: subscribeToBackendChanges()<br/>（监听 plugins-changed 事件，触发重新加载）
```

**关键时序约束**：

1. `ensureBuiltinRendererPluginsRegistered` 在 `<script setup>` 同步执行，确保 platform 的 documentType 在首帧可用
2. `seedFromRegisteredRendererPlugins` 紧随其后，用已注册的 meta 填充 Pinia store 初始值，避免 UI 闪烁
3. `initialize()` 在 `onMounted` 异步执行，从 Main Process 读取真实的 SQLite 状态覆盖 seed
4. `loadRuntimeRendererPlugins()` 必须在 `initialize()` 之后，确保 `plugins:renderer-entries` 使用最新的 enabled 集合

---

## 4. 数据流与状态管理

系统有三层数据源，职责分明：

```mermaid
graph TB
    subgraph "Main Process"
        SQLite["SQLite<br/>installed_plugins<br/>enabled_plugins<br/>plugin_active_versions<br/>plugin_migrations"]
    end

    subgraph "Renderer Process"
        Pinia["enabledPluginsStore (Pinia)<br/>states: PluginStateView[]<br/>enabledPluginIds: Set&lt;PluginId&gt;"]
        RegistryMap["renderer registry (Map)<br/>pluginMetas<br/>documentTypes<br/>toolCards<br/>conversationWorkflows"]
        Revision["rendererPluginRegistryRevision (ref)"]
        Composables["composables (ComputedRef)<br/>useDocumentTypeAvailabilityByNodeType<br/>useToolCards<br/>useConversationWorkflows<br/>..."]
        VueComponents["Vue 组件"]
    end

    SQLite -->|"IPC: plugins:list"| Pinia
    SQLite -->|"IPC: plugins:renderer-entries"| RegistryMap
    RegistryMap -->|"每次写入 bump"| Revision
    Composables -->|"订阅"| Revision
    Composables -->|"订阅"| Pinia
    Composables -->|"调用纯函数查询"| RegistryMap
    VueComponents -->|"必须通过"| Composables
```

### 三层数据源

| 层级 | 位置 | 数据类型 | 响应式 | 说明 |
| --- | --- | --- | --- | --- |
| SQLite | Main Process | `installed_plugins`、`enabled_plugins`、`plugin_active_versions`、`plugin_migrations` | — | 持久化真源，跨重启保持 |
| enabledPluginsStore | Renderer Pinia | `PluginStateView[]`、`enabledPluginIds: Set` | Vue reactive | SQLite 状态的响应式镜像，通过 IPC 定期同步 |
| renderer registry | Renderer 模块级 Map | documentType、toolCard、documentActionMenu 等 | 非响应式 | 已加载的 renderer contribution 实例 |

### composable 桥接机制

registry 内部使用普通 `Map`，Vue 的响应式追踪无法感知 `Map` 的读写。桥接方案：

1. registry 每次写入（注册/注销/激活/停用）时调用 `bumpRendererPluginRegistryRevision()`，递增一个 `ref(0)` 计数器
2. composable 内部同时订阅 `rendererPluginRegistryRevision` 和 `enabledPluginsStore` 的响应式状态
3. 返回 `ComputedRef`，当 revision 或 store 变化时自动重算

**不变式**：Vue 组件中消费 registry 数据**必须使用 composable**（如 `useDocumentTypeAvailabilityByNodeType`），禁止直接调用 registry 纯函数。纯函数保留给测试和命令式事件处理等非响应式场景。

---

## 5. 开发与生产环境差异

| 维度 | 开发环境 | 生产环境 |
| --- | --- | --- |
| Backend 加载 | 混合装配 — 公共开发 owner 可 inline；外置/私有 owner 从独立构建的 direct-dir backend entry 加载 | disk — 从 `active.json` 指向的版本目录 `require` 独立构建产物 |
| Renderer 加载 | Vite `/@fs/` 直读插件源码（`package.json` `exports["./renderer"]`） | `plugin://` 协议读取 `dist/renderer/` 构建产物 |
| Renderer 入口来源 | `official-source` — 从仓库 `packages/plugins/*/` 发现 | `active` — 从 `LINNYA_PLUGIN_ROOT/{pluginId}/{version}/` 发现 |
| 入口优先级 | direct > official-source > active | direct > active |
| CSS 注入 | 无（Vite HMR 处理） | `plugin://{pluginId}/dist/renderer/assets/*.css` 动态 `<link>` |
| 安装/卸载 | 操作 SQLite，不影响源码目录 | 真正的磁盘文件下载/删除 + SQLite 更新 |
| 宿主依赖 | Vite 模块解析，共享同一份 Vue/Pinia | `plugin://host/*` shim — globalThis 注入的宿主模块代理 |

环境判断逻辑在 `shouldPreferSourceRendererPluginEntriesForEnvironment()` 中：

- `LINNYA_PLUGIN_RENDERER_BUNDLE=inline` → 强制源码态
- `LINNYA_PLUGIN_RENDERER_BUNDLE=disk` → 强制磁盘态
- 未设置时：`!app.isPackaged` 或 `NODE_ENV=development` 或 `LINNYA_DEV_MODE=true` → 源码态

---

## 6. 关键约束与边界

### 隔离边界

- **host 不 import 具体插件**：通用宿主代码（registry、IPC、编排）不直接引用 `packages/plugins/*` 的内部模块。插件能力通过 contribution 注册表接入。
- **插件不 deep import host 内部**：插件只能通过 `@plugin/*` 门面（SDK 模块）访问宿主能力。renderer 侧通过 `plugin://host/*` shim 获取 Vue、Pinia 和 SDK 模块。
- **contribution 只声明能力，enabled 过滤由平台统一处理**：插件 contribution 注册时不关心自身是否 enabled，所有能力查询函数都接受 `enabledPluginIds` 参数进行过滤。
- **workspace 软链不是运行入口**：`node_modules/@plugin/*` 只服务 workspace 安装拓扑；宿主别名必须优先指向 `packages/plugins/<id>/src/*`，打包时也必须排除该软链。

### 状态约束

- **SQLite 是唯一真源**：插件启停状态以 `installed_plugins` + `enabled_plugins` 为准。禁止用模块级单例或内存缓存作为启停判断依据。
- **active artifact 指针双源 reconcile**：SQLite `plugin_active_versions` 与磁盘 `active.json` 保持一致，启动时由 `reconcilePluginActiveVersions` 校对。

### 响应式约束

- **Vue 组件必须通过 composable 消费 registry**：registry 是非响应式 `Map`，直接在 `computed` 中调用纯函数不会触发更新。composable 通过订阅 `rendererPluginRegistryRevision` ref 桥接响应式。

### 加载约束

- **builtin 插件同步注册**：platform 插件在 `<script setup>` 同步注册，确保首帧文档类型可用。
- **runtime 插件异步加载**：第三方/官方扩展插件在 `onMounted` 异步加载，依赖 IPC 获取入口列表。
- **宿主模块必须先安装**：`loadRuntimeRendererPlugins` 执行前必须调用 `installHostModules()`，将 Vue/Pinia/SDK 注入 `globalThis.__LINNYA_RENDERER_PLUGIN_HOST_MODULES__`。

### 生命周期约束

- **卸载不删数据表**：卸载只清理磁盘文件和 SQLite 安装记录，保留用户数据。
- **禁用仍迁移**：disabled 状态的插件仍执行数据库 schema 迁移，保证数据版本与 artifact 一致。
- **操作串行化**：同一插件的安装/卸载/启停操作通过 `pluginLifecycleSerialExecutor` 串行执行，防止竞态。
- **版本目录不可变**：同一 `pluginId@version` 的预置或远程 artifact 与既有版本目录必须拥有相同 `SHA512SUMS`；内容冲突直接终止 seed 或安装，不能覆盖目录、沿用旧内容或仅记录 warning。

---

## 7. 模块依赖图

```mermaid
graph LR
    subgraph "Main Process"
        BUNDLED["bundled artifact manifests<br/>(composition-owned trust)"]
        IPCONTRIB["platform/disk contributions"]
        BPR["BackendPluginRegistry"]
        PSS["PluginStateService<br/>(SQLite)"]
        PL["pluginLayout"]
        PP["pluginProtocol"]
        RPE["rendererPluginEntries"]
        DPL["diskPluginLoader"]
        PIPC["plugins-ipc"]
        FPI["features/plugins/install<br/>编排层"]
        PSD["pluginStoreDetail"]

        IPCONTRIB --> BPR
        BUNDLED --> DPL
        BPR --> PSS
        BPR --> PIPC
        PL --> PP
        PL --> RPE
        PL --> DPL
        DPL --> BPR
        PIPC --> PSS
        PIPC --> RPE
        PIPC --> FPI
        PIPC --> PSD
        PIPC --> BPR
        FPI --> PSS
    end

    subgraph "Renderer Process"
        BLT["builtin/platform"]
        RR["registry"]
        DTR["documentTypeRegistry"]
        EPS["enabledPluginsStore"]
        CMP["composables"]
        RDL["runtimeRendererPluginLoader"]

        BLT --> RR
        RR --> DTR
        CMP --> RR
        CMP --> EPS
        RDL --> RR
    end

    subgraph "插件包"
        PKG["packages/plugins/*"]
        SDK["plugin-sdk<br/>@plugin/* 门面"]

        PKG --> SDK
    end

    PIPC -.->|"IPC 通道"| EPS
    PIPC -.->|"IPC 通道"| RDL
    PP -.->|"plugin:// 协议"| PKG
    SDK -.->|"plugin://host/* shim"| PP
```

**核心依赖方向**：

- Main 侧：`plugins-ipc` 是中枢，向上调用 `BackendPluginRegistry` 查询能力，向下调用 `features/plugins` 执行持久化操作
- Renderer 侧：`composables` 是 Vue 组件的唯一访问入口，同时依赖 `registry`（能力数据）和 `enabledPluginsStore`（启用态）
- 跨进程：通过 IPC 通道（`plugins:list`、`plugins:renderer-entries`、`plugins:set-enabled` 等）和 `plugins-changed` 事件连接
- 插件包：通过 `plugin-sdk` 的 `@plugin/*` 门面访问宿主能力，renderer 侧通过 `plugin://host/*` shim 获取运行时依赖
