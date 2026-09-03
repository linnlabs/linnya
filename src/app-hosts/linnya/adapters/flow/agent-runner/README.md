# Flow Agent Runner Helpers

Layer: `host-adapter`

这里承载 `FlowAgentRunnerService` 的执行期宿主协作件真实实现。

## 功能

- `runBootstrapper.ts`：`wait_user` 恢复、request enrichment、runContext 初始化
- `executionPolicyAssembler.ts`：step policy / reminder / start node 组装
- `runLifecycleCoordinator.ts`：run metadata 与上下文快照的用户消息绑定
- `runEventPersistence.ts`：EventBus durable 事实的单队列增量持久化
- `runFinalizer.ts`：成功/失败收尾与 partial final_answer 返回
- `../execution-settlement/`：统一 run error、execution metrics、persistence drain 与 RunHandle 终态顺序
- `runAuditScope.ts`：run 级 audit scope 包裹与 flush
- `summarizationEventEmitter.ts`：摘要 start/end/error 的 host 发射边界

## 边界

- 这里只放 `flow.agent-runner.service.ts` 的宿主执行协作件
- root run 的 `completed` 终态和 `awaiting_user` 暂停态都必须由 execution-settlement 在持久化队列 drain 后落定；event、asset link 或 projection 任一短事务失败时，run 必须进入 `failed`
- `wait_user` checkpoint 缺少已发布的 interaction RuntimeEvent 时必须在 metrics / drain 前失败，不能留下不可 resume 的暂停态
- Graph 执行期间仍按事件增量串行写入，不为每条事件阻塞下一步；终态屏障只负责禁止“运行完成但 durable 事实不完整”
- 每次成功 LLM Prompt 的 `context_usage_snapshot` 经同一 execution-scoped RuntimeEventSink 发布；Host 只绑定最近正式
  `user_message_id`，其中 wait-user resume 沿用历史中的触发消息，不建立 token 专用发布通道
- Graph 返回的最近一次成功 `ContextUsageSnapshot` 由 execution settlement 写进同一份 `run_execution_metrics`；Flow 不重新读取模型目录、不重算窗口，也不为失败 attempt 补造成功快照
- `childRunInvokerFactory.ts` 已迁到 `src/app-hosts/linnya/adapters/child-runs/`
- 旧 `src/features/conversation/flow/services/agent-runner/*` 路径已迁出，不要再回写

## 相关文档

- `packages/linnkit/src/runtime-kernel/README.md`
- `src/app-hosts/linnya/adapters/flow/README.md`
- `src/app-hosts/linnya/adapters/child-runs/README.md`
