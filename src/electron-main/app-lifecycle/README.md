# Electron App 生命周期

本目录只放 App owner 级别的定义与编排。Commands domain 负责命令状态和进程 owner；窗口层只读取“是否存在真实执行中的命令”，不能取得 PID、handle 或停止单条命令的内部能力。

最后窗口、菜单退出、启动失败和安装更新共用一个 typed App shutdown owner。普通退出有活动命令时先让用户返回或停止全部；安装更新使用“稍后更新 / 停止任务并更新”的独立文案，但复用同一 renderer 保存屏障。窗口编排不直接结束命令 owner，也不能自行放行关闭。正式收口先停止 Backend admission 并等待 Command/Profiled Code Sandbox owner，随后卸载 Backend plugin runtime resources，最后才由 Desktop Host 销毁 Browser Pretext 等隐藏窗口；不能在仍有后端调用时抢先关闭 Desktop capability。

退出意图遵循“先提交者唯一生效”：普通退出与安装更新在确认阶段互不抢占，启动失败可以接管尚未提交的确认；一旦进入 `shutdown_committed`，迟到 IPC、activate、second-instance 和另一种退出意图都不能替换它。统一 commit port 会为普通退出、安装更新和启动失败单向放行 BrowserWindow，不能把许可放进普通 `app.quit()` 分支，否则 updater handoff 会被正式 close listener 拦截。`preparing_exit` 期间原窗口保持可用，但不允许创建第二个窗口；用户返回后才恢复 `running`。

普通退出与启动失败在参与者和日志收口后由 Electron 退出；启动失败固定退出码 1。更新只有在下载 ready、用户确认、renderer 保存、网页 renderer/measurement/backend/命令 owner 和日志全部收口后才调用 updater handoff。handoff 前切换到 `update_handoff`，使 `quitAndInstall()` 触发的 `before-quit`/`will-quit` 不再被 host 拦截；该阶段有意保持到进程交给 updater。handoff 抛错则恢复 committed 并以 1 退出。`autoInstallOnAppQuit` 必须关闭。

不能恢复固定等待时间。renderer 在 App 根监听安装后先声明就绪，主进程才发送带页面会话和唯一请求编号的保存请求；插件初始化不阻塞这次握手。慢保存不是保存成功；保存失败保持窗口并允许下一次关闭重试。请求发出后页面导航会让旧请求明确失败，旧页面结果不能完成新请求。renderer 已销毁时没有页面状态可保存，此时继续结束 App owner，避免留下无窗口命令。

主进程还负责在后端和 worker 启动前冻结默认模型配置路径。完整 App 验收和企业部署可以通过 `MODEL_REGISTRY_DEFAULTS_PATH` 提供已经存在的绝对路径；相对路径或不存在的路径会明确阻止启动。未显式配置时，发布态只读取 `app.getAppPath()/dist/domains/model-catalog/default_models.json`，开发态只读取启动 cwd 所代表仓库根下的源码资产。`app.getAppPath()` 在 `electron dist/main/main.cjs` 开发命令中是 bundle 入口目录，不能当作仓库根；这里不搜索父目录、不维护候选路径，也不建立第二套模型目录或缺失文件回退。

产品版本同样由 App owner 在启动时解析一次：发布包使用 `app.getVersion()`；源码运行必须使用
正式 `dev:electron` / `start:electron` 启动器从根 manifest 注入的 `APP_VERSION`。开发命令直接
启动 Main bundle 时，Electron 的 `getVersion()` 是运行时版本，不能作为 Linnya 版本回退。
缺少开发版本会阻止启动；Main 不把根 manifest 打进 bundle，也不在运行时搜索文件。
发行身份校验、Backend bootstrap、ready 与 CLI doctor 共享这份版本事实，Backend 不重新读取环境。

命令执行 owner 的退出收口属于本目录与 [Electron Command Hosts](../commands/README.md) 的组合合同；具体命令终态仍由 Commands owner 提供，窗口层不能自行猜测。

诊断日志也属于 App owner 生命周期。`app-lifecycle.js` 在任何业务日志写入前确定正式日志路径并启用唯一文件 writer，退出时负责 drain。App Server 和 Worker 都只生产严格日志 envelope：App Server 通过非阻塞 reverse RPC、Worker 通过所属 owner 转发，不能自行打开第二个日志文件或让日志反压阻塞业务事件循环。

Main 的 event-loop 响应性 monitor 同样由 App owner 创建和停止。它每 5 秒读取一次 delay histogram 与 event-loop utilization；p99 超过 25ms 或单窗 max 超过 100ms 时写结构化告警。健康 sample 默认不写日志，只有显式设置 `LINNYA_RESPONSIVENESS_DIAGNOSTICS=true` 的基线运行才记录，避免观测本身制造周期日志压力。sample 不能成为业务事实或 UI 状态。

生产 Main 只加载由精确 Electron Main Process 生成的 `main.jsc`；App Server 以固定随包 Node 直接执行 `app-server-entry.cjs`/`app-server-backend.cjs`。构建会主动删除旧 `ts-backend.js/.cjs/.jsc`，启动链没有同进程 fallback。Main 在创建业务窗口前等待 App Server 的真实 ready 事实；关闭 App、启动失败和 updater handoff 都通过同一 owner 收口 App Server 及其全部后代。
