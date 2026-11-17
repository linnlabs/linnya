# 诊断日志

`orchestration/diagnosticLogger.ts` 拥有唯一 `Logger`、有界投影与记录路由；不读取路径、不构造文件 writer。`../logger.ts` 保留 Host 设置与兼容入口，在显式启用文件日志后安装内部输出回调，第一条日志才懒建 writer。进程级运行时让多份 bundle 共用同一 owner，级别、轮转、drain 与关闭行为不变。

插件只通过 `@plugin/backend/loggingRuntime` 使用 `new Logger(moduleName)` 和 debug/info/warn/error。Worker 内联 `@plugin/backend/worker/loggingRuntime`，自动把同一 Logger 的记录通过已有 `diagnostic_log` envelope 发给 parentPort；业务 result 仍走原队列协议，日志不进入控制 stdout。Worker 不提供文件目的地、级别、sink 注册或全局设置。旧 workspaceRuntime 的 Logger 类型/导出仍兼容，类型真源为 plugin-host-contract 的 loggingRuntime。

验收覆盖 Host 多 bundle 共用 writer、禁用/级别过滤/懒创建/关闭、真实 Worker 的有界日志与业务结果并存，以及产物不含 Host 文件路径和 writer。
