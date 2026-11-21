# Backend Health（后台服务状态条）

Renderer 侧只做一件事：把 Main 推送的后台服务状态显示在内容区顶部，并提供“重新启动”“查看日志”。状态的判断、
计数和重开全部在 Main（[App Server Health](../../../../src/electron-main/app-server-health/README.md)）。

## 结构

- `store/`：当前状态快照与 `isUnavailable`（`restarting` / `stopped`）。只由生命周期写入。
- `orchestration/startBackendHealthLifecycle.ts`：先订阅推送再取一次快照，避免漏掉启动瞬间的变化。
- `ui/BackendHealthStrip.vue`：`.content-area` 的第一行，占位而不是浮层，不遮挡对话首条消息；`ok` 时不渲染。
- `definitions/`：中英文文案，经应用 localization 注册。

## 各状态

| 状态 | 显示 | 操作 |
| --- | --- | --- |
| `restarting` | 后台服务意外停止，正在重新启动… | 无 |
| `recovered` | 已恢复，中断的对话在侧栏有红点；8 秒后由 Main 收起 | 无 |
| `stopped` | 反复停止，已暂停自动重启 | 查看日志、重新启动 |
| `unresponsive` | 15 秒没有响应 | 重新启动后台服务（先确认，会中断正在进行的回复） |

重新启动请求失败用 warning 通知提示，因为后台不可用期间 error 通知被收起。

## 与其他界面的约定

后台不可用期间，这条状态条是唯一的错误出口：

- 全局通知不显示 error 类型，免得请求失败刷出一串报错；
- 侧栏运行状态整体隐藏，重开后由启动恢复给出可信的“已中断”。

新功能需要在后台不可用时改变行为，读 `useBackendHealthStore().isUnavailable`，不要自己监听 IPC 或猜测连接状态。
