# 版本化决策记录与计算

在 Shell 中调用 `linnya-decision`，它连接本次运行所在 App 和项目。记录由插件保存到数据库；普通文件工具保存的是面向用户的说明。两者用途不同。CLI 返回 JSON，失败要按错误信息修正后再继续。

## 命令

| 命令 | 用途 |
| --- | --- |
| `linnya-decision list` | 列出当前项目的记录 id、标题、revision 与建议状态 |
| `linnya-decision create --json '<model>'` | 建立条件与选项，返回 id 和 revision=1 |
| `linnya-decision read <id>` | 读取当前版、重算结果和建议状态 |
| `linnya-decision read <id> --revision 1` | 读取指定历史版本 |
| `linnya-decision delivery <id> --expected-revision <n>` | 生成当前建议的交付预览文件；不结束运行 |
| `linnya-decision export <id> --expected-revision <n>` | 导出该当前版的程序报告到会话文件，记录不变 |
| `linnya-decision compare <id> --from <revision> --to <revision>` | 对比两个保存版本的声明、结果及旧选择状态 |
| `linnya-decision update <id> --expected-revision <n> --json '<update>'` | 更新条件；生成新版，旧建议进入待复核 |
| `linnya-decision recommend <id> --expected-revision <n> --json '<recommendation>'` | 记录对当前条件重新判断后的建议 |

优先把 JSON 写到当前会话目录的相对文件，如 `decision-model.json`，用 `linnya-decision create --input decision-model.json` 提交。update/recommend 同样可将末尾 `--json '<...>'` 换成 `--input relative-file.json`。App 在权限通过后读取文件，路径须位于当前会话目录；它不是 `workspace:/` 文档。文件输入避免把完整模型塞进单个命令参数，也无需分拆成多个条件版本。

小修改可用 `--json`，它是一个完整参数，现有 bridge 单参数上限为 4096 字符，命令总长度仍受 Shell 上限约束。Shell 单引号内的文字若包含单引号，使用 Python 等方式正确构造 argv。长研究材料放 Workspace，记录只存影响决策的条件与定位。

## model 格式

必填 `title`、`question`、`inputs`、`options`、`calculations`、`checks`、`obligations`。没有适用的量化模型时，没有内容的列表用空数组，靠解释与调查进行比较。

- 每个 input：`id`、`label`、`kind`（`fact|preference|constraint|assumption`）、`value`（数字、文字、布尔值或 null）、`origin`、`status`（`available|withdrawn`）；`quantityType` 必填，`unit` 可选。origin 写明是用户给定、作者假设或材料定位，CLI 不会核实其真实性。
- 每个 option：`id`、`label`、`description`、`obligationIds`（本选项会产生的收付款责任 id；没有则填 `[]`）。
- 每个 calculation：`id`、`label`、`quantityType`、`unit`、`expression`。
- `quantityType`只取`day_clock`（当天00:00起分钟）、`duration`（时长）、`money`（金额）、`other`（其他）。文字/布尔填other；未知数值用null并填写预期类型。展示单位不决定量类型；新建和更新缺字段会被拒绝。
- 每个 check：`id`、`optionId`、`label`、`left`、`operator`（`lte|gte|eq`）、`right`。仅表达已声明的数值硬约束，不能代表所有现实可行性。
- 这些 id 用字母开头的英文标识，后接字母、数字、下划线或连字符。同类 id 唯一。

表达式支持 `{"input":"inputId"}`、`{"literal":10}`，或 `{"op":"add|subtract|multiply|divide","left":表达式,"right":表达式}`。只能引用 input，复合计算用嵌套表达式；由 Host 实际执行四则运算，不使用 eval。输入未知、非数值、被撤回或除零时结果为 unavailable，不当作零。

收付款责任在 `obligations` 登记，每份含 `id`、`label`、`direction`、`total` 总额表达式、`installments` 已列分期，以及 `final` 最后一期。每个已列分期填 `id/label/amount/at`，amount是固定的非负金额；final只填 `id/label/at`，最后一期金额由总额减已列分期计算。一次付清用空installments。未知总额引用值为null的输入；未知日期填null，或引用值为null的duration输入。

引用责任时同时登记 `funds`：所有节点之前的 `bank` 银行余额、`reserve` 隔离准备两个表达式、`unit` 和 `timeAnchor`。每期at表示距同一锚点的天数，引用输入须为duration，其他时间单位在表达式中换算成天。direction用outflow支付、inflow实际入账；release_reserve在明确时点解禁准备，pay_reserve实际支付对应准备并同时扣银行和准备。银行已包含的到账不再列一次流入。总额、分期及客户回款分别照已知事实登记，日期尚未确认就留未知。

程序给引用责任的选项自动生成逐节点资金检查，与作者的其他检查共同决定状态；同日先付后收，隔离准备不能动用。资金不足给出实际到账需求和最晚付款节点；缺日期或金额返回需要信息。check/read里的cashFlows为程序投影，不能直接写入。情景改变总额输入或时点输入，分期金额保持固定、尾款自动联动；重新约定分期须update责任。资金条件不通过时，simulate核对新条件，再把需要保留的假设写进conditionalAdvice。

下面是虚构的资料采购例，只展示格式：

```json
{
  "title":"资料采购",
  "question":"是否购买补充资料？",
  "inputs":[
    {"id":"bank","label":"银行余额","kind":"fact","value":200,"quantityType":"money","unit":"CNY","origin":"虚构用户给定","status":"available"},
    {"id":"reserve","label":"已隔离准备","kind":"fact","value":80,"quantityType":"money","unit":"CNY","origin":"虚构用户给定","status":"available"},
    {"id":"price","label":"合同总价","kind":"fact","value":150,"quantityType":"money","unit":"CNY","origin":"虚构报价","status":"available"},
    {"id":"due","label":"尾款日","kind":"fact","value":null,"quantityType":"duration","unit":"天","origin":"尚未确认","status":"available"}
  ],
  "options":[
    {"id":"buy","label":"购买","description":"购买资料后再分析","obligationIds":["purchase"]},
    {"id":"wait","label":"暂缓","description":"先使用公开资料","obligationIds":[]}
  ],
  "funds":{"bank":{"input":"bank"},"reserve":{"input":"reserve"},"unit":"CNY","timeAnchor":"下单日"},
  "obligations":[{"id":"purchase","label":"资料合同","direction":"outflow","total":{"input":"price"},"installments":[{"id":"first","label":"下单款","amount":40,"at":{"literal":0}}],"final":{"id":"rest","label":"交付尾款","at":{"input":"due"}}}],
  "calculations":[],
  "checks":[]
}
```

### 布尔与文字条件

已声明的确认、工作方式等硬条件用精确匹配检查，与数值检查一起参与全选项比较：

```json
{"id":"remote_required","optionId":"offer_a","label":"取得适用的全远程书面确认","operator":"is","inputId":"a_remote_confirmed","value":true}
```

is的value为boolean或string，对应input须有相同类型的已知值。已确认false会失败；null、withdrawn、类型错配均返回未定及原因，不当作false或0。文字精确匹配，不做别名、模糊理解或强转。离散条件参与simulate依赖，变量本身不生成连续数值边界。四则计算仍只处理数字；用户陈述与确认依据由作者正确登记，系统不判断承诺是否真的有效。

金额统一币种与时间范围后再计算，换算依据作为输入保留。表达式的单位由作者核对，系统只执行算式；它不能发现遗漏费用、错误模型或不完整的选项。

## update 格式

必填 `reason`，并至少给一项 `title`、`question`、`inputs`、`options`、`calculations`、`checks`、`obligations` 或 `funds`。inputs 按 id 合并，每项提供完整 input；其他数组整组替换，避免旧约束或算式残留。title/question仅在显式给出时替换，历史保留。撤回来源时，把相关 input 的 status 改为 withdrawn，保留其原 value 和 origin 作为历史。

```json
{"reason":"更新银行余额","inputs":[{"id":"bank","label":"银行余额","kind":"fact","value":100,"quantityType":"money","unit":"CNY","origin":"用户本轮明确更新","status":"available"}]}
```

更新回执会重算、列出检查结果，并将旧建议标为 needs_review。相同条件重复提交会被拒绝，不凭空增加版本。revision 冲突时先读取当前版，结合最新条件处理，不能直接把旧提交的数字改成新版号重试。

## recommendation 格式

必填 `optionIds`、`rationale`、`changeConditions`、`nextAction`、`unresolved`（文字数组）。不使用条件性建议时optionIds至少一项，可以包含互相配合的行动，文字解释适用关系；不是必须给所有选项打分。已明确违反声明的数值检查的选项不能作为当前推荐保存；未知检查不等于通过，须在 unresolved 和建议条件中说明。

```json
{"optionIds":["wait"],"rationale":"已知银行余额扣除准备不足以付清，尾款日期待确认；先使用公开资料","changeConditions":"资金或付款条件变化后重算","nextAction":"核对公开资料能否回答当前问题","unresolved":["补充资料是否真正提供新信息尚未确定"]}
```

有数值依据时，可增加 `numericBasis`，从下述check回执选择已有的calculationIds与boundaries。每条boundary只填checkId和inputId；没有手写计算或数值检查的模型可省略，自动资金条件仍会进入交付。

回执的 `recommendationBasis` 分开给出所选计算与数值边界，含等号与越界方向；`fixedInputs` 是其他条件固定在本版的值。每个boundary.text已合并该边界与同一点的相关算值，避免将基线与边界拼接；recommendationBasis.changeConditions由这些程序文字生成。每个可用边界的 `atBoundary` 把目标输入置于边界点，其余输入保持本版值，并给出所有引用该输入的已登记计算（含名称、单位与不可用原因）；`fixedInputIds` 指向同回执record.model.inputs里的固定输入。它仅表示该点，不是整个区间的固定算值，也不改事实或版本。交付可引用其中的 `text`，不需自己再反推一遍门槛。它只回答某个已有检查何时失效，是否改选还要结合偏好和其他条件。定性问题省略 numericBasis。

## 写建议和行动文字之前取得数值

建立或更新记录后，先运行 `linnya-decision check <id> --expected-revision <n> --json '{"optionIds":["本轮选项id"]}'`，收到成功回执后再写建议JSON、行动计划或复核计划的文字。check不需要建议草稿、不保存版本；即使还没有建议或旧建议已待复核，也会预览当前模型。

先读默认回执的changeConditions（边界与同点算值），再读calculations算值文字数组核对基线。numericBasis给出既有引用，按本轮需要选择后提交recommend。需要numericPreview、输入、完整检查或optionRanges时，在check命令最后加--full；不要把默认calculations文字当作result对象。已声明的当天时刻会同时给出分钟数和HH:MM，普通耗时保持原单位。预览不是现实事实变化或执行授权。

执行止损时点也沿这条路径：把实际出发、上车等时刻登记为day_clock输入（尚未发生用null），将相关耗时登记为duration，建立与到达截止的检查。check求该时刻的边界及同点到达值；建议的numericBasis只保存checkId/inputId引用，交付采用程序text中的时刻。现实安排变化后更新模型并重新取得边界。

把会改变选择的条件登记成conditionalAdvice.cases，变动输入后由程序重算。交付中的变化条件来自numericBasis、付款日期门槛和这些情景；changeConditions保存补充文字，留在完整原件。rationale和nextAction仍由作者判断，不受程序语义认证。未登记的门槛本次不会自动新增。

## 程序报告原件

执行 `linnya-decision export <id> --expected-revision <n>` 时，Shell使用`requires_write_access: true`，因为它会写当前会话文件。成功回执的artifact包含conversation locator、UTF-8字节sha256和bytes，以及源decision/revision/inputRevision。artifact.markdownLink是本次原件的可粘贴Markdown链接；deliveryNote是程序生成的记录id、revision、inputRevision和链接附注。用read_file读取该locator，交付时粘贴deliveryNote；原件由程序生成，无需再次抄数。每次导出新文件，旧文件保留，记录和建议均不变。

报告分开列登记输入（含来源说明/状态）、所有计算及公式、全部声明检查、当前建议所选程序边界、行动状态，以及未经语义认证的作者原文。输入名称和单位仍属声明；算式正确不证明模型或建议正确。旧建议待复核时，旧边界不在新输入上重建。导出不自动改写错误的作者原文。

这是生成时的固定快照，后来条件变化后用read查看当前状态，再重新导出。文件属于当前会话，会随会话生命周期处理；它不是Workspace文档，也没有自动成为长期跨会话档案。重要说明另用普通文件工具保存，并依回执说明是否有待用户确认修订。hash可核对原件字节，不是不可篡改或事实认证。

仿射式可解单变量关系，变量相乘/变量分母明确不可用；其他输入未知、撤回、除零时不猜阈值。关系在连续数值上成立，不自动推断整次数或格式化时间；时刻需要在 input.label 中保留基准。模型、单位、费用范围与自由解释仍需核对。输入更新后的旧建议只显示 needs_review，原数值在对应历史版本读取。

建议依据已保存行动时增加 `actionBasis: {"actionIds":["实际action的UUID"]}`。程序生成观察指纹，调用者只提供相关id。read.recommendationContext分开显示inputStatus和actionBasis；相关行动被review、接回报告或撤回后，旧建议needs_review，之后重新recommend。新增无关行动不会触发，程序不改写旧nextAction。

`recommendationStatus=current` 表示当前输入版本与显式行动观察相符；actionBasis=not_observed表示未观察行动，不代表行动已同步。旧建议不补造观察。它不是事实或建议正确性的认证。数据变化后系统只标记待复核，判断是否改选仍由 Agent 与用户完成。只有已声明的计算和检查会自动重算，Shell 脚本输出不会被系统隐式重新执行。


## 只读情景试算

`linnya-decision simulate <id> --expected-revision <n> --json '<scenarios>'` 可在临时输入上重算；也可用 `--input relative-file.json`。JSON格式如下，id与inputId对应已有模型：

```json
{"cases":[{"id":"higher_price","label":"报价提高的假设","inputs":[{"inputId":"price","value":210}]}]}
```

回执绑定当前revision，含baseline及各case的全部计算/检查。`changes`列出原值与假设值，`references`列出进入哪些算式/检查；`unreferencedInputIds`表示未进入数值模型。情景彼此独立，不把上一情景的值带到下一项。未知/撤回不当作零，来源状态不因假设值而恢复。

这些值没有发生：simulate不保存输入、不修改公式、不增加版本或更新建议。若费用变化应影响总额而改动未被公式引用，先对照原始条件判断模型是否漏项；修正模型用update，再对新revision试算。定性偏好未进入四则式本身合法。单个选项的检查失败后，还需看其他选项全部检查，试算结果不自动决定改选。

## 受管研究委托

当一个未知需要完整调查而非几次查找时，先用当前 decision revision 准备委托：

```bash
linnya-decision research prepare <decision-id> --expected-revision <n> --json '<scope>'
```

也可用 `--input relative-scope.json` 从当前会话文件读取同一 JSON。

scope 含 `question`、`reader`、`task_type`（`open`、`fixed` 或 `update`）和 `materials`（Workspace locator 数组），可含 `time_range`。fixed/update 必须声明材料。准备程序从当前决策读取条件快照与 inputRevision，观察材料的真实保存版本，返回 request id 和 prompt。

用普通 `subagent`，type 为 `decision_research`，把回执的 prompt 原样传入。该协调角色使用正式研究父提示与 Skill，调用自己的调查/评审叶子，父子沿用当前模型与思考档位。它不继承决策聊天历史，所需的限制、读者、问题与材料应在 scope 里明确。

完成后调用 `linnya-decision research receive <request-id>`。接纳程序读取原运行的已提交 subagent 事实，不接收自行粘贴的研究结果。`research read <request-id>` 查看委托与失效状态，`research list <decision-id>` 找回已有委托，避免重复启动。

`received` 表示结果已绑定原输入版本并观察了保存稿；还须阅读文章与两份原始评审，判断调查是否解决了真正的未知。没有正式产物或两份已完成评审会报告 `partial`。条件、原材料或已接回稿件变化会报告 `needs_review`；暂停沿原运行继续。取消保留已存文档，重新调查应显式新建委托。重复 receive 复用原接回事实，不自动重跑，也不覆盖新建议。

版本记录是准备/接回时观察到的版本，不能证明并发改动从未发生，也不认证来源或结论正确。读取其他会话已有研究可在同项目下查看已接回记录；尚未接回的运行事实须回原会话处理。


## 条件性建议（可选）

需要保留用户要求的假设情景，并在互斥候选间按已明确的偏好取舍时，在recommendation中增加conditionalAdvice。旧理由、改变条件、下一步与未知仍完整保存。假设清单可跨会话读取，read会重算；simulate仍是临时查看，不自动进入清单。

```json
{
  "preference":{"inputIds":["prefer_first"],"optionOrder":["first","second"],"reason":"用户明确的条件性偏好"},
  "cases":[{"id":"changed_price","label":"报价变动的假设","inputs":[{"inputId":"price","value":210}],"nextAction":"依据本情景失败的约束寻找替代安排"}],
  "whenNonePass":"核对失败约束，调整相应条件或寻找新方案",
  "whenUndetermined":"先补齐影响选择的信息，再重新比较"
}
```

这是字段格式示例，id必须对应当前模型。preference可省略；有偏好时inputIds指向kind=preference的输入，optionOrder须列齐全部互斥候选且不重复。程序不从文字猜顺序；组合行动或没有稳定顺序时保留定性判断。cases可省略，每项沿simulate格式，可附作者nextAction；whenNonePass和whenUndetermined必填。

回执conditionalAdvice把baseline、完整cases、全选项检查状态与outcome分开。检查全true为pass，任一false为fail，未知或无检查为undetermined；有未定则不自动选。状态全确定时，按显式顺序选首个pass（ranked_choice）；没有顺序为selection_required；全部失败为no_option_passes。情景改变偏好依据为preference_needs_review；补信息的行动仍由作者提出。

当前没有选定方案时，带conditionalAdvice可保存optionIds=[]和具体下一步；程序已有ranked_choice时保存选择须一致。不要为表示暂缓而虚构一个满足约束的选项。旧输入版本的分支只显示needs_review。假设不是新事实，程序结果也不认证模型、原文或行动。

recommendationBasis的optionRanges按所有已选边界输入交付全选项范围，不只看单个检查。fixedInputIds引用同一回执record.model.inputs中的固定条件，不依赖交付历史。输入名称和单位取原定义；null上下界表示无限，Inclusive表示等号是否包含。它保留原有数值边界，解释和行动仍须覆盖用户需要的分支。面向用户的说明与record都应能追溯，不能以附表替代纠正相互冲突的文字。


## 对比两个保存版本

```bash
linnya-decision compare <id> --from 2 --to 4
```

明确提供同一记录的两个revision；可正向、反向或相同版，只读，不增加版本。changes给出输入值/来源状态/口径/偏好等声明变化，以及选项、公式、检查的新增/移除/修改；effects给出前后计算与检查差异。dependencies是两个模型中的输入引用，不表示已发生数值变化或现实因果。旧选择在目标模型中的pass/fail/undetermined/removed仅用于复核，不是自动新建议。

条件变了，先update再read检查旧建议失效；用compare核对变化及受影响检查，完成判断后再recommend。对比不替作者接纳偏好或撤回，也不把未定条件当作已确认失败。原始解释可用read --revision读取。


## 完整替换与明确停用分析

recommend提交的是新的完整建议。已有conditionalAdvice、numericBasis或actionBasis时，为对应字段提交重新判断过的对象；确实停止使用则设为null，并在rationale解释原因。省略已有字段会报Existing analysis omitted，记录与revision不变。程序既不静默删除，也不自动复用可能过期的旧分析。首次未启用分析可以省略；对象内部仍按本次提交完整替换，按当前事实组织情景。

输入、保存与求值的路径不同：

| 内容 | 回执位置 |
| --- | --- |
| 保存的偏好、情景与作者行动原文 | record.recommendation.content.conditionalAdvice |
| 保存的计算/边界引用 | record.recommendation.content.numericBasis |
| 程序当前选择状态 | conditionalAdvice.baseline.outcome |
| 程序情景选择与逐案作者动作 | conditionalAdvice.cases[].outcome / authorNextAction |
| 分析启停与case/引用增减 | compare回执的analysisChanges |

whenNonePass/whenUndetermined原文在保存字段内；投影仅在相应outcome出现authorAction，不将整份输入字段复制到顶层。比较发现分析遗漏时，从相应历史版本读取原件，按当前事实明确重建；不能仅把旧revision改成当前版号。

## 行动计划与最终结果

`linnya-decision action plan <id> --expected-revision <n> --input plan.json`保存计划。小JSON可用--json。格式如下，inputIds指向本模型的输入；发现新选项时可为空数组：

```json
{"label":"核对一个尚未知的条件","purpose":"确定是否值得继续比较","inputIds":[],"executor":"user","estimatedCost":"预计5分钟、0CNY"}
```

回执record.actions最后一项含程序分配的id、basedOnInputRevision和plan。保存计划不执行或授权行动，不改变事实和inputRevision，预计费用未发生。

`linnya-decision action resolve <id> <action-id> --expected-revision <n> --input result.json`接回范围完成/明确停止的一次最终结果；部分进度见下节：

```json
{"outcome":"completed","summary":"用户已核对，暂无新增条件","origin":"用户本轮报告，原件未核","actualCost":"实际3分钟、0CNY"}
```

update有实际模型变化时才提供，沿上述update格式；新发现选项时完整提交options/checks/calculations及新inputs。没有模型变化则省略update，不能为了接回结果提交空inputs。取消行动使用outcome=cancelled并如实说明实际已耗成本与原因。结果本身也推进inputRevision、使旧建议needs_review，之后单独recommend。计划与结果的成本各保留原文，预算、累计支出和其他资金如何计算仍由作者在模型明确声明，CLI不隐式扣钱或把款项当收入。

当前/历史read在record.actions中返回结果；result有receivedAtRevision、receivedAgainstInputRevision、resultingInputRevision，区分计划依据和实际接纳版本。compare.actionChanges查看新增计划及结果。result记录提交者报告，不是Host证明真的联系或执行；executor不代替用户授权。只允许一份结果，重复resolve拒绝且不增版本。迟到结果须先读当前条件、用当前expected revision接回，不能覆盖最新事实。

无预先计划而新到的信息直接update，保留来源，不虚构一个已完成的行动。收到结果后，重新检查它改变哪些选项、哪些未知仍在，以及继续付出成本是否值得；新建议仍须显式替换已有分析或以null停用。

## 更正错误的行动结果报告

`linnya-decision action withdraw <id> <action-id> --expected-revision <n> --input withdrawal.json`用于明确撤回错配或不再可信的一份报告：

```json
{"reason":"这份结果对应的是另一项行动，原归属不成立","origin":"用户本轮明确更正"}
```

可加update显式修正受影响的模型输入，沿相同update格式。撤回不自动删除、修改或回滚模型事实和费用；真实发生的支出仍保留，错误转述的输入则按更正说明修改或标为withdrawn。查看原报告receivedAtRevision及历史模型，核对其当时带入的内容。

read的actionStates分开planned、reported_completed、reported_cancelled和report_withdrawn；完整报告及withdrawal在record.actions，旧版不变。撤回也推进inputRevision、使旧建议needs_review；随后重新判断并recommend。程序只记录提交者的更正，不认证执行或事实。已接过结果的同一action不能再次resolve；确有新行动再显式plan，不用重复提交抹掉原记录。


## 报告出处与只读条件复核

结果与更正来自本轮输入时，在resolve/withdraw JSON中加sourceQuote，摘取本轮原句（1–2000字符）。Host仅规范化空白作精确匹配；失败后按当前原话修正。provenance及事件身份由Host生成，载荷不接受自填。无sourceQuote时标为agent_report；origin仍是作者说明。历史缺少出处显示unbound。

conversation_input_quote只表示原句出现在本次接纳的用户角色输入；核对summary与原句的含义、人数、金额和行动对应关系仍由作者完成。它不证明真实执行或人工认证。撤回提供本轮更正原句，原报告及原出处保留。摘录随决策记录保存，不随原会话删除而自动消失。

在明确准备比较/执行的候选上，用linnya-decision check <id> --expected-revision <n> --json '{"optionIds":["a","b"]}'读取同版全部声明条件；也支持--input。返回blocked、undetermined或declared_checks_pass，并列具体检查。失败优先；未知/撤回/无检查不通过。它不改变记录，authorization始终not_evaluated。检查通过仍须判断真实条件、偏好及执行权限；不能把被预算拦下的备选写成可直接执行。


## 部分进度与计划重新确认

部分执行用action progress，不把整项计划结为完成：

```bash
linnya-decision action progress <decision-id> <action-id> --expected-revision <n> --input progress.json
```

progress.json必填planRevision、summary、origin、actualCost，可选sourceQuote、update，沿原格式；没有outcome。回执record.actions[].progressReports新增程序分配的id，basedOnPlanRevision指向你明确给出的实际依据计划版，receivedAgainstPlanRevision另记接纳时的最新版。迟到事实可引用同一行动历史版，程序核对版本存在，不把最新版冒充实际依据。各次actualCost分别写“本次”的真实成本，程序不把文字自动累加。收到进度也推进inputRevision，使旧建议与活动计划待复核；真实成本保留，未发生部分仍未完成。

更正某条部分报告时，在action withdraw载荷加reportId；省略reportId仍指最终result。撤回不抹掉原报告/原句、不自动撤销其他观察或扣回成本；相关错误输入显式update。所有进度撤回为progress_withdrawn，行动未因此完成。

读取actionStates时，看state、planStatus、continuation三个字段。reported_in_progress表示收到有效部分报告；needs_review/review_required表示原计划不能直接作为当前可接续计划。输入版本变化均需复核，原因是计划文字可能依赖inputIds以外的条件；增加计划或保存建议本身不导致失效。实际已发生的迟到反馈仍可接回。

重新确认用action review，提交完整的新计划：

```json
{"reason":"按当前条件重新核对行动范围和依据","origin":"作者复核或本轮用户输入","plan":{"label":"继续核对未知","purpose":"旧转述已撤回，按未知信息重新核对","inputIds":[],"executor":"user","estimatedCost":"预计5分钟、0元"}}
```

命令为linnya-decision action review <decision-id> <action-id> --expected-revision <n> --input review.json，可选sourceQuote。inputIds引用当前存在且未withdrawn的输入，未知null可保留；purpose和范围按实际条件重写。回执actionStates.plan为最新计划，planRevision增加、planStatus=current/continuation=open；原plan及各次reviews仍保留，新报告会绑定实际计划版。review不改用户事实/inputRevision，不恢复旧建议，不认证内容或执行权限。

有progress/reviews的行动，resolve载荷也须明确planRevision且等于当前计划版。旧范围完成不能关闭新范围，迟到事实先progress；历史plain action可省略，但实际依据保持未观察。全部当前范围确实结束后才resolve(completed)；决定放弃未完成部分用resolve(cancelled)并如实保留已花成本。最终报告存在后行动closed，撤回该报告也不自动重开，后续新行动另建。程序不理解自然语言范围是否实际完成，最终说明仍须忠于报告。

## 当前版本交付

保存当前建议后，调用 `decision_finish`，只传 `decisionId` 与 `expectedRevision`。它同时保存本版简明交付delivery.md和完整原件report.md，并直接结束本轮。答复先给选项名称、作者理由与下一步，再列程序算值和重算情景；检查、输入、付款表和自由补充条件在链接原件中。回执artifact指摘要、originalArtifact指完整原件，各有字节hash；deliveryNote链接完整原件。继续前先完成需要保存的说明或行动记录；这个工具不替你修改记录，也不执行下单等外部行动。版本过期或建议待复核时，先 read、重新判断并 recommend，再收口。

如需先查看交付内容，`linnya-decision delivery <id> --expected-revision <n>` 使用 Shell 的写权限生成会话文件，按回执 locator 读取。CLI 预览不结束运行；旧 export 仍是完整审计报告。
