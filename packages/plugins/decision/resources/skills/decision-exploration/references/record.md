# 版本化决策记录与计算

在 Shell 中调用 `linnya-decision`，它连接本次运行所在 App 和项目。记录由插件保存到数据库；普通文件工具保存的是面向用户的说明。两者用途不同。CLI 返回 JSON，失败要按错误信息修正后再继续。

## 命令

| 命令 | 用途 |
| --- | --- |
| `linnya-decision list` | 列出当前项目的记录 id、标题、revision 与建议状态 |
| `linnya-decision create --json '<model>'` | 建立条件与选项，返回 id 和 revision=1 |
| `linnya-decision read <id>` | 读取当前版、重算结果和建议状态 |
| `linnya-decision read <id> --revision 1` | 读取指定历史版本 |
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

金额统一币种与时间范围后再计算，换算依据作为输入保留。表达式的单位由作者核对，系统只执行算式；它不能发现遗漏费用、错误模型或不完整的选项。

## update 格式

必填 `reason`，并至少给一项 `inputs`、`options`、`calculations` 或 `checks`。inputs 按 id 合并，每项提供完整 input；其他数组整组替换，避免旧约束或算式残留。撤回来源时，把相关 input 的 status 改为 withdrawn，保留其原 value 和 origin 作为历史。

```json
{"reason":"用户降低预算","inputs":[{"id":"budget","label":"预算","kind":"constraint","value":100,"unit":"CNY/次","origin":"用户本轮明确更新","status":"available"}]}
```

更新回执会重算、列出检查结果，并将旧建议标为 needs_review。相同条件重复提交会被拒绝，不凭空增加版本。revision 冲突时先读取当前版，结合最新条件处理，不能直接把旧提交的数字改成新版号重试。

## recommendation 格式

必填 `optionIds`、`rationale`、`changeConditions`、`nextAction`、`unresolved`（文字数组）。optionIds 可以包含互相配合的行动，文字解释适用关系；不是必须给所有选项打分。已明确违反声明的数值检查的选项不能作为当前推荐保存；未知检查不等于通过，须在 unresolved 和建议条件中说明。

```json
{"optionIds":["wait"],"rationale":"预算降低后，报价超过硬约束；先使用公开资料","changeConditions":"预算提高或价格下降后重新比较资料的增量价值","nextAction":"核对公开资料能否回答当前问题","unresolved":["补充资料是否真正提供新信息尚未确定"]}
```

`recommendationStatus=current` 仅表示作者将该建议关联到当前输入版本；它不是事实或建议正确性的认证。数据变化后系统只标记待复核，判断是否改选仍由 Agent 与用户完成。只有已声明的计算和检查会自动重算，Shell 脚本输出不会被系统隐式重新执行。
