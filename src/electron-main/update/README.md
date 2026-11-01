# 应用更新

本目录是 Desktop 应用更新的唯一 owner：检查、下载、断网重试、重启前的任务确认，以及交给 App shutdown owner 的安装请求。Renderer 只渲染状态快照和发起动作，合同见 `src/shared/update/definitions/updateMessage.ts`。

## 状态

`AppUpdateController`（`orchestration/createAppUpdateController.ts`）持有唯一状态并在每次变化时推送完整快照；页面重载后用 `app-update:get-state` 取回，不依赖漏收的事件。

| 状态 | 含义 | 入口 |
| --- | --- | --- |
| `idle` | 没有更新，或后台检查失败 | 不出现 |
| `available` | 更新源有严格更新的正式版本 | 绿色图标，点击开始后台下载 |
| `downloading` | 下载中 | 图标外圈显示进度，点击看详情或取消 |
| `paused` | 网络中断，按 5s/15s/30s/60s/120s/300s 退避自动重试 | 琥珀色，可立即重试或取消 |
| `failed` | 校验失败、磁盘不足、位置不支持、安装失败等，需要用户处理 | 琥珀色，说明原因 |
| `ready` | 已下载 | “重启更新”按钮；不点的话下次正常退出时安装 |
| `installing` | 已提交安装 | 按钮显示“正在重启” |

- 只有验签通过的 official 发行版、且没有设置 `LINNYA_DISABLE_UPDATE_CHECKS=1` 时才连接更新源；其他发行版的快照 `enabled=false`，入口永远不出现。
- 版本必须是 `x.y.z` 且严格大于当前版本；预发布、相同、更旧或格式不对都视为没有更新。当前版本来自 App owner 启动时解析的产品版本，开发态不是 `app.getVersion()`。
- 后台检查在 renderer-ready 后开始，之后每 4 小时一次；失败只写日志，30 分钟后重试。手动 `check()` 返回失败原因。
- 下载期间不检查；已下载后发现更新的版本，直接在后台替换下载（用户已经同意过更新），下载期间旧文件作废。
- 错误分类见 `functions/classifyUpdateError.ts`。用户取消以 controller 本地记录为准，electron-updater 的取消错误只有 `cancelled` 文本。

## 安装

`install({ confirmedActivityKeys })` 先读取 App Server 活动快照（前台 Agent 运行、执行中的命令、知识库导入）。出现确认时没有的任务 key 就返回 `confirmation_required`，Renderer 列出任务让用户选择“暂停任务并更新”或“暂不更新”；确认后再次请求，期间新出现的任务会重新询问。确认后先暂停 Agent 运行（重启后可在原对话继续），再交给 App shutdown owner 保存文档、收口资源并以 `restart` 模式 handoff。普通退出时的顺带安装（`install_on_exit`，不重新打开）也由 shutdown owner 决定，见 [App 生命周期](../app-lifecycle/README.md)。

macOS 需要在“应用程序”文件夹中运行才能原地替换，否则不下载并提示移动。Squirrel.Mac 在 handoff 后才取包校验签名，失败时不会退出，handoff 设有 90 秒兜底退出，旧版本保持可用。

下载完成时把目标版本写入 `config.json` 的 `appUpdate.pendingInstallVersion`；下次启动若已是该版本，Renderer 显示一次“已更新到 x.y.z”。

## 验证

- `npx vitest run src/electron-main/update`：状态机、版本、错误分类、确认与安装顺序。
- `pnpm run test:app-update:download`：真实 Electron + electron-updater 连本机 generic 更新源，覆盖同版本、下载到一半断连后自动重试、校验失败与取消。不安装、不访问外网。
- `pnpm run test:shell-tool:app-update-handoff`：updater handoff 不被窗口与退出拦截。
- 真正的安装与重开只能在正式签名安装包上验收。
