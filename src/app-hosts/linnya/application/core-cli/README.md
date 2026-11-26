# Agent Shell 内建 CLI

`linnya changes` 查询当前对话所属项目里保留的文档改动，`linnya conversations` 读同一项目里别的对话，`linnya schema`、`props`、`query`、`links` 读写标签与字段并按它们查文档。它与 `linnya-<插件>` 共用 Shell 的原生客户端、权限、取消和输出通道。Core 命令由 Host 注册，无需启用插件。项目由 Host 查询已授权对话的归属。

- `linnya changes --day yesterday` 按宿主当地日历列出昨天的记录。也接受 `today` 或具体日期。
- `linnya changes --since 2026-11-01 --until 2026-11-06` 包含起日，不含终日。
- `linnya changes --run ROOT_RUN_ID --limit 20` 包含该根运行及其子运行。日期和运行可以组合。
- 默认返回最近 30 项，最多 200 项。超过条数或 Shell 展示预算时，完整 JSON 中的 `truncated` 和 `notice` 明确说明截断。时间以带时区的 ISO 格式输出。隐藏或已入回收站的节点没有活动路径。

运行改的项另给 `agent`（Agent 注册表 ID）。每项是同一执行者对同一文档的保留记录。覆盖范围、精简与跨项目的可见规则见[行动账本](../../../../domains/action-ledger/README.md)。这里只开放只读查询。外部脚本用的 Conversation CLI 见 [Linnya CLI](../../../../../apps/linnya-cli/README.md)。

## 读别的对话

`linnya conversations` 让 Agent 读同一项目里别的对话，只给可读内容（用户的话、AI 的答复、工具前言和被中断的答复），不给思考和工具过程。口径见[可读对话](../../../../../docs/conversation-platform/06-read-model.md#8-可读对话)。

- `linnya conversations list [--query 文字] [--agent ID] [--activity any|today|week|month] [--documents any|changed|unchanged] [--sort activity|title|turns|documents|storage] [--direction asc|desc] [--limit 1..200]`：与项目对话面板共用 Host 查询，默认 30 个。每个对话含执行者（`agents`：Linnya CLI 创建的对话先给 `linnya_cli`，其后是回复过的 Agent，最近的在前）、当前选用的 Agent（`selectedAgent`）、当前执行状态（`activity`）、轮次、改过的文档数和时间。Agent 筛选的值就是 `agents` 里的值：`default` 为默认 Agent，`linnya_cli` 为 Linnya CLI 创建的对话；当前选用但从未回复的不计。活动窗口按宿主本地日历，week/month 含今天共七/三十天；文档按行动账本去重计数。
  置顶始终在前，默认最近活动降序，标题默认升序，其余默认降序；未测量占用排组内末尾。`--query` 搜标题与可读内容，结构化筛选先于搜索截断，并给命中片段。Agent 本地化显示名仅由 Renderer 贡献，因此 CLI 本轮不开放 `--sort agent`，不拿 ID 冒用显示名排序；未知排序返回参数错误。未开放按具体文档筛选，查哪些文档被改用 `linnya changes`。
- `linnya conversations read 对话ID [--after 序号] [--limit 1..200]`：按顺序读一个对话的可读消息，默认 50 条。没读完时输出 `nextAfterSeq`，作为下一次的 `--after`。一条消息超过输出预算时截短并标 `textTruncated`。

范围由 Host 按已授权对话的项目给出，读不到其他项目的对话；不在当前项目的对话与不存在的对话同样报错。超过条数或输出预算时 `truncated` 与 `notice` 明确说明。

list/read 都给 `activity`：running、awaiting_answer、awaiting_approval、interrupted、idle；审批事实不可读时为 unavailable。事实源和优先级见[当前执行状态](../conversation-activity/README.md)。保留 run_id、run_status、reason 和 pause；取消/失败/暂停可区分，读取不消费未读状态、不审批或恢复。列表的 `agents` 是回复过的 Agent，`selectedAgent` 是当前选用的 Agent。argv 不接受项目或来源对话覆盖，作用域只来自已授权父 Shell。

## 配色

`linnya palette` 给 Agent 出配色、检查配色、记下选用的一套。算法、错误码与“最近用过”归 [color-palette domain](../../../../domains/color-palette/README.md)。

- `linnya palette suggest <图片>...`：从 1–20 张图取色，默认给 3 套。可选 `--color` 指定主色（1–6 个）、`--seed` 补充本色、`--accents` 定强调色数量、`--n` 定套数、`--base` 定底色明暗、`--avoid` 排除颜色、`--rng` 复现之前的结果。
- `linnya palette check --bg --sf --ink --mu --ac --ch`：检查自己写的一套，可加 `--excluded`、`--color`。不合格时退出码为 1，并给出改动最少的版本。
- `linnya palette use <单套编号>`：选定一套后记下（如 `pl8f2a-2`），输出这套的组合（底色明暗与色系）。之后的 `suggest` 对同一组合降权，不排除；同一套再记一次只移到最前。编号不是本工作区最近 100 组建议里的报 `palette_not_found`。

权限：`suggest` 读本工作区的最近用过并记下发出的编号，`use` 写选用记录，两者都声明内部数据写入（`internalDataAccess: write`）：内部数据关闭时拒绝，只读档要给 Shell 设 `requires_write_access`。`check` 只算颜色，不读写任何数据。`--preview` 另需写工作目录。

图片是当前对话工作目录里的相对路径或 `conversation:/...`，边界与 `read_file` 相同，符号链接不能带到目录外。相对路径按工作目录根解析，不跟随 Shell 的 `cd`。`workspace:/` 和 `file:///` 按读不出处理。

默认输出是给模型读的紧凑文本：首行取色结论，之后一行一套。`--json` 输出 `@app/schemas/color-palette` 的 DTO，并附 `skippedImages` 和 `preview`。

颜色参数可以不带 `#`，因为 Shell 会把未加引号的 `#` 后面当注释。退出码：0 成功，1 业务失败或检查不合格，2 用法错误。失败时 stderr 是 `错误码 一句原因`。

`--preview` 把几套色条画成 PNG 写进工作目录根。文件名带随机后缀并独占创建，不会跟随预先放好的符号链接。

## 标签、字段与查询

标签与字段的定义、空值合同和查询语义归[语义层](../../../../domains/semantic-layer/README.md)，这里只做命令行翻译。路径一律是 `workspace:/` 开头的文档路径，只在当前项目内解析。

- `linnya schema`：列出已有标签（及其字段、默认值）和字段（类型、选项）。新建前先看能否复用。
- `linnya schema add-field 名称 --type 类型 [--option a,b]`、`add-tag 名称 [--field 字段[=默认值]]...`、`set-fields 标签 [--field ...]`（整体替换）。名称与已有定义相近时报 `similar_name` 并列出候选，确认不是同一个再加 `--allow-similar`。
- `linnya schema rename-tag | merge-tags | delete-tag | rename-field | delete-field | retype-field | set-options`：管理标签和字段本身。不加 `--yes` 只预览影响（文档数、合并补上的字段、改类型时每个值能否转换及样例、要改写的保存的筛选），加上才执行，需要 Shell 写权限。`set-options` 按给出的顺序，`旧名=新名` 改名，没列出的删除。执行与界面同一条路径（[标签管理](../semantic-schema/README.md)），保存的筛选一起改写；输出改动编号。新建标签与这些改动都记下发起的运行与对话。
- 可见范围只到当前项目：标签、字段名与个数是整个工作区共用的定义照常输出；改类型预览的样例（文档名与原值）、要改写的保存的筛选名只列当前项目的，其他项目的只计入个数；改动记录里的对话标题只在对话属于当前项目时显示，否则写“其他项目的对话”。没有所属项目的对话只看到定义与个数。跨项目处理归将来的顶层 Agent，不在这里放开。
- `linnya schema changes [--limit n]` 列出最近的改动；`linnya schema undo 编号 [--yes]` 整批撤回，之后又被改过的保存的筛选不恢复并说明个数。
- `linnya props get 路径`：当前版本、标签和全部字段（未设置的显示“（空）”）。
- `linnya props tag|untag 路径... --tag 标签,...`、`set 路径... 字段=值...`、`restore 路径 --to 版本`。`set` 里值留空即清除，多选用逗号分隔，勾选写 `true`/`false`。
- `linnya query [--tag 标签]... [--where 条件]... [--sort [-]字段]... [--group 字段] [--limit 1..200] [--json]`：条件写成 `字段=值`、`!=`、`>`、`>=`、`<`、`<=`、`~`（包含）、`!~`（不包含）；`字段=` 为空、`字段!=` 不为空。内建字段 `name`、`type`、`created`、`updated`。默认 50 份，超过时首行给出总数。
- `linnya query ... --save 名称 [--suggest]`：查询成功后把条件存成项目概览文件页的“保存的筛选”。标签、字段和选项存 ID，改名不失效；按单选字段 `--group` 时存成按它分列的看板。用户明确要求时直接固定到文件页那一排，`--suggest` 只放进“Agent 建议”，用户点“固定”才上去，30 天没打开会自动清理。用户要保存（不带 `--suggest`）时，同名或条件相同的 Agent 建议会被固定并换成这次的条件，不并排出现两个；其余条件相同的不重复保存、输出它的名称，同名的已有筛选不覆盖。一次性问题直接查完回答，不要保存。保存需要 Shell 写权限，不进行动账本。
- `linnya links 路径`：引用这份文档的文档和它引用的文档，同项目、不在回收站。

**写入要给期望版本。** 写命令不带 `--rev` 时只预览：在事务里按真实写入试一遍再回滚，列出每份文档的当前版本和将要发生的变化，最后一行是加好 `--rev` 的完整命令。带 `--rev`（按路径顺序，逗号分隔）才写入；版本不符时报 `revision_conflict` 并给出当前版本，避免覆盖用户刚在界面上做的修改。批量写入全部成功才提交，任一份失败整体回滚，错误带出是哪份文档。

预览和读命令只要内部数据权限；写入与新建定义还需要 Shell 写权限。属性改动按 Host 冻结的运行编号查出运行、父运行和根运行记入[行动账本](../../../../domains/action-ledger/README.md)；找不到运行记录时记为外部入口。

退出码：0 成功，1 业务失败（stderr 首行是 `错误码 一句原因`，随后是可用字段、相近名称或当前版本），2 用法错误。

## 定时任务

`linnya schedules list` 列出当前项目的任务，`show <任务 ID>` 查看详情。`create --name <名称> --prompt <任务内容>` 还需三选一给出时间：一次性用 `--once 2027-01-01T09:00`（当地时间，不含引号），重复用 `--cron "<五段 cron>"`，例如每天 9 点 `--cron "0 9 * * *"`；其余写法用 `--schedule '<时间表 JSON>'`。帮助只推荐前两种：Windows 受管 PowerShell 会去掉原生命令参数里的双引号，JSON 到达 CLI 时已不合法，解析失败的提示会指回 `--once`/`--cron`。`update <任务 ID>` 接受同样的字段；可带 `--revision <版本>` 确认修改的是刚读到的版本。参数形状由 `functions/parseSchedulesCommand.ts` 解析，字段合法性仍由请求 schema 校验。

- `--agent default|research`，默认 `default`。`--model <模型 ID>|default`，缺省时使用设置里的默认模型。
- `--permission read_only|standard|full_access`，创建时缺省用根运行冻结的对话档位。若任务需更高档位，请在定时任务界面修改。完全访问的成功结果会提示 Agent 在最终回复中告知风险。
- `--missed-policy run_latest|skip`，默认补最近一次。最短间隔一小时，校验与界面共用。
- `pause <任务 ID>`、`resume <任务 ID>`、`run-now <任务 ID>`。删除从定时任务界面执行。

命令只接受 Host 解析出的当前项目。写操作要求 Shell 写权限；标准档的创建、修改、恢复和立即运行需要本次批准。定时根运行及任何层级的子运行均拒绝写操作。改动记录按根运行关联到对话卡片。
