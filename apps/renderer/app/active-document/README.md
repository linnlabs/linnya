# 应用活动文档状态

`useFileStore` 是当前单个活动文档的公开状态入口，内部状态位于 `app/store/activeDocumentStore.ts`。Editor、Workspace 文件会话与应用壳层共用同一份身份、dirty、loading、saving 和自动保存间隔；Pinia ID 仍为 `file`。

这里只持有状态、派生展示事实和同步 action。打开、保存、关闭仍由 Workspace file-manager 与 Editor 文档会话执行。调用方通过 action 更新状态，不在 store 中调用领域流程。
