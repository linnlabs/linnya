# Conversation 输入贡献框架规范

> **全链路权威规范**：[`docs/conversation-platform/`](../../../../../docs/conversation-platform/README.md)。不变量以 [`00-invariants.md`](../../../../../docs/conversation-platform/00-invariants.md) 的 `INV-nn` 为准；本文是实现级说明，冲突时以规范为准。

> 本文定义 conversation 输入框的**贡献框架**：输入框是一个中立宿主，「引用什么、弹什么 UI、提交给谁、发起什么执行」由各 domain / 插件按契约注册。conversation 域永远不认识 table、列、slides 元素、mindmap 节点等业务数据形状。
>
> 本文是客观契约规范，不记录施工过程（迭代历史见 git）。插件开发规则见 `docs/plugins/guides/19-conversation-input.md`（输入贡献）与 `docs/plugins/guides/12-ai-interaction.md`（AI 调用 / subrun 发起）。
>
> 配套文档：全链路架构见 [Conversation Platform](../../../../../docs/conversation-platform/README.md)；活动与 Subrun 见 [Conversation Subruns](../../../../../docs/conversation-platform/10-subruns.md)。

---

## 0. 核心立场

输入框不是「聊天框 + table 特例 + 未来每个功能再加一坨 `if`」，而是一个**中立宿主**：它只拥有编辑器、提交生命周期、引用栏和扩展 / 附件槽位。所有「输入框里的自定义交互」标准化为一套可注册的贡献框架，让 table 模式、@ 文件引用、页面元素引用、未来任意插件的输入交互都按同一规范接入。

第一性原理与铁律是：host 只定义通用动词与挂载点，插件数据保持 opaque。本框架是这条原则在输入框上的稳定实现，不允许按具体文档类型增加分支。

---

## 1. 概念模型：三个原语

用户视角的所有需求——点击页面元素在输入框弹出专属 UI、选中内容带入对话、@ 引用文件、表格填充模式——拆开只有三个原语。

### 1.1 Reference（引用）——「输入框里挂着的一块上下文」

- **数据原语**：`ConversationReference`（`pluginId / kind / uri / metadata` 对 host 全透明）。持久化 wire 收敛为 `user_input.metadata.user_quote.items[]`，逐条保留身份事实（见 §4）。
- **展示与行为注册化**：每个 `kind` 注册 chip 贡献——声明式 label / preview（自定义组件为可选升级位）、失效校验。
- @ 引用文件、点击页面元素带入元素、选中文本带入选区，**终态都产出 Reference**，差异只在触发途径（见 1.3）。

### 1.2 Input Extension（输入扩展）——「接管输入框的一种模式」

比引用重一档：需要占据上下文条、改变提交去向、拥有执行态的交互（table 填充是唯一现存实例）。同一时刻**最多激活一个**扩展（互斥）。含构造期 schema（`editorExtensions`），属宿主内部完整契约，**不开放给运行期插件 SDK**（见 §5、§6）。

### 1.3 Trigger（触发途径）——「引用 / 扩展怎么被唤起」

| 途径 | 形态 | 实例 |
|---|---|---|
| **外部动词** | 其他 domain / 插件调 composer port 的动词：`addReference(ref)` / `activateExtension(id, payload)` | 点击 mindmap 节点、slides 元素、editor 表格工具栏 |
| **inline 触发** | 输入框内打 `@` 唤起候选面板，候选由注册的 provider 提供 | @ 文件、未来 @ 页面元素 |
| **选区工具栏** | `TextSelectionToolbar` 经 composer port 走统一动词 | 选中文本加引用 |

### 1.4 新需求归类判定（一步判断）

```
这个交互要不要接管提交 / 占据上下文条 / 拥有执行态？
 ├─ 不要 → 它是 Reference：注册 kind 的 chip 贡献 + 选一种触发途径
 └─ 要   → 它是 Input Extension：注册扩展契约（宿主内部，不进插件 SDK）
两条路 conversation 都不认识业务数据形状（payload / metadata 一律 opaque）。
```

---

## 2. 契约与能力

契约类型单一真源在 `packages/plugin-host-contract/renderer/`（`conversationInputContribution.ts`）；host 消费在 conversation。内置 domain（editor）经 app 层装配，插件经 plugin loader，**共用同一契约**，避免双协议。

### 2.1 引用侧契约

| 契约 | 内容 |
|---|---|
| `ConversationReference` | 数据原语（conversation `definitions/`） |
| **ReferenceKind 贡献** | 按 `kind` 注册 chip 展示规则（声明式 label / preview，自定义组件可选）、失效校验钩子 |
| **ReferenceProvider 贡献** | @ 候选源：`pluginId + id`、`triggerChar?`、`priority?`、`query({keyword,limit})→candidates[]`、`resolveReference(candidate)→ConversationReferenceInput`、`isAvailable?`。host 只渲染候选面板 |

`ConversationReferenceInput` 是公共单一真源。provider 候选可携带 resolve 所需的私有字段，但宿主不解析。候选 `icon` 收窄为标准菜单可渲染的 Vue `Component`（不接受无法渲染的 string 假能力）。

### 2.2 Input Extension 契约（宿主内部完整契约）

| 字段 | 语义 |
|---|---|
| `id` | 扩展身份（全局唯一） |
| `contextBar` | 上下文条组件 + opaque payload + 宿主句柄（句柄注入式 slot） |
| `editorExtensions` | 输入编辑器的**构造期静态**扩展集合，只允许原子节点 / 装饰，禁改提交管线与通用快捷键（见 §6 INV-editor-ext） |
| `onTextChange?` | 激活扩展按需接收 composer 纯文本变化；host 不解析文本中的扩展语义 |
| `onSubmit` | 激活时接管提交；host 只传编辑器内容与 references，不理解语义 |
| `executionState` | `idle | running` + `cancel`；host 据此禁用输入、显示停止按钮 |
| `onDeactivate` | 退出清理钩子（清理副作用归扩展自己，host 只负责调） |
| `acceptsReferences` | 声明激活期间是否接受 @ 等引用触发（如 table 激活期间宿主通用地停用 @） |

### 2.3 Composer 动词与运行期能力（P5 开放的三项 + wire）

面向「页面选中 ↔ 输入框联动 ↔ 发起可见 subrun」类未来产品能力（Sheet / SupplyMap），框架提前补足以下能力。它们不承诺 semver 稳定（guide 中标注 experimental），首个真实产品消费者接入时按 N4 反向修约。

**① ComposerCommandPort——程序化加 / 删引用 chip**
- 公开形状：`addReference(input): string`（返回宿主生成的引用 id）/ `removeReference(id)`。
- `input` 强制显式给出 `pluginId + kind`，**不继承 platform/text-selection 默认身份**；引用 store 是全局 Pinia 单例。
- **不做隐式 dedupe**：相同 `uri + kind` 不足以证明两次引用语义等价。
- 按 owner 批量清理（`removeReferencesByPluginId`）是宿主生命周期内部能力，**不进公共 port**（否则任意插件能删别的插件草稿）。
- 首版不含 `focus`：composer 是多实例（主聊 surface / side pane / project setup），尚无实例身份与 active-editor 注册协议；`focus` 属演进决策，不用「拿第一个实例」代替正确设计。

**② ConversationInputAccessoryContribution——运行期输入附件**
- 与 Input Extension 是**不同原语**：Accessory = 运行期可装卸的叠加操作区，**不接管 submit、不碰 schema、不改输入语义**，因此可安全开放给运行期插件。
- 契约：`pluginId + id + component + isVisible?()`。组件直接读插件自己的 selection / store（宿主不复制 opaque payload）；宿主只注入 `disabled` 与 owner-bound 的 `addReference/removeReference`（remove 核对引用 owner）。
- 挂载点：contextBar 与引用 chips 之间。Input Extension 激活期间 accessory 一律隐藏（模式接管期语义与布局都不叠加）。
- 每个 composer 实例都会挂载：组件必须把 selection / store 当单一业务真源，mount 只做展示连接，不在 `onMounted` 重复发起业务副作用。

**③ ConversationSubrunInvocationPort——发起可见 subrun**
- 表达业务意图，宿主翻译成内部编排：

```text
RendererPluginContribution.subrunWorkers = [{ id, promptKey }]

startConversationSubruns({
  pluginId, workerId,        // 调用只引用声明 id，不直接传 promptKey
  prompt,                    // 用户可见 run 头
  activityFeature,           // 活动归属标识（非 agent id）
  subruns: [{ description, prompt }],  // 长度 1 是单个，N 是批量
}) => { runId, completion, cancel }
```

- **边界**：公共契约禁止出现 `task`、`subrun_batch`、`tool_name`、`hostToolCall` 与系统 promptKey；单个和批量都用 `subruns[]`。宿主内部翻译为 forced `subrun_batch` + `system_batch_summarizer`（见 [Conversation Subruns](../../../../../docs/conversation-platform/10-subruns.md)），固定并发策略归宿主。写回类副作用（如 table write port）不进本契约。
- 插件在 contribution 声明 `workerId → promptKey`，调用只传当前 active 插件的 `pluginId + workerId`；后端仍校验 promptKey 是否真实注册。这是官方可信 renderer runtime 下的声明约束，不伪装成不受信代码的权限隔离。

**④ 结构化多引用 wire**——见 §4。

### 2.4 与现有机制的关系（不重叠、不合并）

| 现有机制 | 关系 |
|---|---|
| `conversationAgentChoices` contribution | 会话级产品 Agent 选择（PPT / 深度研究 pill），只声明 `agentId`，与输入交互接管是两件事，保持分离 |
| `toolCards` 注册 | 输出侧（工具结果卡）；本框架是输入侧对称面，注册模式参照它 |
| `documentReferenceRuntimePort` | 解析 / 聚焦 / 打开动词；chip 点击导航按需**复用**它，不新建导航通道 |
| `metadata.activity`（ActivityBinding） | 外部运行归属的唯一 wire key |

### 2.5 Host 自有输入状态不属于贡献

发送按钮旁的上下文用量圆环是 Conversation 宿主对自身 read model 的展示，不是 Reference、Input Extension、
Accessory 或插件贡献点。它读取正式 `user_input.metadata.context_usage`：运行中由每次成功 Prompt 的临时快照刷新，结算时
由 durable metrics 收敛；不会把模型预算、tokenizer、Prompt 分类或
弹层状态开放给插件。

该 feature 不接管 submit，不改变输入扩展生命周期；第一次新 Prompt 成功前继续显示上一份快照，之后按成功 LLM 调用
刷新。插件通过 `skill` 工具读入的
内容已经成为 Conversation 消息；默认 `<available_skills>` catalog 则属于 System prompt。宿主只展示后端已经归因的
三项数字，不在 Renderer 按插件或 skill 身份重新分类。

---

## 3. 铁律与护栏

| # | 红线（禁止） | 正确做法 |
|---|---|---|
| N1 | conversation 新增任何「认识具体业务数据形状」的代码（table 列、slides 元素、mindmap 节点……） | 只加通用动词或通用挂载点 |
| N2 | 扩展 / 附件组件拿「插件特定 props」 | 只拿 opaque payload + 宿主句柄 |
| N3 | 双状态源过渡期跨阶段存活 | 每阶段收尾时涉及状态只剩单一真源 |
| N4 | 为单一消费者把契约进 SDK | 两个真实消费者验证后才开放 SDK 字段（table + @ 已达成） |
| N5 | 动 wire（`user_quote` / `metadata.activity`）或虚拟化热路径 | 输入框不在虚拟列表内，执行态与滚动编排走既有显式声明 |
| N6 | 删旧入口不加守卫 | 每删一个旧分支 / 直引，同 PR 升级静态守卫防复活 |

**长期不做清单（防膨胀）**：

- 不为未出现的消费者预留代码。
- 不引入 `@tiptap/extension-mention`（产物是外置 chip，非 inline mention node）。
- 不为单一消费者扩大宿主契约（需要更细状态属扩展私有）。
- conversation 生产代码不得识别具体 pluginId / 文档类型 / payload / URI 语义（由静态守卫长期把守）。
- 不给 Accessory 提交接管能力（那是 Input Extension 的领地）。

---

## 4. `user_quote` 结构化多引用 wire

多引用必须永久保留每条 `pluginId / kind / uri / source / metadata`，支持历史展示、edit-resend 与业务校验。因此 wire 采用结构化 `items[]`，无旧扁平兼容。

- **唯一结构**：`user_input.metadata.user_quote = { items: [{ plugin_id, kind, uri?, text, label?, source?, metadata? }] }`。`items` 至少一项；不读取旧 `{ text, source, display_label }`，不双写、不 fallback。
- **camel / snake 边界**：renderer 运行态用 camelCase（`items[].pluginId`），公共 camel 契约真源是 `plugin-host-contract/renderer/aiInvocationPort.ts`；持久化 / host snake wire 真源是 `packages/schemas/src/conversation/user-quote.ts`。camel↔snake 映射**集中**在 `functions/userQuoteWire.ts`，Vue 组件 / store / service 不得重复手写映射。
- **发送 / 投影 / edit-resend 共用同一映射**：`chatFlowOrchestrator` 本地消息与 `assistantService` HTTP 事件共同消费，edit-resend 走同一反向映射。
- **模型侧等价**：host 仍只生成一个 `<user-quote>` fence，`content = items.map(text).join('\n\n')`，attrs 只取首项 source，确保模型输入与结构化前等价。`linnkit` 不认识 `user_quote`（`no-host-leakage` 守卫），结构化改造停在 host + renderer + schemas，不动 linnkit。
- **@ 文件送达**：`reference.text` 内嵌稳定 VFS inode（`workspace:<nodeId>`），让 Agent 用 `read_file(inode=..., view="document")` 按需读取最新内容（省 token、内容实时、不改 wire）。引用的 UI 导航身份由 `kind + metadata.documentId` 承载。
- **历史 UI 展示口径**：live projection 与 reload mapper 先通过共享 `UserQuoteSchema` 完成 strict admission，`UserMessage.vue` 只消费强类型 `metadata.user_quote.items`，不得再次 parse 或把非法引用降级为无引用。展示不用 `\n\n` 反切文本；引用构造器把缺省 label 收敛为标准正文 preview，业务 provider 可给更明确 label。历史 UI 只消费通用展示语义并保留结构化 item，**禁止按具体 kind 分支或先压成字符串再渲染**。输入框 chip 直接读 composer reference store，从不依赖 wire。

---

## 5. 生命周期与注册路径

- **内置 domain**（editor 的 table 扩展、platform 的文件 provider / text-selection kind）由 **app 层手动装配**（`app/plugins/builtin/installBuiltinConversationInputContributions.ts`、`installBuiltinRendererPluginPorts.ts`），不经 plugin loader。
- **插件**通过 `RendererPluginContribution.conversationInput`（`PluginConversationInputContribution`，仅 `referenceKinds` + `referenceProviders` + 运行期 `accessories`）声明，由 runtime loader 自动注册 / 失败回滚 / 禁用卸载，**镜像 `toolCards` 范式但不逐行照抄**。
- **激活事务**：登记时只保存声明；`activate` 前事务注册 kind / provider / accessory，但统一叠加 active gate，异步 activate 期间保持不可用（active gate 必须显式订阅 renderer registry revision，不能只闭包读非响应式 Set）。`activate` 失败立即回滚全部输入贡献；`deactivate` 只有在插件自身清理成功后才清该插件未发送的 draft references 并注销注册，失败则维持原 active 事实。禁用后 contribution 声明留在 registry，重新启用无需再次 import 插件入口。
- **状态归属**：composer reference 状态在 feature 自有 store（`composer-references/store`），避免生命周期窄入口反向加载整个 assistant / workspace / AI 聚合链。

---

## 6. 物理隔离：插件窄契约 vs 宿主完整契约

**核心定论：物理隔离两套契约，不是加个字段。**

- **插件窄契约**在类型层面就不含 `editorExtensions`：`PluginConversationInputContribution` 首版只含 `referenceKinds` + `referenceProviders` + 运行期 `accessories`。
- **宿主内部完整** `ConversationInputExtension`（含 `editorExtensions`）保留在 conversation feature definitions，移出插件 SDK（`@plugin/renderer`）暴露面，仅供 app builtin 引用。
- 这样「误认为已支持 editorExtensions」从类型上不可能发生，不靠文档口头约束。静态守卫双保险：公共 contract / SDK facade AST 不得出现 `editorExtensions` 或完整 Input Extension 标识符；输入宿主的条件表达式不得读取 `pluginId / documentType / kind` 等业务身份。

**为什么不开放 schema-bearing `editorExtensions`（INV-editor-ext 结论）**：

- TipTap 编辑器构造函数一次性创建 schema，`setOptions` / `registerPlugin` 不能增加 node / mark schema；移除定义 node 的 schema 后无法无损解析旧文档（selection / focus / undo history 也会随实例销毁）。
- runtime 插件在 App 挂载后异步加载，可能晚于 composer 首次构造，无法热装构造期 schema。
- 因此宿主内置扩展走「构造期预注册全部已知扩展，运行期只按激活态切行为 gate」；行为型贡献（reference kind / provider / accessory）是运行期注册表，无此时序问题。若未来必须开放 editorExtensions，需另立「仅 idle 受控重建 + JSON/selection 迁移」协议并重新调研，不能复用现流程。

---

## 7. 已定关键决策

| 决策 | 结论 |
|---|---|
| 列引用形态 | 保留 `ColumnReferenceNode` inline token，不并入 Reference chip。它是 prompt 模板占位符（有位置、可重复），Reference 是不参与句法的外置上下文。通用文本读取用 TipTap schema serializer（`getText({ blockSeparator:'\n' })`），host 不写 `if (node.type.name === 'columnReference')` |
| 执行态接口粒度 | 窄接口 `idle | running` + `cancel`；更细状态属扩展私有，不进宿主契约 |
| table 扩展适配器归属 | app 层（唯一能合法聚合 conversation 扩展契约 + editor `table-ai-mode` + app `table-fill` workflow 的交汇点） |
| @ provider 形态 | 注册式多 provider，首版单 `platform:workspace-document`，registry 骨架一次到位 |
| @ 文件送达 | `reference.text` 内嵌稳定 VFS inode，Agent 通过 `read_file(inode=..., view="document")` 按需读取（见 §4） |
| 结构化多引用 wire | 全局统一 `items[]`，删除旧顶层字段，无兼容 |

---

## 8. 演进类（不主动做；真实消费者出现才启动）

- **`editorExtensions` 对插件开放**：需出现必须热装 schema 的第三方插件，且先完成「仅 idle 受控重建 + JSON/selection 迁移」协议调研。Accessory **不是**此项（不碰 schema）。
- **@ 知识库条目 provider**：另立 `kb://` provider 与独立 kind。
- **ComposerCommandPort.focus**：需先定义 composer 实例身份、mount/unmount 注册与最近获焦选择协议。
- **provider resolve ownership 运行期强校验**：`resolveReference()` 返回的 `pluginId/kind` 目前是可选字段，guide 已要求插件显式返回 owner + kind；运行期校验与类型收窄另立小项，不加临时 fallback。

> 上述能力**代码零预留**（沿用 N4 与「不做清单」）。启动时另开条目，不往本文回灌施工细节。
