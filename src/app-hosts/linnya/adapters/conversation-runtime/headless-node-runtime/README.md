# Headless Node Conversation Runtime

本 adapter 只为独立 App Server 选择物理载体：Command execution 使用现有 `commandRunnerProcess.cjs`，Profiled Code Sandbox Utility 使用现有 `sandboxUtilityProcess.cjs`，两者都由已经校验的随包 headless Node 启动。

三档权限 authority、审批 host 和命令卡片 presentation host 是必填依赖；这里不提供默认批准、空卡片或 Electron fallback。Shell 仍禁止 GUI control，外部 OAuth 浏览器授权属于另一条 Desktop capability。

每次 Command/Sandbox run 仍使用既有一次性 child 与整树 owner。此 adapter 不增加常驻 broker、任务队列、性能模式或 App 关闭后的后台任务。
