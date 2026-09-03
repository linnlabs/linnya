# Renderer Plugin Lifecycle

Renderer 插件运行时属于 app-level orchestration：它连接主进程提供的启用插件入口、宿主模块、Renderer contribution registry 与各业务 domain 暴露的窄贡献契约。

## 生命周期所有权

- `loader/runtimeRendererPluginLoader.ts` 是运行时插件集合同步的唯一编排入口。App 启动、插件商店安装/卸载和插件 API 就绪通知都调用同一个入口。
- 每次调用代表一个完整的“当前期望插件集合”快照。loader 必须按调用顺序串行提交这些快照，不能合并并发调用；否则安装后立即卸载等后续状态可能丢失。
- 前一次同步失败只影响对应调用方，不能阻断后续快照。诊断状态按真正开始执行的同步编号，不允许并发任务互相覆盖。
- `registry.ts` 只负责 contribution 注册、激活状态和各窄 registry 的一致提交/回滚，不负责协调多个外部同步请求。
- 插件 `activate` / `deactivate` 只能在 loader 的串行同步范围内执行。UI 和具体 domain 不得直接操作 registry 生命周期。

## 测试要求

生命周期测试必须覆盖真实状态转换，而不是只断言函数调用：至少验证并发到达的安装与卸载快照按顺序生效、插件不会重复激活、后续快照不会因前次失败而丢失，以及激活失败后 contribution、CSS 和各业务 registry 能完整回滚。
