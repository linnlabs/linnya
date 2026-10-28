# 受管研究委托

基础记录操作见[记录操作](./record.md)。本页处理完整调查的准备与接回。

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

