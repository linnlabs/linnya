# Provider Diagnostics Domain

本 domain 记录外部 Provider 的进程内最新 attempt 快照，服务开发调试和故障定位。它不写
`workspace.sqlite`，不产生
`AuditEnvelope`，不参与统一 Audit 的等级开关，也不提供历史查询。

真正需要长期保存的 Runtime、Command 或 LLM response/stream 事实，必须进入
[`src/domains/audit`](../audit/README.md) 的唯一 `AuditPort`。Provider
diagnostics 只保留 route、状态、usage 摘要和安全错误分类；prompt、response、工具参数、凭据和图片字节都不能进入快照。

`ProviderOutboundDiagnosticsPort` 是生产 capability 的窄写入边界，
`ProviderOutboundDiagnosticsSnapshotPort`
是只读调试查询边界。默认实现是进程内内存快照，进程结束后自然消失；需要持久化时必须重新评审 owner、等级、容量和清理合同，不能偷偷把它接到 Audit 或新增一个文件 sink。
