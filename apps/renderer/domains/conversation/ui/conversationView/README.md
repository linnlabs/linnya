# ConversationView

> **全链路权威规范**：[`docs/conversation-platform/`](../../../../../../docs/conversation-platform/README.md)。不变量以 [`00-invariants.md`](../../../../../../docs/conversation-platform/00-invariants.md) 的 `INV-nn` 为准；本文是实现级说明，冲突时以规范为准。

本目录负责把当前消息窗口投影成 `visual-row`、由 TanStack Virtual 计算 placement，并承接产品滚动意图、历史分页和窗口内 timeline 位置。共享行 DOM、轮次间距与 leaf 展示已经抽到 [`../messageCanvas/`](../messageCanvas/README.md)；历史数据加载属于 `message-window/`，全会话 timeline 索引与换窗导航属于 `features/timeline/`。

## 责任边界

- 输入：`ConversationHost` 提供的消息合成视图、窗口游标、加载状态和滚动宿主。
- 输出：当前窗口的 visual-row、TanStack placement，以及落底、分页、timeline 定位事件。
- 不负责：SSE 解析、事件投影、窗口网络请求、全量 turn index、共享 visual-row DOM 与 Markdown leaf 渲染。

`ConversationView.vue` 只做响应式接线和 UI 事件转发。归组、估高、分页规则与滚动模式判断分别留在 `logic/`、`utils/` 和 `functions/`，不能重新塞回 SFC。

## 目录

```text
conversationView/
├── components/
│   └── VirtualConversationCanvas.vue
├── composables/
│   ├── useAppendOnlyConversationVisualRows.ts
│   ├── useSettledConversationContentWidth.ts
│   ├── useTanstackConversationVirtualizer.ts
│   ├── useConversationScrollController.ts
│   ├── useUserScrollGesture.ts
│   ├── useConversationTimelinePositions.ts
│   ├── useTimelineLayoutReserveAnimation.ts
│   ├── useConversationVirtualizerGeometry.ts
│   ├── useConversationFooterMaskLayout.ts
│   ├── useMessageEntryAnimation.ts
│   └── useStreamingWaitingIndicator.ts
├── functions/
│   ├── historyBackfillPolicy.ts
│   ├── conversationContentWidth.ts
│   ├── scrollPositionController.ts
│   ├── conversationVirtualizerGeometry.ts
│   └── timelineLayoutReserve.ts
├── logic/
│   ├── appendOnlyConversationVisualRowsBuilder.ts
│   ├── conversationVisualRowProjection.ts
│   ├── projectConversationVisualRows.ts
│   ├── messageEntryAnimationLedger.ts
│   └── types.ts
└── utils/
    ├── contentHeightEstimator.ts
    ├── estimationRegistry.ts
    └── resolveScrollContainer.ts
```

## 数据流

```text
window rows + live messages
  -> selectors 合成 activeMessages
  -> useAppendOnlyConversationVisualRows
  -> ConversationVisualRow[]
  -> useTanstackConversationVirtualizer
  -> VirtualConversationCanvas（只适配 placement / measureElement）
  -> ../messageCanvas/ConversationMessageCanvas
  -> ConversationVisualRow / Message / actions / work-duration
```

`ConversationVisualRow` 是消息画布的唯一展示 item，粒度为一条可见 message。主时间线把它作为唯一虚拟 item；Subrun 详情把它作为普通文档流 row。每行携带稳定 `key`、`visualTurnId`、turn 边界、估高和 bounded 标记。父工具下的 subrun collection 属于工具消息 leaf，内部展开由 `SubrunCard/UiCardGroup` 自己管理，不提升为额外顶层 visual-row。

TanStack 仍是主时间线几何的唯一 owner。`VirtualConversationCanvas` 只能把 visible item 转成 placement，不能复制共享 row 模板；`ConversationMessageCanvas` 只接收 placement，不能 import TanStack 或写滚动位置。Subrun 详情不需要虚拟化，也不得因此绕开共享 row、直接循环 `Message.vue` 或另加统一消息 `gap`。

`visualTurnId` 的唯一 owner 是 `packages/schemas/src/conversation/visual-turn-identity.ts`。完整视觉轮次从可见 user message ID 派生；历史窗口从 assistant 中段开始时使用 partial visual turn。Runtime `turn_id` 只属于执行和引用关联，禁止 visual-row、timeline、位置上报或 virtualizer 读取它、比较它或把它作为 fallback。

增量 builder 复用统一可见性规则：尾部 append 与流式尾消息更新只处理尾行；prepend、truncate、edit replay 才因语义结构变化全量重建。宽度不是消息语义；当前阶段仅在真实消息列宽度稳定后触发一次全窗口重新估高，后续应在有 profiling 收益时再把 geometry estimate 完全移出 row projection。禁止恢复 turn 级二次投影、顶层 task-step 分组或在流式 chunk 上全量 Markdown parse。

`useSettledConversationContentWidth` 观察真实 `.messages-container`，初次挂载立即提交；连续 sidebar、窗口、pane 或 timeline resize 只覆盖 pending width，120ms quiet window 后才提交最终整像素宽度。不得恢复 outer width + CSS 变量的重复布局推算，也不得监听 App sidebar 事件。完成态 Thought 的初始 DOM 是折叠壳，估高固定使用 `registry.message.min`，禁止读取或解析正文；用户展开后继续由当前 row 的 `measureElement` 接管真实高度。

未完成 Thought 与 Answer 的 Markdown DOM 会在 active run 中持续增长。主内容区仍平滑改变
真实宽度；同一个宽度协调器通过 `ConversationRenderSchedulingPort` 发布“内容列正在连续
resize”，Markdown 调度器在该窗口只缓存最新正文，不解析、不提交 AST，quiet window 后
一次追平。该端口不暴露 Sidebar、Pane 或 AppLayout 来源，不能反向监听 app 事件。

流式 Markdown 每次解析后按顶层 block 对比 `type + raw`。仅在正文 append-only 时复用已封口
节点 identity，稳定 block 由独立组件边界跳过 patch，仍在增长或被重新解释的尾块正常更新；
编辑、重试替换等非追加更新必须完整使用新 AST，不能复用旧节点掩盖语义变化。

## 虚拟滚动合同

TanStack Virtual 是位置与测量的唯一执行者：

- `anchorTo: 'end'` 负责头插旧页后的稳定 key 归位，`followOnAppend` 负责尾部追加。
- 每个 visual row 直接接 `measureElement`；不得恢复每 item ResizeObserver、手写 spacer 或第二套测量缓存。
- settled width 提交必须作为一次 virtualizer 事务：新估高写入前同步捕获当前 `follow-bottom` 意图或首个可见稳定 row key + row 内偏移，使用 TanStack 公开 `measure()` 失效旧 estimate，画布高度提交后再通过公开 `scrollToEnd()` / `scrollToOffset()` 恢复同一视口。不得访问 `measurementsCache` / `itemSizeCache` 私有状态进行写入，也不得直接修改 DOM `scrollTop`。
- 始终只补偿完整位于视口上方的尺寸修正，即 `item.end <= scrollOffset`；真实尺寸相对估高的残差不能因 prepend 被吞掉。
- 检测到旧首 key 被头插后移时开启 prepend render transaction：scroll bridge 合并 `anchorTo` 目标与同批尺寸残差，Vue patch 后一次写入 DOM。禁止用固定 rAF 数量猜测画布提交时机。
- streaming 时末三行常驻，保证尾部增量 DOM 不被窗口裁掉。
- `scrollMargin` 来自真实滚动原点到画布顶部的几何；sticky footer 与内容 padding 进入 `scrollEndThreshold`，最后一行 tail 已属于 virtual row 实测高度，禁止再次累计。
- 生成期 waiting 只作为 trailing status 传给共享 message canvas，由最后一个 turn-end row 的单一 tail region 持有。通用图标、工具自带 loading 与 answer actions 的显隐不能改变 tail 高度；run terminal 后只释放 waiting ownership，有回答操作时 row tail 继续保留。

`useConversationScrollController` 只维护产品意图：`follow-bottom`、`anchored`、`free`。它不直接修改 `scrollTop`。发送、编辑重发和重新生成必须由编排显式确保真实尾窗后再提交落底意图，禁止根据“末条消息是 user”猜测。

`hasMoreAfter=true` 表示当前底部是假底，即使处于 `follow-bottom` 也必须允许 `loadAfter`。timeline 导航期间由 Host 设置瞬时导航锁，before/after backfill 都暂停，避免换窗与定位竞争。

## Timeline 接口

本目录只上报当前窗口内 `isTurnStart` 行的实测位置，并按稳定 `visualTurnId` 定位。全会话 marker 来自 `features/timeline/` 的 `/turns` index；目标不在当前窗口时，由 Host 执行 `loadAround -> waitForTimelineVisualTurnMounted -> scrollToVisualTurn`。

`scrollToVisualTurn` 是异步稳定合同：动态测高期间持续按 key 重解析 index，目标 offset 连续稳定且误差小于 1px 才成功。禁止以固定数量的 `nextTick` 或 rAF 代替目标挂载和测量完成条件。

## UI 不变量

- 空态与消息态由 `ConversationChatSurface` 使用 `v-if/v-else` 原子互斥。`ConversationHost` 不是 projection runtime owner，进入 `draft / ready-empty` 时应完整卸载；后台会话继续生成由 conversation-scoped reducer 保证，禁止用 `v-show` 常驻隐藏 Host。`ConversationEmptyState` 是 `ConversationView` 既有空态与右侧 footer 草稿共用的纯视觉组件；右侧 composer 由 Surface 的底部 footer 持有，但仍使用与主区一致的 regular 输入框规格，不能为了输入框位置复活空 Host 或切换视觉密度。
- OverlayScrollbars、virtualizer、Timeline Teleport 和 observers 只在其真实宿主挂载期间存活。共享滚动 composable 的 `onBeforeUnmount` 负责先销毁第三方 DOM 接管；业务 watcher 只能请求 update，不能把滚动实例生命周期与后台 projection commit 绑定。
- 滚动条贯穿整个对话宿主，包括输入框所在高度。
- 内容可以滚入 sticky footer 背后，再由 footer mask 渐隐。
- leaf 组件树由 `Message`、工具卡、SubrunCard 等既有组件负责；虚拟化层不得复制或改写 leaf 渲染。
- 普通回答与表格自然增高；只有 bash 这类无界流式输出使用 row 内 bounded 滚动。
- 无尺寸存量图片保留 600x400 上限的有界 fallback；带 `result.media` 尺寸的新图按真实比例预留。

## 排障顺序

滚动或分页异常先核对：真实 scroll element、controller mode、`isPrepending` 窗口、navigation lock、TanStack `scrollOffset/measurementsCache`。不要通过额外 `scrollTop` 写入、MutationObserver 吸底或延长随意帧数掩盖问题。

渲染项异常先核对：消息可见性、visual-row 投影边界和稳定 key。需要独立上下文的过程必须进入父工具的 subrun collection，禁止重新增加业务专用顶层 row 类型。

若异常涉及切换会话、新草稿、ErrorBanner 或流式 terminal 时序，先运行 `pnpm run test:conversation-navigation:electron` 并查看捕获到的第一个 `Runtime.exceptionThrown`。`nextSibling`、`subTree`、`emitsOptions` 等错误常是前一轮 patch 中断后的级联结果，不应直接在报错行增加空值判断。
