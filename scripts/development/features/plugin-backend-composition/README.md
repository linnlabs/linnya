# 开发态插件 Backend 装配

这个 feature 负责把“插件 backend 如何进入本地 Linnya 运行态”从 Host 静态源码 import
改成插件 owner 自己声明的开发装配输入。

同仓但不应进入公共 Core 模块图的插件，可在自己的 `package.json` 中把
`linnya.development.backendLoading` 声明为 `disk`，同时通过 `backendWatchConfig` 指定包内 tsup 配置路径。
字段定义以发现函数和对应合同测试为准，文档不复制实现。

`dev:electron` 通过 build-session 为这些插件分别启动长期 watcher，确保 `@app/schemas` 与
Provider Catalog 的本轮产物就绪后才启动插件构建，并等待插件首次成功（包括配置中的资源复制）。
单独的一次性构建仍使用根级 `build:development-disk-plugin-backends`，由它先执行
`prepare:backend-workspace-dependencies` 再执行各插件的 `build:backend`。两条入口都不能依赖旧工作区残留的 `dist`。
随后启动编排把插件 package
目录写入 `LINNYA_PLUGIN_BACKEND_DIRECT_DIRS`。Host 只读取 `plugin.json` 指向的已构建 backend
entry，不 import 插件源码；Renderer 仍把该目录当作开发源码 package，继续使用 Vite 源码入口与
HMR。Backend watcher 只重建磁盘制品；已经加载到 App Server 的模块不会自动替换，修改 Backend 后需重启开发会话。

插件迁到独立仓后，不再依赖 workspace 扫描。插件仓自行构建 backend，然后由本地启动环境把一个或多个 package
目录通过平台路径分隔符写入 `LINNYA_PLUGIN_BACKEND_DIRECT_DIRS`。正式合并和发布验收仍必须改用完整插件
artifact，direct dir 只属于开发协作合同。

这里禁止加入插件 ID、私有仓 URL或相邻目录默认值。某个插件是否选择 `disk` 由插件自己的 package
metadata 决定；外置仓位置由开发者环境决定。
