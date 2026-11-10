# Canvas 后端组合

本目录连接 Canvas 自有 features 与 Host 窄合同，不持有第二份正文、重复的审批记录或跨 domain 的数据库实现。

`createCanvasDocumentRuntime` 拥有一次插件运行期的视图和停用状态。文档查询、用户写动作与历史接线分别由 `createCanvasDocumentQueries`、`createCanvasDocumentWrites`、`createCanvasDocumentHistory` 负责；内容提交后的 Renderer/Workspace 通知在 `adapters/createCanvasDocumentPublications`。视图关闭和插件停用仍使用同一释放顺序，只有最后一个视图关闭才建立关闭恢复点。

`history/createCanvasHistoryRuntime` 组合用户栈、Agent 改动组、事务历史参与者及审批。用户记录与撤销遍历在 `createCanvasUserUndo`，视图基线、删除占位和 guard 可达性在 `createCanvasHistoryRetention`。`composeCanvasHistoryCommitPorts` 保留事务内的开组、版本、审阅和历史记录顺序；内存栈更新及通知仍在事务提交之后执行。公共的逆变更规则继续由 `shared/history` 拥有。

CLI 正文/图片准备和布局计算在内容事务之外进行。`prepareCanvasCliArrangement` 使用预演尺寸计算布局，`executeCanvasCliWrite` 在最终提交前重新确认文档归属、引用身份及取消状态；正式提交仍复核当前字段版本和编辑保护。历史恢复的异步资产接纳与最终事务复核在 `createCanvasVersionRestorationAction`，历史查询入口不承担恢复副作用。

组合用的依赖和输入类型分别放在 `backend/definitions` 与本目录的 `definitions`；它们只描述现有 owner 的窄能力，不提供新的全局 registry 或 manager。
