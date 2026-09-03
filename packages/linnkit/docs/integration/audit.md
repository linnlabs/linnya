# AuditPort · 决策账本

> **What** · `AuditPort` 接入 —— 把模型选择、上下文构建、工具授权、等待用户、取消等非确定性决策写入审计账本。Telemetry 记录事实，Audit 记录**为什么**。
> **When to read** · 要追溯"agent 为什么这么做"；做合规 / 多租户审计；调试上下文裁剪 / overflow 决策；企业接入强烈建议。
> **Prerequisites** · [`02-quickstart.md`](./02-quickstart.md)。
> **Key exports** · `AuditPort` from `@linnlabs/linnkit/ports` · `AuditEnvelope` from `@linnlabs/linnkit/contracts` · `createFileAudit` / `createCompositeAudit` from `@linnlabs/linnkit/runtime-kernel`。
> **Related** · [`telemetry.md`](./telemetry.md) · [`persistence.md`](./persistence.md) · [`testing.md`](./testing.md)（`createCollectingAuditPort` for tests）

> 可选，但企业接入强烈建议。

AuditPort 是"决策账本"。Telemetry 记录事实（比如一次 LLM 调用了多久、用了多少 token），Audit 记录**为什么做了这个决定**（比如为什么取消、为什么拒绝工具、为什么 fallback 到另一个模型）。

这套接入方式是 host-neutral 的：桌面应用、在线秘书 agent、知识库 agent 或任意自研 agent host 都只需要实现自己的 EventStore / file / SIEM sink，不需要把产品语义写回 linnkit。

中文备注：runtime-kernel 生产路径只通过显式注入的 `AuditPort` 发审计 envelope。旧的全局 `setLlmAuditRecorder` / `llmAuditRecorder` 属于兼容出口，不是 kernel 的观测事实源；新代码不要直接 import 它们。

## 1. 最小接入骨架

默认进 EventStore，再按需分发到文件 / SIEM：

```ts
import { runtimeKernel } from '@linnlabs/linnkit';

const eventStoreAudit = runtimeKernel.audit.createEventStoreAudit({ eventStore });
const fileAudit = runtimeKernel.audit.createFileAudit({ filePath: '/var/log/linnkit/audit.jsonl' });
const auditPort = runtimeKernel.audit.createCompositeAudit({
  ports: [eventStoreAudit, fileAudit],
});

const supervisor = new runtimeKernel.runSupervisor.DefaultRunSupervisor({
  registryStore,
  auditPort,
});
```

## 2. 当前已自动发出的 envelope

- `RunHandle.cancel({ reason })` 会发 `action: 'run.cancel'`，并把 `reason`、`forceCleanup`、`runId`、`conversationId`、`agentSpecId` 写进 envelope。
- `GraphAgentExecutor` 会发 `model.select`；发生模型切换时发 `model.fallback`。
- `ToolNode` 在工具调用通过协议校验、即将执行时发 `tool.allow`，协议校验失败时发 `tool.deny` 和 `tool.protocol_error`。`tool.allow` 只表达放行决策，不代表工具执行成功；执行结果由 `tool_output` 和 `tool_call` telemetry 的 `ok/errorCode` 记录。
- `WaitUserNode` 会发 `wait_user.request`。
- `ChildRunInvoker` 通过内部图执行继续产生 `model.select`、工具授权等小型 envelope；子 run transcript 不写入 `audit_envelope`，由 host 侧文件审计记录。
- `runtimeKernel.audit.emitSandboxDecisionAudit()` 是 sandbox 决策标准入口；当前 linnkit 还没有内置 SandboxPort，所以不会伪造 sandbox 执行链。

中文备注：`AuditPort` 只适合记录 KB 级决策账本。上下文全文、历史全文、子 run transcript 这类会随会话增长的材料不能写进数据库 `audit_envelope`，否则会拖垮历史分页和上下文重建；需要调优时使用 host 侧有界文件审计。

`contracts/audit.ts` 里的 `AUDIT_ACTIONS` 是标准动作集合，不是封闭枚举。`AuditEnvelope.action` 保持开放 string，host 或 kernel 新增细粒度动作时仍必须走同一个 envelope 形状。

## 3. 你现在可以选的 sink

| sink | 用途 |
|---|---|
| `runtimeKernel.audit.noopAudit` | 测试或本地开发占位 |
| `runtimeKernel.audit.consoleAudit` / `createConsoleAudit()` | 开发期看结构 |
| `runtimeKernel.audit.createFileAudit({ filePath })` | 追加写 JSONL，适合最小生产审计或回归测试 |
| `runtimeKernel.audit.createEventStoreAudit({ eventStore })` | 默认推荐落点，写入 `type: 'audit_envelope'` 的隐藏 RuntimeEvent |
| `runtimeKernel.audit.createCompositeAudit({ ports })` | 组合多个 sink |

## 4. 接入规则

- Audit envelope 是追加只读记录；不要在 sink 里回写或修改 run 状态。
- `AuditPort.emit()` 可以是同步或异步；如果你的 sink 有缓冲，暴露 `flush()`，在进程退出或测试结束时显式调用。
- 不要把 AuditPort 当普通日志散用。只有"决策"进 audit，普通耗时 / token / 节点状态继续走 telemetry。
- `audit_envelope` 会持久化，但不会进 UI、不会进 agent context、不会走 SSE。
- `AuditEnvelope.runId / parentRunId / scope` 是审计内容；EventStore admission 另外把所属 run 写入 RuntimeEvent 顶层正式路由字段。禁止再复制到 `metadata.run_context` 或 `metadata.audit_action`。
- `createEventStoreAudit()` 要求 envelope 带 `scope.conversationId`，这是为了避免跨会话审计混流。
- 不要在 graph node、tick middleware 或 tool runtime 中直接写全局 audit recorder；需要额外 sink 时组合 `AuditPort`。

## 5. 最小验证

- 单测：注入一个数组 sink，调用 `handle.cancel({ reason: 'user_request' })` 后能收到 `action === 'run.cancel'` 的 envelope。
- 单测：`createFileAudit()` 连续 emit 两条 envelope 后，JSONL 文件应有两行且可逐行 `JSON.parse`。
- 单测：`createEventStoreAudit()` emit 后，EventStore 中应出现 `type === 'audit_envelope'` 且 `shouldEnterAgentContext(event) === false`。
