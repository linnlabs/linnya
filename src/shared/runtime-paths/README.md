# Runtime Path Roots

该模块只定义一个跨业务、跨进程稳定的基础合同：当前 JavaScript 运行域使用哪一组持久化根目录。

Desktop Host 是生产路径的唯一解析者。它在启动时读取 Electron 的 `userData` / `documents`、开发根目录和 `LINNYA_WORKSPACE_DIR`，生成并冻结 `RuntimePathRoots`，然后把纯数据事实传给 App Server 和 Queue Worker。App Server、Worker 与业务 domain 不得再次加载 Electron、读取自己的 `cwd` 或用用户 Home 目录猜另一套路径。

`registry/` 只解决同一运行域内大量历史 `pathManager` 调用尚未完成依赖注入的问题：同值安装幂等，不同值安装失败。它不是可切换配置中心，也不能被 feature 当成新的全局 service。新增业务应优先接收所需的窄路径或 storage port；待历史调用迁完后删除该 registry 和 `pathManager` 聚合对象。

源码脚本与测试可能不经过 Desktop Host，因此 `pathManager` 仅在 `LINNYA_DEV_MODE=true` 或 `NODE_ENV=test` 时允许使用仓库 `_dev_data`。正式运行域缺少已安装事实会直接失败，不回退到 `~/.linnya`、`~/Documents/Linnya` 或启动 `cwd`。

Queue owner 把同一份事实放入每个 Worker 的 `workerData`。Worker 必须先安装事实再初始化数据库、模型目录或知识库仓储；不得恢复 `PROJECT_ROOT` / `WORKER_PROJECT_ROOT` 推断逻辑。
