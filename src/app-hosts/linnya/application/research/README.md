# Research 应用用例

目标是充分调查、准确解释、深入浅出的长文章。前端入口仍为“研究”，选择身份仍为
`research_v1`。新请求由主研究 Agent 在正常 Conversation 中理解任务、展示进度并调用统一
`subagent`；Default Agent 与 deep-research Skill
1.4 不变。工程闭环不代表已证明跨题稳定的质量优势。

## 调度与职责

主 Agent 选择调查、调查复核、写作、论证复核、来源与数字复核、一次修订的委派时机和具体问题。六个受限委派类型复用四种注册角色，继承用户模型，零轮历史继承，每个 child 最多 800 步。首版沿用通用 subagent 的串行执行；主 Agent 可补查，不由 Host 自动启动后继，也不新增通用 Workflow 状态机。网页深搜仍可选。

TaskState 是主 Agent 展示的计划；实际执行状态由 RunSupervisor、child
registry、EventStore 和 Audit 持有。Conversation 展示主 Agent 的消息和各次标准 subagent 委派，子运行详情展示真实轨迹。`complete_research`
只核对并导航最终稿和评审，不承载整条研究过程。

角色与提示见
[Agent Registry](../../agent-registry/README.md)。共同方法来自正式 Skill，不复制四份 Skill；经过验证的反馈要求作为小型角色增量。调查资料、原始评审、初稿和修订稿分别保存，文章不混入研究日志。

## 接纳与范围

项目会话选择“研究”或 CLI
`send --agent research_v1`，以开放调查接纳。根模型正常接收用户请求、编辑器引用和可见历史；不再把这些内容拼成供 Host 代读的长问题。无项目或本轮图片附件在接纳前明确拒绝。

CLI `--research-scope-json` 通过正式 `research_scope`
声明问题、读者、open/fixed/update 及 Workspace 材料；接纳后冻结为请求的
`researchScope`。显式范围拒绝未绑定的历史、附件和编辑器上下文。fixed/update 必须有正式材料；fixed 在根与 child 的正式 Web/Knowledge 工具入口禁止新增取得。Shell 及同项目文件不因此成为权限沙箱，真实越界仍需审计。

新研究请求不接受 `host_tool_call`。旧已接纳的 research_run
descriptor 按原身份和冻结配置恢复，保留其专属旧调度适配器；不让旧暂停任务进入新主 Agent。旧
`deep_research_leader` 也不开放新请求。

## 单次委派与版本交接

`subagent` 的 `input_documents`
显式选择允许材料及本轮已提交产物；研究 owner 通过通用准备/接纳端口补齐问题、来源范围、版本和输出位置。启动 child 始终由统一 registered
child invoker 负责。公开通用委派不读取研究表，不解释研究阶段。

每个委派绑定父 run、工具调用、冻结分配请求、输入 inode/正文与引用 hash、child 身份及输出。调查复核必须先于采用它的初稿；双评审绑定同一初稿且不接收彼此反馈；一次修订须带齐对应初稿与两份评审。这些是交接前提校验，不是 Host 调度下一步或语义评分。

子角色仅通过 `submit_research_document({content})`
提交完整 Markdown。正式文档 owner
create-only 保存并解析、回读和处理 canonical 引用。路径、项目和来源 run 由 Host 决定。文档、阶段产物绑定、完整 submit 工具结果在同一事务提交；格式/引用错误可在同一 child 内修正，成功提交结束 child。自由终答不构成产物。

同一次委派恢复复用原请求与 child，不重新发送；另一 call 不可替换已提交阶段。可以显式开展新的补查或初稿委派，但不能冒充旧调用恢复；本轮仅接纳一次主修订。即使文档已保存，也须等统一 child
runtime 结算为 completed 才可被后继采用。

每次接纳与交付都核对输入和正式 current 投影；祖先材料变化也使下游稿件失效。用户修改、移除材料时保留其修改和已有候选，停止沿旧版本交付；重新开展研究应接纳新任务。提交期间取消回滚文档与回执，不把失效当成可反复尝试的 Markdown 错误。

## 完成与限制

`complete_research`
只接受本轮已完成的修订文档，回溯调查、初稿、双评审和版本；返回修订稿与两份评审导航并结束根运行。该检查不认证观点正确，也不表示所有反馈已解决。预算不足或失败时主 Agent 应明确未交付，不能用 TaskState 勾选代替真实产物。

registered
child 使用自己的冻结工具名单、调用身份和委派白名单。主 Agent 不持有阶段写入出口，子 Agent 不持有根交付能力。两份评审的输入隔离不等于操作系统级权限隔离。

旧 `createResearchUseCase` 仅服务已接纳旧 descriptor 的恢复；新
`createResearchDelegationUseCase` 服务一次显式委派与最后交付。二者共用
`createResearchStageSession`
的写入/版本接纳，不复制运行状态机。本模块没有新增 Judge、证据数据库、图谱或强制贝叶斯评分。

验收覆盖正式 SQLite/Markdown/Citation、父子工具生命周期、取消恢复、版本变化、角色范围、实时/历史投影。文章质量仍须另做失效回归与真实选题对照，分别报告相对改善、全文质量和成本。
