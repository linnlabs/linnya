# 插件受管 Node Worker

`@plugin/backend/workerQueue` 让已准入且启用的 Backend 插件创建自己的队列。这里把插件的
任务、artifact 相对入口与推理准入转换为通用 `WorkerThreadQueue`；插件不取得原始线程或 Host 队列单例。

## 归属与生命周期

- artifact 目录只读插件装配 owner 的正式记录，不能由调用者传入绝对路径；入口经过 realpath 后仍须属于同一 artifact。
- 队列创建与入队都核对启用状态；旧 artifact 被替换后原队列拒绝新任务。插件 runtime effect 的 disposer 必须 await `shutdown()`。
- `addTask` 冻结业务 job 和该 job 的推理准入。`getTask/listTasks` 返回副本，状态复用通用队列的 pending/running/completed/failed，不建立第二份持久状态。
- `cancelTask` 表示取消已接纳；真正释放业务活动租约必须等待 `settled`。完成、失败、取消和线程意外退出都要等线程与它发出的 Host 请求停止。`shutdown` 停止接单并等待相同收尾。
- progress/completed/failed/settled 订阅返回 disposer；失败保留通用队列记录的错误消息。队列不提供暂停/恢复，也不解释摄入或图谱状态。

## Host 与 Worker 各自持有的事实

Host 只注入操作系统执行所需的 PATH、Windows 系统目录、临时目录、locale、时区和 NODE_ENV；不会复制全部 `process.env`，API Key 和 Node 注入选项不进入新插件线程。Audio 等已有调用者未提供此选项时保持原环境。

Host 从 Backend 启动事实冻结 `plugin-runtime.worker.cjs` 路径。该随包启动器以自身位置为依赖锚点，在插件求值前注册 Node 24 同步 resolve hook；名单仅包含实际使用的 SQLite、Sharp、Canvas、PDF.js 入口与资源定位、Jieba 和其词典。不会依靠源码目录、cwd、NODE_PATH 或插件传入的安装根。未列入名单的子模块、artifact 外调用不获得此映射；Node 正常解析规则仍保留。

数据库路径和 schema 版本由 Host 从当前已打开的数据库冻结，写入专用 `__linnyaWorkerHost` 字段；业务 job 同名字段不能覆盖它。Worker 的 `openPluginWorkerDatabase()` 无路径参数，只交付 prepare/transaction/close。连接与 `DatabaseService.initializeConnectionOnly()` 共用 schema 准入、foreign_keys、busy_timeout 和 WAL 初始化，不运行 migration 或插件 lifecycle。

插件 repository 仍只能访问自有表；这属于可信代码的 owner 边界，不是 SQL 沙箱。此改动不重写既有 Worker 业务读写方式。SoT、原件、任务临时目录等业务资源由插件 job owner 冻结，不新增任意路径 SDK。

模型配置和凭据始终留在 Host。每个 job 的 operation/modelId/输入文件范围交给既有 inference Worker bridge；取消、失败投影和 OCR 文件归属沿用同一实现。

## 构建与验证

`scripts/build/plugin-worker-sdk.mjs` 提供 Worker bundle 的窄实现 alias。`worker/databaseRuntime` 与 `worker/inferenceRuntime` 必须内联，不能 external 后依赖 Backend 临时 require hook；better-sqlite3 仍由正式 native runtime 提供。

相邻真实线程测试将 bare-external artifact 放在操作系统临时目录、Host 启动器保持在其安装树。可通过 `LINNYA_TEST_HOST_WORKER_BOOTSTRAP` 指定 `build:worker` 产生的正式入口复演；不能给原生模块注入绝对 alias。测试使用 SQLite，覆盖写入/回滚、schema/pragma、环境、artifact 归属、停用/关闭、冻结模型，以及取消和意外退出时 Host 请求清理。测试不访问用户库。插件最终 artifact、真实解析与 Desktop 平台验收由消费这些 SDK 的插件完成，基础测试不代替产品验收。

同一正式队列还验证 PDF 文本与直接上传 OCR 临时素材清理、PNG/JPEG/WebP/GIF/BMP、Jieba 词典、日志和业务消息并存。OCR/视觉仅用合成 Host 推理响应，不代表真实供应商连通。
