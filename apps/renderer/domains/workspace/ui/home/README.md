# workspace/ui/home 迁移说明

本目录只保留项目知识库设置面板；旧应用主页组件已删除。

## 当前职责

- `ProjectKbSettingsPanel.vue`：项目知识库设置面板。

## 迁移方向

- 对话主区入口位于 `app/pages/ChatCentricPage/ChatCentricPage.vue`，主区与右侧的共享装配位于 `app/pages/WorkspaceConversationSurface/WorkspaceConversationSurface.vue`。
- `Linnya 助手` 使用 `domains/conversation/ui/LinnyaAssistantChatSurface.vue`。
- 项目对话表面是跨 conversation、workspace、knowledgebase 的 app-level 组合，位于 `app/pages/WorkspaceConversationSurface/ProjectConversationSurface.vue`。

## 已清理

- 未使用的旧项目聊天视图已删除。
- 大而全的旧项目入口组件已删除，中央对话能力已下沉到 conversation domain。
- 旧应用主页组件集合已删除，相关入口能力已迁移到侧栏、Header 或项目概览 surface。
- 旧项目对话页草案已由实施总计划取代。
