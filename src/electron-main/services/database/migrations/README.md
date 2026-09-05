# Host 数据库基线与迁移

本目录只管理 Linnya Host 在 `workspace.sqlite` 中拥有的 Schema。当前不兼容开发基线是
v61；v1-v60 的运行时迁移实现和专项测试已经删除。当前 Schema 版本为 v63。

## 为什么基线仍是 v61

v61 是新基线的持久身份，不代表新库要执行六十次迁移。继续使用单调递增的版本号可以让
旧 v1-v60 数据库明确落在基线之前，让初始化在任何 DDL 或插件 lifecycle 写入前拒绝它们。
如果把版本号重置成 v1，历史 v1 数据库就可能被误认成当前库，除非再引入第二套 schema
epoch；当前没有必要增加这层机制。

## 四种迁移边界

| 边界 | Owner | 当前策略 |
|---|---|---|
| Host SQLite | `DatabaseService` 与各 domain schema provider | fresh 直接建立当前事实；仅支持 v61 之后正式注册的增量迁移 |
| 默认开发数据 | app-level development data lifecycle | epoch 2；不兼容时整体隔离 `_dev_data` 后重建 |
| 插件 owned tables | 各插件 lifecycle | 继续使用插件自己的 migration 版本与 `plugin_migrations` 账本 |
| Cloud KV | Cloud deployment migrator | 继续执行一次性 v1→v2 数据迁移，保留远端模型和 API 配置 |

这四条链不能互相代替。删除 Host v1-v60 不等于删除插件 migration，也不影响 Cloud 数据迁移。

Host 只运行上述当前 Schema 初始化与受支持的增量迁移，不提供旧 `.ablk` 文件或独立
`conversations.sqlite` 的自动导入、手动迁移 IPC 或新旧数据库切换开关。
业务处理器直接使用已初始化的 DatabaseService；插件也不得探测“是否启用新数据库”。
将来存在真实旧数据导入需求时，必须单独定义来源格式、目标 owner、事务与验收合同。

## 初始化合同

- 文件不存在、空文件和内存数据库属于 fresh target。Host schema providers 在同一事务中建立
  当前表并写入当前 `SCHEMA_VERSION`，随后 app-level 编排运行已安装插件 lifecycle，最后建立 Host 索引。
- 已有数据库先读取 `PRAGMA user_version`。低于 v61 或高于当前版本时立即失败，且失败前不执行
  schema provider、插件 lifecycle 或索引 DDL。
- 当前受支持范围内，Host 的非索引 provider DDL 每次初始化都会幂等执行；需要增量迁移时，
  迁移完成后再建立可能依赖新列的索引。
- worker 的 connection-only 路径只接受与当前 `SCHEMA_VERSION` 完全相同的数据库，不负责建表、
  迁移或插件启动。

## 默认开发数据怎么处理

本次基线切换同时把 `CURRENT_DEVELOPMENT_DATA_EPOCH` 提升为 2。默认开发启动会在数据库、
Model Catalog、插件和任务队列初始化之前拒绝旧 epoch。停止开发进程后运行：

```bash
pnpm run dev:data:reset
```

命令会把整个 `_dev_data` 移入同盘 `.linnya-development-data-retired`，不会直接删除，输出中会给出
可恢复路径。不要只改 `user_version`、只删某张表或只清插件账本，这会制造跨 domain 的混合世代。

`LINNYA_WORKSPACE_DIR` 指向的外部 Workspace 不属于默认重置范围；其旧 SQLite 会被 v61 基线检查
拒绝，需要使用者显式重建或走未来单独设计的数据导入流程。

## v61 之后如何变更

先判断变更类型：

- 新增 Host 表、索引、触发器或视图：修改所属 domain 的 schema provider，保持 create-only 和幂等，
  通常不需要提升 `SCHEMA_VERSION`。
- 修改既有 Host 表、回填数据、删除结构或重建索引：提升 `SCHEMA_VERSION`，注册一条显式
  `fromVersion` 迁移，并用真实旧结构验证转换和事务回滚。
- 插件表：只改插件 migration，不能放入 Host registry。
- 再次发生跨 domain 的开发数据不兼容断代：除 Host Schema 决策外，还必须同步提升开发数据 epoch。

迁移注册表不再用数组下标表示版本。每条迁移显式声明来源版本；runner 按来源版本查找，缺失即失败。
这让代码体积只和当前支持窗口有关，不再要求永久保留从 v0 开始的空槽和实现。

## Schema provider 硬约束

Host schema provider 只能声明可重复执行的当前结构：

- 允许带 `IF NOT EXISTS` 的 create-only DDL；
- 禁止 `ALTER`、`DROP` 和任何数据写入；
- 禁止修改 `PRAGMA user_version`；
- 插件业务表禁止注册为 Host schema provider。

Schema provider 的静态合同由 `schema-provider-contract.test.ts` 检查；registry 的连续性由
`migrations/__tests__/registry.test.ts` 检查；fresh bootstrap、当前版本幂等、基线前后 fail-closed、
插件边界和 worker 连接由 `database-service.idempotent-init.test.ts` 覆盖。
