# Citation Ref Claims Host Adapter

本适配器持久化 Conversation 内的 6 位 Citation 短别名声明。它拥有 SQLite
schema、双唯一约束和 `IMMEDIATE` 事务，不拥有来源身份、候选生成或碰撞重试规则。

## 边界

- Citation domain 通过 `CitationRefClaimStorePort`
  传入一次 Conversation 原子操作；
- `SqliteCitationRefClaimStore` 把 port 映射为索引查询与插入；
- `schema-provider.ts` 独立注册
  `conversation_citation_ref_claims`，避免把生产控制状态混入 EventStore
  read-model schema；
- Knowledge、Web、Workspace 和 Renderer 不得直接读取该表；
- Conversation 删除依靠外键级联清理；truncate、turn 或 instance 结束不回收 claim，避免旧 ref 改指向。

claim 只保存稳定来源身份、ref 和 attempt，不保存标题、摘录或正文，因此不是 Citation 来源 SoT，也不能替代
`events`、Evidence 或 Editor `CitationNode`。
