# Renderer Plugin Lifecycle

Renderer 插件运行时属于 app-level orchestration：它连接主进程提供的启用插件入口、宿主模块、Renderer contribution registry 与各业务 domain 暴露的窄贡献契约。

## 生命周期所有权

- `loader/runtimeRendererPluginLoader.ts` 是运行时插件集合同步的唯一编排入口。App 启动、插件商店安装/卸载和插件 API 就绪通知都调用同一个入口。
- 每次调用代表一个完整的“当前期望插件集合”快照。loader 必须按调用顺序串行提交这些快照，不能合并并发调用；否则安装后立即卸载等后续状态可能丢失。
- 前一次同步失败只影响对应调用方，不能阻断后续快照。诊断状态按真正开始执行的同步编号，不允许并发任务互相覆盖。
- `registry.ts` 只负责 contribution 注册、激活状态和各窄 registry 的一致提交/回滚，不负责协调多个外部同步请求。
- 插件 `activate` / `deactivate` 只能在 loader 的串行同步范围内执行。UI 和具体 domain 不得直接操作 registry 生命周期。
- 内置Host port装配以页面为生命周期；开发服务器在热更新将重执行`App.vue`时，先整页重载以重建全部port与registry。不能只跳过重复注册而保留旧adapter，也不能调用测试清理门面模拟产品dispose。修改这些装配依赖前先保存草稿；普通组件与CSS仍保留自己的HMR边界，规则见[开发启动热更新](../../../../scripts/development/features/renderer-bootstrap-hmr/README.md)。

## 测试要求

磁盘插件通过 `plugin://host/vue.js` 消费 Host 的同一个 Vue runtime。协议模块必须提供插件
源码与 Vue 编译器生成代码所用的导出，包括静态 VNode、slot、props 合并和 ref 判断；只给
Host 挂载 namespace 不代表 ESM shim 已导出它们。发布验收要在真实 Renderer 中 import 随包
入口并打开文档 surface，不能只用 Backend 的插件列表或诊断证明前端可用。

生命周期测试必须覆盖真实状态转换，而不是只断言函数调用：至少验证并发到达的安装与卸载快照按顺序生效、插件不会重复激活、后续快照不会因前次失败而丢失，以及激活失败后 contribution、CSS 和各业务 registry 能完整回滚。

`documentTypePresentation` 是 Host 文档 UI 的窄展示装配：图标取已有文档类型贡献，恢复动作按正式 availability 状态选择启用插件或打开商店。App 将该能力注入 Editor 的 `DocumentTypePresentationPort`；只有用户点击动作才调用既有 store 流程，不开放插件任意启用 SDK，也不绕过 loader 操作 registry。

详情档通过同一 `documentTypePresentation` 读取可选 readonlyPreviewComponent，Editor 获得延迟挂载回调，不解释文档正文 DTO。可用状态变化与弹层关闭负责卸载，组件自己拥有只读内容加载和资源释放。

## 官方应用表面

`applicationSurface` 只供产品组合根显式授信的固定应用槽使用。当前槽位为 `knowledge-base`，
Host 决定 scene、侧边栏和标题栏的位置；插件只提供标题、图标、页面及必要的项目关联和全局弹层组件。
它不是任意路由、窗口或导航注册器。普通注册和磁盘 loader 不能授予槽位，`meta.builtin` 也不是信任来源。

新建项目使用独立的 `projectCreationComponent`：组件持有目录加载与选择交互，只向 Host 交付关联 ID 草稿。
已选下拉项即使未点“+”仍进入提交；停用时仅撤销尚未提交的新建草稿，不清空已有项目关联。
名称输入不等待目录，编辑项目也不预加载知识库。关联写入失败独立提示，已成功创建的项目仍正常打开。

Host 需要的知识库数据只经应用槽成员读取，不调用插件 IPC、不写插件 ID 或频道名：新建项目后用
`saveProjectCreationSelection` 保存草稿，项目概览用 `countProjectAssociations` 显示数量（读失败显示未知，
不当成 0），编辑器引用面板经 `citationSearch` 列出项目关联的库并搜索。上传路由仍由产品组合根授信，
属于 Host 路由，不是插件频道。

查询必须同时满足正式启用状态和 Renderer 激活成功。停用、激活失败或注销后，入口、项目关联及弹层一同
撤销；正在看的旁路页面返回原导航 scope 的工作区，保留项目身份。`prepare(signal)` 在保存原文档之后、
挂载之前执行；切换导航和撤销贡献会取消旧准备。历史引用快照仍由 Host 读取，来源跳转则只将冻结的
source/container/project 身份交给贡献 `openSource`，授权与资料检索由知识库 owner 负责。

文档菜单继续复用 `documentActionMenus`。Host 提供菜单打开时冻结的 projectId、documentId 和实际目标类型，
只委派贡献列出的选项，不拦截平台导出。Markdown 动作可获得仅针对该目标的 `readMarkdownSnapshot`：
活动会话身份吻合时捕获允许的未保存内容，否则走正式文档读取；不向插件暴露 Editor、全局 store 或任意读取函数。
选知识库前已经取得同一文档快照，切换项目、停用或关闭会取消未完成的本地动作。
