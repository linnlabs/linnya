# Run Steering

运行中插话的 Renderer 侧：前台 run 进行中，用户在输入框发出的消息先进入待送达列表，等 Host 在一批工具做完后送达。用户可见规则与 Host 合同见 [08 §3.8](../../../../../../docs/conversation-platform/08-lifecycle.md#38-运行中插话)。

## 目录

| 位置 | 职责 |
| --- | --- |
| `store/runSteeringStore.ts` | 按 conversationId 分区的待送达条目（本地排队、提交中、已交给 Host），只保存快照 |
| `orchestration/runSteeringApi.ts` | `steer / withdraw / drain` 三个 Host 请求 |
| `orchestration/useRunSteering.ts` | 插话、编辑、撤回、立即打断，以及 run 停下后的转交 |
| `ui/PendingSteerTray.vue` | 输入框上方的待送达条 |

## 规则

- 只有 Interactive Run 快照为 `running / awaiting_user / continuing` 时向 Host 提交；`starting / submitting` 时 run 还没有身份，先在本地排队，拿到 runId 后按顺序提交。
- Host 返回 `accepted=false` 或请求失败时，条目退回本地排队，等 run 状态变化后再处理；run 停下就走下面的转交规则。
- run 停下后调 drain 一次取回没送达的：`completed` 时第一条作为新消息发出，其余在新 run 出现后接着插话；`paused / failed / cancelled` 时回到输入框草稿，不自动发出。
- 立即打断 = 先暂停，再把待送达的作为新消息发出。
- 编辑 = 撤回后放回输入框。撤回返回 `delivered` 时不放回，条目在时间线出现这条消息后收起。
- 首版只发文字；草稿带图片或引用时不能在运行中发出。
- 本 feature 只读 Interactive Run 快照，不写控制状态；送达后的消息走现有 `user_input` 投影，不新增消息类型。

## 测试

```bash
pnpm exec vitest run apps/renderer/domains/conversation/features/run-steering
pnpm -s scenario run steer
```
