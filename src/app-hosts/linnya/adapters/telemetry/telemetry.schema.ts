/**
 * @file src/app-hosts/linnya/adapters/telemetry/telemetry.schema.ts
 * @description Linnya 宿主侧 SqliteTelemetryAdapter 的 DDL。
 *
 * 表 engine_telemetry：linnkit engine 通过 TelemetryPort.emit() 发出的事件流。
 *
 * 设计：窄表 + JSON payload（详见 README §3）
 * - 把 scope（conversationId/runId/turnId/...）和 durationMs 这几个高频查询字段
 *   冗余拍平到列上，索引能用上、SQL WHERE 直接写
 * - 事件特有字段（modelId / toolName / nodeId / phase / usage / errorCode 等）
 *   全进 payload JSON，linnkit 演化时 schema 不需要 migration
 *
 * 命名规范：
 * - 表 / 列：snake_case（SQLite 习惯）
 * - JSON payload 内字段：camelCase（保留 linnkit TelemetryEvent 原貌）
 */

export const ENGINE_TELEMETRY_SCHEMA: string[] = [
  `
  CREATE TABLE IF NOT EXISTS engine_telemetry (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    event_kind      TEXT    NOT NULL,
    conversation_id TEXT,
    run_id          TEXT,
    parent_run_id   TEXT,
    turn_id         TEXT,
    step_id         TEXT,
    duration_ms     INTEGER,
    payload         TEXT    NOT NULL,
    emitted_at      INTEGER NOT NULL
  );
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_engine_telemetry_emitted_at
    ON engine_telemetry (emitted_at DESC);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_engine_telemetry_kind_emitted
    ON engine_telemetry (event_kind, emitted_at DESC);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_engine_telemetry_conv_emitted
    ON engine_telemetry (conversation_id, emitted_at DESC);
  `,
];
