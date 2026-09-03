# Conversation 域架构规范（已迁移）

> 本文的内容已全部并入仓根 [`docs/conversation-platform/`](../../../../../docs/conversation-platform/README.md)——那里是**唯一权威声明处**。
>
> 迁移原因：同一条约束此前在本文、`docs/README.md`、`packages/schemas/README.md` 各写一遍，导致漂移；且本文手工编号出现过两条 `#23`。新体系按**链路**组织并使用稳定锚点 `INV-nn`。

---

## 去哪里找

| 原本在本文的内容 | 现在在 |
|---|---|
| §1 不变量与产品契约（25 条） | [`00-invariants.md`](../../../../../docs/conversation-platform/00-invariants.md)（60 条，去重后含 Host / Linnkit 侧） |
| §2.1 核心数据流、事件语义 | [`02-event-pipeline.md`](../../../../../docs/conversation-platform/02-event-pipeline.md) |
| §2.2 投影状态管理 | [`05-live-projection.md`](../../../../../docs/conversation-platform/05-live-projection.md) |
| §2.3 请求所有权与提交顺序 | [`02-event-pipeline.md`](../../../../../docs/conversation-platform/02-event-pipeline.md) §7 |
| §2.4 事件协议变更规范 | [`02-event-pipeline.md`](../../../../../docs/conversation-platform/02-event-pipeline.md) §8 + [`11-testing-gates.md`](../../../../../docs/conversation-platform/11-testing-gates.md) |
| §3 Foreground run 与 HITL | [`08-lifecycle.md`](../../../../../docs/conversation-platform/08-lifecycle.md) |
| §4 状态所有权与 Store 分层 | [`05-live-projection.md`](../../../../../docs/conversation-platform/05-live-projection.md) §7 |
| §5 历史与窗口数据层 | [`03-persistence.md`](../../../../../docs/conversation-platform/03-persistence.md) + [`06-read-model.md`](../../../../../docs/conversation-platform/06-read-model.md) |
| §6 会话入口与 agent 选择 | [`08-lifecycle.md`](../../../../../docs/conversation-platform/08-lifecycle.md) §7 |
| §7 教训档案 | [`12-open-risks.md`](../../../../../docs/conversation-platform/12-open-risks.md) §5 |
| §8 冻结区与剩余风险 | [`12-open-risks.md`](../../../../../docs/conversation-platform/12-open-risks.md) §2-§4 |

工具 / subrun / 渲染 / schema 的专题分别见 [`09-tools.md`](../../../../../docs/conversation-platform/09-tools.md)、[`10-subruns.md`](../../../../../docs/conversation-platform/10-subruns.md)、[`07-render.md`](../../../../../docs/conversation-platform/07-render.md)、[`04-schema-contract.md`](../../../../../docs/conversation-platform/04-schema-contract.md)。

---

## 仍留在本目录的文档

这三篇是**实现级规范**，未迁移，继续在原位维护（不变量仍以 `00-invariants.md` 为准）：

- [`conversation-virtualization.md`](./conversation-virtualization.md) — 三层虚拟化、媒体管线、估高体系、滚动红线
- [`input-contribution.md`](./input-contribution.md) — 输入框贡献框架三原语与五能力契约
- [`task-system.md`](./task-system.md) — 活动 / subrun 展示原语与 `task` 命名治理
- [`citation.md`](./citation.md) — Conversation 引用依赖闭包，以及向 Editor CitationNode 的跨域投影合同
