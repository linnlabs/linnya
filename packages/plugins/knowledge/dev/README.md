# 知识库开发诊断与维护

这里只保留仓内开发命令，不是用户态插件 CLI，不进入 `dist`
或发行 ZIP，也不向 Host 增加公开接口。根 `scripts`
保留原来的 pnpm 命令；薄启动器在 Electron
Node 下使用本目录的源码 SDK 路径装配，不能通过产品 loader 加载本目录。

## 搜索与向量观察

`pnpm test:knowledge-search -- --help` 列出原有
`list-projects`、`list-project-kbs`、`search`、`qdrant-info/count/peek/search`
参数。`--workspaceDb` 指定已有 SQLite，`--workspaceRoot`
指定同一份 Workspace 原文目录；不传时使用当前 checkout 的
`_dev_data`。数据库以只读方式打开，诊断不初始化、迁移或创建空库。

`search`
复用正式 SearchService、项目范围、多库聚合、引用分配和 formatter。诊断没有真实 Conversation，因此只返回同结构的搜索投影，不写历史 Evidence；6 位引用只在当前进程分配，不是可供另一对话消费的持久引用。原文/相邻块仍从该 Workspace 的真实 SoT 读取。

普通搜索及 `qdrant-search` 使用当前开发 profile 的正式模型路由和凭据。`--noAi` /
`--no-ai`
不初始化模型或读取凭据，仅通过本地分词生成 BM25 稀疏向量、访问指定 Qdrant，并复用现有图谱反查和格式化；关闭需要模型的 discovery/anchor。纯 Qdrant 信息、计数与抽样命令不打开 Workspace 数据库。普通搜索的索引身份不匹配遵循产品规则，不由诊断猜测或回填。

## 图谱维护

`kg:reset` 清指定 `--kbId` 的五张图谱派生表；`kg:reset-vectors`
只清向量索引状态，保留节点、边和抽取进度。两者接受 `--workspaceDb` 与
`--workspaceRoot`，必须先退出使用该数据的 App。均不删除文档身份、项目关系、原文或 PDF。

只有显式 `--withQdrant` 才删除 `kg_nodes_<kbId>` 与
`kg_edges_<kbId>`；目标必须是合法单段名称。只有本机端口明确拒绝连接时才清理所选 Workspace 的同名 Qdrant 目录；HTTP 错误、超时、未知原因和远端 API 失败直接报错，不转删本地数据。本机 Qdrant 与所选 Workspace 仍须由操作者确认属于同一实例。`kb:delete-vector-collection`
仍要求 `--confirm` 与集合全名一致。

## 验证

`knowledgeCommands.integration.test.ts`
从原根脚本启动实际子进程，在临时 SQLite/SoT 和本机 HTTP 协议夹具上检查搜索范围、图谱、聚合排序、无模型模式与精确维护；普通搜索另调用真实 Host
embedding
adapter，检查混合检索与索引身份拒绝。HTTP 夹具不代表真实 Qdrant 服务或外部厂商在线验收。`knowledge-graph-reset-runtime.test.ts`
保留原事务/参数绑定断言。
