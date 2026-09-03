# Electron Command Hosts

本目录只保留 Electron Main 侧的命令桌面边界：Renderer 身份校验、typed RPC gateway，以及用于历史平台门禁的 Electron Utility runner fixture。生产命令权限、审批、命令卡和 execution owner 全部位于 App Server；Main 不创建第二套 owner，也不转发 stdout/PTY 数据面。

## 子模块

- `runner-runtime`：仅供 Electron Utility 平台 fixture 验证 transport；生产使用 App Server 的 headless Node runner adapter。
- `production-runtime`：旧 Electron composition 的集成测试装配，不被 Desktop App 启动链导入；公共生产组合根位于 App Host。

业务说明见 App Host 的 [approval-host](../../app-hosts/linnya/adapters/commands/approval-host/README.md)、[permission-settings-authority](../../app-hosts/linnya/adapters/commands/permission-settings-authority/README.md) 与 [command-card-control-host](../../app-hosts/linnya/adapters/commands/command-card-control-host/README.md)。历史平台 fixture 说明见 [production-runtime](./production-runtime/README.md) 与 [runner-runtime](./runner-runtime/README.md)。

## IPC 安全规则

- 页面身份来自 `event.sender.id` 和主进程签发的 page ticket，不信任 Renderer payload 中的身份。
- IPC 只传稳定 DTO；不传 PID、Job、文件路径、Readable、Electron 对象或权限 authority 引用。
- 页面 reload、导航、销毁和 App owner end 都必须让旧 pending 请求失效。
- 用户审批只能作用于对应的不可变 proposal，不能通过 request ID 猜测其他 execution。
## Plugin CLI bridge

Electron composition root 安装 enabled plugin CLI 的薄 facade，把 launcher 目录加入冻结的 Shell PATH，并将
enabled backend registry 交给 app-level `plugin-cli-shell-bridge` workflow。Electron Main 不解析插件 argv，
不 import Slides 实现。facade 是父 Shell 树中的普通原生进程；bridge 只把 invocation 作为父 execution 的
受管子活动，不创建另一个 Utility、owner binding、approval、output writer 或 terminal。

插件停用或升级时，registry 先进入 draining：拒绝新 invocation、abort 并等待现有 invocation 退出，
再注销 hidden worker/runtime effect。这样旧插件代码不会在资源卸载后继续访问 DB 或 worker。

## 生命周期

App 关闭先通知 command owner 收口，再排空已经进入的审计和卡片写入，最后关闭 IPC host。普通退出和 updater handoff 共用 typed shutdown owner，但更新交接不能被普通 close listener 拦截。

## 测试

审批、permission authority、命令卡与生产 scope 的业务门禁位于 App Host。Electron 侧测试只验证 sender 校验和 RPC gateway；真实生产链必须穿过 Main → App Server → headless runner，旧 Utility fixture 不能替代 production cutover 回归。
