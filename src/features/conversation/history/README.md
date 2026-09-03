# Conversation History

> 对话工作目录和删除顺序见 [Conversation Files Domain](../../domains/conversation-files/README.md) 与 [Conversation Lifecycle Workflow](../../app-hosts/linnya/application/conversation-lifecycle/README.md)。

```text
src/features/conversation/history/
├── definitions/            ✓ 跨层窄合同
├── history.schemas.ts      ✓ 类型定义
├── history.repository.ts   ✓ 数据访问层
├── history.service.ts      ✓ 业务逻辑层
└── history.router.ts       ✓ API 路由层
```

## 当前能力

- `GET /api/v1/conversation/list`：按 scope 读取历史列表，返回后端排序游标；置顶会话优先。
- `PUT /api/v1/conversation/:id/title`：更新会话标题。
- `PUT /api/v1/conversation/:id/pinned`：更新置顶状态；取消置顶会清空 `pinned_at`。

置顶属于历史列表的持久化排序规则，写入链路必须经过 `HistoryService -> HistoryRepository -> IEventStore`，不要在前端侧栏里维护临时状态。

## 删除边界

- `HistoryService` 必须注入 `ConversationDeletionPort`；这是删除 API 的唯一生产出口，不允许可选注入或缺失时退回 Repository 直删。
- `HistoryRepository` 不拥有“删除整段对话”能力。它只处理 History 自己的读写；EventStore 的原子事实删除通过 App 生命周期工作流持有的窄 port 使用。
- 完整调用链固定为 `History router -> HistoryService -> ConversationDeletionPort -> App conversation lifecycle`。App workflow 先建立持久清理屏障并停止活动 owner，再删除工作目录、批准、对话事实和 identity metadata，最后完成 cleanup job。
- 首次用户删除的 `not_found` 返回失败；持久 job 恢复时事实已经不存在则按幂等成功处理。History 不得自行复制这两套语义。
