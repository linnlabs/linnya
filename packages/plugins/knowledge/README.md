# 知识库插件

知识库拥有资料摄入、原文、检索索引、图谱和项目关联的业务规则。公共 shared 入口是 Backend 和 Renderer 共用的数据合同，不导出数据库、文件路径、模型路由或凭据。模型目录、用途配置和实际推理由 Host 提供窄端口。

## 数据合同

`src/shared/definitions` 是知识库实体、文档状态、任务与检索投影的唯一声明位置。文档的 `hasSource` 是读取时从资料仓投影的可读内容事实，不存第二个布尔字段；`KnowledgeSavedContent` 只包含文档身份、名称和完整已保存内容，不授予磁盘路径。

上传回执表示进入受管任务；是否摄入完成以任务状态为准。重建索引只重建派生向量，不替换或自动删除已保存原文。模型空间不匹配需要用户显式重建，身份未知的历史非空索引不能用当前模型配置回填。

项目摘要复用 `@app/schemas` 的只读合同。关联查询不授予跨项目资料读取权限；来源读取仍由冻结的项目身份和当前关联范围校验。历史引用证据属于 Host，停用知识库不能使已有对话中的引用证据不可读。

Backend 与 Renderer 都消费同一 shared 合同，不能另写一份近似 schema。Renderer 只能通过本包公开入口及 `@plugin/renderer/*` 使用 Host 能力。

## 构建与运行边界

身份和版本以 `plugin.json` 为唯一真源；代码的 builtin 标记不是应用表面授信依据，Host 只授信正式装配来源。
本包需要同批实现公共 SDK 的 Host；当前 manifest 的 `0.2.1` 下限仅供开发联验，不表示已发布的 0.2.1 安装包具备新增接口。正式发行前必须提高到实际包含这些 SDK 的 App 版本。
`pnpm --dir packages/plugins/knowledge run typecheck` 使用 vue-tsc 同时检查 TS 与 Vue 模板。
`pnpm --dir packages/plugins/knowledge run test` 从本包的 Vitest 组合根运行领域测试；Host 与知识库的联合测试位于 `packages/plugins/__tests__`，只由全仓测试入口发现。
原 Renderer 的 JS 模块保留原语言与声明合同，不因迁移全面重写；TypeScript strict 规则保持不变。

### 数据库与产物

[`src/backend/database`](./src/backend/database/README.md) 拥有 8 张业务表及首次插件迁移；Host 历史 v80 仍负责已发布数据库的列升级，插件接管不改文档 ID、项目关系或原文/向量路径。

`package.json` 的 `linnya.development` 声明使开发编排发现 Backend、3 个 Node Worker 与 Renderer，无额外 Host 插件名单。`linnya.release` 使用既有官方插件打包/随包资源流程；该标记仅表示构建装配，不授权上传或开放远程安装。

`pnpm --dir packages/plugins/knowledge run package:artifact` 构建 CJS Backend/Worker 与 ESM Renderer，生成 ZIP、SHA512SUMS 和现有内容许可清单。`guard:artifact` 复用正式插件校验，再验证 3 个 Worker 的实际构建图与 ZIP 内容；构建图留在 `dist/.metadata`，不进入发行包。

Node Worker 不继承 Backend 主线程的 SDK 模块加载钩子，数据库、推理和解析 Worker SDK 由正式构建别名内联；Host 的固定 Worker bootstrap 另行安装受限的原生依赖解析钩子。原生 SQLite、PDF.js、Canvas、Jieba 与 Sharp 使用 Desktop 已有运行依赖；PDF.js 保留完整包的 `cmaps`、`iccs`、`standard_fonts` 和 `wasm`，不另复制一份解析资源。Audio Worker 继续属于 Host。

### 磁盘存储与占用

资料分三处存放，可恢复性不同：

| 位置 | 内容 | 删除后能否恢复 |
|---|---|---|
| Workspace `KnowledgeBase/source_of_truth/<docId>.source.json` | 解析结果（SoT），所有格式的资料真源 | 不能；只能重新上传原文件 |
| Workspace `KnowledgeBase/originals/<kbId>/<docId>.pdf` | 仅 PDF 原件，供查看与 OCR 续跑 | 不能；且有原件不等于能恢复 SoT |
| Workspace `KnowledgeBase/qdrant/` | Qdrant 进程配置、日志与 `storage/collections` | 能；重建索引从 SoT 重新切块并重新调用嵌入模型 |
| 主 SQLite 的 8 张 owned 表 | 知识库、文档、项目关联、图谱等元数据，不含块正文和向量 | 不能；体量小 |

每个知识库最多 3 个 Qdrant 集合：块索引 `<kbId>`，开启图谱时另有 `kg_nodes_<kbId>`、`kg_edges_<kbId>`。块正文作为 payload（`document`）随向量存入集合，因此集合体积包含正文副本。

Qdrant（随包 1.14.1）按固定大小预先占位，再按需新增：

- 每个集合预建 2 个 WAL 段，每段 `wal_capacity_mb`（默认 32 MB）；写满后关闭旧段、新建下一段。
- 每个可追加 segment 的 payload 页和稀疏向量页各预建 32 MB；稠密向量按 32 MB 的 mmap chunk 增长。
- macOS（APFS）上这些预建文件是稀疏文件：文件长度很大，实际分配的块很少。Windows（NTFS）上不是稀疏文件（`fsutil sparse queryflag` 显示未设置），文件长度就是实际占盘。
- Qdrant 自动分段取决于 CPU 核数，每段都各自预建页面。修复前在 18 核 Mac 上自动分成 8 段，一个空集合文件长度 577 MB。图谱首次建集合按写入点数选段，索引重建对正文、图谱节点和边分别按各自总点数选段，统一用现有 1/2/4 段策略，超过 500,000 点才由 Qdrant 自动选段。已有图谱集合在显式重建时收敛。

2026-11-19 在 macOS 用随包二进制实测（1024 维稠密向量 + bm25 稀疏向量，每块约 490 个汉字的 payload，`default_segment_number=1`）：

| 状态 | 实际占用 | 文件长度合计 |
|---|---|---|
| 1 个空集合 | 0.1 MB | 132 MB |
| 3 个空集合（一个开启图谱的知识库） | 0.4 MB | 396 MB |
| 块索引 1,000 块 | 15 MB | 428 MB |
| 块索引 10,000 块 | 125 MB | 566 MB |
| 块索引 30,000 块 | 218 MB | 671 MB |
| 从 30,000 块删到 10,000 块，优化器完成后 | 112 MB | 600 MB |
| 删除集合 | 全部释放 | 全部释放 |

同日在 Windows 11 虚拟机（NTFS，2 核）用同版本 `qdrant.exe` 实测（同样 `default_segment_number=1`）：

| 状态 | 修复前（WAL 实际 32 MB） | 现行配置（WAL 16 MB） |
|---|---|---|
| 1 个空集合 | 136 MB | 104 MB |
| 3 个空集合 | 408 MB | 312 MB |
| 块索引写入 2,000 块后 | 440 MB | 344 MB |
| Qdrant 运行中删除全部集合 | 成功，全部释放 | 成功，全部释放 |

Node 的 `fs.stat().blocks` 在 Windows 上由 libuv 取 NTFS AllocationSize 换算，与上表口径一致，两端都可以用 `blocks × 512` 统计实际占用。

由此得出存储规则：

- 显示占用必须按实际分配的块统计（`stat.blocks`、`du`），不能把文件长度相加，否则 macOS 上会把空库报成几百 MB。
- 删除点只标记删除，等优化器按 `deleted_threshold`（0.2）和 `vacuum_min_vector_number`（1000）重写 segment 后才回收空间；删除整个集合则立即释放。
- 主 SQLite 删除行只把页面留给后续复用。v70 起新建的库可以增量回收，更早的库要缩小文件只能整库 VACUUM，所以清理知识库不以缩小主数据库文件为目标。
- 插件迁移进度取 `plugin_migrations` 最大版本与 `installed_plugins.schema_version` 中的较大值。整体清理数据时，删 8 张表、删迁移记录、把 `schema_version` 归零必须在同一事务完成；只删迁移记录会让重装迁移失败且不重建表。主库中没有其他表外键引用这 8 张表。
- Qdrant 配置使用 `storage.wal` 和 `storage.optimizers`。已有集合保留创建时的 WAL 设置，新集合使用 16 MB WAL；不会为修改配置而重建旧集合。删除整个 `qdrant/storage` 后重启会得到空库。

## 激活、任务与恢复

`src/backend/runtime` 持有一次 activation 的资料访问、3 类队列、图谱调度、维护与推送。
默认启用只读本地元数据；首次实际向量操作才通过 Host 启动 Qdrant，空库、列表和已保存内容不会启动向量服务。
失败的首次启动在当前实例保持明确失败，用户停用并重新启用后取得新的资源 owner。
知识库自己的目录或元数据准备失败时，保留用户的启用选择，普通项目仍可启动；知识库页面和工具返回明确的局部故障与修复后停启指引。该失败实例不领取向量或 Worker 资源，不自动重试；Host 数据库迁移与 SDK 装配错误仍按原来的必需服务规则报告。

真实知识库工具（包括深度搜索）正在运行时拒绝停用或升级，检查发生在启停状态/版本指针变化前。
后台摄入、图谱和重建可以取消；停用先封新任务和 Renderer 推送，再等待本插件 Worker、Host 推理和文件清理完成。
普通对话及 Audio 不受该插件停用影响。未完成摄入在真实线程结束后保留 ID、原文和 PDF，持久化为可见失败状态；不扫描或重写其他 activation 的任务。
原文存在的失败资料可查看与重建；没有 SoT 的原 PDF 不能声称重建能恢复，可重新上传。

管理与关联使用正式 plugin IPC，文件上传仅走 Host 固定 multipart 入口（单文件 50 MiB）。Host 完整收齐文件与字段后交给插件，队列接纳后才转交暂存文件所有权。
错误使用正式 OperationFailure/UserFacingMessage 投影；IPC 传输不确定仍与业务拒绝区分，不自动重放写操作。

Worker 依赖由 Host 固定 bootstrap 在已准入 artifact 范围解析，不能依赖工作目录、源码 node_modules 或自设 NODE_PATH。
`dist/.metadata` 的实际构建图与 ZIP 校验必须保持一致，原生 external 按 bootstrap 的精确 7 个 specifier 核对。

## 项目 CLI

[`src/backend/cli`](./src/backend/cli/README.md) 拥有 `linnya-knowledge` 的参数、项目授权和结果。
Agent 使用 [`knowledge-management`](./resources/skills/knowledge-management/SKILL.md)；Skill 随 artifact 装配与停用撤销。
CLI 只管理当前项目已关联的库。导入与索引重建使用父 Shell 冻结的用途 ID，以及 Host 按本次 invocation
授予的推理端口；这些主线程事实不进入 Worker payload、模型路由或持久化表。

全库一致性维护与历史图谱回填由界面实际使用向量功能后一次调度；项目 CLI 的首次向量操作只处理其目标，
不会顺带回填其他库。元数据读取保持冷态。取消等待本次摄入、派生图谱抽取/索引、既有重试和 Host 请求收口，
不 drain 同库用户同时发起的其他任务。返回成功还必须验证文档与图谱的持久化终态，线程结束本身不代表业务成功。
