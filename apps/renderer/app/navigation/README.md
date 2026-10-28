# Navigation scope

这里拥有应用的导航上下文：当前项目或 Linnya Assistant、该上下文的新会话草稿，以及最近会话选择。切换导航不会切换 Runtime、数据库或数据工作区。Workspace、Project、会话工作目录的区别统一见[产品模型](../../../../docs/product-model-overview.md#20-workspaceproject-与导航上下文)。

各 domain 只通过本目录 `index.ts` 使用 `useNavigationScope`、`NavigationScope` 与身份比较函数。公开入口提供响应式只读状态和显式动作，不暴露内部 store mutation，也不依赖任何业务 domain。保存文档、加载历史和布局切换继续由 `app/layout` 编排。

- `definitions/`：导航、切换事件和草稿状态合同。
- `functions/`：导航身份、复制和比较。
- `orchestration/`：协调切换前通知、状态提交、切换后通知，以及草稿与最近会话。
- `adapters/`：导航持久化适配。
- `app/store/navigationScopeStore.ts`：应用级状态与同步写入 action。

切换事件与每个 Pinia 状态实例同寿命，不能跨应用实例发送。相同 scope 不重复发切换事件；切换前清理仍发生在状态提交前，供图片草稿等调用方释放旧上下文资源。

持久化继续使用既有 `workspace-scope` 键和数据形状；这个键是存储合同，不是 Workspace 实体。保留既有的旧项目选择一次性迁移，代码改名不丢失当前项目、草稿与最近会话。

验证入口：`pnpm exec vitest run apps/renderer/app/navigation apps/renderer/app/layout/orchestration/openProjectWorkspaceFromSidebar.test.ts apps/renderer/domains/conversation/services/orchestration/startDraftConversation.test.ts`。
