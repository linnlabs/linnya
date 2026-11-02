# 项目目录刷新

`refreshProjectCatalog` 是项目事实变更后的只读刷新入口。App-level mutation effects 收到
`project.created / project.updated` 后调用它；即使事件属于其他项目，也必须刷新整个项目列表。
手动或 AI 创建项目成功后也调用此入口，保留现有侧栏列表挂载，让按创建时间倒序的正式记录驱动顶部插入动效。

流程只通过 `projectGateway.list` 获取 Backend 正式记录，复用 domain `shared/projectRecord` 投影，
最后调用 `WorkspaceProjectsStore.replaceProjects` 同步写入状态。失败交给既有通知订阅层记录，
不以空数组替代失败结果。该流程不创建默认项目、不切换 NavigationScope，也不重置草稿或文档树。

创建回执和 mutation 通知可以各自读取正式目录，但内容与顺序相同时不重复写入 store。
否则迟到的相同快照会使正在移动的 TransitionGroup 重算位置，造成下移动画被打断并重新播放。

历史启动入口 `loadProjects` 在空列表时会创建默认项目，不能用于事件刷新。现有 store 的旧异步动作
尚未整体迁出，本 feature 的新增流程遵循 orchestration 调用纯 store action 的方向。

验证：`refreshProjectCatalog.integration.test.ts` 使用真实 Pinia 与导航状态，覆盖其他项目创建、
当前项目改名、草稿保留和空列表只读行为。跨进程事件传输由 Renderer integration RPC 集成测试覆盖。
