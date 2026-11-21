# App Server Health

Main 持有后台服务（App Server）可用性的唯一状态：`ok`、`unresponsive`、`restarting`、`stopped`、`recovered`。
合同见 `src/shared/app-server-health/definitions/appServerHealthMessage.ts`；Renderer 只渲染快照并发起“重新启动”“查看日志”。

## 规则

- **意外停止**：App Server ready 之后的非宿主发起退出才算。5 分钟内前两次先推送 `restarting`，1.5 秒后
  重新打开整个应用（见下文“谁来重开”）；启动恢复把遗留运行标成中断，侧栏照常出红点。第三次推送
  `stopped`，不再自动重启。启动阶段的退出仍由启动失败对话框负责。
- **重新打开而非原地重启**：Main 的 IPC、命令网关、隐藏 Worker、Renderer 缓存都绑定在本次 App Server 上，
  原地换进程要逐个重接且容易留下过时状态；重开应用复用正常启动路径。重开前写入恢复标记，下一次启动推送
  `recovered`，8 秒后回到 `ok`。
- **无响应**：每 5 秒经控制通道 ping 一次（自带 5 秒超时），连续 15 秒没有回应推送 `unresponsive`，回应后回到
  `ok`。不自动处理；用户点“重新启动后台服务”时先 SIGKILL 该进程，退出后重开应用。
- **用户重新启动**：清空意外停止计数，不计入限额。
- 正常退出、更新安装等宿主发起的 App Server 关闭（`exit.expected`）不触发任何状态。

计数与恢复标记存在 Main 的 `store`（`appServerHealth.*`），只影响提示，不参与运行事实。

## 谁来重开

正式安装包里由 `app.relaunch()` 加正常退出完成。开发启动器（`pnpm run dev:electron`）和 Desktop 开发探针
需要保住它们自己启动的 Vite 和进程看管，所以启动 Electron 时设置
`LINNYA_LAUNCHER_HANDLES_RELAUNCH=1`：Main 不调用 `app.relaunch()`，正常退出后以退出码 75 结束，
启动器看到 75 就重新启动 Electron，Vite 保持不动。常量在
`src/shared/app-server-health/definitions/appServerHealthMessage.ts`，脚本侧副本
`scripts/development/features/build-session/definitions/appLauncherRelaunch.mjs` 由测试核对一致。

## 工具不响应停止

暂停或取消后，Linnkit（0.45.0 起）最多再等工具 3 秒；仍未结束就放弃等待，按已停止收口，晚到的结果丢弃。
这一层不在本目录，但与上面的规则共同保证“停止”总能在几秒内生效。
