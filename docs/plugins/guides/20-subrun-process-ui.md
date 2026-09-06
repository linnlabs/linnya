# 20 · Subrun 过程展示

> 适用场景：插件注册工具结果卡，或复用宿主 `SubrunCard`
> 展示 subrun 的实时与历史过程。

本章只讨论**已经发生的工具调用和 subrun 如何展示**。它不定义 subrun 如何启动，也不关心运行是否来自普通对话、Reference、按钮、workflow 或 batch。对话输入贡献见
[19 对话输入贡献](./19-conversation-input.md)，模型工具注册见
[07 工具与 ToolContext](./07-tools.md)，agent/subagent 声明见
[08 Agent 与 Subagent](./08-agents.md)。

## 1. 展示与执行必须解耦

| 机制                            | 责任                                           | 是否启动 subrun |
| ------------------------------- | ---------------------------------------------- | --------------: |
| backend tool / agent / subagent | 定义模型能调用什么、如何执行                   |              是 |
| `toolCards`                     | 展示父工具参数、状态与结果                     |              否 |
| `SubrunCard`                    | 展示某个 subrun 的 thought、工具步骤和最终答案 |              否 |

一个 subrun 可能由带 Reference 的消息触发，也可能与输入引用毫无关系。`SubrunCard` 只消费执行层已经产生的身份、状态和 trace，不能反向读取 composer
Reference 来推断运行来源。

## 2. 工具卡注册

插件通过 `RendererPluginContribution.toolCards` 按工具名声明
`ToolUiConfig`。每项包含一个 Vue `component`，可选标题、图标与布局。类型真源位于
`packages/plugin-host-contract/renderer/toolUi.ts`。

插件公开字段是 `Readonly<Record<string, ToolUiConfig>>`。`ToolUiAliasConfig` /
`ToolUiEntry`
是宿主注册表的内部兼容能力，当前不是插件 contribution 契约；插件不得把 alias 当作可用 SDK。

宿主会把工具参数、结果、状态、tool call 身份、实时 subrun
trace 和可用的历史 lazy source 传给工具卡组件。组件只消费这些事实并渲染，不应：

- 调用 backend 再执行一次工具或 subagent；
- 从 observation 文本猜测 tool call id、subrun id 或状态；
- 从 composer Reference、URI 或 metadata 推断运行来源；
- 自己订阅、解析和缓存宿主的 subrun 事件流；
- deep import conversation 内部组件、store 或 trace 实现。

需要展示工具结果图片时，工具卡必须在 `ToolUiConfig.runtime` 声明 `attachments: true`，再消费宿主
传入的 `ToolUiImageAttachmentRef[]`。该引用已经是 durable event attachment，只包含 asset 身份和媒体元数据；
组件不得读取本地路径、claim URI，也不得重新调用工具获取图片。

普通工具卡需要基础控件时直接使用 `@linnya/renderer-ui`；presentation 类型从 type-only
`@linnya/plugin-host-contract/renderer/toolUi` 导入，payload decoder 留在插件自己的 tool-presentation feature。需要展示
subrun 过程时使用 `@plugin/renderer/subrunToolUi`。

## 3. 复用 SubrunCard

`@plugin/renderer/subrunToolUi` 当前给插件使用的公开面是：

- `SubrunCard`：宿主统一的 subrun 对话分组展示；
- `HistoricalSubrunTraceLazySource`：历史过程懒加载所需的纯类型契约。

允许的历史事件 kind 由 `packages/plugin-host-contract/renderer/subrunToolUi.ts`
定义并由宿主填入 lazy source。插件通常不应自行构造或改写 kinds。

`SubrunCard`
会把 trace 经宿主正式 message admission 投影成 thought、工具调用、已完成的上下文摘要标记和最终答案，并负责插件路径的有界展示、展开与历史加载。摘要标记复用主会话现有 Summary 行，不暴露摘要正文或临时压缩进度。该 admission 与主时间线共用工具 presentation 候选构造器，任一 child 事实失败时原子拒绝新快照。插件不需要理解内部投影规则。

Host 自身的 `subagent/subrun_batch` 不再使用这个 bounded 卡作为父 virtual row；父工具消息继续使用默认折叠的 `ToolCallsMessage` 统一外壳。单个 subagent 运行中已有 child 步骤后，外壳标题复用最新 compact-step 文案和统一扫光；首步之前与终态恢复原始任务标题。Host 的薄内容适配器复用内部 `SubrunTracePanel`（与 Deep Search 相同的逐行过程 UI）：普通 subrun 的内层过程常驻展开并只提供“查看详情”，Deep Search 保留“展开/收起”且不提供详情入口。这不改变插件公开 `SubrunCard` 合同，也不把 Host 内部面板加入插件 SDK。

包装 `SubrunCard` 的插件工具卡应显式接收并向下透传这些宿主输入：

| 输入                                 | 作用                                                      |
| ------------------------------------ | --------------------------------------------------------- |
| `args` / `result` / `status`         | 父工具的事实参数、结果和运行状态                          |
| `subrunTrace` / `subrunTraceVersion` | 当前消息内存中的 append-only 实时过程及其轻量版本号       |
| `toolCallId`                         | 父工具调用身份；只在后端协议已明确定义时用于定位子 bucket |
| `subrunId`                           | 指定当前 `SubrunCard` 消费哪个 subrun bucket              |
| `lazySubrunTraceSource`              | reload 后按需读取历史过程的宿主凭据                       |

单 subrun 可以直接把一张 `SubrunCard`
注册为工具卡。并行 subrun 应由插件包装组件按结果协议生成多张
`SubrunCard`，每张只传自己的真实 `subrunId`。

插件自己的并行工具如果需要展示多个 subrun，应在后端结果协议中提供每个子运行的权威
`subrunId`，由插件 wrapper 原样传给 `SubrunCard`。没有权威 subrun 身份时应修正后端结果协议，不能让 UI 猜。

## 4. 实时与历史回放

实时与历史是同一展示组件的两条数据来源：

| 阶段      | 事实源                                          | 加载时机                             |
| --------- | ----------------------------------------------- | ------------------------------------ |
| 执行中    | 当前消息的 `subrunTrace` + `subrunTraceVersion` | SSE 投影到消息后立即增量渲染         |
| reload 后 | `HistoricalSubrunTraceLazySource`               | 历史卡片由用户展开时按需读取完整分页 |

宿主只在同时具备当前 `conversationId`、父
`toolCallId`，并确认消息 metadata 存在持久化 `run_id` 时构造历史 lazy
source。`run_id` 只是宿主判断“该消息确有可查询历史”的事实门槛，不属于
`HistoricalSubrunTraceLazySource`，插件不得自行生成或补齐。

历史查询必须同时携带 `conversationId + parentToolCallId + subrunId`，服务端只返回这个
exact child 的过程；禁止先读取父工具下全部兄弟再由 Renderer 丢弃。`subrunId` 不能替代父 tool call 身份。

只要存在明确 lazy source，`SubrunCard` 首次展开就必须请求历史前缀，即使已有 live bucket 也不能跳过；否则执行中后挂载的卡只会看到 live 尾部。稳定 accumulator 以历史为前缀、live DTO 为重叠事实和新尾部，按 `source_event_id` 接纳。插件只需原样透传宿主提供的 lazy source，不应自行请求 conversation 内部历史接口或合并事件。

宿主会按 exact source 与 durable invalidation revision 缓存完整分页后的 ready 快照。这个缓存保证 Host 在父列表与详情结构性切换后不会重复读取同一 trace，也不会因父卡先以空历史挂载再增高而破坏返回锚点。插件不得建立第二套缓存或依赖缓存内部 key。

## 5. 生命周期与边界

工具卡 contribution 随 renderer
plugin 注册，并由 enabled 快照决定是否进入可用工具卡表；插件 CSS 经
`stylesheets`
随 loader 注入和移除。插件禁用后，工具卡与其样式必须一起从可用面收缩。

重复工具卡名会显式注册失败。插件应修正命名冲突，不要 catch 后改名重试或静默 fallback。

### 宿主必须保持中立

- 工具卡 registry 只按工具名解析通用 `ToolUiConfig`，不 import 插件组件或样式；
- conversation 不按具体 pluginId、document type 或运行来源写展示分支；
- `SubrunCard` 不负责选择 agent、启动 subrun、重试运行或解释输入 Reference；
- subrun trace 的投影、分页与有界展示由宿主统一负责。

### 插件必须保持独立

- 基础控件只从 `@linnya/renderer-ui` 消费；工具 presentation 类型只从 `@linnya/plugin-host-contract` 消费；确实依赖 Conversation runtime 的 subrun 展示才使用 `@plugin/renderer/subrunToolUi`；
- Vue 工具卡保持薄，只连接宿主 props 与插件展示组件；
- subrun 启动逻辑留在 backend tool/agent 或 app-level orchestration；
- 插件不 deep import conversation trace、消息投影或 store。

## 6. 最小验收

- 工具执行中、成功、失败和 reload 后都能展示真实 args/result/status；
- 单 subrun 与并行 subrun 都使用权威 `subrunId`，没有 bucket 串线或重复消费；
- 实时 trace 能增量显示；存在 lazy source 时首次展开必须加载历史前缀，同一 source 就绪后不重复请求；
- 插件 wrapper 将 `subrunTrace`、version、toolCallId 和 lazy source 完整透传给
  `SubrunCard`；
- Reference 存在和不存在时，`SubrunCard` 都只依赖执行事实，展示结果等价；
- child 发生自动上下文压缩后，实时与 reload 详情都展示同一 completed Summary 行，父卡轻量步骤不增加伪工具步骤；
- 插件禁用后工具卡 contribution 与 stylesheet 一起从可用面收缩；
- 工具卡组件测试证明渲染不会触发 backend 工具或 subrun 调用。

通用插件验收与边界命令见 [16 测试、验收与守卫](./16-testing-and-guards.md)。

## 7. 真源与参考

| 内容                         | 真源 / 参考                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| renderer contribution 总契约 | `packages/plugin-host-contract/renderer/pluginContribution.ts`                                           |
| 工具卡契约                   | `packages/plugin-host-contract/renderer/toolUi.ts`                                                       |
| SubrunCard 门面契约          | `packages/plugin-host-contract/renderer/subrunToolUi.ts`                                                 |
| 工具卡 registry              | `apps/renderer/app/plugins/registry.ts`                                                                  |
| 历史 lazy source 门控        | `apps/renderer/domains/conversation/ui/message/ToolCallsMessage.vue`                                     |
| SubrunCard 实时/历史选择     | `apps/renderer/domains/conversation/features/subrun-card/ui/SubrunCard.vue`、`apps/renderer/domains/conversation/features/subrun-card/orchestration/useSubrunCardTrace.ts` |
| 并行 subrun 插件示例         | `packages/plugins/mindmap/src/renderer/tool-cards/`                                                      |
