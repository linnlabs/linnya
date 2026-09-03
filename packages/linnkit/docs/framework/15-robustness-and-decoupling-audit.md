# 15 · linnkit 健壮性 / 解耦专项收官账本

> 立项：2026-06-23。
> 性质：质量审计驱动的专项治理账本。完整施工流水已沉淀在 git history；本文只保留当前事实、关键契约、少量未完尾巴和后续入口。
> 关系：14 号是治理收官索引；16 号承接本文的 Q-R 根因重构结果与 benchmark 基线施工线。

---

## 1. 当前结论

阶段二质量治理已经基本闭环：

| 模块 | 状态 | 说明 |
|---|---:|---|
| Q-B 真实 bug 修复 | ✅ | error 事件治理、终态守卫、ErrorClassifier、流式 attempt 隔离、工具幂等均已落地 |
| Q-M 健壮性 / 并发 / 可观测 | ✅ / 🟦 | M1-M14 已落地；M15 错误码可观测性 3/4 已接通，`TOOL_TIMEOUT` 等真实超时功能 |
| Q-R 根因重构 | ✅ | R1/R2/R3 已完成主要目标，R2 剩字段分层可选增强 |
| Q-L 解耦收敛 | ✅ / 🟦 | L3/L4/L6/L7 已完成；L5/L8 留作后续小片 |
| 慢循环能力基线 | 🟦 | SN-5 依赖 16 号阶段三 benchmark 自动化；已固化全部 6 个 default-agent case 的 N=3 memory 能力锚点，旧装配 baseline 不作能力 gate |

本轮真正解决的根因是三类：

- **状态纯度**：checkpoint / event store 深克隆、checkpoint local sanitize、context message 不再被 provider 原地改写。
- **并发隔离**：per-run EventBus、按 checkpointKey 串行、按 runId 过滤、supervisor 全局 `maxActiveRuns` 背压。
- **边界清晰**：context state 实体/DTO 分层、tick stage reads/writes + patch 契约、supervisor/graph executor 胖控制器拆分、audit/telemetry Port 化。

---

## 2. 已完成清单

### Q-B · 已验证真实 bug

| # | 结论 | 状态 |
|---|---|---:|
| Q-B1 | `error` RuntimeEvent 不再进入 agent context；converter 漏分支 fail-fast | ✅ |
| Q-B2 | run 终态后反向覆写已加守卫；完整 CAS 留给 `RunRegistryStore` 契约升级 | 🟦 |
| Q-B3 | ErrorClassifier 改结构化 HTTP status 优先，日志收口到 Logger，避免 `400ms` 等误判 | ✅ |
| Q-B4 | 流式重试 / fallback 的失败 attempt chunk 不再透传 | ✅ |
| Q-B5 | 工具幂等加 in-flight 互斥、长 key、scope 缺字段显式失败 | ✅ |

### Q-M · 健壮性 / 并发 / 可观测

| # | 结论 | 状态 |
|---|---|---:|
| Q-M1 | checkpoint sanitize 白名单化，剥离 `signal/sseSink/toolContext` 等运行时引用 | ✅ |
| Q-M2 | `GraphExecutor.runUntilYield` 按 checkpointKey 串行，ephemeral local 分桶；`prime()` 队列外非原子为 latent | ✅ |
| Q-M3 | 首次 / 续跑 LLM 调用从 `stepCount` 魔法数改为显式 invocation kind | ✅ |
| Q-M4 | AgentMessageOrchestrator 改 request-scoped ContextManager，避免并发串配置 | ✅ |
| Q-M5 | supervisor 终态 cleanup、terminal outcome 上限、EventBus.close 仅结束 transport | ✅ |
| Q-M6 | observe 实时 + 持久化双路径按 runId 过滤 | ✅ |
| Q-M7 | child-run 错误模型统一为 Result，取消结果显式 `cancelled:true` | ✅ |
| Q-M8 | context pipeline 默认 rethrow，只有显式 non-fatal provider error 可继续 | ✅ |
| Q-M9 | LLM fallback 增 `maxTotalAttempts` 总调用硬顶 | ✅ |
| Q-M10 | child-run 深度上限熔断 | ✅ |
| Q-M11 | MemoryEventStore 与 MemoryCheckpointer 一致深克隆 | ✅ |
| Q-M12 | runModelLockMiddleware 改 immutable patch，不直接突变 ctx | ✅ |
| Q-M13 | audit/telemetry 隐藏全局副作用改经 `AuditPort` / `TelemetryPort` 出口 | ✅ |
| Q-M14 | supervisor `maxActiveRuns` 背压，拒绝式 fail-fast，队列策略留上层 orchestration | ✅ |
| Q-M15 | `TOOL_PROTOCOL_FUSE` / `ENGINE_DELEGATE_DEPTH` / `ENGINE_BUDGET_EXHAUSTED` 已接通 errorCode；`TOOL_TIMEOUT` 待真实超时功能 | 🟦 |

### Q-L · 解耦 / 维护性

| # | 结论 | 状态 |
|---|---|---:|
| Q-L1 | provider phase 映射修正 | ✅ |
| Q-L2 | quickstart contextPolicy 语义诚实化 | ✅ |
| Q-L3 | 三套 SSE 投影收敛为官方 `runtimeEventToSSEEvent` + host meta enrichment | ✅ |
| Q-L4 | JSON / reasoning / todo / tool lifecycle 类型单源化 | ✅ |
| Q-L5 | shared 层产品词汇下沉到 host | ⬜ |
| Q-L6 | dead config 清理：P4 / SummarizationOptions 三字段 / USER_CANCELLED 已删 | ✅ |
| Q-L7 | preprocessor 基类合并，priority 命名常量化 | ✅ |
| Q-L8 | tokenizer 接 modelId + fallback 可观测；cleanup 生命周期仍待接 | 🟦 |
| Q-L9 | 非测试代码 console 收口到 Logger | ✅ |

### Q-R · 三大根因

| # | 根因 | 当前事实 |
|---|---|---|
| Q-R1 | `MessageProcessingState` 实体 / DTO 混用 | 已完成：`processedContent` 删除，`message/originalIndex` readonly，内容覆盖统一走 `overrideContent` |
| Q-R2 | `TickPipelineContext` 上帝对象 | 已完成主线：stage 声明 reads/writes，runner 合并 patch，middleware patch 出口，`defineTickStage` typed reads DTO；字段分层为可选增强 |
| Q-R3 | 胖 supervisor / graph executor + 隐藏全局 | 已完成：supervisor 主文件压到 298 行，核心函数拆出；graph step/result/telemetry/checkpoint 边界拆出；Q-M13 Port 化 |

---

## 3. 关键契约

### 并发契约

1. `RunSupervisor / EventStore / Checkpointer / GraphExecutor` 可以是进程单例。
2. `EventBus` 必须 per-run，禁止跨 run 共享。
3. 同 `checkpointKey` 的 graph 执行经 checkpoint 队列串行；不同 key 可并行。
4. 事件消费必须按 runId 过滤。
5. host 必须在 finally/finalizer 中关闭 per-transport `EventBus`；逻辑 run 的 `maxActiveRuns` 名额、handle 与 concurrencyKey 只在 completed/failed/cancelled 后释放。`awaiting_user` 跨 transport 保留，resume 激活时轮换 execution controller。

### Error code 契约

- cancel 走 run status 流，不走 `errorCode`；因此 `ENGINE_ERROR_CODES.USER_CANCELLED` 已删除。
- 已知终止路径应优先直接携带 / emit 结构化 errorCode，而不是靠 message string 分类。
- 当前剩余缺口是 `TOOL_TIMEOUT`：工具运行时尚未实现真实超时机制，等功能落地时再接 `tool.timeout`。

### Audit / Telemetry 契约

- runtime-kernel 生产路径不直接写 `llmAuditRecorder` / ALS。
- context audit、tool protocol error、child-run transcript 走 `AuditPort`。
- LLM / graph / run lifecycle 观测走 `TelemetryPort`。
- 若 host 需要 ALS 聚合，应由 host adapter 包装实现，不回灌到 kernel。

---

## 4. 当前未完尾巴

| 项 | 是否阻塞阶段三 | 建议 |
|---|---:|---|
| Q-B2 乐观锁 / CAS | 否 | 等 `RunRegistryStore` 引入 version 或 compare-and-set 契约再做 |
| Q-M2 `prime()` 队列外非原子 | 否 | 仅同 conversation 真并发触发；如未来支持同会话并发 turn，再把 prime 并入队列 |
| Q-M15 `TOOL_TIMEOUT` | 否 | 等真实工具超时机制施工时接 errorCode |
| Q-L5 shared 产品词汇 | 否 | 后续解耦小片，优先识别真实 host 语义 owner |
| Q-L8 tokenizer cleanup 生命周期 | 否 | 等 host/executor close 语义统一后接 |
| Q-R2 跨 stage 字段 / stage 内临时字段分层 | 否 | 可选增强，当前 typed reads/patch 已足够支撑阶段三 |
| SN-5 慢循环能力基线 | 是 | 16 号 BM-2 已接通 baseline schema/store/diff/RunRecord；BM-4 已固化全部 6 个 default-agent case 的 N=3 memory 能力锚点 |

---

## 5. 验证口径

阶段二每轮主要守护命令：

```bash
cd packages/linnkit
npm run typecheck
npx vitest run src/testkit/__tests__/supervisorGraphLoop.e2e.contract.test.ts
npx vitest run src/runtime-kernel/graph-engine/tick-pipeline/__tests__/stageContract.test.ts
npx vitest run src/runtime-kernel/graph-engine/tick-pipeline/__tests__/sideEffectIsolation.test.ts
cd ../..
npm run guard:agent-boundary
```

pre-commit baseline 当前保持 `488`。慢循环能力回归不在本文完成，转入 16 号阶段三。

---

## 6. 下一步

阶段二质量治理已收官。下一站是 16 号文档里的 **阶段三 BM benchmark 自动化**：

1. 先做 benchmark 调研 / runtime 形态决策。
2. 继续推进 Judge 软评分、并发统计和 `agent-bench` 分包；当前 6 个 default-agent case 的 memory baseline / diff schema 已有，后续仍在 16 号推进。
3. 再推进多并发 / agent-bench 分包 / CI 门禁。
