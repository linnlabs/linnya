# 10 · IPC 与事件

> 适用场景：插件前后端通信；选择请求-响应、二进制还是推送事件。

## 标准通道：plugin:invoke

插件业务 IPC 由 backend contribution 的 `ipc` 字段原子声明：

- `ipc.channels` 是 `plugin:invoke` 的白名单。
- `ipc.register(serviceManager, registrar)` 在 App Server 注册这些 channel 的真实 handler。

渲染端只能通过统一的 `plugin:invoke(pluginId, channel, payload)` 调用。App Server 校验插件**已安装且启用**，并确认 channel 属于该插件；Electron Main 只执行已登记 channel 的 data-only 转发。

失败结果必须带 typed diagnostic，调用方不要再解析中文错误字符串：

| code | 含义 | 常见处理 |
|---|---|---|
| `validation` | 请求结构不合法，例如缺 pluginId/channel | 开发错误，记录并提示 |
| `missing` | 插件未安装 | UI 可提示安装插件 |
| `disabled` | 插件已安装但停用 | UI 可提示启用插件 |
| `permission_denied` | channel 未在插件 contribution 声明 | 架构/发布错误，不能重试 |
| `missing_handler` | 白名单存在但真实 handler 没注册 | 插件 artifact 或注册表漂移，记录诊断 |
| `crash` | handler 执行崩溃 | 展示业务错误并保留上下文 |

规则：

- 不要在 preload 里新增插件专属的硬编码方法。
- 新插件只使用 `ipc`，不要再写旧的 `ipcChannels` / `ipcRegistrars`。旧字段仅为历史磁盘 artifact 兼容保留，官方插件 backend 入口由 `PLUGIN-GUARD-05-no-legacy-ipc-contribution-fields` 防复活。
- `ipc.register` 实际注册的 channel 必须与 `ipc.channels` 完全一致；平台启动期会 fail-fast，防止白名单和真实 handler 漂移。
- `plugin:invoke` 网关必须注册在真实 `app-server-backend.cjs` 的 registry 上；Electron Main 只转发 App Server 已登记的 data-only channel，原因见 [13 构建边界与双进程 Bundle](./13-build-and-bundles.md)。
- `ipc.register` 只注册 channel handler，**不得夹带全局副作用**（worker 拉起、adapter 装配等放 `runtimeEffects`，见 [03](./03-backend-contribution.md)）。
- 插件业务 channel 不会被直接挂到 Electron `ipcMain.handle`；Electron 只暴露统一 `plugin:invoke`，真实 handler 存在插件 IPC runtime 的内部分发表里。
- 插件前端 SDK 的 `OperationResult` 保留 `diagnostic` 字段；Slides/Mindmap 这类官方插件也要透传，不要在包内把 typed diagnostic 抹平成纯字符串。
- 迁移旧功能时，先把请求-响应 channel 移入插件 `ipc` contribution，再删 preload 专属 facade 和 raw request 白名单；renderer 只改调用路由，不要顺手把 push/listener 协议一起重写。

## 传输形态选型

| 场景 | 方案 |
|---|---|
| 请求-响应（绝大多数） | `plugin:invoke`，顺带获得安装/启用门禁 |
| 小型二进制请求 | codec 支持 `ArrayBuffer`/`Uint8Array`，必须加体积上限；超过 inline 阈值由 Host 自动使用 AppData 私有 mailbox |
| Backend 到 renderer 的插件推送 | backend contribution 声明 `rendererPush.channels`，后端调用 `broadcastRendererPluginMessage(pluginId, channel, payload)`，前端用 `onRendererPluginPush(pluginId, channel, callback)` |
| token 级长流（对话 SSE） | 目前走 localhost HTTP SSE，绝大多数插件用不到 |

IPC 会不会堵、与进程隔离的关系等深入讨论见 [17 重型插件开发进阶](./17-heavy-plugins.md) 第 2 节。

## 标准推送：plugin:push

`plugin:invoke` 只覆盖请求-响应；App Server 主动推送统一走 `plugin:push` envelope，再由窄 Renderer integration port 投影。插件不能把自己的业务 push channel 加进 preload 静态白名单，也不能直接访问 `BrowserWindow`。

接入规则：

- 在 backend contribution 里声明 `rendererPush: { channels: [...] }`。这些 channel 是该插件的 push 白名单，registry 会按 enabled runtime 过滤。
- 后端发送只走 `@plugin/backend/pluginRendererPush` 的 `broadcastRendererPluginMessage(pluginId, channel, payload)`。发送前会校验插件已启用且 channel 已声明。
- Renderer 订阅只走 `@plugin/renderer/pluginPushClient` 的 `onRendererPluginPush(pluginId, channel, callback)`。preload 只暴露统一 `plugin:onPush`，内部监听 `plugin:push` 并按 `pluginId/channel` 过滤。
- payload 必须是结构化克隆友好的普通数据。业务方在插件内自己做 DTO 校验，不能依赖 Electron 事件对象。
- `plugin:push` 是 fanout 通道；需要 request/response 或错误诊断时仍用 `plugin:invoke`。

例：Sheet 的 5 个 `sheet:*` 请求 channel 由 `sheetBackendPlugin.ipc` 声明并通过 `plugin:invoke('sheet', channel, payload)` 调用；`sheet-ops-appended` 由 `sheetBackendPlugin.rendererPush` 声明，工具写入和 IPC append 共用 `createSheetOpsBroadcaster()`，最终发送统一 `plugin:push` envelope。
