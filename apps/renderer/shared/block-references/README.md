# 块引用内存快照

编码规则由 `@app/schemas` 定义；`functions/createBlockRefSnapshot.ts`
适配现有 Web
Crypto，计算整篇文档的 ref 映射并检查碰撞。`orchestration/registerBlockRefSnapshot.ts`
在全部计算成功后一次提交给
`shared/stores/blockIndexSnapshotStore.ts`，失败不会覆盖旧快照。

Store 只保存内存快照和同步查询/清理 action；Editor 在加载或去抖编辑后注册，Conversation 只查询。快照 TTL、覆盖顺序和页面刷新后丢弃的行为不变。
