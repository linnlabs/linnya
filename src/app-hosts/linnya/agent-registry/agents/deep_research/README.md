# 退役研究角色：历史兼容边界

正式 Deep Research 的产品入口是“研究”（`research_v1`），职责和交付见
[Research owner](../../../application/research/README.md)。本目录不是现行研究编排实现。

## 保留与关闭

旧 beta 的 Leader、Scout、Reasoner 1/2、Challenger，以及相邻的四个
`deep_research_experimental` / `deep_research_*_review` CLI 实验定义，均通过
`newRunUnavailableReason` 关闭新的根任务。它们没有公开 subagent 类型。
CLI 直传 promptKey 也必须在创建 run 和写入新用户消息之前拒绝，不能静默切换到 Default 或研究。

定义、key、提示与执行配置保留，是为了识别历史及检查原暂停运行的兼容性。
此接纳标记不改变冻结执行合同，不清除历史、descriptor 或暂停资源。
兼容的旧 run 仍按原身份继续；已经退出注册的工具或交接协议不能凭保留 definition 获得恢复保证。
旧 Leader 所要求的 beta 子类型目前不可调用，不再把它的旧流程描述为产品能力。

不为收尾修改这些历史提示或迁移为当前提示；不恢复旧 `write_report` 发布通道或专用证据 facade。
它们的最终移除须另行核查仍需支持的历史解析和暂停恢复，并明确迁移或终止合同。
通用 Evidence 的退役边界仍归 [Evidence owner](../../../../../domains/evidence/README.md)。

## 验证入口

[根接纳与持久恢复回归](../../../adapters/flow/__integration-tests__/flow.legacy-research-admission.integration.test.ts)
覆盖全部退役根入口、无新消息/模型调用副作用、旧 Leader 与 CLI 实验 run 的暂停重开恢复，
以及已撤回研究交接合同的明确不兼容。
当前研究父子链另由 Research owner 所列业务测试验证，不能用历史配置测试替代。
