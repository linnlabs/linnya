# 13 · 构建边界与双进程 Bundle

> 适用场景：配置插件构建；理解 `main.cjs` / `app-server-backend.cjs` 与插件磁盘 artifact 的进程边界。

## 插件双端构建

官方 runtime 插件应有独立双端构建：

- renderer 输出 ESM，`vue`、`pinia`、`@plugin/renderer/*`、`@app/localization`
  等 host bare specifier 保持 external（统一经 `rendererHostExternalMap.mjs` 的
  `isHostRendererExternal` 改写为 `plugin://host/...`）。
- renderer build 必须使用共享的 `rendererStylesheetManifestPlugin`，从 contribution 的
  `stylesheets` tuple 生成 `dist/renderer/renderer-stylesheets.json`；构建遇到未声明 CSS、重复 source
  或无法映射的 asset 直接失败。Host 与 artifact verifier 都不得回退到目录扫描。
- backend 输出 CJS，`electron`、native 模块、`@app/schemas`、`@plugin/backend/*`
  保持 external。
- backend entry 必须导出 `backendPlugin` 或 `default`
  contribution；通用 loader 不接受具体插件旧命名。
- 插件内部 shared 代码和只属于插件的小依赖打进产物，避免磁盘插件依赖自己的
  `node_modules`；较大的专属依赖在插件 `package.json` 声明并明确打包策略（见
  [01 包结构](./01-package-structure.md)）。

开发环境可以通过 alias 直读源码；生产环境必须从磁盘 artifact 加载。Linnya Host Renderer 的编译期入口由
`rendererModuleResolutionCatalog.ts` 统一投影到 TypeScript/Vite/Renderer Vitest；插件自己的 artifact tsconfig 与
build resolver 仍独立维护，禁止继承 Host Renderer profile。需要共享 Host UI 时只登记
`@linnya/renderer-ui` 的公开 JS entry，CSS entry 不属于 plugin runtime external。插件产物中的公开入口必须被改写为
`plugin://host/renderer-ui/*`；因此 Host 在既有兼容 range 内升级 package 时，不需要重建插件 artifact。若 range
不满足，商店检查、远程安装和 renderer import 前 admission 都会拒绝，不能回退到 bundled UI。

## 重型 backend 的启动入口与按需 runtime

磁盘 loader 会同步 `require()` backend
entry 以取得 contribution，所以 entry 位于主进程启动关键路径。重型插件不能只看 zip 压缩体积，还必须约束 entry 的 raw
bytes 和构建依赖图：只在首次业务调用才需要的 compiler、parser 或转换 runtime，不应通过静态 import 在 contribution 注册时初始化。

允许把大型插件专属 runtime 作为插件自有资源放入
`dist/backend/node_modules/<package>`，但必须同时满足：

- 生产调用点只有 type import，首次真实用例才经窄 capability 加载并缓存；
- artifact 使用相对自身 backend 的精确路径，不能回退宿主、仓库根或全局安装；
- 只复制运行所需文件及许可证，派生资源必须由权威入口计算闭包，不能“整目录复制再用文件数门禁”；
- 构建同时验证 entry dependency graph、entry/完整 backend raw
  budget、初始 require 不加载重 runtime、首次调用能从隔离 artifact 成功加载；
- metafile 是构建观察数据，不进入 zip、checksum 或 `extraResources`。

注意：`@plugin/backend/*` 的宿主解析只在 backend
entry 初次同步加载期间生效。延迟 chunk 若仍含宿主 bare
specifier，初次加载结束后会解析失败；这类 chunk 必须先改为由 entry 注入窄 port，或者只承载完全插件自包含的 runtime。不能通过常驻
`Module._load` monkey patch 扩大解析窗口。

## 通用 artifact 边界：插件 backend 不进启动壳

- `main.cjs` 是 Desktop 启动壳，不静态 import 任何具体插件 backend，也不为未安装插件生成专属 absent adapter。
- `app-server-backend.cjs` 只包含 Core backend 与通用插件 loader；具体插件通过 active artifact、bundled artifact 或显式 backend direct dir 加载。
- 开发态也先构建插件 backend artifact，再把目录交给 `LINNYA_PLUGIN_BACKEND_DIRECT_DIRS`。不再保留把一组“官方插件源码”内联进 Host bundle 的第二种运行架构。
- 新增重型插件只维护插件自己的 build/package/smoke 与发行 target。若 Core 构建脚本、tsup alias 或 Main 入口需要出现插件 ID，说明边界已经倒退，应先修正通用 loader，而不是补专属分支。

## 架构不变式：双进程与状态 owner（必读）

`main.cjs` 与 `app-server-backend.cjs` 位于两个独立 OS 进程。任何模块单例、`globalThis`、数据库连接和
对象引用都不可能跨边界共享。两端只能通过 strict bootstrap、typed RPC、loopback HTTP/SSE 或私有 mailbox
协作。由此推出三条铁律：

1. **插件运行态/启用状态禁止存 Desktop 模块单例**。运行态以 App Server 的 SQLite 为唯一真相（`installed_plugins`
   / `enabled_plugins`，见 `pluginRuntimeState.ts`），并且只能由
   `ServiceInitializer` 在真实 App Server Backend 初始化服务后注入数据库连接；未注入必须 fail-fast，不能返回空 enabled 集或把 DB 错误伪装成 missing。
2. **`plugin:invoke` 必须注册在 App Server 的 Backend Renderer Request registry 上**。Main 只转发已由
   App Server 登记的 data-only channel，不能 import 插件 registry、推断 enabled 状态或创建第二份 allowlist。
3. **Desktop-only 能力必须是窄反向 RPC port**。保存框、隐藏窗口、Chromium PDF、safeStorage 和系统浏览器
   仍由 Main 拥有；插件不能看到 Electron 对象、真实路径或任意 method table，大二进制使用私有 mailbox。

> 该不变式已有 Backend boundary、Renderer request registry 与插件 fail-fast
> fail-fast 覆盖；任何新增插件相关全局状态仍必须先过这条。

## Backend SDK 运行时解析

`@plugin/backend/*` 仍保持 external，由磁盘 loader 在加载 backend
entry 的同步调用栈里做受控解析。解析只对当前插件目录内的父模块生效，并在本次加载结束后恢复 CommonJS
loader，避免进程级常驻 monkey patch。

插件侧无需也禁止模仿这套机制；需要新增 host 能力时，只补 SDK 窄门面并登记到 backend
host module resolver。若未来要做到完全无 `Module._load`
接管，需要把发布 artifact 升级为真实 `node_modules/@plugin/backend/*`
代理结构，这是发布结构变更，不是插件业务代码的职责。
