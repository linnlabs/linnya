# Renderer Plugin Lifecycle

Renderer 插件运行时属于 app-level orchestration：它连接主进程提供的启用插件入口、宿主模块、Renderer contribution registry 与各业务 domain 暴露的窄贡献契约。

## 生命周期所有权

- `loader/runtimeRendererPluginLoader.ts` 是运行时插件集合同步的唯一编排入口。App 启动、插件商店安装/卸载和插件 API 就绪通知都调用同一个入口。
- 每次调用代表一个完整的“当前期望插件集合”快照。loader 必须按调用顺序串行提交这些快照，不能合并并发调用；否则安装后立即卸载等后续状态可能丢失。
- 前一次同步失败只影响对应调用方，不能阻断后续快照。诊断状态按真正开始执行的同步编号，不允许并发任务互相覆盖。
- `registry.ts` 只负责 contribution 注册、激活状态和各窄 registry 的一致提交/回滚，不负责协调多个外部同步请求。
- 插件 `activate` / `deactivate` 只能在 loader 的串行同步范围内执行。UI 和具体 domain 不得直接操作 registry 生命周期。
- 内置Host port装配以页面为生命周期，`builtin/index.ts`是开发HMR边界；该模块及传播到它的依赖更新会整页重载，重建全部port与registry。不能只跳过重复注册而保留旧adapter，也不能调用测试清理门面模拟产品dispose。修改这些装配依赖前先保存草稿；普通组件仍保留自己的HMR边界。

## 测试要求

磁盘插件通过 `plugin://host/vue.js` 消费 Host 的同一个 Vue runtime。协议模块必须提供插件
源码与 Vue 编译器生成代码所用的导出，包括静态 VNode、slot、props 合并和 ref 判断；只给
Host 挂载 namespace 不代表 ESM shim 已导出它们。发布验收要在真实 Renderer 中 import 随包
入口并打开文档 surface，不能只用 Backend 的插件列表或诊断证明前端可用。

生命周期测试必须覆盖真实状态转换，而不是只断言函数调用：至少验证并发到达的安装与卸载快照按顺序生效、插件不会重复激活、后续快照不会因前次失败而丢失，以及激活失败后 contribution、CSS 和各业务 registry 能完整回滚。

`documentTypePresentation` 是 Host 文档 UI 的窄展示装配：图标取已有文档类型贡献，恢复动作按正式 availability 状态选择启用插件或打开商店。App 将该能力注入 Editor 的 `DocumentTypePresentationPort`；只有用户点击动作才调用既有 store 流程，不开放插件任意启用 SDK，也不绕过 loader 操作 registry。

详情档通过同一 `documentTypePresentation` 读取可选 readonlyPreviewComponent，Editor 获得延迟挂载回调，不解释文档正文 DTO。可用状态变化与弹层关闭负责卸载，组件自己拥有只读内容加载和资源释放。
