# 12 · AI 交互

> 适用场景：插件 UI 触发 AI 对话或 subrun；插件文档参与 AI 上下文；工具结果刷新插件 UI。

插件与 AI 的交互必须经平台 port 或公开 contribution，禁止直连 conversation 内部 store/service。共九条标准链路（对应下面九节）：

## 1. 插件触发 AI：aiInvocationPort（`@plugin/renderer/aiInvocationPort`）

两种语义，按需选择：

- **history-isolated run**（`startHistoryIsolatedRun`）：不读取既有会话历史的一次性 AI run。它仍会在 conversation 中创建用户可见的 run 头并按默认策略持久化；历史隔离只描述上下文读取策略，不表示 UI 不展示或不持久化。
- **conversation message**（`ensureConversation` + `sendMessage`，可带 fences / userQuote）：进入用户可见会话（如选中元素后发起编辑对话）。

history-isolated run 会响应宿主的全局 conversation 取消操作；取消属于独立终局，不展示为普通执行失败。插件不持有宿主 controller，也不能自行清理 conversation 执行态。

`userQuote` 只有一种公开形状：`{ items: [{ pluginId, kind, uri?, text, label?, source?, metadata? }] }`。即使插件当前只发送一条逻辑引用，也必须显式传 `items: [item]`；不要自行拼接多条文本，也不要使用已删除的顶层 `text/source/displayLabel`。宿主持久化时统一映射为 `items[].plugin_id`，插件不接触 snake wire。

纪律：

- 不要为了「拿到会话」直接 import conversation store；一切经 port。
- 失败要让用户可感知：port 实现层应走统一错误上报，插件侧不要吞掉失败（host 侧静默 warn 的现状是审计 F-06，待修）。
- workflow id 的解析应走 conversation 的 workflow 注册表；host glue 里按字符串硬编码映射是反例（审计 F-05）。
- Slides 点选编辑等结构化校验应检查对应 item 的 source；多引用场景不能假设业务引用永远排在第一项。

## 2. 插件发起可见 Subrun：conversationSubrunInvocationPort

`@plugin/renderer/conversationSubrunInvocationPort` 用于插件主动发起由 conversation 宿主管理的单个或批量 subrun。它与输入 Reference、Accessory 和过程展示都是独立能力。

接入分两步：

1. 在 `RendererPluginContribution.subrunWorkers` 声明 `{ id, promptKey }`。
2. 在插件 feature 的 orchestration 中调用 `startConversationSubruns({ pluginId, workerId, prompt, activityFeature, subruns })`。

`subruns` 始终是数组：长度 1 表示单个 subrun，长度 N 表示批量。宿主负责生成 unit/subrun 身份、同步创建用户可见 run 头、选择安全父 agent、维护流式状态、取消与历史；当前宿主内部统一翻译为系统 `subrun_batch`，这些内部工具字段不属于插件契约。

返回 handle 包含：

- `runId`：本次可见 conversation run 的身份；
- `completion`：本次执行的完成 Promise，调用方可显式处理失败或取消；
- `cancel()`：只取消该 handle 对应的 run。

边界纪律：

- 调用请求不得直接传 `promptKey`、工具名、`hostToolCall`、`unit_id` 或系统父 agent；
- `workerId` 只能解析当前 active 插件在 contribution 中声明的 worker；插件停用后不能继续发起；
- 当前官方插件共享可信 renderer runtime，声明 owner 是契约约束，不是不受信代码的权限令牌；后端仍会校验 promptKey 是否真实注册；
- conversation 当前只允许一个活跃 run，新 subrun invocation 与正在流式的 chat/run 显式互斥；
- workflow 将来使用独立 workflow 工具协议，本端口不把 workflow 伪装成 worker；
- Reference 或 Accessory 若要与 subrun 联动，由插件自己的 orchestration 顺序组合两个公开动作，不能把执行命令藏进引用 payload。

本节只负责**发起**。`SubrunCard` 如何展示实时 trace 和 reload 历史，见 [20 Subrun 过程展示](./20-subrun-process-ui.md)。

## 3. 插件文档进入 AI 上下文：pageContextProvider（`@plugin/renderer/pageContextProvider`）

- 插件为自己的文档类型注册 page context provider，使 AI `page_context` 能拿到正确的 document type、标题与内容摘要。
- provider 可按需提供多个 builder：`buildSummary`（当前文档摘要）、`buildDocument`（完整文档）、`buildSelection`（选区：sheet 单元格 / mindmap 节点 / slides 元素等，官方插件均已实现）、`buildDocumentFragment`（sidebar 发送片段）。
- `buildSummary` 的返回使用通用 `sections: [{ sectionName, lines }]`。section 名是插件 own 的模型可见协议，conversation 只排序和串联，不读 `summary.slides` 这类插件专属字段。
- 文档类型映射必须从 renderer document type registry 读取；不要在 pageContext 编排里再写一套 switch。新增插件文档进入 AI 上下文不应修改 conversation 的类型枚举。
- provider 实现要尊重启停：`activate()` 注册、`deactivate()` 注销。禁用后不得再从残留 store 伪造当前文档摘要。

## 4. 发送前结构化上下文校验：structuredContextRequirementPort（`@plugin/renderer/structuredContextRequirementPort`）

有些插件会要求「发起 AI 前必须带某个结构化上下文」。例如 Slides 点选元素编辑必须带选中元素源码 fence，避免 agent 猜 old_string。这个规则属于插件，不属于 conversation。

- 插件在 `activate()` 注册 requirement，在 `deactivate()` 注销。
- requirement 只校验发送请求中的 prompt / fences / documentFragment / userQuote，不直接改写消息。
- conversation 只执行 `validateRendererStructuredContextRequirements()`，不出现具体插件字符串或 fence 名。

## 5. Agent Fence：backend contribution 的 `agentFences`

LLM fence 描述符由拥有语义的插件贡献。例如 Slides 的 `selected-slides-element` fence 在 Slides backend contribution 里声明，Host 的 `registerLinnyaFences` 只懒加载 enabled 插件贡献。

规则：

- Host 只拥有平台通用 fence：additional/project/document/user quote/review 等。
- 插件专属 fence 必须在 backend contribution 的 `agentFences` 声明，不在 Host context 文件里硬编码。
- fence registry 不能在模块 import 阶段读取插件 enabled DB；真实组装 prompt 时再合并插件 fence，避免启动早期 DB-not-ready。

## 6. 工具结果刷新插件 UI：toolRefreshPort（`@plugin/renderer/toolRefreshPort`）

- 插件注册 toolRefresh handler，按工具名监听对话中的工具完成事件，刷新自己的 store/视图。
- backend 工具自身**不**负责刷新前端（见 [07 工具](./07-tools.md)）。
- handler 的去重缓存要按会话分桶并可清理，不要模块级 Set 永久增长（审计 F-12）。

## 7. 文档引用展示：documentReferenceRuntimePort（`@plugin/renderer/documentReferenceRuntimePort`）

插件文档若在 AI 输出里产生 `#ref@docType:documentId` 引用，必须在 renderer `activate()` 注册 document reference runtime：

- `documentType`：插件文档类型。
- `referenceLabel`：引用在 conversation 里的展示名，例如 MindMap 的“节点引用”。这个文案归插件所有，Host conversation 不写 `docType === 'mindmap'` 之类分支。
- `getCurrentDocumentId()`：用于无显式 `@docType:documentId` 时识别当前插件文档上下文。
- `listReferenceIds()` / `focusReference()` / `waitForDocumentReady()`：用于解析和定位引用目标。

禁用插件时必须注销 runtime。Host 引用 UI 只能通过 runtime 读取标签和定位能力，不能 hardcode 官方插件名。

## 8. 对话输入贡献：conversationInput

- `RendererPluginContribution.conversationInput` 允许贡献 Reference kind/provider，以及 experimental 的运行期 Accessory；Accessory 只叠加操作区，不接管提交或 schema。
- 插件页面上的节点/选区等外部动作若要程序化加入或撤销 chip，使用 experimental 的 `@plugin/renderer/composerCommandPort`；它只提供 add/remove-by-id，不负责 focus、提交或 subrun 发起。
- `conversationWorkflows` 只提供 workflow 菜单/pill 与 `promptKey` 元数据，不是 Input Extension。
- schema-bearing `editorExtensions` 和完整 Input Extension 当前不属于插件 SDK。
- Reference 只表达输入上下文；同一用户动作是否同时发起 subrun/batch，由独立的 app/workflow orchestration 组合，不能写进 Reference payload。

输入契约、生命周期与测试要求见 [19 对话输入贡献](./19-conversation-input.md)，本章不重复定义。

## 9. Subrun 过程展示：toolCards / subrunToolUi

- `RendererPluginContribution.toolCards` 与 `@plugin/renderer/subrunToolUi` 只展示已经发生的工具调用和 subrun 过程，不启动 subrun。
- 展示层不关心运行来自 Reference、普通消息、按钮、workflow 还是 batch。
- 实时 trace、reload 后历史懒加载及 `SubrunCard` 复用规范见 [20 Subrun 过程展示](./20-subrun-process-ui.md)。

## 通用纪律

- 插件 enabled 状态在前端只有一个真相源（enabled 状态 store），AI 链路读取插件能力前先过 enabled 快照。
- workspace/project metadata、工具结果卡、`#ref@docType:documentId` 引用解析都以 document type / reference runtime 为入口，不维护 `markdown/mindmap` 二元模型。插件 read hook 读到内容以后，前端卡片和引用也必须能靠 registry 打开和定位。
- 所有 AI 注册物都必须支持随插件禁用而注销：page context provider、structured context requirement、tool refresh handler、document reference runtime handler、agent fence。

## 延伸：conversation 域交互的契约演进

新增"conversation 与文档类型交互"的能力（引用跳转、工具卡正文、选区同步等）前，先读 [Conversation 输入贡献框架规范](../../../apps/renderer/domains/conversation/docs/input-contribution.md)。核心铁律：conversation 域不得新增"认识具体文档类型数据形状"的代码，只能新增**通用动词**（注册表能力）或**通用挂载点**（句柄注入式 slot）。
