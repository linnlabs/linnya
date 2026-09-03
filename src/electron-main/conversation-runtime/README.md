# Electron Conversation Runtime Adapter

本目录只实现 App Host `ConversationExecutionRuntimeFactoryPort` 的 Electron adapter：注入现有三档权限 authority、审批/卡片 host、Command Utility runner 与 Sandbox Utility fork。Commands/Sandbox 的创建、Plugin CLI、环境冻结、业务生命周期与失败收口已经统一归入 `src/app-hosts/linnya/adapters/conversation-runtime/production-runtime`，这里不再复制。

headless App Server 上线时由 `headless-node-runtime` adapter 替换本实现；两者不能在同一 production 生命周期同时创建 Commands 或 Sandbox owner。
