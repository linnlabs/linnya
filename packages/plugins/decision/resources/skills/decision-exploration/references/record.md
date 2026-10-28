# 版本化决策记录与计算

在 Shell 中调用 `linnya-decision`，它连接本次运行所在 App 和项目。记录由插件保存到数据库；普通文件工具保存的是面向用户的说明。两者用途不同。CLI 返回 JSON，失败要按错误信息修正后再继续。


## 按本轮操作读取

| 本轮要做的事 | 操作资源 |
| --- | --- |
| 建立/更新条件、写前check、保存建议、导出原件 | 本页 |
| 临时情景、持久条件性建议、版本对比 | [情景与版本](./scenarios.md) |
| 计划、部分进度、计划复核、结果及撤回 | [行动与反馈](./actions.md) |
| 委托完整研究、接回结果及失效判断 | [研究委托](./research.md) |

先处理本轮需要的操作；相应字段需要上述能力时，再读取对应资源。

## 命令

| 命令 | 用途 |
| --- | --- |
| `linnya-decision list` | 列出当前项目的记录 id、标题、revision 与建议状态 |
| `linnya-decision create --json '<model>'` | 建立条件与选项，返回 id 和 revision=1 |
| `linnya-decision read <id>` | 读取当前版、重算结果和建议状态 |
| `linnya-decision read <id> --revision 1` | 读取指定历史版本 |
| `linnya-decision export <id> --expected-revision <n>` | 导出该当前版的程序报告到会话文件，记录不变 |
| `linnya-decision compare <id> --from <revision> --to <revision>` | 对比两个保存版本的声明、结果及旧选择状态 |
| `linnya-decision update <id> --expected-revision <n> --json '<update>'` | 更新条件；生成新版，旧建议进入待复核 |
| `linnya-decision recommend <id> --expected-revision <n> --json '<recommendation>'` | 记录对当前条件重新判断后的建议 |

优先把 JSON 写到当前会话目录的相对文件，如 `decision-model.json`，用 `linnya-decision create --input decision-model.json` 提交。update/recommend 同样可将末尾 `--json '<...>'` 换成 `--input relative-file.json`。App 在权限通过后读取文件，路径须位于当前会话目录；它不是 `workspace:/` 文档。文件输入避免把完整模型塞进单个命令参数，也无需分拆成多个条件版本。

小修改可用 `--json`，它是一个完整参数，现有 bridge 单参数上限为 4096 字符，命令总长度仍受 Shell 上限约束。Shell 单引号内的文字若包含单引号，使用 Python 等方式正确构造 argv。长研究材料放 Workspace，记录只存影响决策的条件与定位。

## model 格式

必填 `title`、`question`、`inputs`、`options`、`calculations`、`checks`。没有适用的量化模型时，后两项用空数组，靠解释与调查进行比较。

- 每个 input：`id`、`label`、`kind`（`fact|preference|constraint|assumption`）、`value`（数字、文字、布尔值或 null）、`origin`、`status`（`available|withdrawn`）；`unit` 可选。origin 写明是用户给定、作者假设或材料定位，CLI 不会核实其真实性。
- 每个 option：`id`、`label`、`description`。
- 每个 calculation：`id`、`label`、`unit`、`expression`。
- 每个 check：`id`、`optionId`、`label`、`left`、`operator`（`lte|gte|eq`）、`right`。仅表达已声明的数值硬约束，不能代表所有现实可行性。
- 这些 id 用字母开头的英文标识，后接字母、数字、下划线或连字符。同类 id 唯一。

表达式支持 `{"input":"inputId"}`、`{"literal":10}`，或 `{"op":"add|subtract|multiply|divide","left":表达式,"right":表达式}`。只能引用 input，复合计算用嵌套表达式；由 Host 实际执行四则运算，不使用 eval。输入未知、非数值、被撤回或除零时结果为 unavailable，不当作零。

下面是虚构的资料采购例，只展示格式，不是推荐的决策模板或真实报价：

```json
{
  "title":"资料采购",
  "question":"是否购买补充资料？",
  "inputs":[
    {"id":"budget","label":"预算","kind":"constraint","value":200,"unit":"CNY/次","origin":"虚构用户给定","status":"available"},
    {"id":"price","label":"购买价格","kind":"fact","value":150,"unit":"CNY/次","origin":"虚构报价，未核验","status":"available"}
  ],
  "options":[
    {"id":"buy","label":"购买","description":"购买资料后再分析"},
    {"id":"wait","label":"暂缓","description":"先使用已取得的公开资料"}
  ],
  "calculations":[{"id":"remaining","label":"购买后余额","unit":"CNY/次","expression":{"op":"subtract","left":{"input":"budget"},"right":{"input":"price"}}}],
  "checks":[{"id":"affordable","optionId":"buy","label":"购买不超过预算","left":{"input":"price"},"operator":"lte","right":{"input":"budget"}}]
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

必填 `reason`，并至少给一项 `title`、`question`、`inputs`、`options`、`calculations` 或 `checks`。inputs 按 id 合并，每项提供完整 input；其他数组整组替换，避免旧约束或算式残留。title/question仅在显式给出时替换，历史保留。撤回来源时，把相关 input 的 status 改为 withdrawn，保留其原 value 和 origin 作为历史。

```json
{"reason":"用户降低预算","inputs":[{"id":"budget","label":"预算","kind":"constraint","value":100,"unit":"CNY/次","origin":"用户本轮明确更新","status":"available"}]}
```

更新回执会重算、列出检查结果，并将旧建议标为 needs_review。相同条件重复提交会被拒绝，不凭空增加版本。revision 冲突时先读取当前版，结合最新条件处理，不能直接把旧提交的数字改成新版号重试。

## recommendation 格式

必填 `optionIds`、`rationale`、`changeConditions`、`nextAction`、`unresolved`（文字数组）。不使用条件性建议时optionIds至少一项，可以包含互相配合的行动，文字解释适用关系；不是必须给所有选项打分。已明确违反声明的数值检查的选项不能作为当前推荐保存；未知检查不等于通过，须在 unresolved 和建议条件中说明。

```json
{"optionIds":["wait"],"rationale":"预算降低后，报价超过硬约束；先使用公开资料","changeConditions":"预算提高或价格下降后重新比较资料的增量价值","nextAction":"核对公开资料能否回答当前问题","unresolved":["补充资料是否真正提供新信息尚未确定"]}
```

有数值依据时，可增加 `numericBasis`，只选择本模型已有的计算和数值检查：

```json
{"optionIds":["buy"],"rationale":"在预算内取得补充资料","changeConditions":"预算或资料价值改变后重新比较","nextAction":"确认资料内容","unresolved":["是否提供新增信息"],"numericBasis":{"calculationIds":["remaining"],"boundaries":[{"checkId":"affordable","inputId":"price"}]}}
```

回执的 `recommendationBasis` 分开给出程序计算的余额与价格边界，含等号与越界方向；`fixedInputs` 是其他条件固定在本版的值。每个boundary.text已合并该边界与同一点的相关算值，避免将基线与边界拼接；recommendationBasis.changeConditions由这些程序文字生成。每个可用边界的 `atBoundary` 把目标输入置于边界点，其余输入保持本版值，并给出所有引用该输入的已登记计算（含名称、单位与不可用原因）；`fixedInputIds` 指向同回执record.model.inputs里的固定输入。它仅表示该点，不是整个区间的固定算值，也不改事实或版本。交付可引用其中的 `text`，不需自己再反推一遍门槛。它只回答某个已有检查何时失效，是否改选还要结合偏好和其他条件。定性问题省略 numericBasis。

## 写建议和行动文字之前取得数值

建立或更新记录后，先运行 `linnya-decision check <id> --expected-revision <n> --json '{"optionIds":["本轮选项id"]}'`，收到成功回执后再写建议JSON、行动计划或复核计划的文字。check不需要建议草稿、不保存版本；即使还没有建议或旧建议已待复核，也会预览当前模型。

先读默认回执的changeConditions（边界与同点算值），再读calculations算值文字数组核对基线。numericBasis给出既有引用，按本轮需要选择后提交recommend。需要numericPreview、输入、完整检查或optionRanges时，在check命令最后加--full；不要把默认calculations文字当作result对象。已声明的当天时刻会同时给出分钟数和HH:MM，普通耗时保持原单位。预览不是现实事实变化或执行授权。

建议的changeConditions填写偏好、许可、证据等补充定性变化；已登记数值条件由numericBasis生成recommendationBasis.changeConditions，交付使用这份程序文字。rationale和nextAction仍由作者判断，不受程序语义认证。未登记的门槛本次不会自动新增。

recommend在保存前只核对每个conditionalAdvice.cases的label与nextAction：仅明确单位“当天00:00起分钟”的变动输入或算值，若仍写基线数而未写情景数，将以decision.scenario_text_mismatch拒绝，列出情景id和两组值。按该情景重算并改正后再提交；旧建议和版本不会半保存。匹配限该时刻的普通整数分钟值和HH:MM；小数和指数整体略过，同时写前后值可作比较。金额、人数、普通耗时等暂不拦截。该检查不覆盖其他建议字段、行动、最终答复或说明稿，也不认证数字含义。

## 程序报告原件

执行 `linnya-decision export <id> --expected-revision <n>` 时，Shell使用`requires_write_access: true`，因为它会写当前会话文件。成功回执的artifact包含conversation locator、UTF-8字节sha256和bytes，以及源decision/revision/inputRevision。artifact.markdownLink是本次原件的可粘贴Markdown链接；deliveryNote是程序生成的记录id、revision、inputRevision和链接附注。用read_file读取该locator，交付时粘贴deliveryNote；原件由程序生成，无需再次抄数。每次导出新文件，旧文件保留，记录和建议均不变。

报告分开列登记输入（含来源说明/状态）、所有计算及公式、全部声明检查、当前建议所选程序边界、行动状态，以及未经语义认证的作者原文。输入名称和单位仍属声明；算式正确不证明模型或建议正确。旧建议待复核时，旧边界不在新输入上重建。导出不自动改写错误的作者原文。

这是生成时的固定快照，后来条件变化后用read查看当前状态，再重新导出。文件属于当前会话，会随会话生命周期处理；它不是Workspace文档，也没有自动成为长期跨会话档案。重要说明另用普通文件工具保存，并依回执说明是否有待用户确认修订。hash可核对原件字节，不是不可篡改或事实认证。

仿射式可解单变量关系，变量相乘/变量分母明确不可用；其他输入未知、撤回、除零时不猜阈值。关系在连续数值上成立，不自动推断整次数或格式化时间；时刻需要在 input.label 中保留基准。模型、单位、费用范围与自由解释仍需核对。输入更新后的旧建议只显示 needs_review，原数值在对应历史版本读取。

建议依据已保存行动时增加 `actionBasis: {"actionIds":["实际action的UUID"]}`。程序生成观察指纹，调用者只提供相关id。read.recommendationContext分开显示inputStatus和actionBasis；相关行动被review、接回报告或撤回后，旧建议needs_review，之后重新recommend。新增无关行动不会触发，程序不改写旧nextAction。

`recommendationStatus=current` 表示当前输入版本与显式行动观察相符；actionBasis=not_observed表示未观察行动，不代表行动已同步。旧建议不补造观察。它不是事实或建议正确性的认证。数据变化后系统只标记待复核，判断是否改选仍由 Agent 与用户完成。只有已声明的计算和检查会自动重算，Shell 脚本输出不会被系统隐式重新执行。


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
