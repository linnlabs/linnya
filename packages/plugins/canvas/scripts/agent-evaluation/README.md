# Canvas Agent 代表任务验收

`pnpm exec tsx --tsconfig packages/plugins/canvas/scripts/agent-evaluation/tsconfig.json packages/plugins/canvas/scripts/agent-evaluation/run.ts fixtures <输出目录>` 生成固定版本的13题。每题包含用户提示、输入Markdown文档、以用户身份执行的Core种子操作、可信UI动作以及自动/人工断言。文档由runner在独立测试项目创建并把真实ID写入run.documentIds；用户种子操作按最多500条分批，不计入模型写入。每题重建独立夹具，T7不依赖T6模型结果。T3以已有问题为0层，要求再展开3层；分组是空间主题片区，不写保留的parentId。

真实模型runner由Desktop验收入口负责：冻结provider/model/version、正式Skill/CLI commit、图像能力组与每题重复次数。固定首次基线为每模型、每图像能力组、每题1遍，全部首败与修正留痕；扩展重复测试时重复数需事先固定且各题一致。远端模型即使同版本也不声称输出确定；若服务商不公开精确版本，证据中明确记录此限制及调用日期。看图组记录check→render→实际read_file读取图片和后续修正；不看图组只check。T8提供三份带官方URL的历史资料摘要及offlinePrompt供离线来源结构基线；run.evidenceMode=offline时只记offline_baseline，不能算正式联网任务成功。正式T8使用原提示、evidenceMode=network，必须真实联网并记录官方页面、访问日期和支持结论的段落。

`run.ts assess <run.json> <新report.json>` 解析唯一输入schema，校验与after相同sequence的正式check几何事实，再给出逐条断言与失败明细。退出0表示自动检查与人工审阅均通过，1表示自动失败，2表示待人工审阅或仅离线基线；缺人工结论绝不能当任务成功。输入合同见definitions/canvasAgentEvaluation.ts，任务与所有人工项见definitions/canvasAgentTasks.ts。人工项包括主题分片、来源事实、流程语义、对白质量、真正联网及未保存草稿。T5固定README的方向可自动精确核对；布局可读性仍需审阅。

run文件必须由可信runner收集before/after正式快照、结果同sequence的CLI check结果、原始逐条commit结果、每次写请求及响应证据文件、真实UI审批/编辑声明事实、开始/结束时间。模型输出不能自报通过、用户点击或计时。首次提交通过指首次正式写请求通过校验（pending也算通过校验，不算已执行）；修正重试指因格式/语义失败而改载荷重提，网络丢包同编号重放单独记录，不当模型修正。任务完成必须全部自动断言与来源/语义审阅通过。

T2的12至18条计数针对发现，不把总标题和支持/反对分组说明强行算作额外发现。可信语义审阅可在review.taskFacts中声明taskId为T2，并逐项提供organizationCards的真实文字卡id及reason；必须核对每个排除理由，不能由模型自报。身份必须唯一且存在于after，不能排除文档、连线或别题卡。所有未明确排除的文字卡均作为发现计数并逐一检查到来源文档的箭头；没有声明时不排除任何卡。不依据标题字样、卡片编号或有无连线自动猜角色，因此没有来源线的发现不会被悄悄忽略。来源忠实、不重复和分组清晰仍需人工审阅；评测规则修正保留旧判定与原始模型结果，另记新评测实现版本，不修改固定任务或模型产出。

按provider+精确model版本+vision/no-vision分别统计，禁止跨组平均：首写校验通过率>=90%，任务完成率>=85%，每题修正重试平均<=0.3。每组必须覆盖13题且重复数一致；保留每次失败，不只留最好一次。产物至少包括run.json、report.json、完整工具响应/模型终态、审批前后截图、Canvas快照与check结果；图像组再存render locator/实际读取事实，T8保存来源。证据写到调用方输出目录，不进源码、不含凭据。

`run.ts summarize <目录> <新summary.json>` 递归接纳名为run.json的记录并重算每题断言。缺少任务/重复、重复身份、待人工结论及仅离线T8均不能冒充整组达标；汇总保留每次失败和证据位置。

正式组额外列出`nonNetworkTasks`：T8的offline或未声明联网模式只属于来源结构基线，即使其余12题使完成率达到85%，整组也不获得正式联网验收资格。原完成率与失败记录照常保留，不把离线资料伪装为模型真正访问官方页面。

每条记录必须标明sourceRevision（实际实现的完整Git SHA）与batchId。修复产品缺陷后另开整批，保留原批首败，不能用后来成功覆盖旧记录或把不同实现的成功题拼成一组。最终验收在冻结实现上跑完整13题；Backend启动及Skill发现证据随批保存。

`fixtureVersion=1`是证据格式版本，不是资料文案修订号。T2来源修订`research-observations-v2`将旧版重复的两类表述改为三份合成调研的独立观察：单人复核、多人交接、恢复与资源限制。每份含不同的支持与反对观察，可忠实提炼十二至十八条发现；样本编号或观察时长本身不算不同发现。原任务、数量和人工不重复标准保持不变。输入资料由完整sourceRevision以及setup保存的fixture/原文共同追溯；旧预检证据保留，不以新资料解释旧结果。来源支持和发现去重仍需人工语义审阅，不能以字符串不同或自动结构通过代替。

attempts的phase明确区分dry-run预检与write正式写入。首写指标只取第一个write；只有预检而没有正式写入不能算通过。预检没有request-id时如实记录null，正式write必须保留真实ID。两阶段因格式或语义失败而改载荷重提的真实修正都计入correctionRetries，预检成功、重复检查坐标和同请求网络重放本身不算修正。

看图组controls.imageReadSequence必须来自实际Agent render→attached image read的配对事实，并等于after.sequence；看过旧版本后继续改图，必须再看最终版本，旧图不能证明最终画布质量。无此事实时填null并保持未验收。

T13分开记录模型端到端耗时、Worker内布局P50、后端提交到包含变化帧的P95、相邻帧P95/最慢帧及平均fps。300新卡局部布局按<=500档要求Worker P50<=200ms；提交到画面P95<=300ms，上限档平均>=45fps/最慢帧<=50ms。9/17ms是Agent更新目标及回归基线，须另报，不能以50ms绝对门槛取代。不能用工具总耗时替代Worker耗时，也不能用共享CI或模型推理时长冒充固定真机性能。

T9需UI允许后检查；T12需UI拒绝后检查，CLI参数不能伪造批准。T11在模型操作期间为X正文登记并续订真实声明、保留草稿，终态后释放。审批和等待用户动作的时间单列，不计入Worker/帧指标。
