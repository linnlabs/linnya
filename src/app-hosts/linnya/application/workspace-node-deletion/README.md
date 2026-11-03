# 删除节点前的引用提醒

Host 组合 Workspace 的真实活动子树范围与 Document References 的只读聚合结果。后端负责包含未展开后代、排除本次一起删除的来源、过滤软删除和跨项目失效关系；Renderer 不靠当前加载树推测引用数。

SDK `previewDocumentDeletionReferences` 通过 typed IPC 查询。统一 app deletion coordinator 把原有单项/批量确认与引用风险放在同一个应用内弹窗；取消不删除、不改变活动页，也不显示成功提示。确认只是当前引用影响提示，保留现有无文件锁/稳定节点身份删除语义。
