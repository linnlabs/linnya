# 03 · 后端 Contribution

> 适用场景：实现插件主进程能力；理解 backend contribution 的字段与生命周期。

## 入口与类型

后端入口应导出 `backendPlugin`，类型是 `PluginBackendContribution`。插件侧通过 `@plugin/backend/pluginContribution` 引用类型，避免依赖宿主内部路径。

`PluginBackendContribution` 是多个 capability interface 的交集：`BackendPluginToolContribution`、`BackendPluginAgentContribution`、`BackendPluginSkillContribution`、`BackendPluginDocumentContribution`、`BackendPluginIpcGatewayContribution`、`BackendPluginRendererPushGatewayContribution`、`BackendPluginRuntimeContribution`、`BackendPluginDatabaseContribution` 等。大白话说：贡献对象仍然是一个 `backendPlugin`，但字段按能力边界分组，不再把所有东西理解成一个“随便塞字段的大对象”。

## 可贡献能力

| Capability | 字段 | 用途 | 详细章节 |
|---|---|---|---|
| Identity | `meta` | 插件摘要，必须与 manifest 对齐 | [02](./02-manifest.md) |
| Tool | `toolClasses` | 模型可调用工具类 | [07](./07-tools.md) |
| Tool | `toolContextDecorators` | 工具执行前给 `ToolContext` 附加插件私有绑定 | [07](./07-tools.md) |
| Tool | `toolContextBindingMigrators` | 宿主派生 `ToolContext` 时迁移插件私有绑定 | [07](./07-tools.md) |
| Agent | `agentDefinitions` / `subagentTypes` / `agentFences` | 插件 agent、可委派子任务类型、上下文围栏 | [08](./08-agents.md) / [12](./12-ai-interaction.md) |
| Skill | `skillResourceRoots` | 源码态 skill 资源根；默认 agent 通过统一 skill catalog 看到 enabled 插件 skill | [09](./09-skills.md) |
| Document | `documentTypeHooks` | 文档类型后端能力 | [05](./05-document-types.md) |
| IPC | `ipc` | IPC 白名单与真实 handler 的原子 contribution | [10](./10-ipc.md) |
| RendererPush | `rendererPush` | 主进程 → renderer 推送 channel 白名单 | [10](./10-ipc.md) |
| Runtime | `sandboxProfiles` / `hiddenWorkers` / `runtimeEffects` | Backend 运行态装配与受管宿主能力声明 | [17 重型指南](./17-heavy-plugins.md) |
| Database | `schemaProviders` / `ownedTables` / `pluginMigrations` | 数据库能力 | [06](./06-database.md) |

## 核心规则

- **contribution 只声明能力，不自己读取 enabled 状态**。enabled 过滤由 `BackendPluginRegistry` 和 runtime state 统一处理。
- `ipc.channels` 和 `ipc.register` 必须放在同一个 `ipc` 字段里，作为一个原子声明；不要再写旧 `ipcChannels` / `ipcRegistrars` 双字段。旧字段只为了历史磁盘 artifact 兼容，官方源码由守卫禁止复活。
- 持有 OS 资源、进程、隐藏窗口或全局服务装配的能力必须随 enabled 状态挂载/卸载，声明为 `runtimeEffects`（`activate`/`deactivate` 必须幂等），**不能塞进 `ipc.register` 的注册副作用里**——IPC handler 可能在启动期为建立分发表被全量注册，不代表插件当前 enabled。
- `toolContextDecorators` 只负责工具执行前装饰当前 context；`toolContextBindingMigrators` 只负责宿主派生 context 时迁移插件私有绑定。不要把两种生命周期混在一个函数里。
- `ownedTables` 与 `pluginMigrations` 必须和 manifest、DDL contract 保持一致；禁用插件不等于跳过迁移，卸载默认也不删表。
- 插件运行态以 SQLite 为唯一真相（`installed_plugins` / `enabled_plugins`），禁止用模块级单例缓存启用状态（双 bundle 原因见 [13 构建与双 bundle](./13-build-and-bundles.md)）。
- 查询自身启停一律 `isPluginRuntimeEnabled(meta.id)`（`@plugin/backend/pluginRuntime`）；**不要**为单个插件做 `isXxxPluginEnabled` 专属函数（参见审计 H-05）。

## 兼容边界

- 历史磁盘 artifact 的 `ipcChannels` / `ipcRegistrars` 旧字段仍被兼容读取；官方新代码不要使用，守卫会拦截。
- 当前 capability 分层主要解决契约可读性和 SDK 类型提示，运行时仍由 registry 做字段收集、enabled 过滤和生命周期同步。更强的互斥/依赖校验应优先放在 artifact verifier、官方插件契约测试和 guard 里，而不是把 `PluginBackendContribution` 做成难以读懂的巨型泛型。
