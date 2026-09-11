# Linnya Host SqliteCheckpointer

本 adapter 把 Linnkit 的 EngineState 存在 Workspace SQLite 的 `engine_checkpoints` 表。
恢复的产品合同统一见 [run-resumption](../../../application/run-resumption/README.md)。

## 身份与数据

所有 root、auxiliary 和持久 child 都以稳定 runId 为 checkpoint key。物理主键
`conversation_id` 是历史列名，不是会话身份。快照保存原请求、工作 history、节点、
revision、executionStatus、pending tool calls、执行意图以及累计 stepCount/maxSteps；
读取使用已发布 Linnkit 的 `graph.parseEngineCheckpoint`，不直接断言 JSON。

EventStore 保存正式事实，RunRegistry 保存生命周期，Descriptor 保存恢复输入，checkpoint
保存图位置。UI 历史回放不能替代原图继续；上下文压缩的 history_summary 也不是执行断点。
原执行策略与累计预算随断点保留，不从当前默认配置重置。

## 原子提交与装配

生产组合根为 root 和 child 装配
[execution-commit](../execution-commit/README.md)，把本边界事实与 checkpoint
放进同一同步 SQLite 事务，并核对 execution owner。单独调用 save 只履行基础 port，
不能宣称提供产品级原子恢复。事实提交失败时不推进位置；外部效果由其 owner 的原结果凭据对账。

等待审批的事实在 EventStore，不保证进入模型 history；重启按原 run/revision 读取并重建
原 interaction。已提交响应由激活记录引用，不能重新索要或伪造用户输入。

## 生命周期与维护

重启只重建暂停/等待控制态，不自动执行。只有正式继续接纳才轮换 execution。
已 yielded 的断点返回原结果，不重跑最终节点。同步 child 使用自己的持久断点；
父级尚未结算时，已完成 child 的原结果也必须保留。

先写根 run 终态，再释放整棵 run tree 的断点和描述，根描述最后删除。
中途崩溃时启动恢复完成剩余释放。取消和删除仍可终止运行，不复活历史终态。

启动 GC 使用固定 30 天窗口，但必须先通过
`selectRunRecoveryRetention` 保护所有非终态 root 及其 child（包括已完成 child）。
不能只靠 pending tool 标记，也不能用 Audit/Telemetry TTL 清理恢复输入。
`purgeStale` 是 Host maintenance，不扩展通用 Checkpointer port。

## 验证

相邻 SQLite contract 测试覆盖持久读取、身份隔离、单 run 清理与保护范围。
Flow 的 `flow.durable-continuation.integration.test.ts` 穿过真实 SQLite、
正式 npm Graph、生产 Audit off 装配，验证进程崩溃、审批窗口、工具提交、原 child 与预算连续性。
