# EventStore Host Adapter

## 功能

这里是 Linnya backend 的 conversation persistence host adapter。它负责：

- 提供 `IEventStore` 协议
- 用 `SQLiteEventStore` 把 runtime events 落到 SQLite
- 从正式事实增量维护并可全量重建 `conversation_ui_messages`
- 向 Conversation HTTP API 提供经过共享 schema 校验的窗口 read model
- 提供 conversation 相关 schema provider 给 Electron 主进程数据库初始化链
- 持久化会话列表元信息，例如标题、项目归属、置顶状态与列表排序时间

## 边界

- owner：host adapter
- 作用域：Linnya backend conversation/history/flow 持久化链
- 不属于 runtime-kernel
- 如果未来迁移到其他产品或独立仓库，这一层应由新宿主替换或复用

## 文件树

```text
event-store/
├── README.md
├── index.ts
├── event-store.interface.ts
├── conversation.schema.ts
├── conversation-schema.provider.ts
├── schema-providers.ts
├── sqlite.implementation.ts
├── functions/
├── subrun-trace-history/      # ephemeral parent trace 的紧凑历史 projector/read model
└── ui-projection/
```

## 开发注意事项

- `events` 是唯一 durable 事实表；`conversation_ui_messages` 是可重建 UI read model，回放、审计和 Agent context 只能依赖 `events`
- sibling `citation-ref-claims` adapter 拥有 Conversation 级命名控制状态；它不是 event fact，也不是可重建 UI
  read model。EventStore projector 不得读写该表；
- `events.id / type / run_id / ts` 与 `runs.conversation_id / parent_run_id` 是存储身份的唯一 owner；`events.payload` 只保存 `turn_id`、routing presentation、metadata、version 和事件类型专属 body，不复制公共身份 envelope
- Assistant 事件的 Provider 回放数据只存于事件专属 body 的 `provider_continuations`；每项必须携带 `schema_version` 和完整 producer route identity。v58 已删除旧匿名 `reasoning_details`，EventStore 不双读、不猜测回填
- `subrun_trace_runs / subrun_trace_items` 是 parent trace 的紧凑历史 read model，不是 RuntimeEvent 事实表；只保存完整语义项，不能反向替代 child facts 或 lifecycle
- EventStore、rebuild 与 UI projector 只接收 `RoutedRuntimeEvent`；缺 routing identity 的事实不属于当前合同
- `conversations.is_pinned / pinned_at` 是历史列表排序语义，前端不能用内存状态替代
- `ConversationListItem.project_id` 是 scoped history 的归属契约；列表和 metadata 都必须透传，不能只在查询条件里使用
- 持久化资格统一走 `requirePersistableRoutedRuntimeEvent(...)`；`ephemeral` / `tool_process` 直写必须失败
- `RunSession` 参数只做 conversation/run 一致性校验；事件身份只读顶层正式字段，不从 metadata 或 session 补齐
- `runs.kind` 只有 `user_input | agent`：前者是 Host 用户输入事实批次，后者是 Agent run；权威定义在 `../definitions/conversationRunKind.ts`，EventStore 与 RunRegistry 禁止各自定义字面量
- Host row、HTTP DTO 与 Renderer window message 的唯一产品合同是 `@app/schemas` 的 `ConversationUiMessageSchema`
- 非规范 stored event 或 read-model row 必须显式失败；禁止在读取主链恢复 routing、改写字段、猜 message type 或补造 ID

## 数据流

1. `DatabaseService` 通过 `schema-providers.ts` 注册 conversation schema
2. `SQLiteEventStore` 在单事件短事务内写 `events`、资源关联和 `conversation_ui_messages`；ephemeral `subrun_trace` 不经过这条事实写入链
3. `ui-projection/projectEvent.ts` 从正式事实产生当前 UI row，`sqliteApplier.ts` 负责落表
4. `ui-projection/sqliteCitationFactIndex.ts` 在 append/rebuild 时规范化 main/Subrun citation facts，窗口按 ref 查询
5. `ui-projection/rebuildConversation.ts` 使用同一 governance 和 projector 从 `events` 重建 disposable read model
6. `sqliteUiMessagesReader.ts` 将 SQL row 解析为 `ConversationUiMessageSchema` 后提供分页 API
7. `HistoryRepository` 从 `IEventStore` 读取事实事件和元数据；Agent context 使用显式 routing scope
8. `Flow` 通过最小 persistence port 调用 `ensureConversation / openRunSession / appendEventToRun`
9. child EventBus 的 parent trace projector 串行写紧凑历史；历史 reader 按父工具与具体 subrun 查询并重建公开 trace DTO

Citation producer 的 ref 分配不经过上述 event projection：Host allocator adapter 在工具执行期对
`conversation_citation_ref_claims` 做独立短事务。claim 在工具结果之前落盘可能留下未被正文消费的保留号，
但同来源会永久复用，且不会制造错误来源映射；禁止为了回收短号把跨 domain 工具执行塞进 EventStore 事务。

## UI 投影不变量

- 增量写入与全量 rebuild 必须复用同一 routing admission 和事件投影规则。
- 只有 `lane=foreground / visibility=conversation` 的 UI-eligible facts 可以进入 Conversation 主 read model。
- child/auxiliary facts 可以持久化，但不能成为 foreground message 或进入后续 foreground Agent context。
- `RuntimeEvent.id`、`answer_id`、`tool_call_id` 与产品 `message_id` 按正式映射使用，不允许互相 fallback。
- presentation 只允许 `message | hidden`；`ui_card` 不属于 durable timeline message。
- 工具 row 必须携带严格 `ConversationToolMessagePayload`，不能从 observation 或旧 payload 恢复。

合同升级不保留历史兼容。若存量不满足当前 schema，应清理或从规范 facts 重新构建；若 facts 本身不规范，则拒绝读取并显式报告数据问题。

写入、读取、截断重算、Linnkit range 与 UI rebuild 统一通过 `functions/runtimeEventStorageCodec.ts`。写入时移除 `id / type / conversation_id / run_id / parent_run_id / timestamp`；读取时用 SQLite 行身份重建事件，再执行正式 `RoutedRuntimeEvent` schema 与持久化资格校验。payload 重新出现任一身份字段都表示绕开 codec，必须显式失败。

这是新库破坏式合同，没有完整 payload 双读、格式探测或 migration fallback。旧开发库必须重建；不能在 parser 中根据 JSON 形状猜格式。

Linnkit adapter 的 `PersistedEvent` 只有 `eventStoreId + event`。`eventStoreId` 是存储分页游标，`RuntimeEvent.id` 是业务事实身份；两者不得互相 fallback。adapter range 必须经 Host storage codec 重建完整事件，不能直接解析 payload body。

## RunId 约定

- 普通 agent/chat run：由 linnkit `RunSupervisor.registerRun({ runId: turnId })` 先创建 root run。
- `SQLiteEventStore.openRunSession()` 只打开已存在 run；如果 run 不存在，说明上游生命周期错了，应直接失败。
- host-only 路径：只能通过 `beginRunSession(conversationId, runId, metadata)` 使用显式 runId 创建，不允许存储层自己生成平行 runId。
- RunRegistry 保存 root/child Agent run 时固定写入 `agent`；Host incoming 事实才能显式创建 `user_input` run。两者不得通过 event 类型、metadata 或 payload 猜测。

## 相关文档

- [`ui-projection/README.md`](./ui-projection/README.md)：Runtime fact 到 disposable Conversation UI read model 的权威投影边界
- `packages/linnkit/src/runtime-kernel/README.md`
- `src/app-hosts/linnya/adapters/flow/README.md`
- `src/features/conversation/history/history.repository.ts`
