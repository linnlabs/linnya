# 受管 Worker 队列

`WorkerThreadQueue` 只持有线程、任务快照、消息和取消生命周期。业务状态不进入通用队列；`settled` 表示线程已退出且所有 Host 推理请求已停止，不等同于 completed/cancel ack。

Host `QueueManager` 只装配 AudioProcessingQueue。知识库的摄入、图谱抽取和图谱索引已经由[官方插件](../../../packages/plugins/knowledge/README.md)独立拥有，插件停用不能 shutdown 音频队列。

插件通过 `@plugin/backend/workerQueue` 创建自己 artifact 下的队列，不能传任意路径、raw Worker、环境或 Host 服务。
正式 Host `plugin-runtime.worker.cjs` 先在受限 artifact 范围安装依赖解析，再加载目标 Worker；原生 SQLite、PDF.js、Canvas、Sharp、Jieba 由 Host 现有生产依赖提供。
Worker 内联的数据库口只打开被冻结的工作区连接，不能迁移或选择任意数据库路径；模型请求经现有消息通道返回 Host，目录与凭据不进入插件。

`resolveQueueWorkerRuntime` 只检查 Audio 与插件 bootstrap 两个 Host 产物。开发启动等待这两个文件，三个知识库 Worker 的产物就绪由插件 package metadata 的 requiredOutputs 管理。
