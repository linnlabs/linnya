# 行动、反馈与计划复核

基础记录与update格式见[记录操作](./record.md#update-格式)。本页所说的update沿用该格式；涉及条件性建议或版本对比时读取[情景与版本](./scenarios.md)。

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
