# Research run presentation

新版“研究”由主 Agent 在普通 Conversation 中组织消息、TaskState、局部 `subagent` 委派与
最终交付。子运行继续使用统一进度卡和完整详情，不增加包住整个研究的外层工具卡。
TaskState 只显示模型的工作记录，不能作为已执行、已保存或内容通过的事实。

`complete_research` 只展示正式交付的文章与两份原始评审链接。评审按正式 stage 投影为
“论证复核”或“来源与数字复核”；角色说明与统一 Workspace 链接的真实文稿标题同时保留，
不以结果顺序或文件名猜测角色。完整与 compact projector 都
在 admission 校验共享 strict schema；展示数据不携带正文、hash 或质量自评。失败只说明
本次交付检查未完成，原因由标准错误卡展示，不能显示文档已交付。该工具不展示阶段树或
第二份运行状态；主 Agent 是否交付只由正式成功结果表达，内容质量仍由读者与研究判断评估。

下列 `research_run` 合同仅用于旧事件展示和已接纳运行的恢复。本 feature 将旧 Host
`research_run` 的正式结果与已接纳 `subrun_summary` 投影为研究过程卡。
工具完整与紧凑展示分别在 registry admission 使用共享 strict schema；Vue 不读取原始 payload，
不从 trace、阶段名字或文件路径推断研究是否正确。

运行中仅按真实 child 到达顺序展示已有过程，不预造六个阶段或猜测尚未接纳的 child。正式结果
用 artifact 的明确 stage 标识命名并链接已保存文档；未保存的真实 child 仍可查看 trace，但
不补造阶段、产物或终态。旧工具的 `inputs_changed` 显示材料变化和停止提示，已有文档仍保留，不能
显示为研究交付成功。保存成功只表示文件交付，不认证全文质量。

卡片复用标准 `ToolCallsMessage` 外壳、公开 `SubrunTracePanel` 与 `ConversationResourceLinkNode`。
trace 面板的 lifecycle 外观来自父工具，不能解释成各 child 的完成状态。此版本只展示轻量
工具过程，不提供 subagent 专用详情入口：阶段请求依赖前序文档，不能从父工具初始参数制造
六份假请求。完整文章与评审从正式 Workspace 链接打开。

测试覆盖 live 与 reload admission、已保存 artifact 顺序、材料变化后保留原件、未保存 child
仅有 trace，以及非法成功结果原子拒绝。本文不改变 Renderer 研究选项的入口映射。

`submit_research_document` 展示父作者或独立子角色的一次正式文稿提交。完整卡与 compact 均在
admission 使用共享 strict result schema；父作者的成功标题按正式 stage 区分调查记录、初稿和
修订稿，独立子角色继续显示阶段文稿已保存。完整卡只提供正式 Workspace 打开链接，展示模型
不携带正文、hash、运行控制或质量自评。父作者保存不意味着研究结束，最终交付仍由
`complete_research` 单独表达。

loading/error 不解析仅成功才存在的产物；失败标题只表示这次提交失败，同一 Agent 的修正重提
是另一条正常工具调用。前端不增加重试动作、不结束 Agent，也不推断研究已经交付。
测试同时覆盖父作者与 child 事件的实时/重载一致性、compact 投影和身份非法结果的拒绝。

`research_run` 与 `submit_research_document` 显式保留错误态 presentation。研究父工具失败后仍能展开真实 `subrun_summary` 的过程，错误原因由标准错误卡展示；没有正式成功 artifact 就不显示 Workspace 产物链接。提交失败仅显示本次失败标题与原因，不挂载保存卡。
