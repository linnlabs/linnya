# 情景、条件性建议与版本对比

基础输入、更新和建议格式见[记录操作](./record.md)。以下操作沿用同一记录和版本合同。

## 只读情景试算

`linnya-decision simulate <id> --expected-revision <n> --json '<scenarios>'` 可在临时输入上重算；也可用 `--input relative-file.json`。JSON格式如下，id与inputId对应已有模型：

```json
{"cases":[{"id":"higher_price","label":"报价提高的假设","inputs":[{"inputId":"price","value":210}]}]}
```

回执绑定当前revision，含baseline及各case的全部计算/检查。`changes`列出原值与假设值，`references`列出进入哪些算式/检查；`unreferencedInputIds`表示未进入数值模型。情景彼此独立，不把上一情景的值带到下一项。未知/撤回不当作零，来源状态不因假设值而恢复。

这些值没有发生：simulate不保存输入、不修改公式、不增加版本或更新建议。若费用变化应影响总额而改动未被公式引用，先对照原始条件判断模型是否漏项；修正模型用update，再对新revision试算。定性偏好未进入四则式本身合法。单个选项的检查失败后，还需看其他选项全部检查，试算结果不自动决定改选。

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

