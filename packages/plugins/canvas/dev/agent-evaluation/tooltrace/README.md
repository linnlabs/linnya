# 模型工具轨迹提取

本开发入口只从正式 audit/messages
DTO 提取可核对事实，不读取模型自述，不写评分、人工审阅或帧性能。`parseCanvasToolTrace`
是无文件副作用的公开入口；audit 必须证明指定根 run，消息只接纳该 run 及正式 parent 链上的子 run。消息分页未覆盖头尾、同一消息版本冲突、未完成 pipe 输出都会留下 diagnostics 和 needsReview。

`pnpm exec tsx --tsconfig packages/plugins/canvas/dev/agent-evaluation/tooltrace/tsconfig.json packages/plugins/canvas/dev/agent-evaluation/tooltrace/run.ts inspect INSPECTION.json NEW-DIR`
接受 scope（conversationId、rootRunId、documentId、workspace
locators）、auditFile、messageFiles。新目录已有即拒绝覆盖，原始证据不改动，输出 inspection.json 和 trace.json。

目前只接纳独立字面量 `linnya-canvas apply/arrange/check/render` 和带引号的 cat
here-doc 文件写入。动态变量、循环、管道、Python 生成载荷以及其他混合输出明确交人工核验；不会从看起来像正式响应的 echo 内容认定提交。未记录载荷的请求仍可接纳唯一正式回执，但不能臆断它是否为修正重提。stdio 必须是完整且关闭的 pipe 投影，stdout 只解析 CLI 正式单行 JSON。

dryRuns 与正式 attempts 分开保留，pending 仅证明校验接纳，commits 仅从真实 committed 回执产生。同 requestId 的相同回执只记 replay；参数验证错误与未知 operation_failed 分开。修正仅在同一请求或文件载荷可证明改变时计算，原样稳定ID重试不算修正。

图片链必须是同一模型 run 先实际 render，再 read_file 返回该 conversation
locator 且 attachment_status=attached、MIME 为 image。runner 截图、其他 run 的读图、模型说“已检查”都不计。check 保留原始 sequence，后续草拟评测输入必须和 after 快照对齐。审批按钮、草稿键盘输入、人工语义、帧与 worker 性能均需另外的可信证据，不从 pending 或 CLI 耗时推算。

同一入口的 `draft REQUEST.json NEW-DIR`
从 runner 的 state、before、指定 collectionLabel 下的 audit/result/messages-index/after 原件生成草稿。request 包含 runDirectory、collectionLabel，可显式给 controlsFile、metricsFile。正式结束时间取 result.completed_at，源码无效、未知工具事实、最终 sequence 的 check 缺失、UI事实缺失或schema不符时仅产出 run.partial.json 与 diagnostics.json，不能误交评分。事实完整时才产出 run.json；review 始终留空，metrics 缺失留空，不填0冒充性能。

独立 controlsFile 包含 scope（sourceRevision、batchId、documentId、conversationId、runId）、approvalShown、approvalDecision、editedCardId、evidenceFiles；这些值由可信观察者明确提供，不能由模型文本推断。metricsFile 使用同一scope，给出正式评测 metrics 与证据文件列表。证据路径按命令当前目录解释，建议绝对路径；所有文件必须真实存在，属于别题/别run的观测会被拒绝。dry-run/write按原始时间排序并保留phase；原始trace和诊断随草稿保留，人工语义审阅或修正需另留审阅证据，不能抹掉首败。

最终attempt合同区分write与dry-run：write编号必填，dry-run允许原始编号为空；不会给预检臆造编号。controls.imageReadSequence从最后一次模型实际读图及其先前render的正式关联取得；无读图为null，关联事实缺失则partial。它可能小于after.sequence，评分会将旧图判断为未检查最终状态，不能为了通过门槛挑选其他旧读图或把runner读图计入。

契约测试中的可控完整输入仅验证草稿装配与评分门槛，不是实际模型评测证据；真实run仍须保留原始工具消息、UI见证与完整失败记录。

`receipts REQUEST.json NEW-DIR`
通过正式独立只读CLI补采持久回执。request包含runDirectory、collectionLabel、artifactRoot（已构建插件目录）、databasePath（显式只读SQLite路径）、requestIds。collector先从该collection的正式audit/messages重新证明run归属与字面请求编号，未证明的编号在启动CLI前拒绝；不会因为操作者手填编号就把同会话其他run算入本次。here-doc正文、控制流、变量编号和dry-run不能作为正式写编号证据。直接字面命令的stdout被后续管道过滤时，`trace.requests`只记录请求身份，不推断attempt、校验或修正。

采集器使用当前Host的Electron
ABI和正式Host模块解析，固定调用`--database … --project … --conversation … receipt … …`，不启动App写运行态或BrowserWindow。每个查询的参数、完整stdout/stderr、退出结果与已解析原件保留在权限受限的新目录；原件不可覆盖。见证记录实际CLI文件SHA256和Host目录，不能将此哈希冒充模型运行时的源码版本。

draft
request可额外传receiptWitnessFile。装配时再次对照本次解析的`trace.requests`验证编号，并校验sourceRevision、batch、run、conversation、project、文档路径与回执编号。只把committed回执作为权威commit补充；pending、缺失或无效响应不会伪造执行，旧回执缺字段细节保持未知。原始trace.json与receipt见证分别保留，run草稿的commits是两者的接纳结果。成功回执不能恢复已丢失的失败次数或correction，原始needsReview/diagnostics不会被清除，人工/UI/性能事实仍需独立证据。

T9/T12审批通知续轮由runner确认并单独存档。草拟时重新核对UI见证、固定任务决定、原run完成状态与同conversation官方send回执；原root与显式续轮都须有完整audit，同会话其他root不得混入。消息按conversation
sort_seq统一排序，首run的pending/失败与correction不会重置；UI执行的回执只补commit。完成时间取最后续轮，before/startedAt和UI见证scope仍锚首次run。request未另给controlsFile时复用续轮保存的UI见证；人工评分和性能依旧留空。
