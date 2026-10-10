# Linnya Agent Benchmark CLI

这是面向真实 Linnya Agent 的开发 Benchmark Runner。它不自建 Agent
runtime，也不读数据库：每次运行都启动独立的 `linnya` CLI 子进程，依次使用
`send / status --watch / respond / stop / result / messages / audit`
控制正在运行的 Linnya App。因此生成的会话走正式 History，前端能按报告里的
`conversation_id` 看到。

## 使用

先启动 Linnya 开发环境，并准备一个真实 workspace project ID：

```bash
pnpm benchmark:agent list --pretty

pnpm benchmark:agent run slides_consulting_reference_v1 \
  --project <workspace-project-id> \
  --input reference_image=/absolute/path/reference.png \
  --pretty
```

可选参数：

- `--model <id>`：覆盖 App 默认模型路由；不传时使用正常默认路由。
- `--reasoning <level>`：覆盖 case 默认 reasoning。
- `--output <dir>`：覆盖默认报告根目录。
- 多输入 case 可重复使用 `--input key=value`。

图片不作为 CLI
attachment 发送。Runner 只校验它是可读的绝对文件路径，再将路径插入 case
prompt；文件读取、权限和失败语义都由真实 Agent/Host 链路负责。

### Harness 审计的运行门槛

做 token、工具失败和耗时比较时，先在开发 Host 启动环境设置
`LINNYA_AUDIT_LEVEL=response` 并重启；默认是
`off`。先完成一个小型校准运行，确认 facts 的 audit 可用、工具 decision/output 配对和 usage 完整度符合本批实验口径，再开始正式批次。只有排查流式协议时才用有容量上限的
`stream`。审计开关与既有出口见
[Audit owner](../../src/domains/audit/README.md)；Runner 消费已有 audit，不能新建另一套 recorder。

`capability_unavailable`
不足以区分开关关闭与运行版本缺少入口，需结合 Host 版本和启动配置核实；不能据此宣称产品没有审计能力。事后开启不会补回当时未采集的数据。缺失、估算和实际 usage 必须分栏；缺失运行保留为资产，但不进入 token 成本比较。

合并历史批次时，facts 按 `run_id` 去重，消息先限定对应 run，再按稳定
`message_id`
去重；会话全量导出、同一运行的归档副本和 retry 不能重复当成独立样本。发现同一 identity 的事实版本不同，应保留差异并选定明确时点，不能静默覆盖。

### 深入研究 Skill

`deep_research_article_v1` 使用 Default Agent 按需加载内置 `deep-research`，以
`--input brief=<绝对任务文件路径>`
传入研究问题、目标读者、文体、时间范围、篇幅、材料范围与是否允许联网。正式运行须绑定项目，记录输入与 Skill 版本/hash；不把评审答案放进 brief。

Case 复用现有 Runner，不复制 Skill 的研究步骤，也不恢复旧 Deep Research
beta。交付是 Workspace 文章与独立研究记录；从真实工具调用核对激活、资源读取、检索、计算、写入与回读。固定材料任务与开放检索任务的结果分别解释，材料越界不能作为写作收益。

成稿是项目内的 Markdown 文档，聊天只作摘要和文件导航。普通独立复核可在同项目新会话中指定正文、研究记录、允许材料和评价标准，并另存评审 Markdown；不要把聊天终答当成文章提取入口。新会话并不自动阻止读取同项目其他文件，也不等于盲评。正式比较仍需冻结实际读取版本、匿名输入和校准合同。历史运行的原始导出继续保留作审计，不为简化日常复核删除证据。

内置 `deep_research_article_v1`
的 12 分钟是该 case 的有限预算合同，不是深度研究质量上限。需要观察自然完成的研究时，另行冻结任务、Skill
hash、模型与材料范围，用正式 Conversation
CLI 记录 send/status/result/messages/audit，不复用会自动取消的短预算 case。CLI
watch 的观察超时不会停止后端；自然完成验证仍应记录平台步数限制、暂停、取消和恢复。固定材料回归与开放研究分别报告；没有新旧版本对照就不能把通过样本说成新版净收益。只读取外显工具行为和工作记录，不将模型隐藏推理或运行时长当作研究质量指标。

这是接入与行为验收入口，不是自动质量评分器。事实、解释和读者理解须分别复核；独立 LLM 可以辅助定位，但其 pass 和缺陷仍需核对依据。输入不足、未核查、取消与实际 usage 缺失均显式保留。与无 Skill 基线比较时另冻同等材料、模型、预算和评审规则，不将一次冒烟称为有效性证明。

### 自然完成的研究交接原型

`research-workflow --manifest <文件> --output <目录>`
按冻结 manifest 执行版本 1 的 D0 调查、R0 初评、D1 一次修订、R1 终评，或版本 2 的调查、写前复核、补查成稿、两个并行后审、一次修订；支持各版本有序子集。它重用真实 CLI，不复用 case 的取消预算；同一输出目录保留运行身份，不因观察超时重新发送。材料通过正式 Workspace 当前投影交接，取得失败、截断、版本变化和语义未评价分别记录。输入字段、显式恢复、scope 限制和输出布局见
[Research Workflow owner](./src/features/research-workflow/README.md)。

### 受控研究 Agent 工程入口

`research_v1` 是前端“研究”与 CLI 共用的主研究 Agent 入口；Default 与正式 Skill
1.4 不变。主 Agent 持续调查并亲自提交调查记录、初稿和一次修订；通过统一
`subagent`
委派有边界的专项调查、可选写前复核，以及两份必需的独立后审。正式提交分别保存为 Workspace
Markdown；当前委派串行执行。接纳、产物绑定、取消和恢复合同见
[Research owner](../../src/app-hosts/linnya/application/research/README.md)。根模型负责调查判断、成文、进度和委派，Host 复用通用运行、子任务与文件工具，不自动启动后继，也不认证研究交接完整性。各 child 继承所选模型；根模型和子模型的实际调用都计成本，按真实 run 树去重，不能把父汇总和子调用重复累加。旧固定 Host 入口和研究专用交接已撤回；旧研究配置的暂停任务不能静默换用新合同恢复。

工程夹具验证流程与版本，不计为质量样本。现有 `research-workflow`
仍用于独立比较与实验终评，不是第二个产品执行路径。真实研究验证先冻结输入、实际方法送达和允许机会，保留原评审/更正，分别报告相对改善、末稿问题与协调成本。旧会话/运行不得暗中换成新角色续跑；不可用的旧研究身份须显式重新选择“研究”。

### 复杂图表与数据完整性

`slides_arg_frontier_complex_v1`
要求 20 页学术综述、可核验的近期文献与七类数据任务；
`slides_data_integrity_stress_v1`
使用同一输入制作 8 页技术汇报，排除联网检索变量，额外核验累计分母、流量守恒和跨页数字一致性。输入使用
`fixtures/arg-surveillance-synthetic-v1.json` 的绝对路径，以
`--input dataset=...`
传入。数据完全虚构，不是监测结果或生物实验输入。数据构造与人工复算口径见
[fixture 说明](./fixtures/README.md)。

两个 case 均采用人工确认策略；大纲等待不会被自动视为生成成功。Runner 遇到
`awaiting_user` 会保存 `requires_user`
报告并结束。审阅者可依据报告中的 identity，通过 `linnya respond`
批准具体大纲，再继续观察同一个 run；必须另行记录批准、修改和续跑终态，不能用重新执行 case 冒充续跑，也不能覆盖首次报告来隐去干预。人工续跑时仍需遵守原 case 总时间预算，并在超时后停止精确 run。

## 注册一个 Case

一个 case 是 `src/cases/`
下的自包含 TypeScript 声明文件，只定义：稳定 ID 与 revision、Agent/超时、prompt 模板、必需输入、`awaiting_user`
策略、产物期望和人工审阅维度。超时属于 case 的运行预算：简单任务应保持较短，包含资料研究、完整制稿、渲染检查与自修复的复杂 Slides
case 可以按小时配置，避免把已交付产物但仍在质检的运行误判为失败。

新增流程只有两步：

1. 在 `src/cases/` 新建定义文件。
2. 在 `src/cases/index.ts` 的 `builtinBenchmarkCases` 注册一行。

case 禁止启动进程、访问数据库、实现评分器或复制执行流程。重复 ID、重复输入、未使用的 prompt 输入会在 registry 创建时明确失败。Runner 的执行编排只存在于
`orchestration/runBenchmarkCase.ts`。

## 运行语义

一次 `run` 会：

1. 在任何 Agent 副作用前校验 case 与文件输入。
2. 调用真实 `linnya send`，记录 conversation/run/execution identity。
3. 用 `status --watch` 等待状态变化；只按 case 声明处理 `awaiting_user`。遇到
   `paused` 且 `pause.settled=true` 时，以 `requires_recovery`
   结束本轮观察；尚未收口的暂停继续等待，不自行批准、恢复或取消。
   `command_approvals` 中出现 `awaiting_reply` 时保存
   `requires_command_approval`
   并结束观察；即使 case 允许普通 HITL 自动批准，也绝不自动批准 Shell。
4. 达到 case 超时时终止 exact root run，并等待真实 terminal settlement。
5. 仅对 completed/failed/cancelled 收集 final
   result；所有已接纳运行均收集消息数量摘要和 `audit` 安全执行摘要。
6. 原子写入 `facts.json` 与 `report.md`。

Runner 被手动关闭不会杀掉 App 所拥有的 run；可用报告/终端中的 ID 执行
`pnpm linnya:cli stop <conversation-id> --run <run-id>`。Runner 自己判定超时时则会自动调用 stop，避免遗留后台任务。

`requires_command_approval` 同样不是终态。报告保留实际 child/root
run、工具调用和请求身份；通过
`linnya approvals <conversation-id> --run <root-run-id>` 核查命令，再用
`approval-reply --run <pending-agent-run-id> --request <id> --choice <choice>`
显式回复。不要调用
`respond --approve`、重新执行 case 或把等待时间当成命令执行时间。手工继续观察原 run 时独立记录干预、原预算与最终结算。研究 workflow 的同目录重启则自动复查原身份，见其 owner。

`requires_recovery` 不是成功、失败或取消终态，也不是 `requires_user`
大纲确认。Runner 保存暂停事实后退出（CLI exit code
3），不会重新启动立即返回的 watch 形成观察风暴。审阅者应依据 exact
conversation/run
identity 检查暂停原因和恢复条件，再显式恢复或停止；续跑的干预与时间预算必须独立记录，不能覆盖本轮事实报告。

## 报告

默认目录：

```text
_dev_data/benchmark-results/<case-id>/<timestamp>-r<revision>-<run-id>/
  facts.json
  report.md
```

`facts.json` 保存身份、配置、状态轨迹、wait_user 回应、终态、消息数量、错误和
`linnya audit` 的安全聚合。`audit` 的 Telemetry 部分固定标记为
`best_effort`；actual、estimate、missing usage 分开统计，不用 0 补缺失。

`workspace_documents`
单列成功写入中返回的文档诊断，只包含严重度计数、调用身份与截断总数。分严重度计数是已见下界；累计观测不是当前未修复问题数。保存成功不代表编译或视觉通过；诊断 code/message/target 不满足安全文本合同，均不进入审计导出。

`report.md`
把机器事实和人工审阅分开。自动部分包含管理层摘要、测试身份、阶段墙钟、连续状态轨迹、审计来源完整度、父子 Run、模型与 token/cache 口径、工具 decision/output 配对完整度、Shell 命令终态、全部工具明细、自动 context
compaction 明细、每个 Run 的步数占用与终止原因、分层错误和 Conversation 消息投影。压缩报告按 run 分开展示全部观测、真实 Provider
attempt、完成提交和附带 Provider actual
usage 的实际调用，并展示护栏、触发水位、前后 token、真实请求成本、耗时、cache
read 与失败结果。明细用 `generation_attempted`
区分真实请求与发送前结算；发送 Provider 前失败的结果仍属于观测，但不会计入 attempt 或 usage 缺失。`compactionIndex`
表示下一次 Provider attempt 的序号槽位，只有 `generation_attempted=true`
才真正消耗该槽位。报告不会把累计 LLM/工具耗时与墙钟机械相加，也不会把 cache
token 占比冒充请求命中率。Canonical `input_tokens`
只表示非缓存输入；报告中的 Provider 总输入统一按
`input_tokens + cache_read + cache_write` 计算，cache
token 占比也使用这份总输入作分母。人工部分预留产物硬事实、逐页复核、质量维度和问题分级。视觉质量、内容质量和预览/导出一致性必须由人填写，不输出自动总分，也不会自动把一次结果提升为 baseline。

## 测试

```bash
pnpm typecheck:linnya-benchmark
pnpm test:linnya-benchmark
pnpm benchmark:agent list
```

测试分层：

- registry 测试：查询、排序、重复 ID 和声明合同。
- 输入测试：CLI 参数、必需输入、绝对文件路径和 prompt 插值。
- orchestration 集成测试：fake CLI
  port 穿过完整 send/watch/respond/timeout/stop/result/audit 编排，不调用模型。
- 报告集成测试：真实临时文件，验证 facts 与待人工审阅报告同时写出。
- CLI 子进程测试：真实启动 Benchmark CLI，验证 `list` 与副作用前失败。
- 真实模型 Benchmark 不进入普通测试门禁，必须由开发者显式执行，避免产生费用和污染日常测试数据。

当前架构、运行语义与后续 baseline 约束以本文和相邻实现测试为准；新的重大设计通过公开 issue
/ PR 讨论后写回本文。

### 网页深搜资料对照

`web_search_materials_v1`
的 brief 冻结选题、普通/深搜模式和来源范围。两组使用同一模型、Skill、资料清单格式和 12 分钟预算；每题两组各两次独立项目/会话，交叉执行顺序。父工具深浅搜索共用网页列表合同；深搜子 Agent 只提交引用与短注释，不重抄长摘录。

先校准 response 审计与实际子运行模型。评审核对相关性、原文支持、解释覆盖、反方/区分性材料、同源重复、未取得比例和完成率；保留原评审与纠错，不生成单一质量总分。模型评审应由独立 Default 会话读取匿名资料，不能继承生成上下文。token 缺失单列，主/子 run 按 run_id 去重，不再叠加父 run 的树累计。网络等待另列，工具耗时不直接当网络等待。

新版研究的写作归属验收应分别统计父稿提交与子 Agent 复核：父 Agent 持续调查、初稿和修订，子 Agent 仅专项调查与独立复核。不再用“六个 child 齐全”判断闭环；交付需从实际文件读写结果、子任务轨迹与最终文章检查，不能从普通终答推断双评审齐备、版本未变或全文正确。旧运行仍按其冻结合同审计，不能混算为本版质量或成本样本。
