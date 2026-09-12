# App Server RPC

这是 App Server 与 Electron Desktop Host 之间的双向 request/response 数据面，不复用 lifecycle stdout 或
bootstrap pipe。正式 child 使用 fd 4 向 Main 写帧、fd 5 从 Main 读帧；Main 的方向相反。

- payload/result 只能是严格 JSON value；二进制由具体 capability 使用受管 mailbox，不在这里偷偷展开对象。
- 单帧最多 1 MiB；双向 pending/active 各最多 64，writer 总积压最多 128。
- 只有 composition 注入的 handler registry 中的方法可执行；未知方法稳定失败，不存在任意函数调用或 SDK 暴露。
- 多个 capability registry 只能通过冲突即失败的 composition 合并，不能按注册顺序静默覆盖 method owner。
- request 有 deadline 和 AbortSignal；response/cancel writer 优先级高于普通 request。
- codec 或 request id 失配属于协议失败，peer fail closed；不回退到 Main 内运行 Backend。

取消有两个不同边界：deadline/AbortSignal 立即结算调用方 Promise，但已发出的 request 仍有对端
terminal 待接收。取消身份保留到唯一 response 到达或 peer 关闭，不用另一段 deadline 清理；
慢进程/拥塞管道中的合法迟到响应不能被误判为陌生 request。等待 cancellation terminal 的身份
与普通 pending 共享 64 个容量，满额只拒绝新 request，不无界积累，也不抹去旧身份。已消费响应
之后的重复响应、从未发出过的孤立响应仍按协议错误关闭 peer。

cancel 的 urgent 优先级只适用于自身 request 已写出之后。排队期间取消仍立即拒绝调用方，
等原 request 写出才发送 cancel，避免控制帧越过自己的 request 使对端错误关闭。对端已经完成
时只返回原 terminal；cancel 不要求生成第二个结果。

本层只拥有 transport 语义。Desktop capability、Renderer IPC 与 Backend lifecycle 必须在各自 feature 中用严格 DTO
adapter 包装 raw `request(method, payload)`，不能把 RPC peer 传给插件、业务 orchestration 或 Renderer。
