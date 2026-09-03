# Mindmap 插件版本化与数据生命周期

本文只记录 Mindmap 的插件实现细节。官方插件体系的通用规则以仓库级手册为准：

- `docs/plugins/README.md`（权威指南入口）
- `docs/plugins/guides/`（按模块拆分的开发、运行时与发布章节）

Mindmap 已从主 bundle 中外置为官方 runtime artifact。生产路径从磁盘安装目录加载 backend/renderer，首次启动由 `extraResources` 预置包 seed，升级走 R2 manifest + zip + sha512，失败可回滚到上一 active 版本。

## Manifest 契约

`packages/plugins/mindmap/plugin.json` 是当前内置插件的声明入口：

- `version`：Mindmap 插件自己的版本，不等于主应用版本。
- `description` / `developer`：插件商店和管理页展示所需的必填信息。图标由 renderer contribution 的 Vue 组件提供，不写入 manifest。
- `details` / `releaseNotes` / `skills` /
  `agents`：插件商店详情页的结构化展示信息。`details` 是面向用户的必填详细介绍，不渲染 Markdown，也不承载运行时 prompt。
- `compat.minApp`：该插件要求的最低主应用版本，由 app-host lifecycle 校验。
- `ownedTables`：插件拥有并需要数据快照保护的表，目前是 `mindmap_versions` 与
  `mindmap_evidence`。
- `ownedFileTypes`：插件拥有的文件/节点类型归属声明，目前是 `nodeType=mindmap`
  与 `.mindmap`。这只用于宿主在插件缺失时识别“该格式归谁”，不代表插件运行时能力已启用。
- `migrations`：对外声明的插件迁移序号与说明；真正可执行的迁移实现从 backend
  contribution 暴露。
- `entry.backend` / `entry.renderer`：运行时入口，当前指向
  `./dist/backend/index.cjs` 与 `./dist/renderer/index.js`。

`pnpm run package:plugin:mindmap` 会生成本地 artifact：

- `packages/plugins/mindmap/dist/backend/`：后端 CJS 产物，宿主 backend
  SDK、Electron、`@app/schemas` 保持 external。
- `packages/plugins/mindmap/dist/renderer/`：前端 ESM 产物，`vue`、`pinia`、`@plugin/renderer/*`
  保持裸 specifier，后续由 `plugin://` loader 的 import map 解析到宿主单例。
- manifest 声明的截图资源会作为插件静态展示资源进入 artifact，供插件管理页和未来 catalog 使用。Mindmap 当前没有预览图；图标不作为静态资源发布。
- `packages/plugins/mindmap/dist/SHA512SUMS` 与
  `packages/plugins/mindmap/dist/artifacts/mindmap-<version>.zip`：本地完整性校验材料。当前只做 sha512 完整性，不做签名验签；防伪造留给后续安全阶段。

包内 `src/shared/pluginMeta.ts` 从 `plugin.json` 派生 `PluginMeta`，backend contribution
把同一对象注册进 Host registry；Host 不再维护静态 meta 副本。一致性测试继续校验
`plugin.json`、package version、owned tables、迁移和文档类型常量。`details/releaseNotes/skills/agents`
属于 manifest 展示资源，不放进 `PluginMeta`。

`README.md` 是插件代码维护者看的开发文档，不参与插件商店展示。用户可见的短介绍来自
`description`，详细介绍来自 `details`，两者都必须直接写在 `plugin.json` 里。

## 插件管理页展示字段

插件管理页直接读取 manifest 展示官方插件信息。后续 Sheet /
Slides 拆成官方 runtime 插件时，应按同一字段约定补齐 manifest：

- `name`、`description`、`developer`、`version`、`compat.minApp`
  是详情页的基础信息，必须稳定、面向用户，不要写内部实现说明。
- 图标必须由 renderer contribution 暴露 Vue 组件。插件商店和文件树从 renderer registry 读取该组件；未安装或未注册时宿主只显示通用占位或不可用文档图标。
- `details`
  必填，用来放面向用户的详细介绍。它是字符串数组，由宿主按详情页样式渲染，不支持 Markdown。
- `releaseNotes` 可选，用来展示版本更新。每条包含 `version`，以及可选
  `title` / `description`。
- `skills` 可选，只能声明插件真正提供给用户使用的 Skill。Mindmap 当前没有独立 Skill，因此不声明该字段。
- `agents`
  可选，用来声明这个插件带来的用户可感知 agent 能力。它是展示信息，不是系统提示词注入，也不授权插件改默认 agent
  prompt。

这些字段的目标是让用户在“插件”页能判断插件是什么、谁维护、当前版本和它带来哪些能力。插件自己的业务 prompt、agent 定义和 tool
schema 仍由 backend contribution 注册，不能通过商店展示字段偷偷改变运行时行为。

## 运行时加载与分发

生产路径不再把 Mindmap 业务实现打进主应用 bundle：

- `scripts/build/prepare-extra-resources.cjs` 会把 `packages/plugins/mindmap/dist/`
  整理到 `extraResources/plugins/mindmap`，Electron 打包时随应用预置。
- 首次启动时，`prepareBuiltinPluginRuntimeEnvironment()` 将预置 artifact seed 到
  `<userData>/plugins/mindmap/<version>`，并写入
  `<userData>/plugins/mindmap/active.json`。
- 后端 loader 从 active 版本读取 `plugin.json`，通过 `require(entry.backend)`
  加载 CJS backend contribution；加载失败会把 `active.json` 回滚到
  `previousVersion` 并重试旧版本。
- 前端 loader 通过 `plugin://mindmap/dist/renderer/index.js` 暴露 renderer
  ESM 入口和 CSS；`vue`、`pinia`、`@plugin/renderer/*`
  仍解析到宿主单例，避免插件自带第二份运行时。
- R2 升级路径读取
  `latest.json`，下载 zip，校验 sha512，解压到目标版本目录；校验失败、兼容失败或解压越界都会中止，且不修改
  `active.json`。
- 激活升级时通过 `activatePluginVersionWithMigrations` 接主应用插件升级执行器：
  `PluginUpgradeRunner`：迁移成功后新版本生效；迁移失败时 SQLite 事务回滚数据和版本账本，再把
  `active.json` 指回旧版本。

当前只信任 Linnya 官方包，做 sha512 完整性校验，不做签名验签、沙箱、权限执行和第三方插件加载。这些属于未来第三方安全模型。

## Schema 迁移

Mindmap 的存量表通过插件迁移 `v1` 做基线收养：

- 老用户已经由核心历史迁移创建过 `mindmap_versions` / `mindmap_evidence`，`v1`
  使用 `CREATE TABLE IF NOT EXISTS`，只记录收养版本，不搬运数据。
- 新用户没有这些表时，`v1` 负责创建表并写入 `plugin_migrations(mindmap, 1)`。
- 核心历史迁移 v4/v5/v16/v17 保留冻结 SQL 快照，职责是让旧库重放历史可复现；它们不再 import 插件包 DDL，也不再是 Mindmap
  schema 的真源。

`PluginMigrationRunner` 根据 `plugin_migrations` 与
`installed_plugins.schema_version`
计算待执行迁移。所有 pending 迁移必须在同一个事务内完成，并同时更新 ledger 与 schema_version；任一迁移失败时，DDL、数据、ledger 和 schema_version 都回滚。

## 升级、备份与回滚

Mindmap 的升级由主应用侧 `PluginUpgradeRunner` 调度：

- 先校验 `compat.minApp` 与已安装版本。
- 当插件版本变化或存在 pending migration 时，按 `ownedTables`
  创建同库影子表快照。
- 在同一个事务内执行 pending migrations、更新
  `installed_plugins.version`，成功后丢弃快照。
- 失败时事务回滚负责 schema 和版本回退；影子表只作为数据兜底，不承担已提交 schema 的回滚职责。

这个边界很重要：schema 原子性靠事务，不靠备份表。备份表只保护插件拥有的数据行，避免把升级失败处理扩散成整库恢复。

## 卸载与重装

卸载 Mindmap 只改变插件安装/启用状态：

- 不 `DROP TABLE`。
- 不删除 `mindmap_versions` / `mindmap_evidence`。
- 不清理已应用的 `plugin_migrations`。
- 重装后复用原数据，迁移执行器会跳过已经记录过的迁移。

这保证了“卸载是隐藏能力，不是销毁用户数据”。真正的数据清理应另开显式用户动作和独立计划。

## 删包缺失态

当前仍保留一个 host
glue 边界：`src/app-hosts/linnya/plugin-registry/builtin/mindmap.backend.ts`。生产代码里只有这里允许 import
`@plugin/mindmap/backend`；当 `packages/plugins/mindmap` 被移走时，tsconfig
fallback 到 absent stub，主应用 backend 仍能编译，Mindmap 能力降级为缺失态。

这个设计只解决“删包可编译”和“主应用不被内置插件拖死”。生产加载已经由磁盘 artifact 接管；host
glue 仍保留是为了 dev inline 路径、absent
stub 和内置 meta 的兼容边界，第三方化前不继续外扩。

## Sheet / Slides 复用提醒

Sheet / Slides 可以复用这套生命周期地基，但不能复制 Mindmap 的业务细节：

- 各自声明自己的 `ownedTables`，不要共用 Mindmap 表名。
- 各自设计 `v1` 基线收养，覆盖老用户与新用户两条路径。
- 各自补升级失败回滚、卸载/重装、删包可编译和 guard 测试。
- 新增表结构变更必须走插件迁移，不再塞进主应用全局 `SCHEMA_VERSION`。
