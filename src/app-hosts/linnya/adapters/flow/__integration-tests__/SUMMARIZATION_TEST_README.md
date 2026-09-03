# Summarization Flow Test Notes

## 覆盖范围

当前 `summarization` 测试按三组职责组织：

- [summarization.simple.test.ts](./summarization.simple.test.ts)
  - 验证 `HistoryRepository + EventPersistenceCoordinator` 对 `history_summary.replaced_message_ids` 的存储、读取、过滤语义
- [summarization.e2e.test.ts](./summarization.e2e.test.ts)
  - 验证 `FlowOrchestrator` 下的摘要合同：`history_summary` 属于持久化事实，`summarization_start / summarization_end` 属于 SSE-only 宿主事件，并且实时结束事件与持久化摘要使用同一个 ID
- [summarization.test.ts](./summarization.test.ts)
  - 验证 root durable commit port 注入、Graph 历史输入和已有摘要的宿主边界

## 为什么使用分层存储夹具

三组测试按职责选择不同夹具，避免把纯历史语义、真实持久化和 Host 装配混成一类失败：

- `summarization.simple.test.ts` 使用 [inMemoryEventStore.ts](../../../testkit/persistence/inMemoryEventStore.ts)，隔离验证替换与过滤语义；
- `summarization.e2e.test.ts` 使用真实的内存 SQLite，覆盖 durable persistence、历史读取和投影一致性；
- `summarization.test.ts` 使用窄 mock，验证 Graph Host port 注入与历史输入边界。

这样既能快速定位纯合同错误，也不会绕过真正需要 SQLite 锁住的持久化协议：

- `replaced_message_ids` 是唯一权威字段
- `history_summary` 会进入事实持久化链路
- `summarization_start / summarization_end` 不会污染 RuntimeEvent 历史
- `run_status / transport_end` 由 Host session 单点收口，不进入 RuntimeEvent 历史

## 当前不变量

这组测试要锁住的结论只有五条：

1. `history_summary` 持久化后必须保留 `replaced_message_ids`
2. `replaces_message_ids` 只能作为历史说明，不能再回到代码合同
3. `summarization_start / summarization_end` 只能走 realtime SSE，不能落入历史事实表
4. 过滤被摘要替换的历史时，保留摘要本身，剔除 `replaced_message_ids` 命中的旧事件
5. `summarization_end.summary_id` 必须等于对应 `history_summary.id`，保证实时投影与重载历史指向同一事实

## 运行方式

```bash
npx vitest run src/app-hosts/linnya/adapters/flow/__integration-tests__/summarization.simple.test.ts
npx vitest run src/app-hosts/linnya/adapters/flow/__integration-tests__/summarization.e2e.test.ts
npx vitest run src/app-hosts/linnya/adapters/flow/__integration-tests__/summarization.test.ts
```
