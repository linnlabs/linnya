# @plugin/mindmap

这是 Linnya 第一个完整落地的官方 runtime 插件包。Mindmap 已具备独立 manifest、独立版本、独立 backend/renderer 构建产物、插件级 schema migration、预置 seed、磁盘加载、R2 artifact 分发和插件商店展示。

当前包承载 Mindmap 的完整 repo-internal 插件实现：共享契约在 `src/shared`，主进程能力在 `src/backend`，渲染端 surface、文件生命周期、工具卡和 MindMap domain 实现在 `src/renderer`。主应用只能通过公开入口注册这些能力，包内调用宿主能力必须走 `@plugin/*` 下的窄 port / SDK 门面。

官方插件体系的长期规则见仓库级手册：

- `docs/plugins/README.md`（权威指南入口）
- `docs/plugins/guides/`（按模块拆分的开发、运行时与发布章节）

## 公开入口

- `@plugin/mindmap/shared`：跨进程共享契约，必须保持 Node-free、Vue-free。
- `@plugin/mindmap/backend`：主进程 / 后端贡献入口，禁止 import 前端或 DOM 能力。
- `@plugin/mindmap/renderer`：渲染端贡献入口，禁止承载后端持久化实现。

## 边界约定

包外代码只能通过上面的公开入口消费 Mindmap 能力，不能 deep import `packages/plugins/mindmap/src/**`。包内代码如需调用宿主能力，应优先走 `@plugin/*` 下的窄 port，而不是反向 import 主应用内部实现。

`pnpm run guard:agent-boundary` 是全仓包边界的阻断守卫：它会扫描包内生产代码和 Vue SFC `<script>` import，禁止插件包反向依赖主应用内部实现，也禁止主应用 deep import 插件内部文件。

Renderer 基础 UI 直接依赖 `@linnya/renderer-ui`：`peerDependencies` 与
`plugin.json.compat.rendererUi` 使用同一 range，开发依赖使用 `workspace:*`。插件不装载 package CSS；renderer 构建把
公开入口改写为 `plugin://host/renderer-ui/*`，由 Host 提供唯一兼容 runtime。

## 版本化与数据生命周期

Mindmap 的版本、兼容声明、拥有的数据表和插件迁移声明写在 `plugin.json`。可执行的 schema migration、升级备份、卸载/重装语义由主应用侧插件生命周期执行器统一调度；包内只暴露窄小的 backend contribution。

Mindmap 专属的版本化与数据生命周期说明见 `docs/README.md`。Sheet / Slides 后续插件化时，应先看仓库级插件手册，再参考这里的 Mindmap 具体实现，不要复制 Mindmap 的表名或迁移编号。

## 独立构建、artifact 与运行时加载

- `pnpm run build:plugin:mindmap`：构建 renderer ESM 与 backend CJS 产物到 `packages/plugins/mindmap/dist/`。
- `pnpm run package:plugin:mindmap`：先构建，再生成 `dist/SHA512SUMS` 与 `dist/artifacts/mindmap-<version>.zip`。
- `pnpm run prepare:extra-resources`：把当前 artifact seed 源整理到根目录 `extraResources/plugins/mindmap`，供 Electron 打包预置。

renderer 构建会把 `vue`、`pinia`、`@plugin/renderer/*` 和 Renderer UI 公开入口改写为受控的
`plugin://host/*` URL；最终 artifact 不保留这些 bare specifier，也不复制 Host runtime。backend 产物会保留
`@plugin/backend/*`、`@app/schemas`、Electron/native 依赖。插件内部 shared 代码和 `uuid` 会打进产物，避免磁盘插件运行时依赖自己的 `node_modules`。

生产启动时，主应用会把预置 artifact 复制到 `<userData>/plugins/mindmap/<version>`，通过 `active.json` 选择版本；backend 经 `require(entry.backend)` 注册，renderer 经 `plugin://mindmap/dist/renderer/index.js` 动态加载。R2 升级只做官方包的 `latest.json` / zip / sha512 完整性校验，不做第三方签名、沙箱或权限执行。

## Sheet / Slides 复用结论

可以直接复用：

- 单包跨进程布局：`src/shared`、`src/backend`、`src/renderer` 三个构建面，加 `plugin.json` 和三条公开入口。
- 根工程接入方式：沿用 `file:` 依赖语义、Vite / tsconfig / vitest alias 直读源码，不引入 workspaces。
- 边界守卫打法：先用 baseline 冻结迁移债，再在收口批次清零并转阻断。
- 宿主能力接入方式：插件包只依赖 `@plugin/backend/*`、`@plugin/renderer/*` 这类窄门面；跨 domain 协作放在 app-level orchestration 注册 port。
- 文档类型后端 hook：通用 workspace 工具、VFS、系统视图只认按文档类型注册的 hook，不写死具体业务实现。

不能机械照搬，必须另开计划：

- Sheet 有独立表格引擎、公式/渲染/协同边界和可能的外部 engine/fork 依赖，包化前要先定清楚 engine 的构建与运行时边界。
- Slides 有 presentation codegen、PPTX/资源导出和演示文稿专属工具卡链路，不能只按 MindMap 的文档生命周期搬目录。
- Sheet / Slides 的数据表归属、迁移执行和存量数据交接要单独设计；Mindmap 已完成插件级迁移和存量表收养，但 Sheet / Slides 仍要各自定义 `ownedTables`、`v1` 基线收养和失败回滚测试。
