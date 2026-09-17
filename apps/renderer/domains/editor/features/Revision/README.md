# Revision：数据库 Pending 的编辑器投影

Revision 展示 Markdown 数据库中的待处理修改，提供块级、行内与文档级接受/拒绝入口。数据库是唯一事实源；Renderer 不拥有另一套可独立恢复、删除或提交的 Pending。

文档打开、刷新、保存和提交的生命周期由 [document-session](../document-session/README.md) 统一编排。后端正文与修订事务见 [Markdown domain](../../../../../../src/domains/markdown/README.md)，跨进程合同见 [markdown-revisions](../../../../../../packages/schemas/src/markdown-revisions.ts)。

## 身份与状态

- 每个文档的每个 rootBlock 最多一条 Pending。继续编辑更新同一条记录，ID 保持不变，`revision` 单调增加；撤回后再次产生修改属于新的 Pending。
- `canonicalPendingSessions` 是当前后端快照按 blockId 建立的索引。待处理块数只来自这个索引，与文件是否正在显示、是否滚动到该块、是否已有行内标记无关。
- `activeRevisions`、revisionMark 和投影前后节点账本均为派生缓存。投影身份包含 Pending ID 与 revision；不能用 ID 相同判断内容未变化。
- 每次安装完整快照都替换 canonical、DTO 缓存及投影账本，包括空数组。缓存不能跨文档延续。
- 投影状态区分尚未展开、已完成和失败。未展开或失败不会删除数据库事实；全局增删统计只在所有块的统计完成后展示。单个离屏 Pending 也有文档级操作入口。

`definitions/revision.ts` 定义状态与公开接口；`store/revisionState.ts` 只保存数据、同步更新和暴露派生值；`orchestration/createRevisionRuntime.ts` 编排投影与用户动作；`useRevisionStore.ts` 提供按 Editor 实例取得运行时的入口。`runtime.ts` 是不引入 UI 组件的公开入口。

## 装载与显示

文档会话先严格装载正文基线，再调用 `installPendingSnapshot`。普通文档立即投影；开启延迟投影时，1500 个 rootBlock 或 100 条 Pending 起仅安装 canonical，随后由可见窗口请求投影。大文档无需展开全文便可接受或拒绝全部。

所有文档状态变换共用 Editor 域的串行队列。可见窗口每批最多处理 20 块；Shell 的窗口桥只提交已水合的 blockId，不解释 Pending。异步投影与新文档装载不得交错写同一个 EditorState。批次由 `orchestration/batchPendingProjection.ts` 推进公开的 `view.state`，最终从原始渲染状态一次性协调 DOM；禁止写不存在的私有状态字段。异步批次期间暂时停用输入，避免用户输入混入派生事务而漏记 dirty。

投影账本保存每个块的原始节点及投影后节点，同时记录表格修订产生的临时历史块。保存从账本还原基线，再提取用户后续编辑；不能只删除 revisionMark，因为表格及块类型转换本身也改变了结构。投影失败保留原始基线，并明确标记失败。

Markdown 解析和物化继续复用 [markdownRuntime](../../services/markdownRuntime/README.md)。Revision 不维护另一套 Markdown 解释器。现有表格整块替换与历史视图属于显示策略，不改变数据库事务语义。

## 用户决策

块级与文档级接受/拒绝均通过文档会话调用同一个后端提交入口。请求携带正文版本、整份 Pending ID/revision 清单及本地基线。后端在同一事务中保存正文、更新或清除 Pending，并返回完整新快照；前端成功后才安装结果。失败不得改走全文保存或无条件清 Pending。

行内部分接受/拒绝先在不可见的 transaction 中形成候选草稿，再提交已接受的基线和剩余提议。剩余内容仍更新同一 Pending；不能只改前端 mark，否则刷新后被拒绝的片段会重新出现。

接受/拒绝是数据库提交边界。普通撤销只作用于本地编辑；安装新快照会建立新的编辑历史边界。禁止扫描撤销后出现的 mark，把旧 Pending 隐式写回数据库。已经提交的正文可通过正式文档历史恢复。

本地删除块也先属于草稿。其 Pending 随正文保存，由后端 orphan cleaner 在同一事务中清理；UI 的删除事件没有直接删除 Pending 的权限。

## 调试入口

`orchestration/devRevisionTest.ts` 提供开发期种子与诊断。种子先通过文档会话保存正文，再写入数据库 Pending；`inject` 通过正式刷新安装完整快照，`clear` 通过正式拒绝事务清理。`seed` 保留仅准备数据库数据的压测用途。调试代码也不能直接覆盖修订缓存、清除标记或另行保存正文。Renderer 只保留正式提交与开发期批量种子通道；旧的单块写入、单块清理和全文清理 IPC 已移除。

`functions/revisionMarkScan.ts` 仅读取当前标记供插入块投影校验和诊断使用，不承担撤销恢复或事实一致性判定；未显示标记的 Pending 可能仍在等待投影。

## 性能与观测

`store/revisionPendingPerf.ts` 保留投影批次耗时采样，公开到 `window.__REVISION_PERF__`；文档首次装载指标由 Editor 的 open perf 采集。Shell 窗口调度的日志与采样仍由 `orchestration/shellPendingProjection/` 管理。

出现计数与行内预览差异时，先检查当前文档会话、后端 Pending 清单与每块投影状态。计数非零而没有 mark，可能是未展开或预览失败，不能据此修改数据库。提交失败日志包含文档身份、预期版本、Pending 数量和操作类型，不打印正文。

## 验证

核心回归位于 [文档会话测试](../document-session/__tests__/markdownDocumentSession.test.ts)，覆盖空快照、快速切换、同 ID 更新、清空后不复活、并发编辑、保存中输入和失败保留。Shell 窗口、块 UI、引用及 Markdown 物化测试仍位于相邻模块；跨后端物化测试使用仓库默认 Vitest 配置。
