# 项目目录刷新

`refreshProjectCatalog` 是项目事实变更后的只读刷新入口。App-level mutation effects 收到
`project.created / project.updated` 后调用它；即使事件属于其他项目，也必须刷新整个项目列表。

流程只通过 `projectGateway.list` 获取 Backend 正式记录，复用 domain `shared/projectRecord` 投影，
最后调用 `WorkspaceProjectsStore.replaceProjects` 同步写入状态。失败交给既有通知订阅层记录，
不以空数组替代失败结果。该流程不创建默认项目、不切换 NavigationScope，也不重置草稿或文档树。

历史启动入口 `loadProjects` 在空列表时会创建默认项目，不能用于事件刷新。现有 store 的旧异步动作
尚未整体迁出，本 feature 的新增流程遵循 orchestration 调用纯 store action 的方向。

验证：`refreshProjectCatalog.integration.test.ts` 使用真实 Pinia 与导航状态，覆盖其他项目创建、
当前项目改名、草稿保留和空列表只读行为。跨进程事件传输由 Renderer integration RPC 集成测试覆盖。
