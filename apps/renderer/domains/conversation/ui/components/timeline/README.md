# 时间轴导航

> **全链路权威规范**：[`docs/conversation-platform/`](../../../../../../../docs/conversation-platform/README.md)。不变量以 [`00-invariants.md`](../../../../../../../docs/conversation-platform/00-invariants.md) 的 `INV-nn` 为准；本文是实现级说明，冲突时以规范为准。

## 当前边界

时间轴由数据 feature 与纯 UI 两部分组成：

- `features/timeline/`：拥有 turn index 契约、DTO 校验、marker 投影和加载编排。
- `ui/components/timeline/`：只负责位置计算、高亮同步、dot、tooltip 和交互展示。
- `ConversationHost.vue`：连接当前会话、message window、streaming 状态与 timeline feature，并把 markers 和窗口内实测位置显式传给 `TimelineNav`。

`TimelineNav` 禁止直接读取 `assistantStore` 或 message-window store。跨组件数据必须经过共同宿主明传，避免重新形成 UI 旁路。

## Marker 数据合同

历史会话 window ready 后，timeline feature 从 `/api/v1/conversation/:id/turns` 读取全量 user turn index。后端 index 是已持久化历史的权威基线，当前窗口与 live 消息只承担两项职责：

1. 覆盖同一 user message 的最新摘要。
2. 追加尚未进入 read model 的 live user turn。

当 turn index 仍在 preparing 时，时间轴继续使用当前可见消息生成 fallback，并在 feature 编排内重试。window revision 变化或一次 streaming 结束后会重新读取权威 index。普通 assistant 流式 chunk 不得触发全量 marker 合并。

Marker 使用 `ConversationCompleteVisualTurnId`，wire 字段固定为 `visual_turn_id`；它由 `packages/schemas/src/conversation/visual-turn-identity.ts` 的正式函数从 user message ID 派生。`anchorMessageId` 保留原始 user message ID，供后续窗口外 `loadAround` 导航使用。禁止手拼 ID、接收旧 `turn_id` 字段，或读取 Runtime `turn_id`。

## 位置合同

- 当前窗口内已有实测位置的 turn，使用真实几何细化它所在的全局 ordinal 区间。
- 当前窗口外的 turn，按全量 index ordinal 近似分布。
- 短会话继续使用现有归一化布局和最小间距规则。
- 超容量 marker 使用固定间距和可见窗口渲染；正文位置变化不得触发全量 dot 更新。
- 连接线只覆盖首个与末个圆点的中心区间，不得延伸到轨道内容的上下留白。

## 导航合同

- 窗口内目标按稳定 `visualTurnId` 解析当前 visual-row index，并等待虚拟层动态测高定位收敛。
- 窗口外目标先按 `anchorMessageId` 执行 `loadAround`；窗口替换并不代表目标已经可滚动，必须等目标 `visualTurnId` 真正进入 `timelinePositions` 后再定位。
- 禁止用固定 `nextTick` / `requestAnimationFrame` 次数猜测投影和虚拟测量已经完成。
- `scrollToVisualTurn` 是异步完成合同：只有目标 measurement 与实际 scroll offset 连续稳定且偏差 `<1px` 才算成功。窗口头插或裁剪移动数字 index 时，必须按 `visualTurnId` 重新解析并续接定位。
- 连续点击远端 marker 时取消前一次等待和定位，只允许最后一次导航落地；切换会话或卸载宿主也必须取消。
- timeline 导航整个生命周期内禁止 before/after backfill，避免窗口变化与动态定位竞争；锁只属于宿主编排，不进入 message-window store。
- read model 仍在 preparing 或目标未在时限内进入测量结果时显式报错，禁止静默停在目标附近。

## Host 编排

`ConversationHost.vue` 是 timeline 与 message-window 的唯一跨 feature 编排点：

1. `useTimelineTurnIndex` 根据当前会话、窗口 revision 和 streaming 收尾维护全量 markers。
2. 点击 marker 时先取消上一次 `AbortController`，再设置 `isTimelineNavigating`；该状态显式传给 `ConversationView`，分页 policy 在导航期间冻结 before/after backfill。
3. `navigateToTimelineVisualTurn` 先调用虚拟层异步 `scrollToVisualTurn`。目标已在窗口内时直接完成；否则按 `anchorMessageId` 调 `loadAround`。
4. 换窗完成后，`waitForTimelineVisualTurnMounted` 监听 `ConversationView` 上报的实测 positions；目标出现后再次按稳定 `visualTurnId` 定位。
5. 成功、失败、取消或组件卸载都必须释放导航锁。非取消错误由 Host 记录一次上下文日志，不在 UI 组件里静默吞掉。

`TimelineNav` 不拥有上述流程，也不能直接调用 message-window。这样 dot 展示、窗口加载和虚拟滚动分别保持单一职责。

## 当前能力

- 全会话 marker index。
- live user turn 增量追加。
- revision 与 streaming 收尾后的 index 同步。
- 超容量 dot 在 timeline 内部独立滚动，只挂载可见 marker 与 overscan。
- active dot 自动跟随；用户 hover 手动浏览期间暂停跟随，移出后恢复。
- 当前窗口滚动位置驱动 active turn 高亮。
- 窗口外 marker 通过 `loadAround` 换窗；`around` 属于 ready 态导航换窗，不得卸载画布或显示初始加载壳。
- 点击、tooltip、展开与收缩动画。
