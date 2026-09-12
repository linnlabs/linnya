# Diagnostic Log RPC

Electron Main 是桌面诊断日志的唯一文件 writer。App Server 的 Logger 只生成严格日志 envelope，并通过该 feature 的非阻塞 reverse RPC 转发；业务调用不等待写盘，日志失败也不会反压 Backend 事件循环。

Desktop handler 复用 `writeForwardedDiagnosticLogRecord`，因此文件路径、轮转、drain 和关闭仍只有一个 App owner。codec 拒绝任意对象和伪造字段；第一条转发失败会进入 stderr 观察点，不能用无界重试队列或第二个日志文件兜底。

2 秒 deadline 只决定本条日志是否成功交付给调用方，不是 RPC 响应身份的有效期。超时后的迟到
回执由通用 [RPC 生命周期](../../../app-server-rpc/README.md)结算；不能因为诊断写盘延迟而退出
业务 Backend，也不为日志另设一套特殊超时容错或延长 deadline。
