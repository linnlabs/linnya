# Linnya Telemetry Adapter（SqliteTelemetryAdapter）

linnkit 的 `TelemetryPort` 在 Linnya 宿主侧的实现。**双 sink**：把 engine 发出的 6 类事件同时写到 `workspace.sqlite/engine_telemetry` 表（结构化、可查询）和 logger（控制台/日志文件，给人实时看）。

---

## 1. 数据存哪？

**SQLite 文件位置**（跟 Linnya 其它业务表共用 `workspace.sqlite`）：

| 模式 | 默认路径 |
|---|---|
| **开发模式**（`LINNYA_DEV_MODE=true`） | `<repoRoot>/_dev_data/workspace/workspace.sqlite` |
| **生产模式 macOS** | `~/Library/Application Support/<AppName>/AIService/workspace/workspace.sqlite` |
| **生产模式 Windows** | `%APPDATA%/<AppName>/AIService/workspace/workspace.sqlite` |

> 路径权威实现见 `src/shared/utils/pathManager.ts#getWorkspaceDataPath`。

**logger 输出**：跟应用其它日志一致——开发时打印控制台，生产时进 `<AppData>/logs/*.log`。

---

## 2. 开发者怎么查？

### 方式 1：便捷脚本（推荐）

```bash
# 默认查最近 20 条
npm run telemetry:tail

# 只看 LLM 调用
npm run telemetry:tail -- --kind=llm_call

# 只看某个会话
npm run telemetry:tail -- --conv=conv_abc

# 拉多一点
npm run telemetry:tail -- --limit=100

# 指定生产数据库路径
npm run telemetry:tail -- --db="/Users/me/Library/Application Support/Linnya/AIService/workspace/workspace.sqlite"
```

输出形如：

```
2026-04-22T10:00:01.005Z  graph_node       5ms   conv=conv_abc  node=user
2026-04-22T10:00:01.020Z  llm_call       780ms   conv=conv_abc  model=gpt-5  tokens=2300+120
2026-04-22T10:00:30.500Z  tool_call    28690ms   conv=conv_abc  name=web_search  ok=true
2026-04-22T10:00:30.510Z  graph_node       8ms   conv=conv_abc  node=answer
```

### 方式 2：直接 sqlite3

```bash
sqlite3 ~/code/linnya/_dev_data/workspace/workspace.sqlite \
  "SELECT * FROM engine_telemetry ORDER BY emitted_at DESC LIMIT 20"
```

### 方式 3：GUI（DB Browser for SQLite / TablePlus）

打开 `workspace.sqlite`，浏览 `engine_telemetry` 表。

### 方式 4：实时跟 logger（双 sink 的另一份）

跑应用时控制台直接看：

```
[telemetry] llm_call duration_ms=780 conv=conv_abc run=child_1 parent=run_parent model=gpt-5 stream=true tokens_in=2300 tokens_out=120
[telemetry] tool_call duration_ms=28690 conv=conv_abc name=web_search ok=true
```

### 方式 5：Conversation CLI 安全摘要

```bash
pnpm linnya:cli audit <conversation-id> --run <root-run-id> --pretty
```

该入口查询 `llm_call / tool_call / context_compaction / run_lifecycle` 的安全白名单字段，并与 RunRegistry 关联；不会
导出 payload 中的 prompt、原始 provider usage、工具参数或正文。由于 Telemetry 是
7 天保留、fail-open 的观测面，CLI 合同固定标记为 `best_effort`，不能作为完整执行
事实源。完整多来源审计仍按独立 proposal 推进。

---

## 3. 表 schema：窄表 + JSON payload

```sql
CREATE TABLE engine_telemetry (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  event_kind      TEXT    NOT NULL,    -- 6 类 TelemetryEvent kind
  conversation_id TEXT,                -- scope.conversationId（拍平到列，便于 WHERE + 索引）
  run_id          TEXT,                -- scope.runId
  parent_run_id   TEXT,                -- scope.parentRunId
  turn_id         TEXT,                -- scope.turnId
  step_id         TEXT,                -- scope.stepId
  duration_ms     INTEGER,             -- 有耗时语义的事件会写入，run lifecycle 等为 NULL
  payload         TEXT NOT NULL,       -- 完整 TelemetryEvent JSON（含事件特有字段）
  emitted_at      INTEGER NOT NULL     -- UNIX ms (Date.now())
);
CREATE INDEX idx_engine_telemetry_emitted_at      ON engine_telemetry (emitted_at DESC);
CREATE INDEX idx_engine_telemetry_kind_emitted    ON engine_telemetry (event_kind, emitted_at DESC);
CREATE INDEX idx_engine_telemetry_conv_emitted    ON engine_telemetry (conversation_id, emitted_at DESC);
```

**为什么窄表 + JSON 而不是宽表**：
- linnkit 还在演化，事件 schema 会变；宽表加字段要 migration，窄表无痛
- SQLite 的 `json_extract` 性能对 < 1M 行的小表足够
- 跟 `events` 表（也是 JSON payload）的设计风格一致

**6 类事件的 payload 字段**：
- `llm_call`: `{ kind, modelId, stream, durationMs, usage?, scope }`
- `tool_call`: `{ kind, toolName, durationMs, ok, errorCode?, scope }`
- `context_build`: `{ kind, modelId, tokenEstimate, tokenComponents?, scope }`
- `context_compaction`: `{ kind, modelId, compactionIndex, maxCompactionsPerRun, generationAttempted, beforeTokens, afterTokens?, compressionRatio?, canonicalUsage?, outcome, scope, ... }`；`generationAttempted` 区分真实 Provider 请求与发送前结算，原始 ratio 可大于等于 1，不含摘要正文
- `graph_node`: `{ kind, nodeId, durationMs, scope }`
- `run_lifecycle`: spawned 只有身份；terminal 额外带 `{ stepsUsed, maxSteps, terminalReason }`

权威定义见 独立 Linnkit 仓的 `src/runtime-kernel/telemetry/telemetryPort.ts`。

---

## 4. 双 sink 的设计意图

| sink | 用途 | 何时看 |
|---|---|---|
| **SQLite 表** | 结构化、可 SQL 查询 / 聚合 | 事后排查（"过去 7 天哪个 tool 平均最慢"）、做仪表盘 |
| **logger** | 单行 inline、人眼可读 | 开发时实时跟、CI 日志归档、应急排查 |

两份数据语义一致，只是消费方式不同。**SQLite 写失败时不会让 engine 崩**（被 try/catch 兜底，写一条 `logger.warn`），因为 telemetry 失败只是丢观察数据，业务无影响——这跟 `SqliteCheckpointer.save` 失败必须暴露不同（后者关系到状态正确性）。

child telemetry 的 SQLite 列和单行 logger 都必须保留 `parentRunId`（日志显示为 `parent=`），
方便实时 tail 时按父子链定位。但 telemetry 有 7 天 GC，且事件只表达局部 phase，不能作为
subrun lifecycle 汇总 owner。

---

## 5. GC 策略（保留 7 天）

`engine_telemetry` 写入频率高（每节点 / 每 tool / 每 LLM 都一行），不清理一周就上 GB。

**触发**：`src/electron-main/routes/index.ts` 在会话服务初始化时同步跑一次 `purgeStale`：

```ts
telemetryPort.purgeStale({
  olderThanMs: TELEMETRY_RETENTION_MS, // 7 * 24 * 60 * 60 * 1000
});
```

**保留窗口**：默认 7 天（在 `routes/index.ts` 里改 `TELEMETRY_RETENTION_MS` 常量）。

**为什么不像 checkpointer 一样默认保留 pending 行**：telemetry 没有 "pending" 概念——每个事件都是已发生的事实，不存在"卡住等用户恢复"的语义。直接按 `emitted_at < cutoff` 删掉就好。

**`purgeStale` 不在 `TelemetryPort` 接口上**：平台层不规定 GC 策略，留给宿主自定义。其它宿主（如 linnsec / OTel collector）可能有完全不同的清理策略（按容量、按归档冷存储等）。

---

## 6. 当前与 linnkit engine 的接通状态

**已落地**：
- ✓ schema + provider + DDL
- ✓ `SqliteTelemetryAdapter` 实现（双 sink + GC）
- ✓ `routes/index.ts` 实例化 + 启动跑一次 GC
- ✓ `npm run telemetry:tail` 便捷脚本
- ✓ `GraphExecutor` 注入 `telemetryPort`，发 `graph_node` 与 `run_lifecycle`
- ✓ `tick-pipeline` 发 `llm_call` / `context_build`
- ✓ `ToolNode` 发 `tool_call`
- ✓ `SqliteTelemetryAdapter` 同时写入 `RunCostCollector` / `TokenCalibrationCollector`

| 事件 | 埋点位置 | 复杂度 |
|---|---|---|
| `llm_call` | `tick-pipeline/middlewares/llmTelemetryMiddleware.ts`、context compaction 内部 LLM 调用 | 已接 |
| `context_build` | `tick-pipeline/stages/buildContextStage.ts` | 已接 |
| `context_compaction` | `tick-pipeline` 的 compact / commit stage | 已接 |
| `tool_call` | `graph-engine/nodes/toolNode.ts` | 已接 |
| `graph_node` | `graph-engine/orchestration/runGraphNodeWithTelemetry.ts` | 已接 |
| `run_lifecycle` | `graph-engine/orchestration/runWithLifecycleTelemetry.ts` | 已接 |

中文备注：runtime-kernel 不再直接写旧的 ALS telemetry recorder。benchmark 若仍需要 `withLLMTelemetryContext` 聚合，应在 host runner 或 telemetry adapter 层处理。

---

## 7. 测试

- 契约测试：`__tests__/sqlite.implementation.contract.test.ts`（覆盖 6 类事件持久化、安全审计投影、logger 双 sink、写盘失败容错、flush noop 与 purgeStale）

---

## 8. 参考

- linnkit TelemetryPort 接口：独立 Linnkit 仓的 `src/runtime-kernel/telemetry/telemetryPort.ts`
- 事件 schema：独立 Linnkit 仓的 `src/runtime-kernel/telemetry/telemetryEvents.ts`
- B0 研究文档：独立 Linnkit 仓的 `docs/archive/engine-phases/21-host-port-adapter-research.md` §6（B2 实施背景）
- 跨切关注点（telemetry 设计原则）：独立 Linnkit 仓的 `docs/archive/engine-phases/08-cross-cutting-concerns.md`
