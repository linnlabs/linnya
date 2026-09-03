# Commands Production Runtime

本目录是 Commands 的 App Host 唯一组合根。它拥有唯一 command execution owner、Shell/process runtime、
output artifact、审批/卡片持久化和 App end 收口顺序，但不依赖 Electron、Renderer page 或具体进程载体。
Shell/环境冻结、Plugin CLI client 路径与已验证的产品容量/超时策略也属于这里，不再以 `Electron*`
命名或由不同宿主各复制一份。

Electron Main 当前只在外层注入审批/卡片 presentation host 和 Utility runner adapter；headless App Server
使用现有 `createNodeCommandRunnerProcessPort` 注入一次性 packaged Node runner。两者不能同时成为 production owner，也不能创建
第二套 approval、handle、ToolOutputStore、audit 或 terminal。

依赖方向：

```text
Electron Desktop Host / Headless App Server
  -> CommandApprovalHostPort / CommandExecutionPresentationHostPort
  -> CommandRunnerProcessPort
  -> createCommandProductionScope()
  -> Commands domain + App Host adapters
```

迁移或新增 adapter 时必须复用这里的 composition；不得复制组合代码。测试应穿过真实 Shell/process 生命周期，
覆盖审批、长短命令、PTY、取消、终态、对话删除与 App end。
