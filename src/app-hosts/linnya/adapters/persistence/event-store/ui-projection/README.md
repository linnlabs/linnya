# Conversation UI Projection

本目录把已 admission 的 Linnkit Runtime facts 投影为 Linnya 的 disposable Conversation UI read model。它不拥有 RuntimeEvent 定义，也不拥有 Renderer 组件。

权威合同是 `@app/schemas`：

- `ConversationUiMessageSchema` 约束完整 Host → HTTP → Renderer row。
- `message-metadata.ts` 约束 user、thought、answer payload 与 answer seal 状态。
- `tool-message.ts` 约束工具 identity、status、phase、时间和结果。
- `presentation.ts` 约束 durable presentation。

`projectEvent.ts` 与 `toolProjection.ts` 是生产入口，`types.ts` 的 row 联合只能从上述产品合同派生。`sqliteApplier.ts` 在落表前校验，`sqliteUiMessagesReader.ts` 在出表时再次校验。非法行必须失败并通过 disposable projection rebuild 处理，不允许读取期兼容、字段补造或 shape guessing。

Citation-bearing tool output 在增量 append、Subrun history projection 与全量 rebuild 时，经 Citation domain
正式 admission 后写入 `conversation_ui_citation_facts`。`sqliteCitationFactIndex.ts` 只拥有 SQLite 规范化、
按 ref/消息时点查询和派生生命周期；scope 冲突、来源身份与 dependency closure 仍归 Citation domain。
窗口读取禁止重新扫描和解析完整 tool history，也禁止在索引缺失时 fallback。

Tool row 的 `message_id` 与 `merge_key` 必须相等，并且只通过 `@app/schemas` 的 `conversationMessageIdFromToolIdentity(run_id, tool_call_id)` 生成。`tool_process` 是否持久化、哪类工具事件先到以及一个 decision 是否包含 batch，都不能改变 UI 实体身份。旧事件 ID 体系不兼容；合同升级时物理清理 disposable rows，再从 immutable Runtime facts 重建。

新增或修改消息 variant 时，必须同一变更更新：共享 schema、Host producer、Renderer mapper/live projector、`uiProjectionParity.spec.ts` 以及 `scripts/guards/conversation-contract-guard.mjs`。工具时间必须来自 RuntimeEvent timestamp，禁止在投影器使用 `Date.now()`。

Subrun trace 历史端点直接消费 Linnkit `SubRunTraceKind` 与完整 `RuntimeEvent` schema。显式 kinds 只做业务筛选；未指定 kinds 时必须校验 parent 下的全部 trace，非法事实直接失败。禁止恢复手写 envelope guard、Host 私有 kind enum 或默认 SQL 白名单。

工具 read model 的 `loading` 不是可在 reload 时修补的临时状态。`tool_call_decision` 可以为同批全部调用建立 pending UI row，但每个调用必须由 Runtime 主链的 `tool_output` 结算；普通串行 ToolNode 在取消时负责给未启动 calls 发布 error output。`run_execution_metrics` 只投影 run 性能与 outcome，不扫描或关闭工具行，避免 Host projector 成为第二个工具生命周期 owner。
