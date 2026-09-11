# Electron 开发构建会话

本 feature 只拥有开发任务依赖、首次成功和进程释放。编译配置仍归各 package/build owner，运行时业务就绪仍归 App Server。

`pnpm run dev:electron` 按 `definitions/electronDevelopmentBuilds.mjs` 的依赖图启动构建：独立 runtime、WASM、资源和
原生检查可以并行；Schema 的 CJS/ESM 与 Provider Catalog 就绪后才放行 Backend、Main 和插件消费者。
Vite 在自身依赖完成后启动并预热；Electron 等待所有本轮构建、资源复制与门禁完成。`--build-only` 走完全相同的准备链并关闭会话，不打开 Electron。

长期构建通过子进程 IPC 报告成功，不解析终端文案，不用旧文件存在充当 ready。首次构建失败立即阻断启动，后续编辑错误留在 watcher 中报告，修复后继续重建。
同一构建进程承担首轮与后续监听，tsup 的首轮 ready 包含声明生成，配置的资源复制也属于构建完成条件。
单次任务通过退出码报告成功。Schema watch 的双格式修正归 `packages/schemas/scripts/watch-runtime.cjs`。

磁盘插件通过自身 metadata 声明 tsup 配置，见 [plugin-backend-composition](../plugin-backend-composition/README.md)。
插件与 Core Backend 的 watcher 更新磁盘制品，已经运行的 App Server 不自动替换模块；Backend 改动需重启开发会话，Renderer 继续使用 Vite HMR。

退出、信号和首次构建失败统一进入进程 scope，只关闭本次启动的子进程与 Vite。watcher 先收到关闭消息；未退出的进程树在限定时间后终止。
不得按进程名清理机器上的其他 Electron/Node，也不能通过跳过门禁或自动重置数据缩短启动。

行为验证覆盖独立任务并行、依赖只执行一次、旧产物不能掩盖失败、watcher 保持与退出收口；真实配置验证使用
`pnpm run dev:electron --build-only`。涉及应用交互时再运行隔离的 Electron E2E。
