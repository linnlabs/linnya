# 行动账本

行动账本回答“谁、在哪次运行里、改了哪份用户内容”。它是各文档类型共用的登记点，不是统一写入 API：
各 owner 保留自己的写入接口、校验、审阅与撤回，账本只记身份和引用。

## 负责与不负责

- 负责：执行者身份、登记端口、`action_ledger_entries` 表、按运行和时间段的只读查询。
- 不负责：撤回、接受、恢复。Markdown 的 pending、Slides 的历史恢复、各插件的版本都由对应 owner 执行；
  账本里的版本引用只帮助找到 owner 自己的审阅或历史。
- 不记系统维护：迁移、索引、清理、缓存、设置、对话记录和插件安装都不入账。只记用户内容，当前是文档的新建、修改，以及[语义层](../semantic-layer/README.md)的打标签、去标签和改字段值。

## 执行者与作者

| 种类 | 含义 | 身份从哪里来 |
| --- | --- | --- |
| `run` | Agent 主运行 | 工具上下文的运行编号 |
| `subrun` | 子运行（可嵌套） | 工具上下文的运行编号、直接父运行和根运行 |
| `user` | 用户在界面上的操作 | 界面请求入口 |
| `plugin` | 插件自动化 | 插件身份 |
| `external` | 经外部控制桥进来的改动，界面显示为 Linnya CLI；分不出调用方是人、脚本还是外部 Agent | 外部控制桥入口；CLI 工具调用另带执行它的运行身份 |

身份由入口确定一次，再绑定进登记端口（`recorderFor(actor, granularity)`）；owner 登记时只给文档、部分、版本引用和计数，
不能改写执行者。运行身份来自 Host 注入的工具上下文，模型参数和插件都不能提供。

所有运行都记录用户这次请求的**根运行**。嵌套子运行只知道直接父运行，所以根运行在 Host 创建根工具上下文时按
RunContext 写入 `rootRunId`，子运行沿父上下文继承。子运行缺少根运行时登记直接失败，不按父运行猜。

运行执行者另记 **Agent**（注册表 ID，如 `default`、`research_v1`）。Linnkit 的工具上下文不带 Agent，登记时由账本按运行编号从运行记录查出，owner 与调用方都不能提供；没有运行表的装配记为空。对话删除会级联删掉运行记录，账本里的 Agent 仍保留；显示名由读取方从 Agent 注册表取，账本不存名称。

作者与执行者不同时另记 `author_run_id`，例如用户接受运行 R 的建议：执行者是用户，作者是 R。

Renderer IPC、产品 HTTP 请求、外部控制桥以及已注册插件的后台 effect 分别绑定入口身份。经 Conversation 接纳的 CLI 工具调用由一次无模型运行执行：那次原始 Host 工具调用记为 `external`，同时写入运行、根运行、对话和工具调用编号；CLI `send` 启动的模型运行里，模型自己的工具调用仍记为运行；界面发起的 Host 工具调用（表格填充等）入口身份是用户，也仍记为运行。Host 的编辑器保存、修订决定、新建与复制，以及文件工具的写入使用该身份。插件绕过这些入口直接写自己的表，仍须由对应 owner 接入细账。Shell 里的 `linnya props` 只拿到 Host 冻结的运行编号，由 `readStoredRunActor` 按运行记录找出父运行与根运行后记为运行；链条中断时报错，不按父运行猜，找不到运行记录时记为外部入口。

## 记什么

每条只存身份与引用，不复制正文：

| 字段 | 说明 |
| --- | --- |
| 文档、项目、文档类型 | 文档类型用于把改动交回对应 owner 的审阅或历史 |
| 动作 | `create`、`update`；语义层登记 `tag`、`untag`、`set_props`，部分为 `properties`，版本引用是语义层的对象版本 |
| 部分 | owner 定义的文档内部分身份，例如某一页、某组元素；粗账为空 |
| 改前、改后版本引用 | owner 的版本身份；被[文档历史](../document-history/README.md)保留规则清理后，读取方按版本不存在处理 |
| 摘要计数 | 少量数字，例如改了几处；不放正文片段 |
| 对话、运行、根运行、父运行、工具调用 | 运行身份；对话和运行不是外键 |
| Agent | 运行执行者的 Agent 注册表 ID；用户、插件和没有 Agent 的运行为空 |
| 时间 | 登记时刻（毫秒） |
| 粒度 | `coarse` 或 `fine`，见下节 |

动作和执行者种类在应用层校验，表里不写 CHECK，接入新动作时不用重建表；运行身份的完整性写成 CHECK。
按开发规模的 id 长度实测，每条记录约 290 字节，三个索引另约 170 字节。

## 粗账与细账

Agent 写文档只经过 Host 分发口：`write_file`、`edit_file` 的写入由
[`createWorkspaceDocumentFileWriteProviderResolver`](../../app-hosts/linnya/adapters/document-file-write/createWorkspaceDocumentFileWriteProviderResolver.ts) 分派，
新建由 [`createWorkspaceDocumentFileCreateProviderResolver`](../../app-hosts/linnya/adapters/document-file-create/createWorkspaceDocumentFileCreateProviderResolver.ts) 分派。
Host 在这里给每次成功写入记一条**粗账**（文档、运行、时间），不依赖各文档类型接入：

- 内建 Markdown：与正文、pending、批注同事务登记；规范化后没有变化的写入不记。
- 插件文档：插件的写入是异步边界，粗账在插件提交成功后另行写入；进程恰在两者之间退出时会少记一条。
  插件返回版本号时记为改后版本引用。粗账不判断插件写入是否真的改变了内容。

owner 在自己的提交事务里登记的是**细账**，可带部分、版本引用和计数。同一工具调用对同一文档已有细账时，
Host 不再记粗账，查询结果不会重复列出。只有粗账的文档类型没有逐处的改动记录，不能据此按运行撤回。

## 查询

Agent 通过 [Shell 内建命令](../../app-hosts/linnya/application/core-cli/README.md) 查询；对话界面经
[`run-document-changes`](../../app-hosts/linnya/application/run-document-changes/README.md) 按一轮回复的根运行查询。

`listDocumentChanges({ projectId, rootRunId?, conversationId?, since?, until?, limit })` 只读当前项目：

- 按根运行查询包含当前项目内它的全部子运行；时间段含起点、不含终点。文档转移后，目标项目仍可列出发生过的改动，但其他来源项目的插件、对话、运行身份不可见，也不能用原运行编号匹配。
- 同一执行者对同一文档的多次改动合成一项，按最近改动倒序。
- `limit` 为 1–200；超出时 `truncated` 为 true，调用方必须明说结果不完整。
- 返回文档身份，不读文档树；路径、名称和是否在回收站由调用方经 Workspace/VFS 解析。

按对话查询（项目概览对话页的“改过的文档”）只匹配改动发生在当前项目的记录，与按运行查询的可见规则相同。

`countDocumentsByConversation(projectId)` 给对话页的列表用：每个对话在当前项目改过几份文档（去重），文档已物理删除的不计。

`summarizeProjectDocuments(projectId, documentIds?)` 给项目概览用：每份有账的文档一项，最早一条若是新建则给出新建者，
另给最近一条。插件、对话身份与按运行查询一样，只在改动发生在当前项目时可见。

## 保留与删除

每次登记在同一事务内复用文档历史的保留计划：按文档保留最早、最近和各时间桶中的代表。一次工具调用的多个部分整体保留或清理。因此时间查询列的是仍保留的改动，不能据此断言过去从未发生其他操作。文档移入回收站时保留，物理删除时按文档级联删除。原项目仅标识改动发生地，跨项目转移后删除原项目不会删除仍存文档的记录。
删除对话不删除账本：文档的改动已经发生，账本只存对话编号，不存对话内容。

## 目录与验证

- `definitions/`：执行者、登记端口与查询合同。
- `functions/resolveToolRunActor.ts`：从工具上下文得出运行执行者。
- `infrastructure/sqlite/`：表结构、schema provider、登记与查询。
- 文件工具接入：[`src/tools/workspace/shared/fileToolActionLedger.ts`](../../tools/workspace/shared/fileToolActionLedger.ts)。

```bash
pnpm exec vitest run src/domains/action-ledger src/tools/workspace/shared/__tests__/fileToolActionLedger.integration.test.ts
pnpm exec vitest run src/tools/agent_control/subrun/subagent packages/plugins/__tests__/databaseUpgrade.sqlite.integration.test.ts
```
