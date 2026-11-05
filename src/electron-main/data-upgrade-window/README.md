# Desktop 数据升级窗口

App Server 启动时如果需要升级数据格式、且升级超过 1 秒仍未完成，Desktop 显示一个“正在升级数据”的小窗口：Linnya 标记、标题、一句提示和按步骤推进的进度条。一般升级在启动时几百毫秒内完成，用户看不到这个窗口。

## 时序

- 进度来自 App Server 控制协议的 `startup_progress`（见 [App Server Control](../../app-hosts/linnya/app-server-control/README.md)）。只有 `upgrading=true` 的启动才可能显示。
- `started` 后 1 秒仍未 `finished` 才打开；在此之前结束的升级不显示，避免一闪而过。升级已经结束、只是其他启动步骤较慢时也不再打开。
- 窗口一旦显示，至少保留 800ms。App Server ready 后，`settle()` 等到最短显示时间，再创建主窗口。
- 主窗口创建后才关闭升级窗口。先关会让 Windows/Linux 触发“最后一个窗口关闭”，被当成退出。
- 启动失败时先隐藏窗口，再显示错误对话框；窗口随 App 退出收口。

进度按步骤计算：每个 Host 迁移步骤一格，插件迁移与建索引合为最后一格。单个步骤可能持续几分钟，进度条上的流光表示仍在进行。不显示剩余时间：迁移耗时取决于数据量与磁盘缓存冷热，开始前无法可靠估计（见[迁移文档](../services/database/migrations/README.md#升级耗时与启动进度)）。

## 窗口

- 无边框、不可调整大小，可拖动；页面不执行脚本（`javascript: false`、`sandbox`、CSP 只允许内联样式），不能导航或打开新窗口。进度通过 `insertCSS` 更新 `--progress`。
- 升级期间拦下用户关窗：中途退出只会让当前迁移步骤回滚、下次启动重来。App 已提交退出（例如启动失败）后放行；程序关闭用 `destroy()`。
- 颜色取 Renderer 设计 token 的实际值，随系统深浅色切换；主进程还没有 Renderer 的语言设置，按系统语言选择中文或英文。
