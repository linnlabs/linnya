# Development Data Lifecycle

该 use case 是 Linnya 默认开发运行态的应用级准入边界。它横跨 Workspace、Model
Catalog、Conversation、Knowledge、assets 和插件状态，因此不归属于任何单一 domain。

## 公开合同

- `definitions/` 只声明 epoch、状态文件、路径与 filesystem port。
- `functions/` 只解析状态、判断准入和解析固定路径，不访问磁盘。
- `orchestration/` 只编排“读取 → 判断 → 建立 marker / 拒绝”和“盘点 → 整体隔离”。
- Node 文件系统实现位于 app host adapter；Electron 启动和 maintenance
  CLI 都复用同一 use case。

主进程只在非打包且 `LINNYA_DEV_MODE=true`
时调用准入，并且必须发生在业务服务初始化之前。非空目录缺 marker、marker 损坏或 epoch 不一致都会失败；启动链不自动迁移、不自动删除，也不按异常类型猜测兼容路径。

当前 epoch 是 2：桌面 Host Schema 已从 v1-v60 历史升级链切换为 v61 当前事实基线。epoch 1
目录必须整体隔离后重建，不能只修改 SQLite `user_version` 或局部清表。

## 维护规则

发生持久化 envelope、baseline
migration、跨 domain 标识或受管目录布局的不兼容变化时，同一提交必须提升
`CURRENT_DEVELOPMENT_DATA_EPOCH`，更新正式开发文档，并验证旧目录在任何 domain 初始化前被拒绝。

重置入口固定为 `pnpm run dev:data:reset`。它不接受目标参数，只把仓库根
`_dev_data`
移入同盘隔离目录。不要增加按表、按插件或按 domain 的常用 reset；当前开发阶段不保留 live 数据，局部删除会制造跨边界悬挂引用。

`LINNYA_WORKSPACE_DIR`
指向的外部 Workspace 不由该命令管理。需要做破坏式验证时，应使用默认 `_dev_data`
或独立 disposable Workspace，不能把外部长期数据当作可重置开发运行态。
