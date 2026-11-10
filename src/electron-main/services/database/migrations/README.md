# Host 数据库基线与迁移

本目录只管理 Linnya Host 在 `workspace.sqlite` 中拥有的 Schema。当前不兼容开发基线是
v61；v1-v60 的运行时迁移实现和专项测试已经删除。当前 Schema 版本为 v77。

v67→v68 为 image_blocks 增加默认空字符串的 caption；已有 alt/title、尺寸、来源保持不变，旧图片不会自动显示文件名题注。

v68→v69 删除自建 trigram grep 索引表 `workspace_vfs_search_files`、`workspace_vfs_search_lines`、`workspace_vfs_search_grams`。它们只是可重建的搜索缓存；新的 FTS5 索引表由 Workspace schema provider 建立，并在下一次目录 grep 时按需重建，旧行不迁移。DROP 释放的页留在数据库空闲列表里，可被后续写入复用，但文件本身要等 VACUUM 后才缩小；迁移不在启动时执行 VACUUM。删除耗时与旧索引体积成正比：2026-11 在开发库副本（23.4GB，其中旧索引 16.8GB）上实测，冷读 DROP 约 197s、系统缓存已热约 53s，随后 VACUUM 约 69s，文件降到 5.4GB。普通用户的旧索引通常在 GB 以内，一次性代价约为秒级到十几秒。

v69→v70 把 `agent_run_costs.state_json` 的运行成本恢复账本改为只存累计合计与条目 ID。旧账本逐条保存每次 context build 的全部上下文分项（每条消息一项），长运行的账本随调用次数平方增长：2026-11 开发库 1,546 行平均 585KB、最大 19.4MB。合计等于对全部条目聚合的结果，快照与恢复只读合计；迁移按 `run_id` 分页改写全部旧行，无法识别的行让迁移失败并回滚，运行时代码不双读旧形状。

v70→v71 把 `assets.local_path` 从本机绝对路径改为相对 AppData Root 的持久路径（合同见 [assets](../../../../domains/assets/README.md)）。迁移只截取 `ConversationAttachments/v2/stores/<store-id>/content/<xx>/<sha256>.<ext>` 这段受管内容后缀，统一成 `/` 分隔，不依赖旧前缀：换过位置或在 checkout 之间复制过的库同样能转换。不符合该结构的行让迁移失败并回滚；2026-11 各开发库共 5,514 行全部符合。`assets` 表的两个触发器在迁移完成后，与其他索引、视图和触发器一起建立，此后拒绝非相对路径写入。

v71→v72 为工具卡的正文和结构化结果引入来源事件外键。迁移事务重新建立可再生的 UI 消息表，将会话投影标为 pending。启动维护按最近活动顺序逐会话重建并提交 ready；中断后从尚未完成的会话继续。单个会话的事实校验失败时记录会话身份，后续会话仍可恢复。事件、执行断点、客户端提示与子运行历史各自由原 owner 保留。

v73→v74 将行动记录的保留归属改为文档。已存在的账本保留其来源项目，并按文档历史规则精简。

v74→v75 删除 `workspace_nodes.tags`。这一列只存过资源库角色标记；资源库投影早已删除，生产代码不再写入，2026-11 各开发库没有带角色的节点。用户可见的标签由语义层的独立表承载，不复用这个列名。

v75→v76 为行动账本加 `agent_id`，从仍在的运行记录回填，运行已删除的记录留空。对话删除会级联删掉运行记录，账本自己存 Agent 才能回答“这份文档是哪个 Agent 改的”。

v76→v77 建立可读对话的全文索引（FTS5 trigram，外部内容指向可读消息视图，合同见 [06 Read model §8](../../../../../docs/conversation-platform/06-read-model.md#8-可读对话)），并从已有 UI 消息整体重建一次。同一版本新增 `conversation_storage_usage`（对话占用的测量缓存，随对话级联删除），表由 schema provider 建立，不需要迁移步骤。索引只是投影，丢失或损坏时可用 `rebuild` 恢复。

语义层的标签与字段表（[语义层](../../../../domains/semantic-layer/README.md)）在 v77 内由 schema provider 建立，已有库启动时补建空表，不提升版本、没有迁移步骤。

v72→v73 将含思考消息的界面投影标记为待重建，同一思考的正文改为引用实际提供该值的事件。迁移逐项比较子运行工具输出、思考及回答，通过同一来源精确还原的内容只存一份；其余轨迹完整保存。工具决策事件的两份参数相同时使用存储标记，读取恢复原有字段。迁移和新写入遵循同一合同。2026-11 在 4,227 个会话的开发库副本上实测：v72 约 6 秒、v73 约 43 秒，随后投影重建约 80 秒；迁移前后的事件、子运行轨迹和界面消息逐条读回一致，三张表合计从约 3.5 GB 降到 2.2 GB。旧库释放的页留在文件内，由后续写入复用。

## 升级耗时与启动进度

每个 Host 迁移步骤是独立事务：成功后才提升 `user_version`，中途退出只回滚当前步骤，下次启动从该步骤重来。每步完成后日志记录耗时和数据库大小，用来积累不同数据量下的实际耗时。

迁移耗时取决于数据量和磁盘缓存冷热（v68→v69 同一份库冷读 197s、热缓存 53s），无法在开始前给出可靠的剩余时间，所以宿主只显示按步骤推进的进度，不显示预计时间。

Desktop 启动时，App Server 经控制协议报告数据库阶段（打开、逐步迁移、插件迁移与建索引）的开始、每步完成和结束。宿主在这一阶段暂停 30 秒启动超时，阶段结束后重新计时；有数据格式升级且超过 1 秒仍未完成时，显示“正在升级数据”窗口（见 [Desktop 数据升级窗口](../../../data-upgrade-window/README.md)）。CLI 同样暂停超时，但不显示窗口。

## 空闲页回收

新建的数据库在建第一张表之前设为 `auto_vacuum = INCREMENTAL`。删除释放的页先留在空闲列表里，启动维护在空闲页超过 2048 页时分批归还磁盘（每批 2048 页，保留 512 页，批次之间让出事件循环、可取消）。已有数据库保持原来的 `auto_vacuum` 设定：切换需要整库 VACUUM，不在启动时做；对它们 `reclaimFreePages` 不执行任何操作。

## 已发布数据库的升级保障

Desktop 0.1.0 的公开数据基线是 v68（源码 `9c8186a8`）。公开用户不存在 v61–v67；
未来收紧支持窗口时可以从 v68 起算，但不能删除 0.1.0 之后任一已发布 schema 到最新版本的升级路径。
当前运行时仍支持 v61，本规则不改变现有准入范围。

新增或修改迁移必须同时通过[新建库与发行夹具升级测试](../../../../../packages/plugins/__tests__/databaseUpgrade.sqlite.integration.test.ts)：
它通过正式 DatabaseService 和插件升级 runner，比较表、列、类型、约束、索引、触发器、视图及随包插件表，
并验证合成数据与 Pending 保留。新增 Host provider 即使不提升版本，也必须通过这道结构一致性门禁。
每个新的已发布 schema 都应保留可复演的升级夹具；既有发行夹具不能随当前 DDL 更新而重建。

0.1.0 的夹具来源、数据范围和重建入口见[夹具说明](../../../../../packages/plugins/__tests__/fixtures/database-0.1.0/README.md)。
插件表仍走自己的版本账本，不能用 Host 的版本号替代插件升级验证。

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
  当前表并写入当前 `SCHEMA_VERSION`，随后 app-level 编排运行已安装插件 lifecycle，最后建立 Host 索引、视图和触发器。
- 已有数据库先读取 `PRAGMA user_version`。低于 v61 或高于当前版本时立即失败，且失败前不执行
  schema provider、插件 lifecycle 或索引 DDL。
- 当前受支持范围内，Host 的表 DDL 在迁移前幂等执行；依赖最终表结构的索引、视图和触发器在迁移后建立。迁移自身需要使用的视图由对应步骤在事务内建立。
- worker 的 connection-only 路径只接受与当前 `SCHEMA_VERSION` 完全相同的数据库，不负责建表、
  迁移或插件启动。

生产启动的拒绝提示说明数据未修改、保留旧应用与完整数据目录；不展示开发重置命令。
开发重置仅适用于下面的独立开发目录，不是老版本用户的升级办法。

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

## v64 Pending revision

v63→v64 为既有 Markdown Pending 增加 `revision`，已有记录从 1 开始。更新提议保留 ID 并递增 revision；正文和 Pending 的版本共同防止旧 Editor 决策覆盖新提议。这是保留数据的增量迁移，不提升开发数据 epoch，也不要求重置数据库。旧结构迁移与回滚由相邻真实 SQLite 测试覆盖。

## v65 会话执行通知

v64→v65 保留 child trace 身份与内容，扩展其 kind 以保存重试和运行错误；保留索引和级联删除。已有会话 UI 投影标记为 pending，由正式 projector 从原 error facts 重建通知。迁移不生成不存在的 child 错误、不修改运行状态、不增加开发 epoch。真实 SQLite 测试覆盖旧结构、事务回滚和历史保留。

## v66 客户端提示与 v67 完整引用元数据

v65→v66 仅重建可再生 UI 消息表，以接纳没有 Runtime 身份的客户端提示；原始事件、运行和客户端事实保留。

v66→v67 清空 `conversation_ui_citation_facts`，并把已有 UI 投影标记为 pending。旧索引用搜索展示合同保存引用，作者数组、刊名和知识库身份可能已经在投影时丢失；因此不能把旧 JSON 双读或猜补成完整来源。启动维护沿用正式 rebuild，从原始 main tool events 与 Subrun trace 重建完整来源，再恢复 ready。

本迁移不修改 Runtime facts、Subrun trace、文档或其待接受修订；原始事实没有的字段仍然缺省，已写入文档的历史损失不能靠 UI 重建恢复。真实 SQLite 回归验证事务回滚、旧 ready 状态失效、完整来源恢复和首次快照规则。

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

### 改写或删除用户内容的迁移

升级不做整库备份。逐步提交的迁移失败后重试时，新副本可能盖掉真正的升级前状态；整库还原还会回滚升级后的
全部新工作，而库里的大部分空间是对话记录和可重建投影。保护按迁移类型决定。

用户内容指文档正文与版本、目录、待审阅修订，以及插件的文档表。Host 迁移和插件 migration 都适用本节。

不改写用户内容的迁移不做任何复制：加表、加列、加索引、重建可再生投影、清缓存都属于这一类。

改写或删除用户内容时，按下面的顺序选择：

1. **分两个版本做（首选）。** 这一版写新结构并保留旧数据，后续版本确认无误再删旧数据，删旧数据的那一版
   不需要复制。发现语义错误时，修正版从旧数据重算。
2. **做不到分版本时，只复制受影响的表。** 迁移前用 `ATTACH` 加 `INSERT … SELECT` 复制到数据库同目录的旁路
   文件，文件名带来源版本号：
   - 同名文件已存在，说明是上次失败后的重试，不得覆盖；
   - 后续一次迁移成功后删除；
   - 空间不足时不迁移，向用户提示空间不足。

旁路复制当前没有实现，第一条需要它的迁移连同这份合同一起实现。

两种做法都要让发行夹具包含受影响的内容，升级后逐条读回比较，见[已发布数据库的升级保障](#已发布数据库的升级保障)。

插件升级 runner 的表快照只在当次升级失败时还原，升级成功即丢弃，不能代替上述规则。

## Schema provider 硬约束

Host schema provider 只能声明可重复执行的当前结构：

- 允许带 `IF NOT EXISTS` 的 create-only DDL；
- 禁止 `ALTER`、`DROP` 和任何数据写入；
- 禁止修改 `PRAGMA user_version`；
- 插件业务表禁止注册为 Host schema provider。

Schema provider 的静态合同由 `schema-provider-contract.test.ts` 检查；registry 的连续性由
`migrations/__tests__/registry.test.ts` 检查；fresh bootstrap、当前版本幂等、基线前后 fail-closed、
插件边界和 worker 连接由 `database-service.idempotent-init.test.ts` 覆盖。
