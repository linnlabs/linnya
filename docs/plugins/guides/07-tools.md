# 07 · 工具与 ToolContext

> 适用场景：插件给模型贡献工具；工具需要插件私有运行时对象；host 通用工具与插件协作。

## 工具贡献

插件工具是 linnkit runtime tool class，经 contribution 的 `toolClasses` 注册。`toolRegistry.reinitialize()` 会按当前 enabled 插件集合重建工具表。

规则：

- 插件禁用或卸载后，工具不应出现在模型可见 schema 中。
- 工具不要直接访问其它 domain 内部实现；跨 domain 能力通过 SDK port、registry 或 app-level orchestration。
- 工具输出如果会影响前端插件 UI，渲染端刷新走 renderer toolRefresh port（见 [12 AI 交互](./12-ai-interaction.md)），不要在工具里直接触碰 renderer store。
- 错误协议统一：业务失败应 throw（由 ToolRegistry 记为执行失败），不要把 error 装进 success JSON 返回（两种风格并存的现状见审计 T-09）。
- 需要流式占位或参数快照时，在工具类上声明 Linnkit 的通用 `streaming` policy；不要在插件或 Host 中维护按工具名的 Renderer 白名单。该 policy 只表达 runtime 生命周期行为，生命周期参数仍未通过 owner admission，Renderer 必须使用独立的 lifecycle 合同。

## 工具名单的单一真源

`toolClasses` 注册名、decorator `toolNames`、agent `availableTools` 是三处会互相漂移的字符串清单（审计 T-06）。纪律：

- 官方插件必须维护包内 `toolManifest`，集中声明 `classes`、`allNames`、语义化 `names` 以及各 agent 的 `agentTools`。
- 工具名只在 tool class 的 `name` 上定义一次；`toolManifest` 通过 `new ToolClass().name` 派生工具名，不要手抄字符串。
- 插件 agent 的 `availableTools` 只能引用 `toolManifest.agentTools.*`；decorator 的 `toolNames` 只能引用 `toolManifest.allNames`。
- rename 工具时全链路（class、decorator、agent、文档）一次改完，跑启停收缩测试。
- 官方插件必须进入 `official-plugin-tool-contract` 契约测试：`toolManifest.allNames`、decorator `toolNames`、`toolClasses` 实例名必须一致，agent 引用本插件私有工具时必须能在 `toolManifest` 找到。

## Renderer 工具展示注册

插件后端 `toolClasses` 只注册执行能力；插件自己的 Renderer contribution 必须为每个 live 工具注册
`toolCards`。最终非 alias config 同时拥有：

- `presentation`：在 live、reload 或完整 child message admission 中生成完整卡片 read model；
- `compactStep`：在 Subrun 等紧凑 surface 的独立 admission 中生成延迟本地化标题。

两者可复用插件 feature 内的纯标题函数，但不得互相调用。组件只消费 admission 后的
`presentation`，不能再读 raw `args/result`；紧凑标题也不能写回后端工具 definition、RuntimeEvent 或
SQLite。Host 只负责汇聚 enabled 插件、检测冲突和解析一次 alias，不解释插件工具的参数与业务语义。

官方插件由 `official-plugin-tool-cards-contract` 构建期门禁核对 backend manifest 与 Renderer 注册，
每个 live 工具缺少完整或紧凑 projector 都直接失败。插件禁用后其 Renderer 注册不参与解析，历史
紧凑步骤使用通用“执行「tool_name」”诊断标题；这不能成为 Host 建立第二份插件工具映射的理由。

## ToolContext 装饰器

插件工具需要在通用 `ToolContext` 上挂运行时对象（coordinator、lazy provider、目标解析器）时，用 `toolContextDecorators`，**不要**反过来让通用 host 工具 import 插件包。

- `toolContextDecorators[].decorate(context, params)`：只在 `toolNames` 列出的工具执行前调用，给 context 附加插件私有绑定。绑定存 `WeakMap<ToolContext, ...>` 或非枚举属性，禁止污染通用 `ToolContext` 公开字段。
- `toolContextBindingMigrators[].migrate(source, target)`：宿主派生 context 时由平台调用，插件自己把私有绑定迁到新 context。**实现时克隆绑定结构而不是共享引用**；如果 binding 里有捕获 `source` 的 provider/resolver 闭包，必须用 `target` 重建闭包。按引用复制会让新旧 context 互相污染，或让派生 context 偷偷读旧 database/workspace 作用域。
- 插件工具运行时若需要缓存，必须**单一工厂、单一缓存**：decorator 与 binding migrator 迁移的是同一份私有绑定，不能各自创建互不相干的实例。Document hook 不经过 tool decorator；能由 `databaseService` / `workspaceService` 重新构造的轻量 document service 应保持无状态，不要为了“同一个对象”把插件专属 service 塞进通用 `ToolContext`。

平台内置工具的跨 domain 写入也使用同一组合机制：owner 工具定义自己的 DTO 和窄 port，平台 decorator 在执行前注入目标 domain adapter。禁止让 port 文件 import concrete implementation，也禁止把目标 domain 的 persistence record 当作 owner 的业务 DTO。Web → Evidence 是当前参考实现。

## host 通用工具的派生纪律（红线）

- 通用 host 工具（`WriteFileTool` / `EditFileTool` / `ReadFileTool` 等）**永远不得编译期 `import '@plugin/<id>/...'`**。
- 派生 `ToolContext` 必须走 `derivePluginAwareToolContext`（复制 linnkit runtime 隐藏绑定 + 调 enabled 插件的 `toolContextBindingMigrators`）。禁止 `{ ...context, xxx }` 裸 spread，也禁止 `context.workspaceService ?? new WorkspaceService(db)` 这类旁路兜底——它们会静默丢失 WeakMap 绑定。`src/tools` 生产代码由 `PLUGIN-GUARD-03/04` 守卫；workspace/resource 工具补齐 `WorkspaceService` 时使用 `ensureWorkspaceServiceToolContext()`，不要在工具文件里自己 new。
- 历史教训：曾因 spread 丢绑定，临时让 host 工具 import 插件 helper 续命——这是被禁止的旁路，已被平台派生入口取代，新代码不得重蹈。

## 启停与进行中的运行

启停只保证「下一次工具调用」看到收缩后的 schema；进行中的 agent run 持有的旧 ToolContext/绑定目前不会被刷新。插件工具实现要容忍「执行时插件已被禁用」：入口处用 `isPluginRuntimeEnabled` 再确认，失败给用户可读错误。
