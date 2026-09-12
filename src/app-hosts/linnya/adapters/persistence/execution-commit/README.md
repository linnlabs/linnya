# 执行边界原子提交

本模块是 Host 对 Linnkit `EventBusEventPersistence.checkpointWriter` 的 SQLite adapter。
它只组合同一数据库的 RunRegistry、EventStore 和 Checkpointer 公共写入能力，不拥有运行控制、
工具副作用或重启恢复策略；恢复描述和控制流程由应用层负责。

一次提交在一个同步 SQLite 事务中：校验原 run 的 execution owner，写入本边界接受的事实及
资产引用 / UI 投影，最后保存 checkpoint。任一步失败全部回滚；不得在 SQLite 事务中调用
异步 port 并期待 Promise rejection 回滚。EventBus 继续拥有事实准入与唯一写入队列。

校验使用 RunRegistry 已保存的 executionId，不能查询“当前 activation”后替旧请求补齐。
暂停意图落盘但旧 attempt 尚未收口时，允许该 attempt 保存安全边界；暂停结算、完成/失败
或新 activation 接管后，旧 attempt 不再可写。此事务不代替整个 Workspace 的独占 owner。

取消分开撤销动作权限与收尾提交：RunRegistry 先进入 cancelled，工具效果凭据仍使用严格
`requireExecutionOwner`，不能新增效果；原 execution 的 checkpoint writer 只可沿现存、
连续 revision 链排空到 yielded。取消时已排队的 ready/executing checkpoint 不能直接丢弃，
否则实际完成的工具结果会丢失。yielded 必须无 pending call/执行意图；yielded 后或清理后
拒绝迟到提交，不允许复活断点。事实、UI 投影与位置仍在同一事务，不扫描 loading 补造输出。

通用 ToolNode 必须在 AbortError 离开前提交取消边界；Graph 在节点切换期间收到取消也必须
先调用节点的取消收尾入口。这需要 Linnkit 0.37.0 起的取消合同支持，Host 单侧不能替代该修复。

该 adapter 本身不启用恢复；只有 Host 同时装配描述、恢复控制、checkpoint writer 与 Graph
提交端口之后，才可以对用户提供暂停 / 继续。没有 Audit 依赖，也不复制工具执行记录。
