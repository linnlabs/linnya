# @linnya/plugin-host-contract

本包是 Linnya Host 与插件包之间的**纯类型公开合同**。它让 backend 插件、renderer 插件和 Host SDK facade 依赖同一组窄接口，不承载实现、状态或业务流程。

## 1. 边界

本包拥有：

- 插件注册时必须实现的 backend/renderer contribution 类型。
- Host 向插件暴露的窄 port。
- 插件生命周期、Workspace 文档类型、工具 UI、引用、命令和 IPC 的跨包接口。

本包不拥有：

- Linnkit Runtime facts、Graph、Agent context 或 tool lifecycle。
- Linnya Conversation timeline message 和 UI read model。
- Workspace、Slides、Sheet 等具体业务模型。
- Vue store、数据库、网络请求或插件实现。

插件工具可以通过本包引用 Linnkit 的通用工具合同（包括流式生命周期 policy），但合同 owner
仍然是 Linnkit；本包只提供 Host 与插件之间的类型门面，不增加工具名、UI 或产品领域语义。

需要运行时校验的跨边界 DTO 应由 `@app/schemas` 提供 Zod schema；本包引用该 DTO，不复制近似 shape。

## 2. 公开入口

- `@linnya/plugin-host-contract/backend`：backend contribution 与 Host runtime port。
- `@linnya/plugin-host-contract/renderer`：renderer contribution 与 UI-side port。
- `@linnya/plugin-host-contract/renderer/localization`：插件可见的本地化类型门面；真实 registry、store 与解析运行时由
  [Renderer 本地化](../../apps/renderer/app/localization/README.md)拥有。
- 包根：仅用于确实同时适用于两端的类型聚合；业务代码优先使用明确子入口。

插件不得 deep import 其它插件、Host 内部实现或本包未导出的文件。`src/plugin-sdk/` 是带行为的 Host facade，不是第二份合同 owner；它必须从本包导入类型。

## 3. Workspace 文档读取

Workspace runtime 只暴露当前数据库能力，不提供 `isUsingNewDatabase` 新旧切换探测。
Host 在插件 Backend 初始化前完成数据库准入；插件文档操作直接使用已注入的数据库，并继续执行自身启用状态与参数校验。

`DocumentTypeBackendHook.readDocument()` 返回 `DocumentTypeBackendToolReadResult`，其中 `data` 直接使用 `@app/schemas` 的 `WorkspaceDocumentReadData`。

规则：

- 插件选择并构造正式 `blocks | outline | text` presentation。
- 每个 block/outline item 必须提供稳定 ID，禁止让 Renderer 使用数组下标补 key。
- 插件私有展示信息进入 `data.details`，不能扩展顶层公共字段。
- Host 与 Renderer 不解析 observation 来恢复 presentation。
- 插件 renderer 不再注册第二套 Workspace read presentation mapper。

## 4. Conversation 扩展

插件可以通过窄 contribution 扩展输入附件、引用 provider、workflow、subrun worker 和 tool card，但不能：

- 创建或改写 Conversation timeline message identity。
- 绕过 Conversation event projection 直接写其 store。
- 把插件私有执行状态提升为全局 streaming 状态。
- 用 `Record<string, unknown>`、optional identity 或 fallback key 掩盖正式合同缺失。

Conversation 的产品消息合同由 `@app/schemas` 拥有；具体渲染、虚拟化和滚动规则由 Conversation domain 拥有。

工具卡如需展示工具结果中的图片，必须在 `ToolUiConfig.runtime` 显式声明 `attachments: true`。
Host 只传递已经由 durable `tool_output.attachments` 映射出的 `ToolUiImageAttachmentRef[]`；这不是 Agent
的 `modelInput` selection，也不包含本地路径、claim URI 或 provider payload。工具卡只能展示该事实，不能
重新调用工具读取图片。

动态工具标题只允许通过可选 `ToolUiConfig.titleComponent` 替换标准外壳中的标题正文；图标、标签、折叠和点击仍归 Host。标题组件只接收已解析的 fallback 标题、工具 lifecycle，以及该卡在 `runtime` 显式声明的能力，不能读取 Conversation store 或重新解释工具 raw payload。注册后运行态标题视觉也由该组件负责，Host 不再叠加通用 loading spinner。普通静态标题继续由 presentation projector 提供，不应为样式差异注册组件。

插件向用户输入附加持久化数据时只能使用 `messageExtension`，其类型直接别名到 `@app/schemas` 的 `ConversationMessageExtension`：稳定 `namespace` 加纯 JSON `data`。普通 AI invocation 与 subrun invocation 使用同一合同。本包严禁重列该接口，严禁恢复 `messageMetadata/userInputMetadata`，插件也不能把函数、Date、undefined 或 UI 控制状态塞进扩展槽。

插件按需读取历史 subrun trace 时，`HistoricalSubrunTraceKind` 必须直接派生自 Linnkit `SubRunTraceEvent['kind']`。本包只描述 Host 能力形状，不拥有 Runtime kind，禁止重列字符串联合。

## 5. Plugin CLI 与 Hidden Worker

官方内置 backend contribution 可以提供一个 `pluginCli`。它只接收 opaque `argv`、invocation ID 和
conversation root；prepare 阶段只解析参数并返回 access plan，不得接触 DB、coordinator 或 worker。
Host 通过权限门禁后才调用 execute，并传入 `hostContext: unknown` 与 `AbortSignal`。插件必须用窄类型守卫
读取自己的 host context，不能用断言绕过边界。

Plugin CLI bridge v1 的 access plan 固定拒绝 external files、network、GUI 和 local IPC，只允许声明内部
数据访问与 conversation 文件写入。Host 会对磁盘 JavaScript contribution 做严格运行时校验，TypeScript
类型本身不是授权事实。当前 registry 只接受 Host 组合根对编译期已知官方插件显式授信的 contribution；
磁盘插件自己声明的 `meta.builtin=true` 不能建立信任。

Hidden worker 的单请求取消是可选能力，但 `cancelChannel` 与 `createCancelPayload` 必须成对声明。支持取消
的 worker 应按 requestId 传播 AbortSignal；不支持的 worker 在 host abort 时只收口本地 pending，不能发送
伪造 channel。插件 draining 必须等 Plugin CLI invocation 退出后再注销 worker。

## 6. 导出 artifact 与 PDF

`@plugin/backend/imageTranscoding` 只定义通用的不透明内存 bytes → JPEG 转码合同。插件必须先在自己的领域内完成页面背景合成，再显式传入 quality、chroma subsampling 和输入像素上限；Host 发现真实透明像素时直接拒绝，不能替插件猜测底色。契约不认识文件路径、asset、Conversation 或具体插件业务。Sharp 与真实解码实现留在 Host。

Renderer 插件通过 `@plugin/renderer/exportArtifact` 请求系统保存框，只取得一次性 target token 和文件名，不能读取本机路径。Backend 插件通过 `@plugin/backend/exportArtifact` 把完整 bytes 提交到该 token；Host 负责 owner、扩展名、MIME、有效期、单次消费和原子发布。

`@plugin/backend/pdfDocumentRuntime` 只接受有序 PNG 页面与物理页面尺寸。插件不能传入 HTML、URL、BrowserWindow 或 Chromium 打印参数；具体业务 renderer 负责生成页面视觉事实，Host 只负责 PDF 封装。

## 7. 测试运行态

插件 backend 集成测试如需启用状态与 Workspace mutation composition，只能通过
`@plugin/backend/testRuntime` 的 `installPluginHostTestRuntime()` / `resetPluginHostTestRuntime()`
装配。测试不得直接 import Host 的 `pluginRuntimeState`、Workspace publisher registry 或其它全局状态；
生产 contribution 也不得依赖 test runtime。

## 8. 变更纪律

1. 先确认能力是否真的跨 Host 与插件包；只在一个插件内部使用的类型留在插件自身 definitions。
2. 新增字段必须明确 owner、必填性、生命周期与消费者，不能为未来可能性预留死宽度。
3. backend/renderer 两端需要同一运行时 DTO 时，先在 `@app/schemas` 建 schema，再由本包引用类型。
4. 删除或修改合同必须同步全部插件与 Host adapter，不保留旧字段兼容分支。
5. 运行 `pnpm --filter @linnya/plugin-host-contract typecheck`，并验证受影响插件的 typecheck。

禁止 `any`、不安全断言、shape guessing、随机身份、index key 和无业务含义的 fallback。
