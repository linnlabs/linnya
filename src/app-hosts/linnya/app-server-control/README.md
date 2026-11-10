# App Server Control

本目录拥有 Linnya Desktop Host 与 headless App Server 之间的最小生命周期协议。它只表达
`ready / startup_progress / ping / shutdown / fatal`，不承载 HTTP/SSE、Command stdout/PTY、插件 payload 或通用任务状态。

- stdout 仅允许协议 4 的 JSONL 帧，单帧最多 16 KiB；普通日志只能写 stderr。child writer
  最多积压 8 个串行写入，并等待 Writable callback 后才结算 ready/ping/shutdown，不能绕过 pipe 背压。
- `ready` 只能在数据库、HTTP/SSE 和业务 owner 全部可接流量后发布，并返回真实 API port、
  renderer session token、应用版本和 `database_ready=true`；仅仅 child 进程存活不能冒充 ready。
- `startup_progress` 只在 ready 之前出现，报告数据库阶段（打开、Host 迁移、插件迁移与建索引）：
  `started` 与 `finished` 各一次，中间每完成一个 Host 迁移步骤发一次 `progress`，并带 `upgrading`
  与已完成/总步骤数。child 等帧写入 stdout 后才开始下一段可能很久的同步步骤；parent 在 `started`
  到 `finished` 之间暂停启动超时，`finished` 后重新计时。ready 之后或越序的进度帧按协议错误处理。
  App Server 进程先建立 control host，再开始任何启动步骤，进度因此总有可写的出口。
- ready 之前的启动失败发 `fatal`，`code=startup_failed` 时必须带 `startup_failure`：类别、原始错误码与失败的迁移起始版本（没有则为 null）。类别由 App Server 按错误码与阶段判断，不匹配文案；错误码只接受大写标识符，`message` 截到 2048 字符。其他 fatal code 不带这一字段。parent 把它交给启动失败对话框，协议本身不携带任何文案。
- 启动 App Server 的 Desktop Main 或 CLI Runtime 是唯一 process owner；显式 `shutdown`、stdin EOF、parent pipe error 与 bootstrap parent identity 消失都必须进入同一收口。
- App Server 不 detach、不跨 App 复用，也不提供退出 App 后继续任务的入口。
- 协议错误 fail closed，不回退到 Main 内运行 Backend。

业务 Backend 和 Electron desktop capabilities 必须通过各自窄端口装配，不能向本控制协议增加任意方法调用。
双向业务 RPC 固定使用独立 fd 4/5 与严格 handler registry；即使 RPC 拥塞或失败，也不能污染 lifecycle stdout。
