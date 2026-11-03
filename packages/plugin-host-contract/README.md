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
- `@linnya/plugin-host-contract/renderer/settingsContribution`：设置页注册合同。`headerMode` 默认由壳层显示标题，页面需要自带标题和操作区时显式声明 `page`；导航标题仍由原有 `title` / `titleMessageKey` 决定。
- `@linnya/plugin-host-contract/renderer/localization`：插件可见的本地化类型门面；真实 registry、store 与解析运行时由
  [Renderer 本地化](../../apps/renderer/app/localization/README.md)拥有。
- `@linnya/plugin-host-contract/renderer/executionPresentation`：Host 工具活动指示器的组件合同；插件通过 `@plugin/renderer/executionPresentation` 使用运行实现，可选择扫光、呼吸或静态文字。执行态、动画实现与标题/正文的动画归属均由 Host 持有，插件不复制判断或 keyframes。
- `backend/childRunDelivery`：供已授权插件 CLI 读取当前会话中正式 subagent 交付、生命周期和当前项目 Markdown 版本观察；只读，不接受自报运行结果，不开放数据库表或任意历史。
- `backend/runInputQuote`：供已授权插件 CLI 匹配当前 root 原接纳输入中的短引语，返回 Host 生成的事件身份和文本 hash；不检索历史，不接纳 child 委派，不认证人类身份、现实事实或执行授权。实现与生命周期见 App Host 的 run-input-provenance owner。
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

Renderer 文档保存 handler 拥有本类型的 dirty 状态：只在确认当前草稿全部落库后清除。Host 不根据 handler 返回成功无条件清除 dirty；保存期间的新输入必须继续保持 dirty，导航离开前再次确认已落库。合同见 [`renderer/workspaceRuntime.ts`](./renderer/workspaceRuntime.ts)。

## 4. Conversation 扩展

`ConversationAgentChoiceContribution.disabled` 只限制新的菜单选择；贡献仍保留在列表中，
用于显示已有会话的产品 Agent 身份。不可用原因由贡献的本地化 menu / pill / aria 文案说明。
该 UI 标记不授予或撤销运行权限；后端首次接纳由 Agent Registry 声明与 Flow 执行，已有运行
恢复继续使用其原始身份。

插件可以通过窄 contribution 扩展输入附件、引用 provider、workflow、subrun worker 和 tool card，但不能：

- 创建或改写 Conversation timeline message identity。
- 绕过 Conversation event projection 直接写其 store。
- 把插件私有执行状态提升为全局 streaming 状态。
- 用 `Record<string, unknown>`、optional identity 或 fallback key 掩盖正式合同缺失。

Conversation 的产品消息合同由 `@app/schemas` 拥有；具体渲染、虚拟化和滚动规则由 Conversation domain 拥有。

`SubagentTypeContribution` 只声明类型、promptKey、说明和固定的父历史继承量。材料路径、评审对象和角色任务通过父 Agent 的委派 prompt 交接，不扩张通用工具参数或在本纯类型包中建立业务执行器。

工具卡如需展示工具结果中的图片，必须在 `ToolUiConfig.runtime` 显式声明 `attachments: true`。
Host 只传递已经由 durable `tool_output.attachments` 映射出的 `ToolUiImageAttachmentRef[]`；这不是 Agent
的 `modelInput` selection，也不包含本地路径、claim URI 或 provider payload。工具卡只能展示该事实，不能
重新调用工具读取图片。

动态工具标题只允许通过可选 `ToolUiConfig.titleComponent` 替换标准外壳中的标题正文；图标、标签、折叠和点击仍归 Host。标题组件只接收已解析的 fallback 标题、已 admission 的 presentation、工具 lifecycle，以及该卡在 `runtime` 显式声明的能力，不能读取 Conversation store 或重新解释工具 raw payload。注册后运行态标题视觉由该组件负责，但执行判定必须消费 Host 的统一活动态，不能从工具 loading 推断；Host 在暂停等非执行阶段不显示 header 状态。普通静态标题继续由 presentation projector 提供，不应为样式差异注册组件。

工具默认沿用通用错误卡。`retainPresentationOnError` 是可选的 Renderer 布局能力，省略等同 `false`；不改变 wire、SQLite 或工具 API payload，旧插件无需修改。只有显式声明 `ToolUiConfig.layout.retainPresentationOnError` 的卡片，错误态才保留已 admission 的标题与专用内容；标准 `ToolErrorCard` 仍负责错误原因与修复动作。该开关不允许读取原始 payload，也不把错误结果解释为已保存产物。过程卡可继续展示正式子运行索引；单次提交卡可明确本次失败语义。未声明的工具错误展示不变。

需要把外部 owner 的审批/终态事实与具体工具关联时，卡片声明 `runtime.toolIdentity: true`。
Host 仅提供 `{ runId, toolCallId }`，与 `conversationId` 分别声明；不提供整个 message/store，
也不允许工具从命令文本或 message ID 拆解身份。标题与正文接收同一能力；该通用合同不认识 Commands。

工具正文的执行占位统一使用 `ToolActivityIndicator`；插件只传运行中的业务文案与文字效果选择，三类用户状态（暂停、进行中、AI 输出结束）及动画开关由 Host 的 Conversation owner 维护，禁止插件复制动效实现或读取 Conversation store。

插件向用户输入附加持久化数据时只能使用 `messageExtension`，其类型直接别名到 `@app/schemas` 的 `ConversationMessageExtension`：稳定 `namespace` 加纯 JSON `data`。普通 AI invocation 与 subrun invocation 使用同一合同。本包严禁重列该接口，严禁恢复 `messageMetadata/userInputMetadata`，插件也不能把函数、Date、undefined 或 UI 控制状态塞进扩展槽。

插件按需读取历史 subrun trace 时，`HistoricalSubrunTraceKind` 必须直接派生自 Linnkit `SubRunTraceEvent['kind']`。本包只描述 Host 能力形状，不拥有 Runtime kind，禁止重列字符串联合。

## 5. Plugin CLI 与 Hidden Worker

Plugin CLI 的 execute context 可包含 `conversationId` 和 `projectId`。前者由已授权父 Shell 的冻结身份提供，后者在 internal-data 权限通过后由 App 查询 Conversation 正式归属；插件不能用 argv 自报项目替代。两字段对旧 Host 可缺省，依赖它们的插件必须明确报告接入缺失。它们是上下文，不扩大 CLI access plan 的权限。

官方内置 backend contribution 可以提供一个 `pluginCli`。它只接收 opaque `argv`、invocation ID 和
conversation root；prepare 阶段只解析参数并返回 access plan，不得接触 DB、coordinator 或 worker。
Host 通过权限门禁后才调用 execute，并传入 `hostContext: unknown` 与 `AbortSignal`。插件必须用窄类型守卫
读取自己的 host context，不能用断言绕过边界。

Plugin CLI bridge v1 的 access plan 固定拒绝 external files、network、GUI 和 local IPC，只允许声明内部
数据访问与 conversation 文件写入。Host 会对磁盘 JavaScript contribution 做严格运行时校验，TypeScript
类型本身不是授权事实。当前 registry 只接受 Host 组合根对编译期已知官方插件显式授信的 contribution；
磁盘插件自己声明的 `meta.builtin=true` 不能建立信任。

Hidden worker 的 `renderingMode` 可选择 `background`（缺省）或 `offscreen`。前者适合排版和计算，不保证 HTML-in-Canvas 有实际像素；需要后台绘制的 provider 显式选择后者。该 data-only 选择沿 Desktop capability 传递，插件不接触 BrowserWindow；目标 DPR 仍由领域请求明确传入。

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

文本测量端口的 `fontUnits` 是可选的只读字体单位事实，供客户端在相同 shaping 输入下准确投影字号；不携带字体路径、宿主对象或可写文档状态。没有该事实的 provider 不承诺跨字号复用，调用方不能自行从最终宽度推算。

## Workspace 文档投影端口

`backend/workspaceDocumentProjection` 提供活动节点归属查询、按项目/类型列出节点身份，以及文档更新时间写入。Workspace 拥有节点事实，插件只用这些身份查询自有正文表。调用方传入当前连接，更新时间写入加入插件现有事务，不自行提交或提前广播事件。该门面没有 App runtime 依赖，standalone CLI 可直接使用。

`workspaceRuntime.hasWorkspaceNodeTextSnapshot` 与既有保存端口供迁移在同一事务内补齐缺失快照；插件不能直接读写 Host 快照表，也不能用回填覆盖已有快照。没有新增持久化字段或版本迁移。

Composer 的页面命令端口只开放引用增删和 `focusComposerInput()`。聚焦由 app 先显露当前对话区域，再交给 Conversation 注册的输入能力；插件不能取得编辑器实例或操作 Conversation store。输入框关闭时注销能力，多个暂存表面仅由当前可见的输入框接纳聚焦。

`backend/conversationProjection` 只读取正式会话当前项目 ID，不存在或无项目返回 null。它不打开完整 EventStore、不读取消息或 metadata，发送准备等调用方据此重验会话项目，不能借当前界面项目补齐缺失归属。

`renderer/documentReferences` 提供同项目文档候选及当前展示身份：候选按活动节点名称查询，选择后保存稳定 documentId；标题、类型、路径与插件可用状态在查询时读取。越界或已删除目标不返回标题/路径，插件停用单独标记。Editor 的 @ 与文档型插件的选文档界面共用此门面，不各自读取 Workspace 树或增加专用 IPC。

`renderer/documentReferences.previewDocumentDeletionReferences` 返回完整 Workspace 删除范围之外、当前同项目活动来源的引用影响；只提供总数量及有界标题列表，供 Host 的统一删除确认使用。该提示不会建立文件锁或替代稳定节点身份的删除授权。

引用发送准备上下文同时冻结 conversationId 与 projectId。已有会话的归属仍由 Backend 正式会话记录决定；尚未创建会话时，provider 只能使用 Host 冻结的当前项目，不能从引用自带 metadata 猜测。`deduplicationKey` 只用于当前 composer 内同 owner/kind 的重复引用合并，移除或发送后可以重新加入，不写入 Agent 引用正文。

`subscribeWorkspaceMutations` 转发 Workspace 的正式跨进程 mutation stream，回调只接收 `@app/schemas` 的已验证事件，调用方关闭时取消订阅。引用或预览消费者可据稳定 ID 失效派生资源；不建立第二套 Canvas/标签事件总线，也不能用事件正文代替重新读取后的项目范围验证。

`renderer/pluginRuntime` 只读查询插件 `enabled` / `disabled` / `missing` 并订阅变化；App 从既有 enabledPluginsStore 和文档类型 registry 投影，不向插件暴露 store。变化携带卸载前后相关 nodeType，引用消费者只失效相关身份与派生预览；调用方关闭时取消订阅。编译期解析复用 Renderer catalog 的 `@plugin/renderer/*` facade 目录，artifact 仍须同时登记 Host provider、external URL 与协议具名导出。

`DocumentTypeContribution.historyClientSessionId(documentId)` 可在打开历史面板时提供当前文档编辑会话身份。Host 固定该身份并在用户确认恢复时通过通用 `clientSessionId` 字段透传；插件自己拥有会话注册及撤销栈，Core 不解释其格式。未提供回调或返回 null 时省略身份。

迁移数据库的 statement 明确提供同步 `get/all/run`：Host adapter 三项能力始终齐全，迁移可读取旧事实后在调用方迁移事务内写入，不应以可选方法或空查询结果替代合同缺失。

## Renderer IPC 的投递结果

`pluginIpcClient.invokeRendererPluginIpc` 保留 `failureKind`：正式Handler返回的失败为 `application`；调用通道抛出或返回结构无法验证为 `delivery_unknown`。后者不能证明写入没有执行。需要幂等的写用例必须保留原requestId和完整负载，确认前不能生成另一份写意图；DTO仍由调用方的正式schema接纳。`application`描述返回来源，事务是否已写入由业务owner的提交合同保证。

`renderer/documentReferences.readDocumentBacklinks` 以当前 projectId/documentId 读取同项目活动来源，按来源文档分组分页并返回文档数和引用数。它不读取正文、不打开文档、不赋予跨项目访问；标题与节点类型都是当前派生事实。

`DocumentTypeContribution.readonlyPreviewComponent` 是详情档的可选增强，接收 documentId/projectId。消费者只在用户展开时挂载，离开、换目标或插件不可用时卸载；组件必须只读、核对范围并释放资源，不绑定可写 file session。静态封面和摘要仍走统一 DocumentPreview 数据合同，不能为远景卡片批量挂实时组件。

`renderer/documentPreview.mountDocumentPreviewDetail({element,documentId,projectId,signal?})` 是 Renderer 本地只读挂载口，返回 Promise<dispose>。Host 在 import 前后核对当前项目，signal 可在 Promise/插件组件加载中取消；旧 disposer 不会移除同容器后来挂载的目标。DOM 和 AbortSignal 不过 IPC，插件不得借此打开可写 surface 或批量挂载远景组件。
