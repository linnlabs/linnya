# 决策原型插件

本插件提供独立的 `decision_agent`、`decision-exploration` Skill 和版本化决策记录 CLI。目标是让建议可以在用户条件变化后继续更新，而不把聊天历史当作唯一状态。当前版本 0.3.0，是开发原型，尚未进入默认发行插件清单。它需要本轮新增 SDK/CLI 身份合同的源码 Host；manifest 的 App 版本下限不能解释为旧发行包已具备这些能力。

## 能力与边界

Agent 负责澄清、探索、调查和判断，Skill 提供方法与操作说明。程序保存项目内的版本化条件，计算已声明的四则式和数值约束；条件更新后旧建议标记为待复核。`current` 仅表示建议关联当前输入，不是质量认证。

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
