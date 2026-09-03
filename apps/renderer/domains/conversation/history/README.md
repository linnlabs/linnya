# Conversation History

> **全链路权威规范**：[`docs/conversation-platform/`](../../../../../docs/conversation-platform/README.md)。不变量以 [`00-invariants.md`](../../../../../docs/conversation-platform/00-invariants.md) 的 `INV-nn` 为准；本文是实现级说明，冲突时以规范为准。
>
> 对话工作目录和删除顺序见 [Conversation Files Domain](../../../../../src/domains/conversation-files/README.md) 与 [Conversation Lifecycle Workflow](../../../../../src/app-hosts/linnya/application/conversation-lifecycle/README.md)。

`history/` 负责历史列表、打开会话时的 loading 壳，以及单个活跃会话的 message window 加载。它不拥有 Agent run、SSE 请求或 message projection runtime。

## 数据边界

- `messageProjectionStates`：按 conversation 持有 live reducer。后台 run 即使不可见，也继续在自己的 runtime 上投影。
- `conversation.messages`：每个 conversation 的 live slot，由 projection commit 写入。
- `messageWindowStore`：当前活跃会话的 durable history window，切换会话时可以替换。
- `selectors.activeMessages`：按规范 `message_id` 合并 window 与 live，live revision 优先。

三者不能互相代替。window 加载不是 Runtime 生命周期事件，不得释放 run / execution / answer / tool 的在途状态。

projection runtime 的常驻只发生在 store。它不要求 `ConversationHost` DOM 常驻：Surface 进入草稿或 ready-empty 时必须原子卸载 Host，后台 conversation 仍由自己的 reducer 和 pending commit 继续接收事件。不要用 `v-show` 或组件实例保存运行态。

## 打开会话顺序

1. 创建 `{ conversationId, requestToken }` loading 世代并开启 SSE FIFO。
2. 保留目标 conversation 已有的 projection runtime 和 live slot，切换展示壳。
3. 加载 metadata 与 tail window，恢复 conversation-scoped interactive-run 控制态。
4. window ready 后，把本世代缓冲事件按原序回放到同一 projection runtime。
5. 按 token 结束或丢弃本世代缓冲；旧世代不得继续写入。

切走的 conversation 不进入当前 loading buffer。它的请求级 router 仍按事件自己的 `conversation_id` 投影，因此后台生成不会因为当前页面变化而中断或改绑。

`loadConversation` 必须返回明确的 `committed / stale / failed` 结果；导航只有收到 `committed` 才能持久化最近对话。删除或更新的导航世代取得控制权后，旧请求即使正常返回也不得再写导航状态。

## 侧边栏选择语义

- `activeConversationId` 表示当前打开的会话，是普通点击和键盘打开的唯一单选事实源。
- `ConversationBatchSelectionState` 是列表操作选择集合，只服务右键单项操作、`Ctrl/Cmd` 切换选择、`Shift` 范围选择和批量删除；它不表示当前打开的会话。批量集合没有显式锚点时，首次 `Shift` 点击以当前打开的会话为隐式锚点；后续 `Shift` 点击只扩展到新落点，不移动锚点，行为与文件列表一致。
- 普通点击或键盘打开会话时必须清空批量选择；组合键选择只更新批量选择，不切换活动会话；进入新草稿时两种状态都必须结束。
- Pinia store 只保存、替换和清理选择集合。点击意图与锚点语义留在 `functions/conversationSelection.ts`；有序区间合并统一调用 `shared/selection`，不得在 store、Vue 模板或 domain 内重新实现索引循环。

## 删除编排

- Sidebar 只确认用户意图、展示状态并调用 `deleteConversationFromHistory`；删除 API、跨 store 顺序和运行态释放不得写回 Vue 组件或 Pinia action。
- 请求 pending 时列表、正文、标题候选、message window、projection 和 interactive run 全部保留；同一 conversation 的重复入口共享同一请求，并显示“正在删除”。
- 只有后端完整生命周期删除成功后，Renderer 才依次使 HistoryLoader 世代失效、释放 projection/run、清理目标列表与 conversation read model；提交时目标仍为 active 且当前 scope 仍等于删除发起 scope，才进入该 scope 的草稿态。
- 删除失败只结束 pending，原事实保持可重试。用户等待期间已经切到另一条对话时，成功提交不得清空新正文。
- 删除前发出的 metadata、window、列表响应或同步 upsert 都不得复活已删除身份。HistoryLoader 用目标 owner/token 失效，HistoryList 在本次 Renderer 生命周期拒绝已确认删除身份；禁止增加全局取消或通用 fallback。

业务回归集中在 `orchestration/deleteConversationFromHistory.integration.test.ts`，必须覆盖 pending、重复请求、失败重试、非 active 隔离、跨 workspace 切换、真实导航竞态和迟到结果。

## 禁止事项

- 禁止在侧栏切换时调用 projection cleanup。
- 禁止 loading 壳把已有 `conversation.messages` 替换为空数组。
- 禁止从 durable `final_answer` 补造丢失的 live chunk；缺少 chunk 应继续作为协议错误暴露。
- 禁止只删除 reducer Map 而保留 pending commit。确认 conversation 不会再收到事件后的销毁或全局 reset，必须原子释放两者；历史删除 API 本身不等于后台 run 已终止。
- 禁止根据 `activeConversationId` 接收后台事件；请求捕获的 conversation 与事件正式身份才是路由依据。
- 禁止把严格投影失败降级成跳过事件。失败可以驱动 conversation-scoped ErrorBanner，但不得因此停止 history loading 收敛或污染 Vue 组件树。

## 回归门禁

至少覆盖以下业务时序：conversation A 收到 answer chunk，用户切到 B，再切回 A；A 的 final seal 无论在后台还是 loading buffer 中到达，都必须命中原 answer state，最终消息完整封口，且页面仍可继续切换。

涉及真实 DOM 生命周期时运行 `pnpm run test:conversation-navigation:electron`。该测试使用隔离 SQLite、真实 Electron、真实 OverlayScrollbars、TanStack virtualizer 和 Timeline Teleport，覆盖：

- A/B 多轮切换以及 A → 新草稿 → B。
- chunk 的 50ms commit 尚未执行时切换或新建，随后 A 在后台完成 terminal seal。
- `final_answer` 缺少 live chunk 的严格协议失败先挂载 ErrorBanner，再切换和新建。

不得用 mock OverlayScrollbars、stub `ConversationView` 或只断言节点“存在”的组件测试替代这条门禁；这些测试无法发现半挂载 vnode 与第三方 DOM ownership 冲突。
