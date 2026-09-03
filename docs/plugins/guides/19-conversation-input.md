# 19 · 对话输入贡献

> 适用场景：插件给对话输入框贡献 `@` 引用候选和标准 reference
> chip，或从插件页面交互程序化加入引用/操作区；判断新输入能力属于 Reference、Accessory 还是宿主 Input Extension。

本章只讨论**输入上下文如何进入 composer**，不定义发送后如何执行，也不负责展示 subrun 过程。Subrun 展示见
[20 Subrun 过程展示](./20-subrun-process-ui.md)，插件主动发起普通 AI 请求或 subrun 见
[12 AI 交互](./12-ai-interaction.md)。

## 1. 输入与执行必须解耦

Reference 表达“用户随本次输入带了什么上下文”。它不表达“发送后必须怎么执行”。

同一种引用可能进入不同执行路径：

- 作为普通对话上下文，模型直接回答；
- 被 workflow 或 agent 用来发起一个 subrun；
- 被 app-level orchestration 拆成 batch；
- 只参与资源读取、定位或后续工具调用。

这些选择可能发生在引用确认时，也可能发生在提交后的 workflow、agent、tool 中。关键不是时间点，而是**由 app/workflow
orchestration 组合两个独立动作**：一边创建 Reference，一边按需启动 subrun/batch。启动动作不属于
`ConversationReferenceProviderContribution`，也不能通过 reference
kind、URI 或 metadata 在 conversation 宿主里硬编码。

当前插件 ReferenceProvider 的标准选择动作只创建引用，不附带执行命令。某个产品流程若要求“选中候选后立即研究”，应由插件 orchestration 显式编排“加入引用 + 发起 subrun”，而不是扩张 Reference
payload 的语义。

反过来，subrun 也可以由按钮、工具调用、定时流程等其他入口发起，不要求先存在 Reference。输入贡献与 subrun 展示不存在一一对应关系。

## 2. 三个输入原语

判断新需求时只问：是否需要接管提交与执行态？

| 原语            | 适用场景                                          | 插件 SDK 状态             |
| --------------- | ------------------------------------------------- | ------------------------- |
| Reference       | 给当前输入附加一块上下文，不接管提交              | 已开放 kind/provider      |
| Accessory       | 在输入框上方叠加操作区，不接管提交、不改变 schema | experimental，已开放      |
| Input Extension | 改变输入框结构、接管提交、持有独立执行态或 cancel | 仅宿主内置，未向插件开放  |

`conversationWorkflows`
是另一个独立概念：它声明 workflow 的菜单、pill、文案、图标和
`promptKey`，不等于 Reference 或 Input Extension。真实装配以各插件自己的 renderer contribution 为准。

## 3. 插件公开契约

契约真源是
`packages/plugin-host-contract/renderer/conversationInputContribution.ts`，SDK 入口是
`@plugin/renderer/conversationInputContribution`。

`PluginConversationInputContribution` 包含三类运行期贡献：

- `referenceKinds`
- `referenceProviders`
- `accessories?`

### 3.1 ReferenceKind：已解析引用如何展示

`ConversationReferenceKindContribution` 定义：

- `pluginId + kind`：引用类型的全局身份；
- `chip.label` / `chip.preview`：宿主标准 pill 的展示文本；
- `isValid?`：该引用是否仍满足插件业务约束。

首版只支持宿主标准 pill。插件不能贡献自定义 chip 组件、点击导航或私有交互；这些能力没有公共契约。未注册 kind 是契约违规，宿主显式报错，不做静默 fallback。

### 3.2 ReferenceProvider：发现候选并构造引用

`ConversationReferenceProviderContribution` 负责 `@` 候选：

- `query` 只根据 keyword/limit 返回轻量 candidate；
- `resolveReference` 只在用户确认候选后构造最终 `ConversationReferenceInput`；
- `isAvailable?` 表示插件业务环境当前是否可提供候选；
- `priority?` / candidate `score?` 参与宿主聚合排序。

查询阶段不要为了展示所有候选而预读完整正文，也不要绑定 conversation 内部状态。`resolveReference`
是同步转换：它只应基于用户选中的 candidate 构造 `text`、`uri` 和
`metadata`，不能在里面启动未等待的异步读取。

若正文必须异步获取，优先让引用文本携带可读取的资源 URI，由 agent 使用平台资源工具按需读取；确实无法表达时，应先演进公共契约。

一个插件 provider 的 `resolveReference` 必须显式返回本插件的 `pluginId` 和已注册
`kind`，不能依赖 platform/text-selection 默认值。provider、kind contribution 的
`pluginId` 也必须与所属 renderer plugin 的 `meta.id`
一致，不能冒用其他插件身份。

### 3.3 Accessory：叠加操作区

`ConversationInputAccessoryContribution` 用于 Sheet/SupplyMap 一类联动：插件页面选区变化后，在 composer 上方展示按钮、摘要或操作入口。贡献只包含本插件的 `pluginId + id`、Vue `component` 和可选 `isVisible()`。

Accessory 组件直接读取插件自己的 selection/store，宿主不复制或解析 opaque payload。宿主只注入：

- `disabled`：当前 composer 是否因执行中或外部状态而禁用；
- `composer.addReference`：自动绑定贡献所属 plugin owner；
- `composer.removeReference`：只能移除该 owner 自己加入的引用。

多个可见 Accessory 按注册顺序展示。宿主 Input Extension 激活期间全部隐藏，避免模式接管与叠加操作区同时改变输入语义。插件停用、激活失败或注册冲突时，Accessory 与同批 kind/provider 一起卸载或回滚。

Accessory 可以在按钮事件中调用独立的 `conversationSubrunInvocationPort` 或普通 AI port，但这仍是执行层动作，不属于 Accessory 或 Reference payload；两条链必须分别处理失败、取消和测试。发起契约只在 [12 AI 交互](./12-ai-interaction.md) 定义，本章不重复。

### 3.4 Reference payload 的边界

`text` 是最终进入发送上下文的模型可见内容；`uri`、`source` 和 `metadata`
是引用事实。conversation 宿主只负责保存、展示和发送，不解析插件私有 payload。

发送与持久化时每条 Reference 对应一个 `user_quote.items[]` 条目，逐条保留 `pluginId/kind/uri/text/label/source/metadata`。插件和输入 feature 使用 camelCase 公共契约；snake wire 映射由 conversation 统一完成。不要在 provider、Accessory 或插件 workflow 中自行拼接 `\n\n` 或构造 `plugin_id`。

不要在 payload 中埋“启动某个 subrun”“使用某个 agent”之类的宿主控制协议。需要在引用确认时或提交后执行分流，应使用公开 subrun invocation、workflow、tool、agent 或 app-level
orchestration，让执行层基于自己的契约作决定。

## 4. 当前明确不开放的能力

插件的 `conversationInput` 当前不包含：

- `editorExtensions` 或任何 TipTap schema 扩展；
- 完整 Conversation Input Extension；
- 接管提交、执行态、cancel 或 Input Extension context bar；
- 自定义 reference chip、chip 点击导航；
- 宿主内部 table 输入扩展。

原因不是口头权限约定，而是类型物理隔离：runtime 插件异步加载晚于编辑器构造，而 schema-bearing 扩展必须在构造期确定。平台内置 table
Input Extension 仍由 app 层手动装配，不代表插件 SDK 已开放同类能力。

未来出现真实的第二个 schema-bearing 消费者时，应另立受控重建和内容/选区迁移协议，不能把
`editorExtensions` 直接塞回当前窄契约。

## 5. 从非 Accessory 页面程序化操作引用：ComposerCommandPort

`@plugin/renderer/composerCommandPort` 是 experimental 的窄命令口，适用于编辑器工具栏、画布节点等 Accessory 组件之外的页面动作。它不是 `conversationInput` contribution，也不改变发送后的执行方式。

当前只开放两个动作：

- `addComposerReference(input)`：调用方必须显式提供自己的 `pluginId + kind`；宿主创建引用并返回唯一 `referenceId`；
- `removeComposerReference(referenceId)`：按上一步返回的 id 精确移除引用。

调用方如果需要撤销，应保存 `addComposerReference` 返回的 id。公共 port 不提供按 `pluginId` 批量删除，因为插件不应拥有清理其他 owner 草稿的权限；插件停用时的 owner cleanup 由宿主生命周期负责。

当前插件是官方可信 renderer runtime，`pluginId + kind` 是契约约束而不是隔离不受信代码的权限令牌。插件必须只声明自己的 owner/kind，也只能移除自己保存的 reference id；不要把 id 当作跨插件协调协议。

该 port 当前不提供 focus、编辑器实例、输入文本修改、提交控制或隐式去重。主 conversation、side pane 等 composer 可以同时存在，在实例身份与最近获焦协议建立前，宿主不能武断选择一个输入框聚焦。相同 URI 也可能代表不同引用文本或 metadata，宿主不会吞掉重复的显式添加动作。

“加入引用”和“发起 AI/subrun”仍是两个独立动作。产品流程需要两者联动时，应由插件自身 orchestration 或 app workflow 显式组合，并分别处理失败与取消；不能把执行命令藏进 Reference payload。

## 6. 生命周期与失败语义

conversation 输入贡献跟随 renderer
plugin 的 active 生命周期，不跟随“入口已被 import”或“contribution 已登记”状态。

1. loader 读取并登记 `RendererPluginContribution`。
2. 激活前，宿主校验 kind/provider/accessory
   ownership，并事务注册输入贡献；provider/accessory 仍由 active gate 隐藏。
3. 插件 `activate()` 成功后，provider 才可参与候选查询，accessory 才可展示。
4. 输入贡献冲突或 `activate()` 失败时，本次注册的 kind/provider/accessory 会回滚。
5. `deactivate()`
   成功后，宿主先移除该插件尚未发送的草稿引用，再注销 provider/kind。
6. `deactivate()`
   失败时，宿主保留 active 状态、provider/accessory 和草稿引用，不伪造“已停用”。

重复的 `pluginId + kind`、`pluginId + provider id`、`pluginId + accessory id`
或插件 id 都会显式失败。插件应修正身份冲突，不要通过 catch、改名重试或 fallback 掩盖注册错误。

平台内置的 text-selection、workspace-document 和 table 输入贡献由
`apps/renderer/app/plugins/builtin/installBuiltinConversationInputContributions.ts`
装配，不经过动态插件 loader。不要把 builtin 路径复制到插件包。

## 7. 边界铁律

### 宿主必须保持中立

- conversation 输入宿主不得按具体 `pluginId`、document type、node
  type、reference kind、URI 或 payload 字段写条件分支；
- conversation 不解析插件 reference 的 `metadata` / `source` 私有结构；
- conversation 不读取插件 Accessory 的 selection/store，也不按 accessory 身份写布局分支；
- 输入宿主不决定发送后使用普通回答、subrun 还是 batch；
- 跨 domain 装配放 app 层，通过 registry、port 或 public contract 协作。

### 插件必须保持独立

- 只从 `@plugin/renderer/*` 门面消费宿主能力，不 deep import
  `apps/renderer/domains/conversation/**`；
- 入口只装配 contribution，复杂查询、转换和流程放插件自己的 feature/functions/orchestration；
- 不从 ReferenceProvider 直接调用 subrun invocation、conversation store 或 subrun UI；
- 插件样式经 `stylesheets` 随 loader 挂卸。

## 8. 最小验收

- provider 的 query、排序输入和 resolveReference 有业务测试；
- resolveReference 显式返回本插件
  `pluginId + kind`，停用时草稿引用能按 owner 清理；
- kind 的 label/preview/isValid 对真实引用有业务测试；
- accessory 验证可见性、disabled、Input Extension 互斥和 owner-bound add/remove；
- ownership 冒用、重复 kind/provider/accessory、后段冲突回滚会显式失败且无部分注册；
- fake
  plugin 覆盖激活前不可用、激活成功可用、激活失败回滚、停用清草稿、重新启用恢复；
- `deactivate()` 失败时 active/provider/草稿引用保持不变；
- Electron 验证 `@`
  选择、标准 chip、发送、模型实际读取资源、reload，以及与宿主 Input
  Extension 共存；
- 若产品流程会在引用确认或提交后触发 subrun，应分别测试“Reference 正确入栈”和“独立 subrun 命令正确发起”，证明失败、取消和重试不会把两套状态绑死。
- 使用 ComposerCommandPort 的页面动作应验证 add 返回 id、remove 精确撤销；不得通过 deep import 调用 conversation store/composable。

平台已有
`apps/renderer/app/plugins/pluginConversationInputBoundary.static-guard.test.ts`，锁定两条边界：输入宿主不能按插件/文档业务身份分支，插件公开输入契约不能出现
`editorExtensions` 或完整 Input Extension。

通用插件验收与边界命令见 [16 测试、验收与守卫](./16-testing-and-guards.md)。

## 9. 真源与参考

| 内容                         | 真源 / 参考                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| renderer contribution 总契约 | `packages/plugin-host-contract/renderer/pluginContribution.ts`                      |
| 插件输入窄契约               | `packages/plugin-host-contract/renderer/conversationInputContribution.ts`           |
| composer 命令契约            | `packages/plugin-host-contract/renderer/composerCommandPort.ts`                      |
| composer SDK 门面             | `@plugin/renderer/composerCommandPort`                                               |
| Accessory registry/宿主槽     | `apps/renderer/domains/conversation/features/input-accessories/`                    |
| loader 输入生命周期          | `apps/renderer/app/plugins/orchestration/pluginConversationInputLifecycle.ts`       |
| registry 激活/停用事务       | `apps/renderer/app/plugins/registry.ts`                                             |
| builtin 输入装配             | `apps/renderer/app/plugins/builtin/installBuiltinConversationInputContributions.ts` |
| conversation workflow 示例   | 各插件的 `src/renderer/index.ts` contribution                                      |
