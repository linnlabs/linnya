# 14 · 生命周期：安装 / 启停 / 卸载 / 升级

> 适用场景：理解插件运行目录、启动时序、安装卸载升级链路与回滚语义。

## 运行目录

用户插件目录由 `LINNYA_PLUGIN_ROOT` 指定。active 布局：

```text
<userPluginRoot>/
  <pluginId>/
    active.json
    <version>/
      plugin.json
      SHA512SUMS
      assets/
      dist/
        backend/
        renderer/
```

- `active.json` 记录当前 active artifact 版本；带 `previousVersion` 时，加载失败后端 loader 会尝试回滚重载上一版本。
- SQLite 这三个版本字段语义不同，不可互换：`installed_plugins.version` 是**已安装 artifact 版本**（由 `PluginUpgradeRunner` 写成 `plan.targetVersion`，与 manifest 对齐）；`installed_plugins.schema_version` 是**数据迁移账本版本**（由 `PluginMigrationRunner` 维护，对应 `plugin_migrations`）；`plugin_active_versions`（+ 磁盘 `active.json`）是**当前运行 active artifact 指针**。
- 开发调试完整 artifact 用 `LINNYA_PLUGIN_DIRECT_DIRS` 指向插件版本目录，优先级高于 active 布局。
- 只把外置 backend 接入开发 Host 时使用 `LINNYA_PLUGIN_BACKEND_DIRECT_DIRS`；它不会把 Renderer 强制切换成 artifact，Renderer 仍可走源码入口与 HMR。

## 启动时序

1. Electron main 注册 `plugin://` scheme 和 handler。
2. `prepareBuiltinPluginRuntimeEnvironment()` 把预置官方插件 **stage** 到用户插件目录，只复制版本目录，不写 `active.json`。
3. 核心数据库迁移完成（插件状态表、快照表就绪）。
4. `bootstrapBuiltinPluginLifecycle(db)` 先激活 staged 预置版本：临时加载该版本 backend 生成迁移计划，迁移成功后才写 `active.json`；随后登记 active backend 插件、应用 schema、执行 plugin migrations。
5. renderer 通过 `plugins:renderer-entries` 获取 enabled 插件前端入口，动态 import 并注册 UI contribution。

> 不变式：`active.json` 只能在对应版本的插件迁移成功后写入。启动早期 seed 不允许切 active。激活编排会在迁移前 preflight 读取旧 active；迁移事务提交时同步写 `plugin_active_versions(status='activating')`，再写 `active.json`；成功后标记 `active`，失败后标记 `failed`。成功升级时写入 `previousVersion`，供下一次 backend 加载失败时回滚。

## 预置 Seed 规则

- 用户没有 active 插件时，复制预置版本目录并等待 DB lifecycle 激活。
- 用户 active 版本低于预置版本时先 stage 新版本；高于则不降级。
- 预置 staged 版本激活成功后，如果之前已有 active 版本，`active.json` 必须写入 `previousVersion`，不能丢失回滚链。
- 用户主动卸载过（`plugin-user-removed.json`）会阻止自动 seed。
- 目标版本目录已存在时，manifest 身份和 `SHA512SUMS` 必须与预置 artifact 一致；同一版本出现不同内容会立即失败并要求提升插件版本，绝不覆盖或静默沿用旧目录。
- 首装 staged 激活失败会还原为未安装；已安装但禁用的插件完成随包升级后仍保持禁用。

远程安装同样不能只凭版本号复用既有 staged 目录。安装流程必须先下载并校验远程 zip，再比较解包 artifact 与既有目录的 `SHA512SUMS`；只有身份一致才返回 `already-staged`，内容冲突必须失败且保留原目录与 active 指针。

## 后端 / 前端加载

- 后端 loader（`diskPluginLoader.ts`）：由 App Server 执行“发现目录 → `parsePluginManifest` 校验 → 校验 `compat.minApp` → `require(entry.backend)` → 校验 contribution meta 与 manifest 一致”。同一 pluginId 只加载第一个实例；单个插件加载失败不应破坏其他插件，active 布局尝试回滚 previous。
- 前端 loader：只加载 enabled 插件 entry；登记 contribution 后注入 CSS，再调用 `activate()` 挂载 renderer port。下一次同步时如果插件不再 enabled，会先调用 `deactivate()` 注销 port/watchers，再移除该插件 CSS；单插件失败只记 warning，不阻断其它插件，且会撤回本次已注入的 CSS。
- 启动 reconciliation：若 `plugin_active_versions` 里有 `activating/failed` 记录，平台会对照磁盘 `active.json` 修复或记录失败；若记录为 `active` 但磁盘已经被 loader 回滚到 `previousVersion`，平台承认 runtime rollback，不把坏版本强行写回去。

## 启用和停用

- 状态写入 `enabled_plugins`；未安装不能启用；required 不能停用；启用前确认依赖已启用，停用前确认无被依赖。
- 启停后重建工具注册表并清 agent task cache，模型可见能力立即收缩。
- renderer 收到 `plugins-changed` 后重新拉取 enabled renderer entries，同步 `activate()` / `deactivate()`、file handler 与 CSS，避免禁用插件后 pageContext、toolRefresh 或创建 handler 残留。
- 停用不删除 runtime 文件，也不删除数据。
- **禁用仍迁移**：已安装但禁用的插件，启动时仍执行 pending 迁移（语义口径见 [06 数据库](./06-database.md)）。
- 安装、远程安装、启停、卸载按 `pluginId` 串行执行；不同插件可以并行，同一插件不能交错写 DB、`active.json` 和 runtime 资源。
- Hosted Plugin Command 属于 backend runtime resource。停用、卸载或 active 版本切换前，host 先把旧 command 标记为 draining，拒绝新 invocation，abort 并等待已进入的 invocation；完成后才注销 hidden worker 和 runtime effect，再激活新 contribution。禁止先卸载 worker/coordinator、再等待旧命令自然结束。

## 卸载和重装

卸载（`uninstallPluginLifecycle`）：`installed=0`、删 enabled、标记 `user_removed=1`、删 active 指针与版本目录、保留 `plugin-user-removed.json` 防自动装回；**不删数据表、不清迁移账本**。重装清除移除标记、重装 runtime 文件、复用原数据与 migration ledger。

## 远程安装和更新

入口 `plugins:installFromRemote`，运行时只使用固定官方 latest 地址
`https://download.linnyai.com/plugins/<pluginId>/latest.json`。只有验签通过的
`official` Desktop 可以在发出请求前通过门禁；源码运行与社区打包不连接该服务。
普通环境变量不能覆盖运行时下载地址。

安装不存在 DB-only 入口：任何「安装」都必须先拿到插件版本目录并完成迁移/active 指针切换，不能只把 `installed_plugins.installed` 改成 1。

链路：读 latest.json → 校验 version/url/sha512/minApp → 下载 zip → sha512 校验 → 解压（防路径越界）→ 校验 plugin.json/entry → 落版本目录 → 加载新 backend 生成升级计划 → 标记 installed → `activatePluginVersionWithMigrations()` → 迁移成功后写 active → 通知 renderer。

失败规则：sha 不匹配不落盘；manifest 不兼容返回可读错误；migration 失败 SQLite 事务回滚；新 backend 加载失败则安装失败。同一插件的生命周期写操作由平台排队，但插件迁移仍应保持可重入，保证崩溃恢复或重试时不会破坏数据。

## 数据迁移和回滚

- `PluginUpgradeRunner`：校验兼容范围 → 判断升级/pending migration → 按 `ownedTables` 建数据快照 → 同一事务执行迁移并更新版本 → 成功丢快照、失败事务回滚（快照只是兜底）。
- `PluginMigrationRunner`：拒绝「DB schema 高于代码声明」；pending 迁移按严格递增执行并记账。
- `activatePluginVersionWithMigrations()`：先校验目标版本目录并记录旧 active，再跑迁移；迁移事务内同步写 runtime active 账本，只有成功且旧 active 未变化时才写 `active.json`。因此崩溃不会留下「active 指到新代码但 schema 仍旧」或「DB 已升级但启动无从修复 active 指针」的组合，也不会在并发生命周期操作后覆盖别人刚写入的 active。
- `plugin_active_versions.status` 语义：
  - `activating`：迁移账本已提交，active 指针切换尚未确认完成，启动可尝试修复。
  - `active`：DB 与磁盘 active 指针曾经完成同步。
  - `failed`：active 指针修复/切换失败，需要商店或诊断界面展示原因。

## 插件商店数据

- 商店列表 IPC（`plugins:store-list`）基于 `listRegisteredBackendPluginMetas()` 读取已加载 contribution meta，再叠加 `listStates()`，**不是 `packages/plugins/*` 全量扫描**。required 插件不进商店列表；未装配插件未来由验签 catalog 补充，不允许 Host 回到私有源码 meta import，也不允许按某个下游插件 ID 添加预览门禁。
- `PluginStateView.state='missing'` 只表示当前不可运行；`reason='用户已卸载该插件'` 表示用户主动卸载过，区别于从未安装的 `reason='插件未安装'`。商店和 seed 逻辑不能把两者重新折叠。
- 详情优先读当前安装目录 manifest；missing 时读随包预置目录，保证卸载后仍能看详情和安装入口。
- 商店列表可见的官方插件，详情页必须能从 active artifact 或 bundled artifact 读到完整展示 manifest。`enabled` / `disabled` 但 active artifact 暂不可用时，必须回退 bundled manifest；不能只返回 DB 里的 base meta。这个场景常见于首次 seed 前、开发态直载缺口、迁移中的重型插件。
- 展示字段只来自 manifest（`details`、`releaseNotes`、`skills`、`agents`、`homepage`），不要从 README 读取。
