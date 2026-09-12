# 同一 Agent Run 的持久恢复

本应用用例协调 Flow、Linnkit 和持久化 owner，不属于 Audit。执行断点及原输入在生产中也必须
可用。恢复不是发送用户消息：保留原 run / turn，只创建新的 execution attempt。

## 输入合同

`RunDescriptor` 保存原注册 AgentSpec、请求增强后的非秘密输入、模型身份、权限快照、执行策略
以及原 history / incoming fact ID。Conversation 历史继续由 EventStore 拥有，不复制到描述中；
调用方显式注入而没有 durable fact 的上下文仍属于必要请求输入。描述只存原始输入，不维护第二份
Graph 位置或预算进度。凭据仅可保存正式 owner 引用，恢复时重新解析秘密。

系统提示在首次接纳时物化，包括当时的时间与 Skill catalog。Generic task 与显式支持冻结输入
的 custom task 使用相同快照；恢复不重新运行 enricher，不重新读取命令权限设置。Agent / 模型 /
插件 / Skill 的必要能力发生不兼容变化时，保持原运行受阻，禁止悄悄换成最新默认值。

当前兼容校验包含接纳时已注册的插件、候选对话模型，以及启用 Skill 时的可调用目录；
这些候选能力尚未被调用也可能阻止旧 run 继续。这是当前保守边界，不是逐调用依赖追踪，
也不对同版本下的源码修改做环境指纹验证。

## 执行合同

事实与 checkpoint 通过 [execution-commit](../../adapters/persistence/execution-commit/README.md)
在同一 SQLite 事务中保存。外部效果不在该事务内：意图先保存，未知结果交给实际 owner 对账，
不能凭参数相同重做。重启只重建暂停 / 审批状态，不启动执行；继续必须经过唯一 activation admission。

审批生命周期由 Host 拥有：`requires_user_interaction` 与等待断点提交后才写 awaiting_user。
启动时补齐“等待断点已提交、生命周期未写”的窗口，沿用原 interaction 与 token；若正式响应
已经与激活原子提交，则保持可继续状态并消费原响应，不能重新要求审批。

Descriptor 的持久写入和启动恢复、Flow 控制、资源保留必须一起装配；只有完成该组合，才可将
运行标为用户可恢复。旧数据缺少描述不可用聊天历史猜造。当前实施状态以生产 composition root
与业务集成测试为准，孤立 adapter 通过测试不代表产品端到端恢复已经完成。

## 用户控制与连接

空输入框运行中显示暂停；安全收口后显示继续。暂停先持久化意图，再中断当前 attempt，
收口前不能继续。继续使用原 run/turn 与新的 execution，不调用 `/next`，不写 user_input。
有可发送草稿时走普通 Send；原暂停 run 与新请求通过同一 admission 事务替代，失败保留
草稿与断点。仅编辑草稿不取消旧运行。HITL 仍须正式 interaction response，继续不代表批准。

HTTP 的 pause 携带 expected_execution_id，continue 还携带 expected_updated_at；后端在
控制锁与持久提交边界验证，不用时间戳单独判断旧命令。SSE 关闭只停止投递，不取消运行。
Renderer 在没有 reader 时观察原 run 状态；Backend 不可达显示重连，不伪造 failed 终态。
重启先恢复控制态，等待用户继续，不自动发起模型或工具调用。

Conversation CLI 的 `resume <conversation-id> --run <run-id>` 先读取 exact settled pause，再把
观察到的 execution/update fence 交给同一 Host continue 流程。CLI 仅等待新的 execution ownership
接纳，后续运行仍归 App；它不以 send 冒充恢复、不写 user_input、不批准 HITL，也不解释或跳过
未知工具副作用的 receipt/reconcile 门禁。

## 副作用支持范围

| 原调用状态 | 当前动作 |
| --- | --- |
| 模型请求中断或未开始的工具 | 从最后提交位置发起新 attempt，保留累计预算 |
| 已返回且保存了完整字符串结果 | 读取原 run/tool-call receipt，提交原结果，不再次执行 |
| Markdown create / write / edit | 原结果与文档、pending、批注同事务；结果保存失败整体回滚 |
| 未完成 child | 按原 parent/call/批次位置重建同一 child，从自己的断点继续 |
| 已完成 child、父级尚未结算 | 保留并读取 child 的原 yielded 结果，不重跑 |
| 未知 Shell / 外部 / 插件效果 | 无可靠结果凭据即受阻，不凭 PID、stdout 或参数重放 |

纯读取白名单允许重读当前数据，不承诺历史内容冻结。尚未返回的插件写入、结构化图片结果、
失效进程内 asset claim 不具备通用恰好一次保证；明确受阻时可解决能力问题后再继续，或发送
新消息/显式取消结束旧运行。不能为“继续”伪造成功、自动批准或覆盖用户后续编辑。
没有恢复描述的旧历史不会复活。缺少或损坏的必要输入保留诊断证据，并隔离该 run；
不阻塞其他对话。运行中模型的同一请求可重试，但无法恢复已销毁的网络 token 流。

## 存储与释放

所有结构化恢复状态复用 Workspace SQLite，不是新的审计数据库。原始必要输入含用户正文，
其保护等级与正常 Conversation 数据相同；秘密只经凭据 owner 解析。

启动维护先识别非终态 root 的整棵 run tree，再清理过期数据。checkpoint、descriptor、
原 tool receipt 保留到 root 终态；已完成 child 也在保护范围。ToolOutput 与已封口 Command
artifact 按会话保护，因为原上下文可能引用更早结果。已提交附件/图片依靠 Assets 的正式
event links 保留，不把未消费的进程内 claim 当成可恢复引用。

根终态先落盘，随后收口暂停 child、释放 child 断点/描述，最后释放根；中途崩溃可重试。
Events、用户文档和最小累计 run cost 不随断点释放而删除；随其正式 owner 生命周期管理。
用户明确删除对话仍先阻断 ingress、停止执行，再删除事实与资源。

## 验证与当前限制

Flow 的 `flow.durable-continuation.integration.test.ts` 和 `flow.process-crash.integration.test.ts`
使用真实 SQLite、生产 Audit off、正式 npm Graph 与脚本模型，覆盖 SIGKILL、提交失败、审批两个
崩溃窗口、原 child、预算、未知效果、重复激活与新消息替代。Renderer interactive-run
测试覆盖主按钮、断线观察和迟到响应隔离；Workspace owner lock 有真实跨进程竞争验收。

工作区互斥只针对本机文件系统，不支持共享网络盘多机写入。Backend 仍由 Desktop 启动并
提供部分能力；这里不实现独立常驻 daemon、开机调度或新的审阅 UI。工具注册目前仍有
静态聚合的导入顺序耦合，独立工具入口测试必须经 Host 装配；不能据单文件加载成功推断
完整产品启动。兼容性按已声明 Agent/模型/插件/Skill 身份校验，不是全环境可复现快照。
