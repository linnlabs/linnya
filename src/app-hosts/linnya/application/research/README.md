# Research 应用用例

目标是充分调查、准确解释、深入浅出的长文章。前端入口仍为“研究”，选择身份仍为
`research_v1`。新请求由主研究 Agent 在正常 Conversation 中理解任务、展示进度并调用统一
`subagent`；Default Agent 与 deep-research Skill
1.4 不变。工程闭环不代表已证明跨题稳定的质量优势。

## 调度与职责

主 Agent 持续负责调查、解释、初稿与一次修订。专项调查和成文前调查复核按缺口选用，不强制另起作者；成稿必须交给独立论证复核和来源与数字复核。四种受限委派类型继承用户模型，零轮历史继承，每个 child 最多 800 步。父 Agent 传递具体问题和正式材料路径，不把近完整文章复制给新作者重写。委派沿用通用 subagent 的串行执行；Host 不自动启动后继，也不新增 Workflow 状态机。网页深搜仍可选。

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

每个委派绑定父 run、工具调用、冻结分配请求、输入 inode/正文与引用 hash、child 身份及输出。父 Agent 先保存自己的调查主记录，再保存初稿；可选专项材料不能替代主记录。双评审绑定同一初稿与相同资料上下文，且不接收彼此反馈；父修订须带齐对应初稿与两份评审。这些是交接前提校验，不是 Host 调度下一步或语义评分。

评审对象与查找范围写在子任务请求中：成稿复核明确标出唯一的 `Review target` 路径及版本，其他文档用于核查；评审按给定路径读取、检索，不搜索项目根目录或读取其他评审，缺材料按获准范围补查或报告缺口。通用 Workspace 工具及 VFS 不承载研究阶段的文件拒绝集，不改变同项目文件权限。这是任务遵循要求，不是权限隔离保证；实验仍按实际工具返回核对串读，已暴露的样本不得追认为独立。

父 Agent 与子角色共用
`submit_research_document`。父级参数声明调查主记录、初稿或修订，以及本稿依赖的 input_documents；child 只提交已绑定阶段的正文。正式文档 owner
create-only 保存并解析、回读和处理 canonical 引用。路径、项目和来源 run 由 Host 决定。文档、产物绑定和完整 submit 结果同事务提交。父稿保存后保持根运行，child 保存后结束该 child；只有 complete_research 结束父研究。格式/引用失败可修正正文再提交，不能用自由终答冒充产物。父稿用真实 run_id，子产物用 subrun_id，二者不能混用。

同一次委派恢复复用原请求与 child。父提交恢复复用已原子保存的工具结果，不新建同名稿。父级三类稿件各允许一份成功产物；格式/引用失败或取消未保存正文时，可在新调用修正，不因此消耗修订机会。重复提交在文档事务内拒绝。专项补查可多次开展。子产物保存后仍须等统一 child
runtime 结算为 completed；父稿由原子提交证明，不要求仍在研究中的根运行提前 completed。

每次接纳与交付都核对输入和正式 current 投影；祖先材料变化也使下游稿件失效。用户修改、移除材料时保留其修改和已有候选，拒绝沿旧版本提交或交付；父模型仍可说明失败与保存的工作，并非自动终止根运行。重新开展研究应接纳新任务。提交期间取消回滚文档与回执，不把失效当成可反复尝试的 Markdown 错误。

## 完成与限制

`complete_research`
只接受本轮已完成的修订文档，回溯调查、初稿、双评审和版本；返回修订稿与两份评审导航并结束根运行。该检查不认证观点正确，也不表示所有反馈已解决。预算不足或失败时主 Agent 应明确未交付，不能用 TaskState 勾选代替真实产物。

registered
child 使用自己的冻结工具名单、调用身份和委派白名单。父级提交能力只绑定真实父运行及当前调用；child 不能借用父级参数，父不能借用 child 出口。子 Agent 不持有根交付能力。两份评审的输入隔离不等于操作系统级权限隔离。

旧 `createResearchUseCase` 仅服务已接纳旧 descriptor 的恢复；新
`createResearchDelegationUseCase` 服务父稿提交、一次显式委派与最后交付。二者共用
`createResearchStageSession`
的写入/版本接纳，不复制运行状态机。本模块没有新增 Judge、证据数据库、图谱或强制贝叶斯评分。

输入版本在首次提交或委派时绑定，不能追溯证明父模型更早某次 read_file 所见的版本；Host 完整读取也不证明模型理解了材料。已经保存的调查→初稿→双评审→修订依赖则逐份检查，不能因父稿共用 run_id 跳过祖先。

验收覆盖正式 SQLite/Markdown/Citation、父子工具生命周期、取消恢复、版本变化、角色范围、实时/历史投影。文章质量仍须另做失效回归与真实选题对照，分别报告相对改善、全文质量和成本。
