# App Server Control

本目录拥有 Linnya Desktop Host 与 headless App Server 之间的最小生命周期协议。它只表达
`ready / ping / shutdown / fatal`，不承载 HTTP/SSE、Command stdout/PTY、插件 payload 或通用任务状态。

- stdout 仅允许协议 2 的 JSONL 帧，单帧最多 16 KiB；普通日志只能写 stderr。child writer
  最多积压 8 个串行写入，并等待 Writable callback 后才结算 ready/ping/shutdown，不能绕过 pipe 背压。
- `ready` 只能在数据库、HTTP/SSE 和业务 owner 全部可接流量后发布，并返回真实 API port、
  renderer session token、应用版本和 `database_ready=true`；仅仅 child 进程存活不能冒充 ready。
- Main 是唯一 process owner；显式 `shutdown` 与 stdin EOF 都必须收口 App Server。
- App Server 不 detach、不跨 App 复用，也不提供退出 App 后继续任务的入口。
- 协议错误 fail closed，不回退到 Main 内运行 Backend。

业务 Backend 和 Electron desktop capabilities 必须通过各自窄端口装配，不能向本控制协议增加任意方法调用。
双向业务 RPC 固定使用独立 fd 4/5 与严格 handler registry；即使 RPC 拥塞或失败，也不能污染 lifecycle stdout。
