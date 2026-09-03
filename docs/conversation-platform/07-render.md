# 07 · 渲染与虚拟化

> **What** · 消息 → visual row → 虚拟画布 → leaf 的渲染链路，以及测量、滚动、key、动画的归属划分。
> **When to read** · 改 visual row 投影、改虚拟化、排查闪帧 / 跳动 / 吸底失效 / 列表错位之前。
> **不变量** · [INV-36](./00-invariants.md#inv-36--产品视觉契约永不更改)、[INV-37](./00-invariants.md#inv-37--稳定实体-key)、[INV-38](./00-invariants.md#inv-38--visual-row-支持任意消息-revision)、[INV-39](./00-invariants.md#inv-39--测量单一执行者)、[INV-40](./00-invariants.md#inv-40--滚动意图显式声明)、[INV-41](./00-invariants.md#inv-41--消息可见性与入场动画解耦)、[INV-59](./00-invariants.md#inv-59--完整消息共享同一个-visual-row-展示-owner)、[INV-56](./00-invariants.md#inv-56--工具展示派生只有三个-admission-入口)
> **Related** · [06 read model](./06-read-model.md) · [08 生命周期](./08-lifecycle.md)
>
> 完整实现契约（估高体系、媒体管线、红线表）在 `apps/renderer/domains/conversation/docs/conversation-virtualization.md`。本篇只定合同与归属。

---

## 1. 渲染链路

```text
window ∪ live（selectors.activeMessages）
   │  visual-row 投影（append-only 增量）
   ▼
visualRows（shallowRef + triggerRef）
   ├─ 主时间线：TanStack Virtual → VirtualConversationCanvas placement adapter ─┐
   └─ Subrun 详情：普通文档流 placement ───────────────────────────────────────┤
                                                                              ▼
                              ConversationMessageCanvas / ConversationVisualRow
                                                                              │
                                                                              ▼
                                         Message.vue / 工具卡 / 回答 footer
```

Host 主时间线的 `subagent/subrun_batch` 只保留父卡轻量进度，完整 child 消息不进入父 virtual row。用户打开详情时，`ConversationHost` 用与主 `ConversationView` 互斥的 `SubrunDetailSurface` 占据同一滚动视口；详情复用相同 message canvas / visual-row 展示层，但不复用前台 store、分页、timeline、滚动编排或 TanStack。插件公开 `SubrunCard` 仍可使用 bounded 模式，但不属于 Host 主链。

代码位置：共享展示在 `apps/renderer/domains/conversation/ui/messageCanvas/`，主时间线投影与虚拟化在 `ui/conversationView/`。

| 层 | 文件 |
|---|---|
| 共享 canvas / row DOM | `messageCanvas/components/ConversationMessageCanvas.vue`、`ConversationVisualRow.vue` |
| 共享 row 合同与 streaming 规则 | `messageCanvas/definitions/`、`messageCanvas/functions/` |
| 单条投影规则 | `logic/conversationVisualRowProjection.ts` |
| 全量投影 | `logic/projectConversationVisualRows.ts` |
| 增量 builder | `logic/appendOnlyConversationVisualRowsBuilder.ts` |
| Vue 接线 | `composables/useAppendOnlyConversationVisualRows.ts` |
| virtualizer | `composables/useTanstackConversationVirtualizer.ts` |
| 滚动意图 | `composables/useConversationScrollController.ts` |
| 手势 | `composables/useUserScrollGesture.ts` |
| 几何 | `composables/useConversationVirtualizerGeometry.ts` |
| footer mask | `composables/useConversationFooterMaskLayout.ts` |
| 动画账本 | `logic/messageEntryAnimationLedger.ts` |
| 估高 | `utils/contentHeightEstimator.ts`（**冻结区**） |

桥接层：`domains/conversation/shared/virtualization/vueVirtualizerScrollBridge.ts`（**冻结区**）。
滚动宿主：`packages/renderer-ui/src/scroll/useOverlayScrollViewport.ts`，正式入口为
`@linnya/renderer-ui/scroll`。

---

## 2. 三层虚拟化各管什么

| 层 | 管什么 | 不管什么 |
|---|---|---|
| **数据层**（window 分页） | 哪些消息在内存里 | 哪些在屏幕上 |
| **渲染层**（TanStack Virtual） | 哪些 row 挂载、测量、滚动数学 | 消息内容与业务状态 |
| **timeline 层** | 轮次导航与定位 | 滚动执行 |

三层不得互相代偿。典型错误是用渲染层的可见性推断数据层是否该翻页。

共享 `ConversationMessageCanvas` 不属于第四层虚拟化：它只把已经投影的 row 按宿主提供的 placement 渲染。主时间线传入 TanStack placement 与 `measureElement`；Subrun 详情不传 placement，按普通文档流展示。语义行距统一收口在 `ConversationVisualRow.css` 的 turn 边界 padding，宿主禁止叠加统一 `gap`。

最后一个 turn-end row 同时是唯一尾部几何 owner。`resolveConversationRowTailLayout` 决定它是否持有
tail region，以及主时间线的 waiting indicator 是否归属于该 region；duration、answer actions 和 waiting
只改变区域内内容，不改变区域高度。tail 已由 `measureElement` 计入 row，`ConversationView` 和
virtualizer geometry 不得再添加 waiting slot 或把 tail 重复计入 `scrollEndThreshold`。Subrun 普通画布
默认不启用 trailing status，但回答 actions 仍遵守同一 row tail 合同。

---

## 3. 增量投影（[INV-38](./00-invariants.md#inv-38--visual-row-支持任意消息-revision)）

builder 保存已处理消息的**浅引用**，按引用变化定位重投：

```text
同引用原地增长        → 仅尾部正文 streaming，追加
任意位置引用变化      → 按 message id 重投对应 row
结构身份变化          → 全量 rebuild
```

触发全量 rebuild 的**语义结构变化**限定为：

- `message.id` 变化
- `role` / `type` 变化
- turn identity 变化
- 可见性变化
- 消息数量减少

宽度与 registry 属于几何估高输入，不属于 [INV-38](./00-invariants.md#inv-38--visual-row-支持任意消息-revision) 的消息结构。当前实现为了刷新 row 上的 `estimatedHeight`，允许在**真实内容列宽度稳定提交后**执行一次全窗口重新估高；连续 resize 帧不得逐帧进入 builder。该过渡实现不能被文档解释为 turn identity、row map 或消息可见性发生了变化。

其余修订（metadata、工具状态、subrun version）只重投单行。禁止深度 watch 整棵消息树。

### 3.1 切会话时的 reset

`useAppendOnlyConversationVisualRows` 用 `resetKey`（当前 `activeConversationId`）判断是否 `builder.reset()`。

**这里对 reset 的正确性要求很高**：builder 的 `structureChanged` 判据依赖首条 id / 尾条 id / 长度。如果 `resetKey` 与实际 messages 内容脱钩（例如 messages 已换会话而 key 未变），就会走增量 append 路径，把新会话的行追加到旧会话行后面——`rowIndexByMessageId` 不去重，直接产出**重复 `msg_${id}` key**。

重复 key 进入 keyed `v-for` 是 `vnode.component === null` 类崩溃的教科书成因。因此：

- `resetKey` 必须与 messages 的会话归属**同源**。
- 新增 rebuild 触发条件时优先做保守判断（宁可多 rebuild）。

### 3.2 响应式表达

`visualRows` 是 `shallowRef`，持有 builder 就地 mutate 的数组，靠 `triggerRef` 通知。

**为什么不用普通 ref**：整数组替换会让 TanStack 丢失测量缓存并触发全量重排。就地 mutate + `triggerRef` 保留缓存。

代价是必须严格遵守"只有 builder 能改这个数组"。

### 3.3 工具卡 leaf 只消费已投影数据

`ConversationVisualRow.payload` 已保存完整消息引用，`toolPresentation` 随 `ToolCallMessage` replacement 触发 [INV-38](./00-invariants.md#inv-38--visual-row-支持任意消息-revision) 的单行重投；不得再复制一份到 row。

迁移完成的工具卡只接收 presentation 与明确的交互身份 props，不再声明或读取原始 `args/result`。alias 路由、wrapper 字段转换、strict parse 与 title 构造都已在 admission 完成。卡片和 `useRegistryToolUi` 禁止重新解释原始 payload，也禁止用 catch/default 隐藏协议错误。

TaskState、AgentTodo、ToolOutputRead、WorkspaceDocumentView 已完成实体卡迁移；历史 SharedMemory list/read/write 与 Resource wrapper 只保留 strict replay projector，不对应 live executable。Workspace `list_files / read_file / write_file / edit_file / grep` 已完成 header-only 注册迁移。各 feature projector 生成判别数据和延迟本地化标题；通用 registry 不理解其业务字段。工具图标合同只接受已注册组件，不接受需要运行期猜测映射的字符串名称。

---

## 4. Key 规则（[INV-37](./00-invariants.md#inv-37--稳定实体-key)）

```ts
// logic/conversationVisualRowProjection.ts:117
key: `msg_${input.message.id}`
```

要求：

| 必须 | 禁止 |
|---|---|
| 正式 message / entity ID | 数组 index |
| 跨 seal 不变 | 内容文本 |
| 跨 `loading→complete` 不变 | 工具名 + 序号 |
| 跨 reload 不变 | 随机 fallback |

同样适用于 timeline marker、动画账本、subrun 步骤列表（`SubrunTraceDisplayStep.toolCallId` 必须从正式事实透传到 Vue key）。

---

## 5. 测量单一执行者（[INV-39](./00-invariants.md#inv-39--测量单一执行者)）

尺寸测量统一交给 TanStack 的 `measureElement`。

禁止：

- 每 item 一个 ResizeObserver + rAF 测高链
- 手写 spacer
- 第二套测量缓存
- 测量后的第二次 `scrollTop` 修正

> 教训 3：headless 库负责滚动数学，宿主几何归集成方。两边都做就会互相抵消，表现为持续抖动。
>
> 教训 7：库的扩展点语义要读源码核实——TanStack 的 `shouldAdjustScrollPositionOnItemSizeChange` 是**实例属性**，通过 options 传入会被静默忽略。

估高热路径 `utils/contentHeightEstimator.ts` 属**冻结区**（见 [12](./12-open-risks.md)）。

完成态 Thought 的默认展示是未挂载正文的折叠壳，因此估高固定使用折叠壳高度，不得解析正文；未完成 Thought 默认展开并继续按 streaming 内容估高。用户主动展开完成态 Thought 后，真实高度仍只由当前 row 的 `measureElement` 写回。

估高宽度观察真实内容列。首次挂载立即提交，连续 sidebar、窗口、pane 和 timeline resize 只保留 pending width，并在 quiet window 后提交最终整像素宽度一次。提交必须由 virtualizer 作为单一事务处理：新 estimate 生效前同步捕获 `follow-bottom` 或首个可见稳定 row key + row 内偏移，公开 `measure()` 失效旧 estimate，画布提交后再用公开滚动 API 恢复同一视口。禁止写内部 cache、直接修改 DOM `scrollTop` 或增加第二个滚动 owner。

active run 期间，未完成 Thought / Answer 是持续增长的长 Markdown DOM。AppLayout 仍用
`margin` 平滑改变真实内容宽度；Conversation 宿主从同一个内容列 ResizeObserver 发布窄小的
render-scheduling port。宽度连续变化时，Markdown 调度器只能缓存最新正文，禁止解析或提交
新 AST；quiet window 后立即追平一次。该机制必须对 Sidebar、窗口、pane 和 timeline 一视同仁，
不得监听 App Sidebar 事件。

流式 AST 使用顶层 block 作为稳定渲染边界。append-only 更新中 `type + raw` 未变的 block
必须复用节点 identity，让已封口子树跳过 Vue patch；非追加替换不得复用。该优化不改变完整
Markdown 语义，也不能通过把 Thought 改成纯文本或给普通回答加内部滚动条来掩盖布局成本。

---

## 6. 滚动意图显式声明（[INV-40](./00-invariants.md#inv-40--滚动意图显式声明)）

```text
virtualizer                        → 滚动执行的唯一写者
useConversationScrollController    → 只维护产品意图
```

意图三态：`follow-bottom` / `anchored` / `free`。

落底、锚定由**发送 / 编辑 / 重新生成编排显式声明**，不由列表形态推断。

> 教训 5：依赖"列表形态变化"反推"用户意图"的启发式在窗口化数据源下必然误判。典型反例是"末条是 user 就回底"——窗口翻页时末条同样可能是 user。

---

## 7. 产品视觉契约（[INV-36](./00-invariants.md#inv-36--产品视觉契约永不更改)）

两条永不更改：

1. 滚动条**贯穿对话面板全高**，含输入框区域。
2. 对话内容滚入输入框背后**渐隐**（sticky footer + footer mask）。

任何虚拟化方案必须**适配**该设计，不是清除它。实现分工：

- 滚动条贯穿 → OverlayScrollbars 适配到 Host 全高（`useOverlayScrollViewport.ts`）
- 渐隐 → `useConversationFooterMaskLayout.ts`

中间对话流与右侧对话栏必须先经过 app-level `WorkspaceConversationSurface`，再由 `ConversationChatSurface` 在非空相位挂载同一个 `ConversationHost.vue`，从而复用**同一套**非空滚动 / 列宽 / footer 规则。`ConversationSidePane` 只拥有布局壳，不得直接挂载 Host 或复制第二套内容相位判断。

### 7.1 输入框上下文用量

发送按钮左侧固定保留 24px 点击区，内部使用 16px 圆环；发送按钮本身的 regular / compact 尺寸不变。圆环按真实
`used_tokens / (input_budget_tokens + output_limit_tokens)` 分为 `<70%`、`70%–<90%`、`90%–100%` 三档颜色，超过 100% 时弧长只在
视觉上封顶，文案与 ARIA 仍显示真实百分比。无快照或当前窗口不含 tail 时使用中性空环，不伪造 0%。历史模型快照
使用虚线轨道。

点击圆环通过共享 `BaseDropdown` 打开 `UsageBreakdownPanel`，Teleport 容器复用 `CustomSelect` 的标准 dropdown
surface。面板没有关闭按钮，只通过再次点击触发器、点击外部或 Escape 关闭；Escape 后焦点返回触发器。Teleport 面板
必须把真实 DOM ref 交给 dropdown 的外部内容边界，避免面板内点击被误判为外部点击。弹层优先位于输入框上方并与触发器
右对齐，空间不足时放到下方，始终限制在 viewport padding 内。

首版明细固定为三项，且三项之和必须等于顶部已用 token：

| 行 | 展示边界 |
|---|---|
| System prompt | 最终 system-role messages；包含默认注入的 `<available_skills>` catalog |
| Conversation | 最终非 system messages；包含 `skill` 工具读取后进入历史的结果 |
| Tool definitions | 最终 provider 请求中的工具 schema 与 control 开销 |

面板只保留顶部占用摘要、分段条和三项构成。分母使用
`input_budget_tokens + output_limit_tokens` 还原当次 route/policy 共同约束后的完整有效窗口；未着色尾部同时包含剩余输入
空间与输出额度，不另列 source、confidence、预算模型或输出预留脚注。共享面板只负责通用 segments / rows
展示，分类、百分比、格式化、历史态与 localization 全部属于 Conversation 的 `context-window-usage` feature。三项归因值
使用 ASCII `~ ` 标识近似值；条内每个非零组成必须可见，同时不得扩大总体已用宽度。

---

## 8. 可见性与动画解耦（[INV-41](./00-invariants.md#inv-41--消息可见性与入场动画解耦)）

| 组件 | 职责 |
|---|---|
| `Message.vue` | 只按 type 渲染。消息**默认可见** |
| `ConversationView.vue` | 统一决定哪些消息播放一次性入场动画，向下传递 |
| `messageEntryAnimationLedger.ts` | 记录已播放过的实体（按正式 ID） |

**禁止**在 `Message.vue` 内用 `IntersectionObserver` / 视口可见性决定显隐——视口逻辑只属于虚拟列表与滚动系统。

原因：入场动画是增强。把它和可见性耦合后，一旦观察器时序异常，消息就直接不显示了。

---

## 9. Markdown 与原样文本（[INV-22](./00-invariants.md#inv-22--markdown-只有一个解析入口)）

| 内容 | 渲染方式 |
|---|---|
| Conversation 正文、工具卡内 Markdown | `MarkstreamRenderer` → `packages/stream-markdown-parser` |
| Workspace `presentation.kind='text'` | `<pre>` 语义，保留原始空白 |
| `tool_output_read.window_text` | 同上 |

**由结构化合同判别，不由组件猜内容。** 业务组件不得自行解析 Markdown、正则替换为 HTML 或建立第二 AST。

`ConversationMarkdownRenderer.ts` 的 `renderNode` 与流式节流 watch 属**冻结区**。

### 9.1 回答中的文件链接

统一 Markdown parser 仍只产生普通 link AST；`ConversationMarkdownRenderer` 的 link 分支仅识别
`workspace:`、`conversation:`、`file:` 三类候选并分派到 Conversation `resource-link` feature，不能在
冻结热路径里执行 schema admission、IPC、Workspace 查询或异步状态管理。

资源链接组件使用消息所属的不可变 `conversationId` 请求 app-level port。Workspace owner 在 Host 中从
Conversation 事实反查 `projectId`，再解析 VFS metadata；Renderer 只消费真实标题、node type 和内部导航
身份，并由 document registry 决定图标与 surface。Conversation/Host owner 只返回普通文件状态和
basename，绝对路径留在 Host；点击时重新准入并调用系统文件管理器定位。

虚拟列表重挂载会重新解析当前 path，不缓存永久 missing，也不扫描或猜测移动后的目标。非法的三类正式
locator 显示 disabled 状态；普通 Web 链接和其它协议仍是独立的外链安全议题，不得借文件链接 feature
建立万能 URI router。

---

## 10. Timeline

`features/timeline/` 管全量 turn index 与窗口内 / 外导航。

- timeline index **只接受完整 visual turn 身份**（[INV-12](./00-invariants.md#inv-12--runtime-与视觉轮次身份隔离)）。
- 窗口外跳转经 `loadAround`（见 [06 §2](./06-read-model.md)）。
- 滚动 / 定位链路（`navigateToTimelineVisualTurn` / `waitForTimelineVisualTurnMounted`）属**冻结区**，只允许增加错误上报。

TimelineNav 开关指对话面板的轮次导航，不是编辑器块历史。唯一开关由 `AppHeader` 控制、状态收口在 `useAssistantStore`，中间对话流与右侧对话栏消费同一份状态，默认收起。

---

## 11. 禁止清单

| # | 禁止 | 正确做法 |
|---|---|---|
| 1 | 数组 index / 文本 / 工具名+序号作 key | 正式实体 ID（§4） |
| 2 | 每 item ResizeObserver 测高 | `measureElement`（§5） |
| 3 | 测量后二次修正 `scrollTop` | 单一执行者（§5） |
| 4 | 由列表形态推断滚动意图 | 编排显式声明（§6） |
| 5 | 在 `Message.vue` 用视口决定显隐 | 默认可见（§8） |
| 6 | 组件手写 Markdown 解析 | 唯一入口（§9） |
| 7 | 深度 watch 消息树 | 引用变化定位重投（§3） |
| 8 | 整数组替换 `visualRows` | builder mutate + `triggerRef`（§3.2） |
| 9 | `resetKey` 与 messages 归属不同源 | 同源，宁可多 rebuild（§3.1） |
| 10 | 右侧对话栏复制第二套滚动规则 | 复用 Host 规则（§7） |
| 11 | 清除滚动条贯穿或渐隐设计 | 适配而非清除（§7） |
| 12 | 修改冻结区热路径 | 需可复现 bug + 真机门禁（[12](./12-open-risks.md)） |
