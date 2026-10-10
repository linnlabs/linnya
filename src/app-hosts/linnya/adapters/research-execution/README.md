# Research 执行适配器

新“研究”根是正常模型 Agent。`decorateResearchDelegation` 从真实 caller
identity 和持久根 descriptor 装配交接能力；研究业务见
[应用用例](../../application/research/README.md)。

## 统一委派

准备端口验证本轮 scope、角色、资料版本及交接前提，提供自包含请求、稳定 child
identity 和只绑定该 child 的提交能力。通用 `subagent` 仍唯一调用 registered
child invoker。接纳端口只接受正式 `submit_research_document`
输出，并与原子阶段回执核对；不解析自由终答，不自动启动后继。

根与 child 的 fixed 范围在 Web/Knowledge
decorator 执行，恢复保留限制。该限制不是 Shell 网络或整个项目文件系统隔离。委派串行执行，主 Agent 的 TaskState 不作为持久运行真源。

`bindResearchStageSubmission` 校验实际 child
run、conversation 和工具调用身份；同伴、嵌套 worker 和父模型不能借用子阶段能力。父作者另由真实根 descriptor 的冻结工具范围授权，提交声明阶段与正式依赖，Host 冻结它们并分配路径。两分支均只使用实际产出者的来源 run。Markdown 编译与 Citation 仍归正式文档 owner。

文档、阶段产物绑定与完整成功工具结果同事务提交；父级结果不携带终止指令，child 结果仍终止自身。中断通过已有 atomic-owner
receipt 恢复，不依赖 ToolRegistry.returned 兜底。来源版本变化使 child 停止、父提交明确失败且不得旧版交付；父运行可以报告限制，不伪装成可重试格式问题；编译期间取消回滚整个事务。

## 最终交付

`complete_research`
是薄的交付检查工具：只读本轮已提交修订稿、关联双评审、完整依赖链和 child 终态。成功结果导航到文档并结束主 Agent；不启动 child，不写稿，不认证全文质量。它属于无写入可重查工具，恢复再次检查当前版本。

前端主过程由普通主 Agent 消息、TaskState 和标准 subagent 卡及详情组成。complete 卡只展示真实文档导航；不能把它渲染成整条研究流程。

## 旧运行恢复

`research_run` 保留为旧已接纳 descriptor 的 Host
forced-tool 入口，不进入任何模型目录，也不是新请求入口。其适配器与新委派共用提交/接纳逻辑；旧固定调度仅用于原运行恢复。`yield_after_batch`
的 completed 只表示旧 Runtime 工具批结算，不能等同旧 research_run 的 delivered 业务结果。

最近一代主 Agent 委派独立作者的已接纳运行，按完整历史配置恢复，仍使用原请求和 child 写作。新请求不再开放 draft/revision 子类型；不能把旧配置静默转换成父级写稿权限。
