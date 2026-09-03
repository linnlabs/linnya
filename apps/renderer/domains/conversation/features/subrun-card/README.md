# Subrun Card

## 模块定位

`subrun-card` 拥有两个独立产品能力，两者共用 `features/subrun-trace/` 的稳定 bucket，但不合并 projector：

1. `SubrunProgressCard.vue` 是 Host 薄内容适配器：复用 `features/subrun-trace/SubrunTracePanel` 展示轻量步骤，只拥有详情导航参数转换；统一工具卡外壳由 `ToolCallsMessage` 持有。
2. `admitSubrunMessageProjection.ts` 将完整 trace 接纳为 child messages，供 Host detail 与插件公开 `SubrunCard.vue` 共用。

这里不启动 child run，不拥有 lifecycle，不读取父工具 result 补造正文，也不拥有 Host 导航 scope。

## 完整消息 admission

`admitSubrunMessageProjection` 在脱离 Vue 响应式树的 snapshot 上顺序接纳 trace。工具消息与主 `MessageProjection` 共用 `prepareToolCallMessageCandidate`，因此 alias、owner schema、presentation 与 lifecycle 规则只有一份。

`createSubrunMessageAdmissionScheduler` 将 admission 调度到 Vue flush 之外。新 trace 全批次成功后才替换快照；任一事实失败时保留旧快照并显式报错，不跳过、不补默认值、不发布半状态。

实时答案正文只从 `final_answer_chunk` 创建，`final_answer` 只封口。紧凑历史不保存实时 chunk，因此 `subrun-trace` 在历史加载边界把 durable 完整答案快照规范化为一次性 chunk 与原封口；本 feature 不识别历史来源，也不放宽实时 admission。

## 工具协议

- `tool_call_decision.tool_calls[]` 是 durable 批次事实，不创建可见步骤。
- `tool_process` 已通过 owner admission，携带单个调用的正式 args，创建 loading 步骤。
- `tool_output` 收敛 terminal presentation；reload 时可从同 tool identity 的 decision 恢复 args。
- 开发环境不接纳 decision 标量旧字段。

child 工具消息 ID 必须由 `conversationSubrunMessageIdFromToolIdentity(subrunId, toolCallId)` 派生，不得用事件 ID、工具名或下标。

## UI 边界

- Host 主 registry 使用 `ToolCallsMessage` 的统一工具卡外壳，内容组件是 `SubrunProgressCard`。外层卡默认折叠；运行中标题使用统一扫光，已有真实 child 步骤时复用最新工具的 compact-step 文案，首步之前仍显示父任务原始标题，终态恢复原始标题并停止扫光。展开后的逐行过程直接复用 Deep Search 的 `SubrunTracePanel`：普通 subrun 内层选择 `static-expanded`，不再嵌套一层折叠操作，只保留“查看详情”；Deep Search 选择 `collapsible` 且不提供详情导航。配置不得使用 `renderAsGroup` 绕开外壳，本 feature 不持有第二套卡片或 trace CSS。
- 终态没有工具步骤时不渲染 `0 步`或空过程正文；标题和详情入口已经是充分信息。
- `SubrunCard` 是插件公开卡，可使用 bounded 容器，但 bounded body 必须直接挂载，禁止 `Transition/BaseTransition`。
- Host detail 归 `features/subrun-detail/`，通过公开 composable 消费已接纳 messages；详情底栏的模型与终态只读取 `subagent` 正式结果，不读取当前 composer 选择。
- Host detail 在已接纳 child messages 前投影父 `subagent.args.prompt`，复用 `UserMessage` 视觉但保持 activity 只读语义：不写入父消息窗口，不提供编辑或重新发送。
- 跨父列表/detail 的 durable ready 快照归 `features/subrun-trace/store/subrunTraceHistoryCacheStore.ts`；本 feature 只消费 cache port，不持有第二份历史状态。

## 业务门禁

- decision batch 不生成可见步骤，process/output 按 tool identity 稳定收敛。
- live 与 reload 产生同一 child message ID、args、title 与 presentation。
- 仅有 durable 完整答案快照的 reload 恢复正文；live 完整答案缺 chunk 仍拒绝。
- schema/projector 失败不改变上一快照，且不在 reactive flush 中抛错。
- 真实 parent projection 与 async registry card 证明 Host 父 row 使用 `SubrunTracePanel`，不存在独立父卡步骤 DOM。
- Electron 真机证明 exact ready 快照复用后，详情返回仍保持父消息精确锚点。
