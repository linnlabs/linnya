# 决策原型插件

本插件提供独立的 `decision_agent`、`decision-exploration` Skill 和版本化决策记录 CLI。目标是让建议可以在用户条件变化后继续更新，而不把聊天历史当作唯一状态。当前版本 0.17.0，是开发原型，尚未进入默认发行插件清单。它需要相应 SDK/CLI 身份合同的源码 Host；manifest 的 App 版本下限不能解释为旧发行包已具备这些能力。

## 能力与边界

Agent 负责澄清、探索、调查和判断，Skill 提供方法与操作说明。程序保存项目内的版本化条件，计算已声明的四则式和数值约束；条件或显式观察的行动改变后，旧建议标记为待复核。`current` 仅表示输入和显式行动依据版本相符，不是质量认证。

完整 Deep Research 可作为受管子项调用。插件注册仅向自身决策角色开放的协调类型，复用正式研究定义、父提示与 Skill；协调子运行只可委派四种研究叶子。通用工作流引擎、专用编辑器和自动对外执行不属于当前实现。正式研究根入口和 deep-research Skill 不变。

## 修改地图

- `src/backend/agents/decision/`：独立角色和系统提示。
- `resources/skills/decision-exploration/`：方法入口与模型可读 CLI 格式。
- `src/shared/definitions/decisionRecord.ts`：数据合同和纯 JSON 四则表达式。
- `src/backend/features/decision-record/`：计算、更新规则和持久化。
- `src/backend/features/decision-research/`：研究委托、输入与观察版本、结果接纳与失效规则。
- `src/backend/features/decision-cli/`：参数解析与 App bridge adapter。

## 持久化与操作

`decision_record_versions` 由插件 migration 创建，采用同一 decision id 的追加版本，项目删除由外键级联。记录可跨会话接续；读写的 project id 来自 Host bridge 对正式 Conversation 归属的查询，CLI 不接受项目覆盖或数据库路径。对话不属于 Workspace 文件节点，不能用文件节点查询推断其项目。禁用/卸载遵循平台合同，插件数据保留，重新安装可继续使用。

修改必须提供 expected revision，事务内检查当前版再追加。输入更新保留旧建议及其输入版本；包括偏好在内的条件变化都会要求重新判断。表达式只引用本记录输入，未知/撤回/非数字和除零明确不可用，不执行生成代码。数值检查的模型、单位、完整性与事实真实性仍需判断。输入登记不代表它已参与计算：只有表达式实际引用的输入变化才会影响该项算值；新增费用或其他情形可能需要同步修改模型，不能把更新输入视为已覆盖新情形。

`linnya-decision create/list/read/update/recommend` 经现有 Shell → Plugin CLI bridge 调用。prepare 只解析参数；执行前由 bridge 校验 internal-data 与写权限。它只访问本插件数据表，复用已有命令生命周期，不新增 Agent 工具、审批或重试器。当前此 CLI 需要 internal-data 权限；不能把它的可用性解释成解决了整个平台的内部存储保护问题。

create/update/recommend 支持 `--input` 读取当前会话内的相对 JSON 文件，文件读取在权限校验后进行并核对真实路径归属。小载荷也可用 `--json`；现有通用 bridge 的单参数 4096 字符限制不变，不能将大型条件拆成多次版本更新当作默认用法。

决策记录与说明稿属于不同owner。Workspace Markdown是数据库文档；工具成功保存的修订可能仍待用户确认，不等于已接受正文。插件revision只保证本插件记录，不代表说明稿同步成功或用户已确认，交付须依文件工具的实际回执说明。

## 开发与验收

从仓库根运行 `pnpm --dir packages/plugins/decision run typecheck`、`test` 和 `build:backend`。源码 Desktop 的开发发现读取本包 `linnya.development.backendLoading=disk`，通过既有 direct-dir loader 装入构建产物；Skill 由平台从本包资源发现，requiredSkills 仅保证依赖存在，实际激活要检查轨迹。

后端变动需正常重启对应开发实例。插件启停后 Agent、CLI 与 Skill 应随注册能力收缩；卸载不删决策记录。进入正式分发前，还需按插件发布合同完成制品、默认发行配置和安装包验收；Renderer 入口仅在需要专用界面时添加。开发 direct-dir 加载不是已发布。

业务测试覆盖创建、条件更新与重算、建议失效、违反硬约束拒绝、历史与项目隔离、过期版本拒绝、持久重开、偏好更新和来源撤回。真实模型冒烟另验 Skill 实际读取、CLI 实际执行、最终建议与计算是否一致，不以测试通过证明模型判断正确。


## 版本绑定的研究子项

CLI `research prepare/read/list/receive` 在当前项目管理委托。prepare 以 expected revision 读取真实决策条件，保留 inputRevision、原会话/run 和显式 scope，观察正式材料版本；待接受修订的材料须先收口。普通 subagent 接纳自己的研究范围，不继承父业务 scope、历史或当前视图材料。

研究结果经 `@plugin/backend/childRunDelivery` 只读端口从原会话/run 的正式 subagent 参数与成功回执接回，按准备时的原始 prompt 精确关联；多次启动不自动选一个。端口由 EventStore、RunRegistry 与 Workspace/VFS owner 协作，插件只读写本插件两张表。CLI 的 agentRunId 来自已授权 Shell 的冻结 identity，不是 argv 或模型自报。

研究完成、两份评审齐备、文档存在、业务适用与正确性分别判断。缺评审/正式产物是 partial；条件或文档观察版变化是 needs_review；取消/暂停从生命周期事实投影。接回不修改 recommendation。版本指准备/接回时观察的 Markdown 保存版本与 current 投影 hash，不认证并发生产时的精确版本、事实或质量。当前只支持有正式版本的 Markdown 材料与产物；其他文档类型须由其 owner 提供版本观察能力后扩展，不能用更新时间冒充。

三层闭环业务回归位于 `packages/plugins/__tests__/decisionResearch.sqlite.integration.test.ts`，使用真实 SQLite、文件工具、TaskState、注册 child 与恢复，替换模型和 Shell transport；完整真实模型验收另记。没有另造研究工具、重试器或工作流引擎。公共 Host 不依赖本插件内部表或实现。


这里的有界委派限定调用角色、直接类型、叶子工具与既有单 run 步数，不代表已实现全树统一 token/费用预算。原生短题也可能产生很长评语；是否调用完整研究仍须按问题价值判断。早期接回记录若缺评审文档观察，会返回 unobservedDocuments 并标为 needs_review，不回填或伪造原观察版本。

## 建议中的程序数值依据

recommend 可选 numericBasis：calculationIds 指向既有计算，boundaries 的每项只有 checkId/inputId。程序使用同版模型生成 recommendationBasis（含数值、单位、固定的其他输入、可行关系与严格越界关系）；不接收第二份阈值。原始 rationale/changeConditions 仍是作者文字，与该数值投影分开，未被程序认证。

单变量边界只对仿射表达式求解（加减、乘常数、除非零常数）。变量乘变量、变量分母、其他输入未知或撤回时返回不可用及原因；抵消后无关则只报告该检查是否成立，不捏造阈值。目标输入为未知数值时可解条件边界，目标撤回或非数值时不可用。连续数值关系不自动推断整数、日期格式或其他现实取值域。单位和原始模型仍由作者声明。

建议当前时引用必须存在且相关；条件更新后保留旧内容，但 recommendationBasis 只给 needs_review 与旧输入版本，不用新模型解释旧引用。历史版本读取重建该历史版数值。qualitative/旧建议没有 numericBasis 时返回 null；这是 schemaVersion=1 的可选加法，不迁移或补造历史内容。未新增表、Host SDK、基础工具或工作流引擎。

业务回归 decisionNumericBasis.integration.test.ts 覆盖预算与出发边界、严格越界、原建议失效和SQLite重开、引用删除/拒绝、未知/撤回与不支持的模型。通过程序回归只证明数值投影合同，不证明 Agent 实际采用了它，更不证明来源、模型或全文建议正确。

## 只读情景试算

simulate接受当前expected revision与若干cases，只允许对已有输入id假设不同的value。每个情景都从同一版模型出发，重新计算全部选项的既有算式和检查，返回基准结果、实际依赖和unreferencedInputIds。未引用是依赖事实，偏好或范围外输入也可以合法不参与数值模型，不能由此直接判业务模型有错。

该操作不调用update/recommend、不增加版本、不改变事实、公式、来源状态或旧建议。假设值不恢复withdrawn输入；需要确认新事实或修正模型时仍须显式update。结果绑定basedOnRevision/inputRevision，不能冒充当前建议或来源认证。用文件传入JSON时沿既有conversationFiles=write的CLI bridge合同读取，未扩大Host权限枚举；实现只读文件并在内存求值。内联simulate声明不访问会话文件。

simulate不做一般求解、偏好推断或模型语义认证；条件性建议仅采用作者显式给出的顺序。业务回归见decisionScenarios.integration.test.ts，覆盖漏项显露与显式修正、共享条件/边界点、情景隔离、未知/撤回、版本/项目隔离和正式文件bridge；既有记录与建议必须逐字不变。


## 条件性建议与完整分支

recommend可选conditionalAdvice保存假设清单、作者明确的偏好顺序和无方案/未定时的行动。cases沿simulate的id/label/inputs，每项可含作者nextAction；只保存假设值，不改用户事实，不额外保存计算结果。read在同一输入版本重算全部选项的全部检查，返回当前及每个case的结果。旧字段rationale/changeConditions/nextAction/unresolved完整保留，不因程序分区删除解释或未知。

preference的inputIds必须引用kind=preference的已有输入；optionOrder列齐全部互斥候选一次，reason属于作者解释。程序不推断其符合用户原意。全部检查true为pass，任一false为fail；未知或没有检查为undetermined。所有状态确定时才按顺序选择首个pass；没有顺序返回selection_required，不把唯一数值通过等同总体最佳。存在未定返回needs_information；情景修改偏好依据返回preference_needs_review，不套旧顺序。所有候选fail返回no_option_passes及whenNonePass作者行动。

optionIds可在显式conditionalAdvice未选定方案时为空，表示暂不选择；无需为落库虚构选项。当前程序已按顺序选定时，保存的optionIds必须一致，推荐明确失败选项仍被拒绝。行动是建议，不自动联系、购买或执行；whenUndetermined与各case的nextAction均保留作者身份，程序不认证其内容。

recommendationBasis新增optionRanges：对每个选中的input求所有候选全部检查的单变量分区。lower/upper为null分别表示负/正无穷；Inclusive保留等号，rows中的options给出各选项检查状态。固定条件由fixedInputIds引用同一回执record.model.inputs，避免在每个范围重复整套来源文字；原始input名称/单位不另作展示改名；仿射限制同上，不推断整数、非负或跨日边界，不是一般符号求解器或模型语义校验。输入版本变化时整个旧conditionalAdvice与数值依据均只给needs_review，历史版仍重建原结果。

这是schemaVersion1可选加法，无新表/Host接口/基础工具。业务回归decisionConditionalAdvice.integration.test.ts覆盖跨会话项目读取、SQLite重开、7人无可行方案、费用/容量等号与上界、偏好改变、未知/撤回/无检查、顺序与保存选择冲突、历史重算、空选择和五个课程边界的保留。程序结果与自由说明矛盾仍是质量错误，不以current或完整分支作为正确性认证。

## 离散硬条件

checks除原数值left/operator/right外，支持operator=is、inputId、value（boolean或string）三字段的精确匹配。它用于已明确的书面确认、工作方式等条件；不解释自然语言，不做字符串/数字/布尔强转。已知false与未知null/withdrawn分开，类型错配返回不可用及原因。四则表达式仍只计算数字。

离散条件参与同一选项的全部检查、情景依赖和条件性建议；不相关的离散失败也会限制所有数值范围。离散变量自身没有仿射数值边界，返回不可用；不伪造0/1阈值。旧数值载荷和输出shape保留，检查左右值扩展为数字/布尔/文字。该功能不证明作者把用户条件登记正确。


## 保存版本的只读影响对比

compare <id> --from <revision> --to <revision>读取同项目同记录的两个明确版本，返回声明变化、前后结果差异、变更输入在两个模型的引用关系，以及原选择在目标模型下的检查状态。支持正向、反向或相同版本；不猜latest，不写数据、接纳旧建议或自动推荐。

changes分开列输入（含value/status/origin/kind/unit/label字段变化）、选项、计算声明、检查声明及题目变化；effects分别列计算/检查结果差异。dependencies仅表示引用，来源/名称变更不一定改变算值，不能把引用当作数值影响或现实因果。previousSelectionInTarget可为pass/fail/undetermined/removed，未知或撤回不冒充false；它不是新推荐。

对比沿用record repository的项目隔离与不可变历史，不读取全会话或另一份缓存。CLI准入只读、不访问会话文件、不联网，无新Host接口或基础工具。结果摘要保留来源版本和输入版本；要看完整作者说明，仍读取对应历史版。业务回归覆盖来源元数据不改算值、确认/撤回改变检查、模型/选项删除、两个比较方向及正式bridge拒绝跨项目/缺版本，比较前后行数与内容不变。


## 建议替换时的分析完整性

recommend仍是完整的新建议，不自动合并旧分析。若旧建议已含conditionalAdvice或numericBasis，新建议必须为该字段给出明确替换对象，或null表示明确停用；省略会在追加版本前以invalid_model拒绝并列出字段。首次没有分析的建议可省略；输入变化后的旧分析也不自动重新接纳。显式停用仍须满足当前选择的约束校验，空选择仍须有条件性建议与下一步。

原始null保存在记录中，历史保持原样，无schemaVersion迁移或新表。compare.analysisChanges显示两项分析前后是否启用、目标字段是omitted/disabled/provided、case新增/删除/修改，以及计算引用和边界引用的增减。它揭示删除，不认证作者对重建或停用的判断；提交了对象仍视为作者完整替换，不扩展为递归patch/merge引擎。

原0.7及更早的省略写入可已丢失当前分析，0.8不会从历史偷偷补回；需要显式查看历史、按当前事实重建。业务回归decisionAnalysisIntegrity.integration.test.ts覆盖拒绝后版本/内容不变、旧分析仍待复核、首次省略、显式null与历史保留及删除对比。

## 行动计划与结果回流

同一决策记录的可选actions保存有明确目的的计划、分段进度及一次最终结果。action plan接收label/purpose/inputIds/executor/estimatedCost，程序分配UUID和basedOnInputRevision；inputIds引用当前输入，可空表示探索新选项。计划只追加revision，不改变inputRevision或模型，不执行、联系、扣费或授予权限。executor是拟执行者，不证明动作已发生。

action resolve用于终结行动，明确action id和outcome（completed/cancelled）、summary、origin、actualCost，可带原有update载荷。结果及模型变化在同一版本保存；校验失败或revision冲突不追加任何部分。无update时结果本身也使inputRevision前进，旧建议needs_review，研究委托沿既有版本合同失效。结果保留计划所基于版本、接回前inputRevision和落库版本；迟到结果须对当前expected revision显式接纳，不自动恢复旧条件。已接结果的行动不能再次结算；更正现实事实仍显式更新条件并保留原报告历史。

origin和实际成本是提交者的报告，不是Host实测或认证。estimatedCost与actualCost分别保留，不自动从预算扣除、汇总不同单位或把客户款当收入。成本和预算的计算应明确登记到模型；未发生的试算不作为实际结果。无预先计划的新信息使用update，不补造已执行行动。recommend仍单独重新判断并遵守已有分析的显式替换合同。

read读取当前/历史actions；compare.actionChanges按id显示计划新增与结果变化，只读。schemaVersion1可选加法，不增加表、调度器、执行器或基础工具；业务实现与事务仍属decision-record。update另允许显式修改title/question，使当前问题变化可记录，历史保持原样，不自动根据数值改写标题。

业务回归decisionActionFeedback.integration.test.ts覆盖计划不执行、结果与条件原子保存、失败/重复/旧版本/跨项目拒绝、取消与无模型变化的结果、迟到接纳、SQLite重开、历史标题、compare只读、新选项及旧偏好失效、正式文件bridge。程序只保证关联与版本，实际建议和停止时机仍须独立评价。

## 错误行动报告的明确撤回

action withdraw以当前expected revision接收reason/origin及可选update。它仅为已有、未撤回的报告增加withdrawal，保存撤回来源与版本，不覆盖原summary、成本或历史。没有结果、重复撤回或再次resolve已接过结果的action均拒绝；新行动显式新建。撤回与显式模型修正在同一版原子保存，旧建议待复核。

read的actionStates从原始记录推导planned/reported_completed/reported_cancelled/report_withdrawn，reported不表示Host执行或核验；原文仍在record.actions。compare沿actionChanges揭示撤回。程序不自动检出错配，不据一份报告撤回就推断所有事实无效，不倒扣真实支出；相关输入须按真实更正显式update。schemaVersion1的新读取器可读旧记录；新增字段写入后不承诺旧版严格schema能读新版，回退插件前须评估数据兼容，不能把无需表迁移当作可无损降级。

业务回归另覆盖报告撤回后的状态/建议失效、旧版原报告保留、当前事实不自动回滚、同版显式撤回输入、无结果/重复/冲突/坏模型/跨项目拒绝及文件bridge；这不证明能自动纠正作者给错的来源或模型。


## 行动报告的输入出处

resolve/withdraw可选sourceQuote，通过Host的runInputQuote窄端口核对当前根运行原接纳的用户角色输入。仅空白等价的精确子串命中才写入conversation_input_quote，身份/hash由Host生成；引语失败不追加任何版本。无引语由实际CLI调用身份标为agent_report，不能靠origin自报认证。调用载荷不接受provenance或事件身份。read.actionStates分别显示reportSource/withdrawalSource，旧记录没有出处则为unbound，不回填。

原报告及撤回各保存自己的出处，撤回保留原报告。引语证明的是用户角色输入出现过原句，不证明由人手工输入、执行发生或摘要忠实；前端与外部CLI都可产生该角色输入。仅保存请求的短引语，不复制完整消息。引语随项目记录保存，删除原会话不自动清除该快照，项目删除按原外键生命周期清理。记录含新字段后旧严格读取器未必兼容，回退前须评估。

## 选项条件只读复核

check <id> --expected-revision <n> --json '{"optionIds":["a"]}'复核明确候选的同版全部声明检查。重复/不存在选项、过期版本和跨项目拒绝。任一失败返回blocked；未知、withdrawn或没有检查返回undetermined；全部已知通过为declared_checks_pass。复用条件性建议的全检查汇总，不另建规则引擎。

结果绑定revision/inputRevision，authorization固定not_evaluated。不写事实/建议/版本，不自动执行，不理解正文的隐含候选，不接管Shell或支付审批。通过仅说明声明条件成立，不认证模型完整、来源真实、偏好合理或现实可行。实际执行仍须具体执行owner接入现有权限审批；本轮没有新增执行能力。

业务回归decisionInputQuote.sqlite.integration.test.ts覆盖真实Host与插件链，decisionOptionCheck.integration.test.ts覆盖只读、全部检查、未知与无检查、等号、失败优先、版本/项目隔离和权限语义。


## 分段进度与活动计划复核（0.12）

progress接收显式planRevision及summary/origin/actualCost、可选sourceQuote/update，追加有程序id的progressReports，不生成result、不关闭行动。每条报告保存显式basedOnPlanRevision、接纳时receivedAgainstPlanRevision及前后输入版本，可多次接回；版本存在由程序校验，是否真正按该版行动仍是报告者陈述。成本是各次原文，不自动累加文字或重复扣款。resolve仍是一次completed/cancelled最终报告，分别用于完成范围/明确停止。已final的行动不再progress/review；撤回final不自动重开。

withdraw可选reportId指向本行动某条progress，省略仍指final。单条撤回保留原报告、成本、出处与独立withdrawal，其他报告不变；所有progress都撤回时显示progress_withdrawn，不冒充从未有过观察。报告及显式模型修正在同一版本提交，失败不半写。迟到的实际观察即使计划过期仍可接纳，不因此授权后续执行。

read.actionStates分开state与planStatus/continuation。无final且有有效进度为reported_in_progress；活动计划最后确认的inputRevision不同于当前，或引用缺失/withdrawn输入，planStatus=needs_review、continuation=review_required。这里采用决策级输入版本，原因是purpose可能依赖未声明在inputIds中的条件；不能从引用列表证明其他变化不影响行动。增计划/保存建议等不改输入版本的操作不使计划过期。每次观察后须明确复核，不自动给本行动续准。

review接收完整plan/reason/origin及可选sourceQuote，追加reviews，保存本版输入身份与出处；只增record revision，不改inputRevision、事实或旧报告。原plan是第1版，reviews逐次构成后续planRevision；progress的实际planRevision必须显式引用本行动已有历史版，接纳时最新版另存，避免迟到报告错绑。多阶段行动的resolve必须显式引用当前planRevision才能关闭当前范围；旧范围事实用progress接回。旧plain action的resolve仍可省略，但实际basedOnPlanRevision保持未观察，不用最新版补造。旧result缺此字段不补造。compare.actionStateChanges另列派生状态变化，包括原始action不变、仅输入变化导致的计划失效；actionChanges仍只比较保存声明。actionStates.plan是实际最新计划，record.actions.plan仍为原始计划，reviews保留各次完整版本。新计划/复核禁止引用withdrawn或缺失输入，未知null可作为调查对象。程序不理解purpose是否仍写错，current不等于批准或正确性认证。

终态planStatus/continuation为closed，不对历史已经完成的行动施加未来接续要求。业务回归decisionActionProgress.integration.test.ts覆盖多段进展、明确复核、定向撤回、输入版本、过期与坏模型的原子拒绝、取消/终结、SQLite重开、文件bridge；真实Host组合另验证progress/撤回/review的三份原输入出处。旧0.11失败原件不迁移改判，SchemaVersion1可选字段的新读取器兼容旧数据，旧版严格读取器回退另行评估。

## 建议的显式行动依据（0.13）

recommend可选actionBasis.actionIds，须为本记录内不重复、至少一项的行动id。程序从当前保存声明生成actionObservations指纹，载荷不接受自报指纹或观察身份。输入版本不同或任一已观察行动改变，recommendationStatus均为needs_review；只修改计划的review也会触发，新增无关行动不会。read、list、compare、recommendationBasis和conditionalAdvice共用projectRecommendationContext，避免分析与建议状态分裂。程序保留旧建议文字，不自动根据行动重写下一步。

read.recommendationContext分别返回inputStatus、actionBasis状态及相关行动当前投影；没有显式依据的旧建议显示not_observed，不回填。首次可省略，启用后须完整替换或显式null停用，沿既有分析替换合同；compare.analysisChanges揭示启停。输入未变且未观察行动的旧建议仍可为current，但不能理解为已检查行动文字。观察某行动不保证nextAction忠实描述它，也不证明计划current等于授权；可把仍待复核的行动作为“下一步先重规划”的依据。

schemaVersion1可选加法，无新表或新工具。decisionRecommendationActions.integration.test.ts覆盖计划复核导致建议失效、无关行动、持久重开、旧版未观察、明确停用、文件bridge、历史/比较只读及非法载荷原子拒绝。资金的单位、含义、订金处理和费用范围仍由作者建模；程序不把支出上限当现金余额，不自动计算收入或累计文字成本。

## 程序计算报告（0.14）

export <id> --expected-revision <n>从当前项目读取明确当前版，由decision-record的renderDecisionReport复用求值/投影生成确定的Markdown。报告包含输入及其声明出处、全部公式/算值/检查、当前建议选定的数值边界、当前行动投影和单独标识的作者建议原文。旧建议待复核时不按新输入重建旧边界；报告不会替作者修正错误建议或认证模型语义，作者文字按数据转义，不能冒充程序章节。

CLI adapter沿conversationFiles=write权限，使用标准库在Host给定会话目录内创建独占报告目录，直接写UTF-8原件并返回conversation locator、sha256、字节数和源版本。每次导出新文件，旧产物不覆盖；取消/写失败不交付成功回执，记录逐字不变。调用不接受输出路径、项目覆盖或第二份数值，不新增工具/SDK/表。实现地图为decision-record/functions/renderDecisionReport与decision-cli/adapters/writeDecisionReport，Core和Linnkit不持有报告业务。

报告是生成时快照，之后的输入/行动变化不回写旧文件；当前状态仍read后按需重新导出。会话文件不等于Workspace或长期跨会话档案，重要说明仍由普通文件工具保存并区分待确认修订；hash只校验原件字节，Shell仍可修改文件，不能宣称不可篡改或已核事实。完整条件情景和逐次历史仍通过read/compare读取。decisionReport.integration.test.ts覆盖实际CLI/SQLite/文件写入、字节hash与重复导出、未知/撤回/过期建议、行动失效、版本/项目隔离、取消和输出失败及作者文字边界。


## 边界点算值与交付附注（0.15）

recommendationBasis.boundaries每个可用边界附atBoundary：只把目标输入置于边界值，其他输入保持同版原值，重算所有显式引用该输入的已登记计算，保留id、名称、单位、依赖及不可用原因。固定输入由fixedInputIds指向同回执record.model.inputs；未登记的推导不由程序补造。未知目标可求边界时仅在该假设点赋值，撤回或无法求边界时atBoundary为null；旧建议待复核仍不在新模型上重建。该投影不保存情景、不改记录或输入版本，边界点算值不代表整个区间。export复用同一投影展示点值。

export成功回执的artifact.markdownLink直接使用本次实际locator；deliveryNote由程序生成记录id、revision、inputRevision及原件链接，供作者粘贴交付。文件字节/hash合同不变；链接指当前会话的固定快照，不因此成为跨会话地址或长期档案。程序附注不自动注入聊天，作者是否采用仍须另验。实现均属Decision插件，无Host/Linnkit或基础工具变化。


## 写前数值预览（0.16）

check沿原optionIds入参只读预览当前模型，不要求先写recommend草稿。完整回执（--full）的numericBasis列出全部已有计算及所选选项数值检查的数值／未知输入引用；不新增检查、门槛或偏好。numericPreview含输入版本、当前算值、边界与同点计算及固定inputs；当前无建议或旧建议needs_review也可取得，不保存或接纳建议。离散检查仍按原规则复核，不转成数值边界。

纯projectNumericBasis由check和recommendationBasis共同使用；boundary.text把边界和同点算值合成完整文字，changeConditions由numericBasis引用派生。作者content.changeConditions保留为补充条件原文，操作说明要求写定性变化；不覆盖历史作者文字或另存派生数值副本。预览不证明作者已读、遵循或没有在其他字段重复数字，实际写前取得须查工具交付与调用参数的时序。程序没有解析或认证自由文字。

该插件只能处理经自身CLI接纳的载荷，不读取最终聊天答复或write_file/edit_file的Workspace正文；任何CLI载荷核对都不能宣称覆盖交付全文。未新增Host/Linnkit接口或Agent工具。


## 情景字段数值检查与精简交付（0.17）

recommend追加版本前，对conditionalAdvice.cases逐个合并label和nextAction。仅对单位明确为“当天00:00起分钟”、相对基线变化的可用输入／已登记算值，若文字只出现该项基线值、没有本情景值，以scenario_text_mismatch拒绝（CLI exit 3），列情景id、输入或计算id、基线与本情景程序值；一次列出命中项，版本与建议不变。read／历史／export不再运行此检查，旧失败样本仍可读取。未知／撤回／不可用结果不生成伪值。

只比较已声明当天时刻的安全整数分钟值，同时认原分钟数和HH:MM；小数／指数整体略过，不截断。金额、人数、普通分钟耗时和缺单位的值均不硬拦；暂不依据文字猜数值对象。程序数值文字和报告的该单位值复用formatDecisionClock／formatDecisionQuantity显示时刻，不给非整数或跨日值猜HH:MM。数值字段和持久schema不变。

该规则不能区分同值的不同对象、否定句或真实的前后比较；同时出现两值便允许保存，没有相关数字也不强迫补写。它不是情景语义认证。只覆盖上述情景两字段，不检查rationale、changeConditions、顶层nextAction、行动plan/review、最终聊天或Workspace稿。

check默认由CLI投影为overall、options的状态及失败／未知check id、changeConditions、calculations文字数组和numericBasis；保留记录／输入版本、只读／非授权身份和notice。命令末尾--full交付完整结构，含numericPreview的数值对象、输入及optionRanges。--json与--input两路共用同一执行和输出投影，不增加求值、状态或基础工具。

业务回归decisionScenarioText.integration.test.ts通过真实CLI／SQLite核对拒绝不半写、一次修正、合法比较、数值词法、历史可读与两种check回执。程序拦住规则命中不证明作者能修正，运行后仍须核对最终情景、行动与聊天是否一致。
