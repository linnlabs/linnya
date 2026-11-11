# Backend 插件装配与运行查询

`builtin/index.ts` 是 App 的装配入口，负责 platform-only / complete 注册阶段、磁盘插件加载、迁移与运行资源同步。应用版本冻结后才允许完整加载；原来的延迟注册与 `requireComplete` 约束继续适用。

`registry.ts` 只保存已经接纳的贡献及其声明，`pluginRuntimeState.ts` 读取 installed/enabled 事实。SDK、fence 与工具上下文派生在 App 完成注册和启用装配后通过 `registeredContributions.ts` 读取运行贡献，不能为了查询声明反向调用磁盘加载入口。加载插件模块时不能发送业务推送；运行期推送仍必须同时满足“已启用”和“已声明 channel”。Host 的静态枚举与启动用例继续通过 builtin 入口显式保证注册阶段；独立工具测试的组合根也须先注册 platform，不能依赖第一次工具查询偷偷初始化。

SDK 使用 Desktop capability 时直接引用对应 `registry/*Registry.ts` 的窄端口；`desktop-capabilities/index.ts` 供 App composition 选择具体 RPC/Host 实现，不进入 SDK 的运行闭包。这样磁盘加载器可以提供 SDK 合同，同时 SDK 不再依赖加载器或请求装配。
