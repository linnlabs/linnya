# Provider Outbound Debug

本 feature 是开发态的 Provider
outbound 快照查看能力。原先挂在 Markdown 工具栏的开发按钮已移除，面板与 API 保留，入口以后放到专门的开发调试窗口。它只展示后端 audit
domain 已验证的安全合同，不自行拼装 Provider request，也不读取旧 `LLMHttpClient`
调试状态。

## 目录边界

- `orchestration/`：调用开发态 debug API，并用共享 audit schema 校验响应。
- `ui/`：展示 route、状态、输入聚合和 usage provenance。
- `index.ts`：唯一入口；目前没有界面挂载它。

本模块不负责模型配置、Provider 注册、请求发送、token 计算或持久化审计。API 在生产环境不挂载；404 只表示当前主进程还没有 Provider
attempt，不触发旧 endpoint fallback。
