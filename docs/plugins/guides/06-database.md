# 06 · 数据库与迁移

> 适用场景：插件需要自己的数据表；写 plugin migration；处理升级备份与回滚。

## 三种机制与分工

| 机制 | 用途 | 口径 |
|---|---|---|
| `pluginMigrations` | 可执行迁移，版本严格递增 | **插件建表、改表的唯一正道** |
| `ownedTables` | 升级前需要数据快照保护的表 | 必须声明，驱动升级备份/卸载不删表/数据归属 |
| `schemaProviders` | 启动时应用 DDL | 仅限 host 核心表；**插件不要用** |

## 规则

- 新增插件表结构变更必须走 plugin migration，不再塞进主应用全局 `SCHEMA_VERSION`。
- 全新 `workspace.sqlite` 由当前 host schema providers 直接落当前版本；随后只有当前安装插件的 lifecycle 可以建立各自 owned tables。当前 Host 基线是 v61，v1-v60 历史升级链已经删除，基线前数据库会在插件 lifecycle 之前失败。
- 官方插件 backend contribution 禁止声明 `schemaProviders`；`PLUGIN-GUARD-06-no-plugin-schema-providers` 会拦截。
- manifest 的 `migrations` 字段只声明版本和说明；真正的 `up` 实现在 backend contribution 的 `pluginMigrations`。
- `PluginMigrationRunner` 在一个事务里执行所有 pending migrations，并更新 `plugin_migrations` 与 `installed_plugins.schema_version`。
- `PluginUpgradeRunner` 在插件版本变化或存在 pending migration 时，按 `ownedTables` 创建同库数据快照；事务成功后丢弃快照，失败回滚。
- 迁移 `up` 应尽量幂等，覆盖老库收养、新库首建和重启恢复。
- 事后插件化迁移允许使用 `CREATE TABLE IF NOT EXISTS` 同时覆盖缺表建表和老库收养；确认插件 lifecycle 在首次业务访问前执行后，必须退役对应 host schema provider，避免双真源漂移。
- `ownedTables` 声明必须与迁移真实建出的表一致，并有契约测试比对；声明表不存在时升级备份会 fail-fast，防止数据归属契约漂移被静默跳过。

## 语义口径（必须知道）

- **禁用 ≠ 数据冻结**：已安装但禁用的插件，启动时仍会执行 pending 迁移，保证重新启用即可用（如未来调整该口径需同步更新本节）。
- **卸载保留数据**：卸载删除 runtime 文件与安装/启用状态，但**不删数据表、不清 `plugin_migrations` 账本**；重装复用原数据与迁移账本。要彻底清理需单独的显式路径（当前没有）。
- 激活指针在迁移成功后才写入。迁移仍必须可重入，因为崩溃可能发生在数据库事务或后续文件指针切换边界。

## 表来源判断（事后插件化场景）

v61 基线不再收养 v1-v60 Host 历史中的插件表。fresh 路径由已安装插件的 migration 建表；当前基线内若插件自身需要收养既有表，仍由该插件 migration 使用幂等 DDL 完成。对应 Host schema provider 不得为了兼容再次出现。详见 [17 重型插件开发进阶](./17-heavy-plugins.md) 第 5 节。
