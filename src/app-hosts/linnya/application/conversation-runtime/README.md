# Conversation Runtime Application Lifecycle

本目录拥有 Conversation routes 对 Commands 与 Profiled Code Sandbox 两个生产 owner 的 App 级提交顺序。它不创建进程、不读取 Electron，也不定义 Shell、审批或 Sandbox 策略。

固定顺序是：准备全部 routes、注册 Commands owner、注册 Profiled Code Sandbox owner，最后提交全局唯一 Sandbox runner。任一步失败都要等待两个 owner 收口，并同时保留初始化失败与清理失败。

Electron Main 与 headless App Server 只能各自提供 adapter；生产切换前后都复用这里的生命周期合同，禁止复制第二套组合或同时成为 owner。

`ConversationExecutionRuntimeFactoryPort` 是 routes 唯一允许使用的生产组合入口。它返回 Commands scope、Profiled Code Sandbox scope 和现有三档权限 authority；routes 不知道 runner 是 Electron Utility 还是 packaged headless Node，也不接触 approval/卡片传输实现。
