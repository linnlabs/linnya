# Workspace Node Move

本 feature 拥有同一个项目内改变节点父目录的持久化用例。`WorkspaceService.moveNode` 只做薄委托和提交后 mutation 发布。

后端必须保证：

- 来源节点存在且未删除；
- 非根目标存在、未删除并且类型是 `folder`；
- 来源与目标属于同一项目；
- 目标不是来源自身或来源文件夹的任何后代；
- 目标位置没有同名活动节点。

这些规则必须在后端执行，前端拖拽校验只用于即时交互反馈。`move-node` 不能用于跨项目转移；跨项目语义由相邻的 `node-transfer` feature 拥有。
