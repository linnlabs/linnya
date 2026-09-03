# 对话引用（RAG Citation）合同与链路索引

## 本文管什么

本文说明 Conversation 中 `[@ref]` 的稳定合同、依赖闭包和跨域边界。它不复制 Knowledge、Web、
EvidenceStore、Editor 或 MindMap 的内部实现。

遇到以下问题时阅读本文：

- 回答中的引用标记无法显示或 hover 无数据；
- live 正常但 reload / Subrun 详情后引用丢失；
- 答案与生产引用的 tool row 不在同一分页窗口；
- 引用复制、另存为文档后没有转成 Editor `CitationNode`；
- Citation、EvidenceStore 与 Editor 快照职责混淆。

## 稳定合同

### 引用身份

- 数据层使用 6 位 canonical `ref`，Markdown 使用 `[@XXXXXX]`。
- `ref` 是**有作用域的短别名**，不是全局 ID。Knowledge 来源身份是 `docId + blockId`，Web 来源
  身份是 canonical HTTP(S) URL。
- Conversation 是唯一性边界；turn、`research.instanceId`、单次工具调用和单个搜索结果列表都不是。
  同一来源在同一 Conversation 复用 ref，不同来源绝不共享 ref。
- `citations[].index` 是 producer 在 turn 内的生产顺序；UI `[1][2]...` 按一条正文中的首次出现顺序
  派生。来源身份、`ref`、生产 index 和展示编号不得混用。
- 模型只能引用正式工具输出中出现过的 ref。未知 ref 保留在消息正文，并进入
  `unresolved_refs`，禁止 UI 猜测来源。
- 同 scope 的同 ref 指向不同来源时投影失败；跨 scope 只有所有候选都指向同一稳定来源时才可解析。
  跨 Conversation 查找一律禁止。

### 严格结构化事实

唯一公共核心合同位于 `packages/schemas/src/citation.ts`：

- `SearchResultCitationSchema` 是 `sourceType` 判别联合；
- Knowledge 强制 `ref + docId + blockId`；
- Web 强制 `ref + HTTP(S) URL`；
- `ConversationCitationDependencySnapshotSchema` 只包含已解析 `citations` 与
  `unresolved_refs`，两组 ref 必须唯一且不重叠。

Producer 仍由自己的完整 schema 接纳结果；公共联合只统一 Conversation 展示真正需要的来源事实。
`data.citations` 是程序化事实，`observation` 只服务模型上下文。任何消费者都不得从 observation、
可选字段组合或 URI 猜来源，也不得把 UI 布局和组件配置放进 citation metadata。

## 当前架构

```text
Knowledge / Web / Workspace citation producer
        │ stable source anchors
        ▼
Citation domain batch allocator
        │ Host atomic conversation claim store
        │ canonical refs + owner strict schema admission
        ▼
Citation domain conversation-presentation
        │ scoped workspace + 来源冲突规则 + canonical ref parser
        ├────────────────────────────────────┐
        ▼                                    ▼
Renderer live / Subrun                 Host durable window
projection workspace                   按正文 ref 查询可重建 fact index
        │                                    │
        └──────── message dependency snapshot┘
                         │
                         ▼
              hover / clipboard / export
```

Evidence resolver 只回放已经接纳的 ref 与来源快照，不创建新的来源命名，因此不经过 allocator。

### Ref 生产

Citation domain 公开 `CitationRefAllocatorPort`，Knowledge/Web/Workspace producer 只提交自己的稳定来源锚点。
Host 在工具执行前用当前 `conversationId` 绑定 SQLite claim store；表同时唯一约束
`conversation + sourceIdentity` 与
`conversation + ref`。首次候选碰撞时只对后接纳来源递增确定性 salt，无需增大 6 位 token，也不改变已经发给模型的 ref。

分配对当前批次做线性遍历，每个普通新来源只进行索引查询与一次插入；它不扫描 RuntimeEvent、tool history
或 UI fact index。claim 是命名控制状态，不是 Citation 来源 SoT，也不参与 Renderer 的消息依赖闭包。
producer 缺少 Host allocator admission 必须失败，禁止退回局部哈希、随机 ref 或调用内 `used Set`。

### Citation domain owner

`src/domains/citation/features/conversation-presentation/` 拥有：

- 按 `toolName` 调用各 producer 正式 schema 的 citation admission；
- scope 内注册、来源锚点冲突和唯一跨 scope 解析规则；
- 从正文提取 canonical refs，并裁剪出一条消息实际使用的依赖闭包；
- dependency snapshot 与正文 refs 的完整性校验。

Host 与 Renderer 只通过 `src/domains/citation/conversation-presentation.ts` 的窄公开入口复用这些规则，
不复制 ref 正则、来源身份比较或工具分派。Citation domain 不读取 Conversation SQLite，也不依赖 Vue。

### Live 主时间线

`MessageProjectionState` 持有当前 Conversation 独享的 citation workspace。成功 tool output 必须先通过
producer admission，再在 detached `Map` 上完成注册；冲突时事件投影失败，已提交 workspace 不变。

answer / thought 正文每次形成新的 canonical ref 集合时，从 workspace 生成
`message.citationDependencies`。workspace 跟随 projection runtime 释放，没有 TTL、全局 Pinia store 或
`activeTurnId`。Subrun trace 使用自己的 workspace，不与主会话或其它 Subrun 共用容器。

projection runtime 因页面壳切换、截断或重新初始化而重建时，只从已提交的 canonical tool message 及其
`subrunTrace` tool output 恢复 workspace，不从旧 message snapshot 或 UI 组件反推来源。window/live admission
冲突发生在 mutable reducer 已开始计算之后时，store 保留 reduce 前的 detached workspace，再丢弃未提交的
message runtime，避免把尚未被正文消费的合法 tool fact 一并回滚。对已经 sealed 且同时存在于 window/live
的消息，Host materialize 的 durable 正文与 dependency closure 作为同一 snapshot 优先于 live 临时快照。

### Durable message window

窗口按 `sort_seq + limit` 裁剪，不能要求答案与 producer tool row 同窗。因此 Host 在选定可见 rows 后：

1. main tool output 与有正式 parent tool 归属的 child `tool_output` 在 durable projection 写入时，
   通过同一 Citation admission 进入规范化
   `conversation_ui_citation_facts`；
2. 全量 UI rebuild 从 immutable main events 与 durable Subrun trace 重建该索引；索引与 message row 同为
   disposable read model，不是 Citation SoT；
3. 窗口只按可见正文实际出现的 ref 查询候选 facts，不解析或扫描无关工具历史；
4. 按 `available_sort_seq` 在每条消息发生时点 materialize，只接纳它之前已经存在的来源，禁止未来工具事实
   反向改变历史消息；同一稳定来源重复出现时保留首次接纳快照；
5. 通过 `citation_dependencies[message_id]` sidecar 与同一 revision 返回。

Renderer 的 `uiMessagesDtoGuards.ts` 会同时校验消息、snapshot 严格结构以及正文 ref 依赖闭包：缺项、
多项、残缺或属于窗外消息的 sidecar 都不会进入 store。`mapUiMessageDto.ts` 再把对应 snapshot 绑定到
不可变 message row；窗口裁剪后依赖随 message 自然释放。

这个 sidecar 和 fact index 都可由 durable producer facts 重建，不是新的 Citation SoT，也不写回工具结果。
索引按 `(conversation_id, ref, available_sort_seq)` 查询，使窗口成本随可见引用及其候选事实增长，而不随完整
Conversation 工具历史增长。索引写入、消息投影与 revision 在同一事务边界；Subrun fact 单独落地时也必须
同步推进 revision。索引缺失或损坏应让 projection 进入 rebuild/失败，禁止回退到读取时扫描历史。

### Subrun 详情

Subrun 的 detached admission 同时维护 child messages 与独立 citation workspace。child tool output 先做
strict admission，child thought / answer 再生成自己的 dependency snapshot；任一步失败都不发布半快照。
历史 trace、live 尾部和 scheduler 继续服从同一原子 snapshot 版本，不在 Vue computed / mounted 中注册引用。

### UI 消费

`ConversationMarkdownRenderer.ts` 从当前 message 的 dependency snapshot 取出与 ref 精确对应的 citation，
再交给 `ConversationCitationNode.vue`。节点不知道 workspace、其它 turn 或全局 fallback，只负责展示。

popover、复制和另存为文档消费同一 message snapshots。对话引用离开 Conversation 时必须转换为 Editor
结构化 `CitationNode`，不能只复制展示编号。入口位于 `ConversationVisualRowActions.vue`、
`UiCardGroup.vue` 和 citation-presentation feature 的
`projectConversationCitationsToEditorHtml.ts`。边界文本使用 canonical `[@ref]`，
进入 Editor 后才按目标文档顺序派生 `[n]`。

## 与其它引用能力的边界

- EvidenceStore：生产期证据审计、回放与 Workspace 写入来源解析，不是 Renderer UI registry。
- Editor `CitationNode`：让文档脱离原 Conversation 后仍自包含，不反向读取 Conversation snapshot。
  节点保存稳定 docId/blockId 与引用发生时的标题、原文快照，不保存 Workspace 路径；文件移动不影响回看。
  `read_file` 进入新 Conversation 时只在出站视图把文档 ref 映射为该 Conversation 的别名，不回写节点；
  因此既保留 Editor 的持久化引用，也不会把旧文档 ref 直接注入另一个 Conversation。映射复用同一
  Markdown citation parser，不改 fenced/inline code 示例。
- Citation Snapshot Store：只读历史 Knowledge bundle，不参与 live citation 生产或 Conversation lookup。
- Linnkit：只传输通用 RuntimeEvent / Subrun trace，不解释 citation 业务字段；
  `citation_dependencies` 只属于 Linnya Conversation UI read model。
- Knowledge / Web 卡片：只消费 presentation；引用接纳不是组件挂载副作用。

跨 Subrun 的长期 Agent 协作仍应通过 Workspace 文档与 `CitationNode`，不能因为 child trace 可见就把其
citation 当作父 Agent 语义上下文。

## 变更检查

修改引用链路时至少确认：

1. producer 的 owner strict schema、observation 与 citations 来自同一份事实；
2. live、durable window 与 Subrun detail 复用同一 Citation domain admission 和来源冲突规则；
3. 所有 citation-bearing 可见消息都携带完整 snapshot 或明确 unresolved refs；
4. producer row 位于窗外时，hover / copy / export 仍只依赖消息 snapshot；
5. 同 ref 不同来源明确失败或 unresolved，不做全局 fallback；
6. projection admission 失败不发布一半 message / citation 状态；
7. runtime 重建能从已提交 main tool 与 subrun trace 恢复尚未被正文消费的 facts；
8. truncate、run 删除与 Conversation 删除同步清理派生 fact index；
9. snapshot 只包含正文实际使用的 refs，不复制全量搜索结果；
10. 日志不打印 snippet、正文、完整 tool output 或无必要 URL；
11. 新字段没有进入 Linnkit 通用事件、开放 metadata 或组件配置。
12. 新 producer 只提交稳定来源锚点，并通过 Conversation allocator 批量取得 refs；不存在局部生成器或历史扫描。

完整投影说明见 [`messageProjection/README.md`](../services/messageProjection/README.md)，Citation 领域说明见
[`src/domains/citation/README.md`](../../../../../src/domains/citation/README.md)，窗口规范见
[`docs/conversation-platform/06-read-model.md`](../../../../../docs/conversation-platform/06-read-model.md)，
Subrun 规范见 [`docs/conversation-platform/10-subruns.md`](../../../../../docs/conversation-platform/10-subruns.md)。
