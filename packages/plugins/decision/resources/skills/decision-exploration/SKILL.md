---
name: decision-exploration
description: Help compare options, discover feasible next actions, and update a decision when goals, constraints or evidence change. Use with the decision prototype's versioned record CLI.
version: 0.7.0
---

# 决策与探索

每轮交付当前建议、成立条件、可能改变建议的信息，以及值得执行的下一步。先理解用户要改善的结果，再选择分析方法。记录用于延续工作，用户需要的是有用的选择与行动。

## 开始与继续

1. 理解要决定什么、何时决定、谁执行，以及影响可行性的预算或底线。把用户明确说出的偏好与自己的假设分别记录。只问会影响选择的问题。
2. 继续旧问题时，先用 `linnya-decision list` 和 `read` 找到当前记录。首次操作前读取 [记录操作](./references/record.md)。决策条件存在插件数据库，Shell 通过当前 App 的受管 CLI 操作它；交付说明用普通 Workspace Markdown。
3. 收集已有选项，也考虑谈判、延期、小步试等可创造的选项。列出真正决定取舍的因素；定性偏好可以保留文字。

## 分析与行动

先核对可行性，再比较值得争取的收益、代价、风险与可逆性。有明确数量关系时声明输入、单位和算式，用 CLI 计算；复杂模型可以用 Shell 脚本，保留输入、脚本和实际输出，并说明哪些部分未进入记录的自动重算。

围绕会改变建议的未知，选择查原件、计算、问用户、安排小试验或设观察点。以实际成本、延迟和用途决定做到多深。新事实可以改变推荐，确认原推荐仍适合当前条件也有价值。

证据不足时给出条件性取舍与可验证的下一步。有真实概率和损益依据时再量化，其他问题用具体条件表达。外部材料的引用沿现有 Citation；原始发布、转述、作者假设和已核验是不同状态。

## 条件变化

先更新原记录，读取重算与约束结果，再重新判断建议。预算变化会影响计算，偏好变化也可能改变选择；来源撤回时将输入标为 `withdrawn`。CLI 保留旧版，并把旧建议标为 `needs_review`。完成判断后，使用当前 revision 提交新的建议；解释为什么改选或仍保留原选。

## 交付与停止

用自然语言给出建议及理由、适用条件、未解问题与下一步。保存重要说明，交付记录 id、revision 和 Workspace 链接，便于后续接续。已有足够信息做当前动作，且继续分析的收益不值得成本时结束这一轮。以后有新条件，再从记录继续。

需要完整调查时，先保存当前条件，再按记录资源中的 `research prepare → subagent → research receive` 发起受管研究。把准备回执的 prompt 原样交给 `decision_research`，读取正式文章和原始评审，再决定如何更新建议。条件或材料变化产生 `needs_review`；部分或取消结果保留为过程资料。研究完成、版本接回与建议正确分别判断。
