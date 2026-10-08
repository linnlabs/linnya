# Research Workflow 开发原型

本 feature 是 Benchmark 内的真实研究交接编排，不是生产 Agent、不创建 Runtime、不自动评定文章质量。入口仍由 Benchmark
CLI 解析，执行仅调用正式 Conversation
CLI 子进程；不读取数据库、Blob 物理目录或隐藏推理。

## 使用与输入

`pnpm benchmark:agent research-workflow --manifest /absolute/manifest.json --output /absolute/result-dir`

manifest 的正式 parser 是 `definitions/researchWorkflow.ts`。它声明
`schemaVersion: 1`、固定 `projectId` 与有序 `stages`。每个阶段包含：

- `id`：D0 / R0 / D1 / R1 的有序子集，不得重复。
- `agentId`：可选的正式 backend Agent ID，省略时使用 `default`。不同阶段可选不同 Agent；
  例如实验作者与 Default 评审。实际接纳身份保存在 receipt，恢复不得换 Agent。
- `modelId`、`reasoningEffort`（默认 high）、`skill`：显式模型配置与需加载的 Skill。
- `promptFile`：UTF-8 提示文件，相对 manifest 所在目录解析。
- `allowedMaterials`：允许读取的 Workspace
  locator；`expectedDocuments`：本阶段必须成功写入并回读的文档。
- `network`：allowed /
  forbidden；不允许通用子 Agent，网页深搜只在联网允许阶段按需使用。
- 可选 `sourcePacket: { prefix, index }`：例如 prefix 为 `workspace:/S0`，产生
  `workspace:/S0-001.md` 等根文件和指定 index，不隐式创建目录。

真实开放研究优先普通网页、PDF或项目文档与紧凑来源目录，`sourcePacket`不是必需输入。
原始审计与取得记录仍保存在后台，不要求作者/评委解码审计JSON。PDF须走当前正式可用读取
路径，不能假设web_read支持全部附件。公开夹具只验证工程合同，不替代自然任务的质量评审。

同一 manifest 的后继阶段自动允许先前资料包；**不会自动允许先前文章、笔记或评审**。这些文档必须显式放进 allowedMaterials。因此 R1 可只取得 D1 与来源，而不读取 R0。不同项目的对照使用独立 manifest，由操作者通过正式工具预置材料；source
publication plan 可用于复制普通材料，不能作为 Citation/Evidence 导入接口。

输入 manifest、提示正文与文章投影均冻结 hash。正式 read_file 始终绑定持久 inspection
Conversation，避免引用别名跨会话漂移；Citation 快照排除展示 index，保留当前窗口预算后摘录的全部已见变体，并纳入 versionHash。同一 output 再执行只观察同一 run；不通过重新发作者消息修复错误。固定材料并不代表 OS 或工具权限隔离：网络、根枚举、物理读取、命令和通用委派按真实工具轨迹记录，Shell 范围仍需人工核对。

## 状态、恢复和版本

- send 前先持久化 admission_unknown，取得 receipt 后才 observing。响应未知时保留原状并退出，不自动 send。操作者须通过正式 CLI 查明原请求结果，不能删除 state 后补跑冒充恢复。
- watch 的 30 秒只限制一次观察，绝不取消后端 run。自然完成仍受 Host/模型真实预算约束。
- paused / awaiting_user 退出观察。paused 需显式
  `--resume-stage D0`（或相应阶段）；只恢复 exact run。HITL 仍通过正式
  `linnya respond` 处理后重跑同一命令。
- resume 先保存 pending
  fence；结果未知时只查原 execution，不能自动再发 resume。cancelled /
  failed 保留终态、消息与 audit，不进入后继阶段。
- 产物缺失、未在根运行写入、读回不完整或资料发布失败是 collection_failed，不重发作者。再次执行仅重新收集同一run的正式记录；未知资料写入先按publication
  journal对账，不自动重复写入，也不重发作者。原始失败轨迹供诊断。
- manifest、提示、已绑定输入或最终产物改变时标 stale，旧评审不再被当作当前结果。completed 只表示运行和交接完成；`semanticQuality`
  始终为 not_evaluated。阶段结束重新核对输入；任一绑定变更级联使该阶段与后续旧检查失效，原运行事实保留。
- output 以独占 runner.lock 防止并发 send。进程被强杀留下锁时，先确认 pid 已退出并核对 state 中接纳身份，才可人工移除锁；不按锁年龄自动抢占。

## 材料与正文完整性

`messages` 分页覆盖会话，再按 exact run 过滤。只导出根运行实际返回的 web_search
/ web_read / tool_output_read 和 Shell/Process execution
observation：搜索摘要、metadata-only、正文、续读范围、失败与未知合同分别保存。深搜子运行的「已读」说明不会变成父运行全文；Shell/Process实际返回单列为命令观察，不能自动认证为外部来源；未返回的下载文件或 child 正文不被自动认定为已取得来源。

**取得记录不等于可交接资料。** `tool_output_read` 也可能续读评审、笔记或 Skill，不能因工具名就收入来源包。目前 CLI 消息不携带通用 blob producer metadata；只有先前同一会话、同一 run 的 Shell/Process 正式结构化 blob 身份能绑定续读。其余续读（包括无法证明归属的网页续读）保留原始 observation、范围与 `packetDisposition`，不发布正文；资料索引明确报告排除次数。不从正文里的调用示例、URL、引用或 blob 字符串猜测来源，也不改 Host 合同补充旁路。

已绑定的命令续读仍是命令观察，不是经过认证的网页，也不保证命令未读越界文件；固定材料实验仍需审计命令行为。未知/不匹配的续读结果同样不进入资料包。完成交接不代表完整转交所有取得内容，缺少 producer 信息是当前原型的明确限制。

完成发布的阶段记录 `sourcePacketPolicyVersion`。恢复旧 completed 状态时，缺少本版本来源准入证明的资料包及后继阶段标 stale，不自动继续发送；保留旧包，在独立输出中重新核查并显式发布新前缀，不能原地改写旧实验。

原始 messages 与 source-records 保留取得版本、实际 observation 原件和 hash。owner 截断与外层截断信号分开；续读 data 中的 window 只有完整出现在实际 observation 才能声明取得范围，不把结构化载荷中的未见尾部转交后续模型。供下一会话读的 packet 使用短片段、明确 Workspace
locator 与文本围栏；原会话 blob 调用片段被隔离，转换区间有记录、同行资料仍保留，原始审计不修改。分片不是新来源，原取得失败不会被另一次成功覆盖。

Markdown
current 会规范化代码块首尾空白。只有首尾确有空白的资料片段增加显式传输边界，`segmentFraming`
记录前后缀；标记不属于来源，片段字符与 offset 不变。发布后仍逐字核对完整投影，不通过 trim 或模糊比较放过内容变化。

正文来自正式 `read_file`
的 current（包含 pending），按实际行号与返回行数校验；外层截断时缩小窗口。单行仍过长时使用正式 DocumentView 字符窗口，核对总长度、cursor 和完整 envelope，并将 representation 标为 document-view。该 hash 是相应当前投影的 hash，不是数据库 revision
hash；DocumentView 的块 ref 不是普通 Markdown 字节。字数为当前投影中的 Han 字符数，不含主观可读性评价。

资料包目标不得覆盖任务输入、文章、评审或先前材料包，完整发布计划在写入前再次核对。发布资料时先记录写入意图，逐件读回并保存当前投影。中断留下的写入意图必须对账，不能自动重复写入。文章Skill 实际激活、作者输出回读只作为执行事实记录；inspection 的程序回读不替作者证明自检。文章语义、来源是否支持结论、整体反馈是否正确，依然由隔离评审与证据核对决定。

## 产物与测试

output 下保存 manifest.freeze、state、workspace-calls，以及各阶段 prompt、状态观测、messages、result、audit、scope-audit、outputs、source-records、source-publication-plan
/ journal /
publications。审计不可用明确记缺失；不另外发明采集或评分系统。正文、参数、来源属于开发数据，应留在忽略目录，不提交到公共仓。

业务测试使用合成资料和 fake CLI
port 穿过发送、恢复、取消、观察超时、缺稿、版本失效、消息分页、长行续读和发布闭环。真实 App
smoke 另检验五工具 adapter 和 Markdown 投影；真实质量实验不进自动测试门禁。
