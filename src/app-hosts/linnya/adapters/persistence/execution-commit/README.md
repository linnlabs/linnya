# 执行边界原子提交

本模块是 Host 对 Linnkit `EventBusEventPersistence.checkpointWriter` 的 SQLite adapter。
它只组合同一数据库的 RunRegistry、EventStore 和 Checkpointer 公共写入能力，不拥有运行控制、
工具副作用或重启恢复策略；恢复描述和控制流程由应用层负责。

一次提交在一个同步 SQLite 事务中：校验原 run 的 execution owner，写入本边界接受的事实及
资产引用 / UI 投影，最后保存 checkpoint。任一步失败全部回滚；不得在 SQLite 事务中调用
异步 port 并期待 Promise rejection 回滚。EventBus 继续拥有事实准入与唯一写入队列。

校验使用 RunRegistry 已保存的 executionId，不能查询“当前 activation”后替旧请求补齐。
暂停意图落盘但旧 attempt 尚未收口时，允许该 attempt 保存安全边界；暂停结算、取消、终态
或新 activation 接管后，旧 attempt 不再可写。此事务不代替整个 Workspace 的独占 owner。

该 adapter 本身不启用恢复；只有 Host 同时装配描述、恢复控制、checkpoint writer 与 Graph
提交端口之后，才可以对用户提供暂停 / 继续。没有 Audit 依赖，也不复制工具执行记录。
