# Electron Desktop Host

`src/electron-main/` 是 Linnya Desktop Host 的入口和 Electron adapter 所在地。它拥有 Electron App 生命周期、窗口与系统能力、Preload/IPC 安全边界，以及独立 App Server 进程的启动、监督和关闭。

这个目录名不能直接代表运行 owner：部分 App Server 代码仍因历史原因物理位于这里。判断职责时必须沿生产组合根和调用链确认执行进程，不能仅凭路径归类。

## 负责与不负责

Electron Main 负责：

- 单实例、启动、窗口、权限、协议、更新和统一退出；
- 解析并冻结 Desktop 路径与平台事实，启动固定 Node 中的 App Server；
- 向 App Server 提供 safeStorage、系统浏览器、文件定位、隐藏 Chromium、PDF 和文本测量等窄 Desktop capability；
- 对 Renderer 页面身份做 admission，并转发 App Server 已登记的 data-only request/push；
- 通过 Preload 暴露受限 Renderer API，不向页面暴露 Electron 对象或任意 IPC。

Electron Main 不负责：

- HTTP/SSE、业务数据库、Agent loop、模型 Provider 或插件 Backend；
- Commands、Sandbox、Knowledge、Workspace 等业务规则和状态 owner；
- 解释 App Server 业务 payload、复制业务 registry，或为业务建立第二套 enabled/permission 状态。

业务 Backend 的生产组合根是 [`src/app-hosts/linnya/app-server-runtime`](../app-hosts/linnya/app-server-runtime/README.md)，后端总导航见 [`src/README.md`](../README.md)。

## 启动与关闭主链

1. `index.js` 准备开发环境、注册 privileged scheme、取得单实例所有权，并选择 Desktop App 或受控插件 CLI 模式。
2. `app-lifecycle.js` 在 `app.whenReady()` 后冻结路径和插件环境，注册协议与系统权限策略。
3. `app-server-runtime/` 用随包固定 Node 启动唯一 App Server，传入严格 bootstrap，并等待真实 ready identity。
4. Main 注册 Renderer request gateway、Commands 的 Desktop admission host 和自身拥有的系统 IPC，然后创建主窗口。
5. 普通退出、启动失败和安装更新统一经过 `app-lifecycle/`：先停止 App Server 及其后代，再释放 Desktop capability、日志和窗口。

Main 不允许加载 `app-server-backend.cjs`、打开 `workspace.sqlite`，也不存在同进程 Backend fallback。

## 修改地图

| 要修改什么 | 第一入口 | 边界 |
| --- | --- | --- |
| 启动、单实例、窗口关闭、App 退出 | [`index.js`](./index.js)、[`app-lifecycle/`](./app-lifecycle/README.md)、`window-manager.js` | 只编排 App owner，不取得 Backend 内部对象 |
| App Server 子进程、bootstrap、双向 RPC | [`app-server-runtime/`](./app-server-runtime/README.md) | Main 只托管进程并实现 Desktop reverse capability |
| Renderer 的 Preload API 与 IPC 白名单 | `preload/`、`ipc/index.js`、`ipc/handlers/index.ts` | 页面只见稳定 DTO；新增业务 handler 应注册到 App Server request registry |
| App Server 业务请求转发 | `app-server-runtime/orchestration/registerBackendRendererRequestIpcHandlers.ts` | 只转发 App Server 已登记 channel，完整合同见 [Backend Renderer Requests](../app-hosts/linnya/adapters/backend-renderer-requests/README.md) |
| safeStorage、OAuth browser、文件定位、PDF、隐藏窗口等 | `desktop-capabilities/`、`hidden-worker/`、`measurement/`、`web-render/` | 对外只实现 [Desktop capability ports](../app-hosts/linnya/desktop-capabilities/README.md) |
| 自定义协议与受管媒体 | `protocols/`、`plugins/loader/pluginProtocol.ts` | scheme 必须在 `app.ready` 前登记；文件路径必须经过准入 |
| Command 审批/权限的页面身份与 RPC | [`commands/`](./commands/README.md)、`ipc/handlers/commands/` | 命令 owner 在 App Server；Main 不处理 stdout、PTY 或命令状态 |
| 更新与安装交接 | `update-manager.js`、`update/` | 必须复用统一 App shutdown owner |
| Renderer 权限与窗口安全 | `security/`、`window-security-boundary.test.ts` | 默认拒绝未声明权限，不放宽任意导航或窗口创建 |

跨进程 DTO 与 schema 统一归 [`packages/schemas`](../../packages/schemas/README.md)，不能在 Main 和 Renderer 各自复制 shape。

## 历史物理目录债务

以下内容目前仍在 `src/electron-main/**`，但其运行 owner 是 App Server：

- `routes/**` 与 `services/apiServer.ts`：Express 路由和 HTTP Server；
- `services/database.ts`、`services/serviceInitializer.ts` 及相关业务服务：数据库和 Backend 初始化；
- `ipc/handlers/workspace/**`、`knowledge-base/**`、`todo/**`、`plugins/**` 等业务 handler：由 App Server 的 Renderer request registry 注册；
- `plugins/loader/`、`plugins/store/` 中的磁盘 backend loader、Renderer entry 构建和商店数据代码。

其中也夹有真正的 Main adapter，例如 `pluginProtocol.ts` 和 `prepareElectronPluginRuntimeEnvironment.ts`。因此不要整目录搬迁，也不要继续向这些历史位置新增 Backend 业务；应先确认唯一 owner、公开合同和调用链，再按 domain/feature 分批归位。

`commands/production-runtime`、`commands/runner-runtime`、`sandbox-runtime` 和 `conversation-runtime` 中还保留平台 fixture 或历史 Electron composition。生产 Commands/Sandbox owner 以 App Server 和 [Commands domain](../domains/commands/README.md) 为准，不能把 fixture 当作当前生产入口。

## 开发约束

- Main 与 App Server 只交换严格、可序列化的 bootstrap/RPC DTO；大字符串和二进制走受管 mailbox。
- Main 不导入业务 domain 内部实现；App Server 也不导入 Electron、`BrowserWindow`、`ipcMain` 或 `shell`。
- Renderer request 必须先经过页面身份与 channel admission；未知 channel、失效页面和越界路径应失败关闭。
- Desktop capability 必须是窄 port，不能开放 Electron 对象、任意 method table、真实凭据或未经准入的物理路径。
- 架构或运行 owner 变化时，同步更新本 README 和对应 owner README，不以兼容 fallback 掩盖双 owner。

## 验证

按改动 owner 运行相邻测试。涉及 Main/App Server 边界时，至少执行：

```bash
pnpm vitest run \
  src/electron-main/app-instance \
  src/electron-main/app-lifecycle \
  src/electron-main/app-server-runtime
pnpm guard:app-server-backend-boundary
```

窗口、权限、协议、更新、Commands 或隐藏 Worker 改动还需运行对应目录的 integration test；发布与 Electron 真机选择见[构建与测试指南](../../docs/development/build-and-test.md)。
