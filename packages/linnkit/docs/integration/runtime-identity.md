# Runtime 身份合同

本文是 Linnkit Runtime identity 的唯一规范。它只定义 framework 事实链中的身份，不定义任一接入方的数据库主键、UI message、组件 key 或产品 read model。

事件类型与传输流程见 [`realtime.md`](./realtime.md)。

## 1. 代码真源

Runtime 身份统一位于 `packages/linnkit/src/contracts/identity/`，并只通过 `@linnlabs/linnkit/contracts` 暴露：

- `definitions.ts`：身份 schema、类型、语义和唯一性作用域。
- `generators.ts`：由 Linnkit 拥有的新身份生成器。
- `invariants.ts`：跨字段必须同时成立的关系。
- `index.ts`：唯一公共出口，消费方不得 deep import。

这不是全局 ID 上帝模块。Agent 配置、插件资源、宿主 read model 等独立概念继续由各自 domain 拥有。

## 2. 身份矩阵

| 身份 | 标识对象 | owner | 唯一性作用域 | 稳定期 |
|---|---|---|---|---|
| `RuntimeEvent.id` | 一份不可变 Runtime fact | 事实 creator | 全局 | 创建后永久不变 |
| `conversation_id` | 会话式聚合根 | Host orchestration | 全局 | 聚合根生命周期 |
| `turn_id` | 一次用户请求及其后续工作 | Host orchestration | conversation 内 | 该轮生命周期 |
| `run_id` | 一次逻辑 Agent run | RunSupervisor/Host | 全局 | start、wait、resume 全程不变 |
| `execution_id` | 一次实际执行 | execution owner | 全局 | 单次 start 或 resume |
| `trace_id` | 一条可观察性关联链 | EventSequencer | 全局 | execution 生命周期 |
| `answer_id` | 一个可流式聚合的答案段 | answer segment creator | 全局 | 首 chunk 到 seal 及回放 |
| `summarization_id` | 一次 SSE-only 压缩进度 presentation | Host compaction progress adapter | execution 内 | start 到 end/error；等于 start event ID |
| `thought_message_id` | 一个可增量合并的思考段 | thought creator | run 内 | 思考段生命周期 |
| `tool_call_id` | 一次工具调用 | provider 或 tool bootstrap | run 内 | decision、process、output 全链 |
| `interaction_id` | 一次等待用户输入的交互 | interaction creator | run 内 | wait 到 resume |
| `todo_list_id` | 一份可版本修订的 todo 列表 | todo creator | run 内 | 列表生命周期 |
| `subrun_id` | 一个 child run | child orchestration | 全局 | child 生命周期 |
| `source_event_id` | 对已有 child fact 的引用 | trace projector | 不创建命名空间 | 与被引用事实一致 |
| `resume_token` | 一次恢复凭据 | interaction owner | 全局 | 一次性使用 |
| `control.target_id` | event/message/branch anchor 引用 | control creator | 不创建命名空间 | 与目标一致 |

局部唯一不表示可以裸用。答案状态应使用 run、execution、turn、answer 的完整 scope；工具状态应使用 run 与 tool call scope。

这些身份不是线性父子层级：

```text
conversation
├─ turn                     （一次用户输入及其后续工作）
└─ run                      （逻辑 Agent run）
   ├─ execution(start)
   └─ execution(resume)

answer 绑定单次 execution 与稳定 turn
tool   绑定 run，可跨 execution 延续
```

wait-user resume 复用原 `run_id` 与 `turn_id`，只创建新的 `execution_id`。因此 `turn_id` 不是 `execution_id` 的子身份；索引保留完整 scope 是为了校验归属与生命周期，不表示这些 ID 构成一条嵌套链。

## 3. 强制关系

### 3.1 Final answer

`final_answer` 与 answer segment 一一对应，因此：

- `final_answer.id === final_answer.answer_id`。
- `final_answer_chunk.id !== final_answer_chunk.answer_id`。
- chunk 与 seal 全程透传同一个 `answer_id`。
- mapper、transport 和 persistence adapter 不得重新分配答案身份。

chunk 是独立增量事实；若 chunk event ID 与 `answer_id` 相同，事实去重会错误吞掉后续 seal。创建边界和 admission 都必须执行这一不变量。

### 3.2 Tool lifecycle

同一次工具调用的 `tool_call_decision`、`tool_process`、`requires_user_interaction` 与 `tool_output` 必须透传同一 `tool_call_id`。缺失身份必须在创建或 admission 边界失败，不能由工具名、事件次序或数组下标补造。

### 3.3 Child trace

`subrun_trace.source_event_id` 必须等于真实 child RuntimeEvent ID；它是引用，不是新 ID。工具 trace 还必须携带真实 `tool_call_id` 与 `tool_name`，答案 trace 必须携带真实 `answer_id` 和 segment 字段。

trace 类别的唯一取值合同是 `contracts/sub-run-trace-payload.ts` 的 `SubRunTraceKind`。Host、持久化 adapter、transport 与客户端只能导入或派生，禁止为了查询或展示再维护一份 kind 列表。

### 3.4 Compaction presentation 与摘要事实

`summarization_start/end/error` 是 Host realtime presentation，不是 Runtime fact。start 必须满足 `id === summarization_id`；end/error 原样引用该 ID，并与 start 使用同一 `run_id + execution_id + turn_id`。完成产生的 `history_summary` 是另一份 durable 事实：Context Manager 只创建 pending draft，Graph 的 `commit_context_compaction` 在主 Prompt 容量接纳后先通过当前 execution 的 `RuntimeEventCommitPort` 完成 routing admission 与 durable commit，再发送 end，并由既有 event handler 发布同一 fact。Host callback 不得发布 Runtime fact。commit 失败时只能出现 start/error，不能出现 end/summary；commit 成功后摘要身份已经成立，不得因 progress transport 或后续 fan-out 失败改写成 error 或回滚摘要。两者不能复用 progress type，也不能让客户端按“最近一条摘要”猜关联。

自动 compaction 不创建 auxiliary run 或第二套 run identity；它继承当前 root / child 的正式 scope。内部模型调用只用 telemetry 的 `phase=context-internal / purpose=context_compaction` 区分，不能用新的 `run_id`、`summarization_id` 或开放 metadata 伪装执行归属。

## 4. 创建与导入纪律

- 新实体身份只由对应 owner 的生成器创建；关联事实只透传。
- creator 的显式身份参数不能再次出现在可展开的 options 中。
- Provider/Graph 可以创建尚未 admission 的 RuntimeEvent 草稿；run routing 只能由 RuntimeEventSink/Publisher 附着。
- EventBus、EventStore、replay 和 realtime mapper 只能消费已 admission 的正式事实。
- 不可信边界必须使用公开 schema 解析，不能用类型断言替代校验。
- 外部协议、Provider DTO、SQLite row、HTTP path/body 与插件公共合同保留原始字符串；进入 Runtime 内部前必须使用本目录的公开 schema strict parse。parse 后的身份使用不同 TypeScript brand，禁止重新扩大成普通 `string` 后跨身份传递。
- brand 不能用类型断言获得。`as RunId`、`as ToolCallId` 以及通过 `as RuntimeEvent / RunRecord` 等载体断言绕过 admission 都属于协议违规。
- 两个身份复用同一个底层字符串时，必须由命名明确的派生函数表达业务关系；例如 host 明确选择让 run 与 turn 同值，不能依赖两者都是字符串而直接互换。
- checkpoint local 属于持久化输入：`history` 与 `pendingToolCalls` 即使在 `EngineState` 上已有静态类型，恢复后也必须先经 `parseRuntimeEvents` / `parsePendingToolCalls` admission。Renderer SSE 同理，必须在 projection buffer/reducer 之前解析 `SSEEventInput`。

## 5. 禁止替代

- 禁止用 event ID、`turn_id`、step count 或数组下标代替 `answer_id`。
- 禁止用工具名、事件序号或随机 UI key 代替 `tool_call_id`。
- 禁止把 `execution_seq` 当作答案 chunk `seq`。
- 禁止从开放 `metadata/meta` 读取 routing、归并、生命周期或副作用目标身份。
- 禁止为同一事实分别创建 live ID 与 durable ID。
- 禁止用“最近一条”或数组位置关联 summarization start/end/error。
- 禁止在 adapter、client 或测试夹具中修复、猜测、重命名缺失身份。
- 禁止接受身份合同生效前的非规范事件形状；接入方应显式清理或重建不符合当前合同的数据。

## 6. UI client 接入原则

Linnkit 不拥有 UI message identity，但使用 Linnkit 的客户端必须遵守事实身份：

- live 与 replay 使用同一投影规则。
- 同一 Runtime entity 在 client read model 中使用稳定 key，seal 或状态修订不得换 key。
- 产品 UI message ID 的派生规则由接入方自己的公共合同拥有，不能回写 Runtime。
- 客户端不得根据文本、当前活动会话、数组位置或后续事件猜关联。

## 7. 变更门禁

身份字段、creator 或 mapper 变更至少证明：

1. 所有创建路径满足相同 schema 与不变量。
2. Runtime 到 wire、persistence 和 replay 不改写身份。
3. answer 首 chunk、后续 chunk 与 seal 的 `answer_id` 不变。
4. tool decision、process、interaction 与 output 的 `tool_call_id` 不变。
5. child trace 的 `source_event_id` 指向真实 child fact。
6. compaction presentation 的 start/end/error 保持同一 `summarization_id` 与 execution scope，durable `history_summary` 由同一 scope 的 Graph commit stage 唯一发布。
7. 缺失、空白、碰撞或错 scope 身份会显式失败。
8. 接入方 live 与 durable/read-model 投影最终一致。

只验证字段存在或单个 creator 返回值不足以证明身份合同正确；测试应覆盖完整事实序列与跨边界投影。
