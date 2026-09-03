/**
 * @file src/app-hosts/linnya/adapters/persistence/checkpointer/checkpointer.schema.ts
 * @description Linnya 宿主侧 SqliteCheckpointer 的 DDL。
 *
 * 表 engine_checkpoints：
 * - 一对一存储 checkpointKey 的 EngineState 完整快照
 * - conversation_id 是历史列名；当前 port 语义里它对应 checkpointKey
 * - schema_version / saved_at / current_node / iterations / has_pending_tool_calls
 *   是 summarizeCheckpoint() 衍生的元数据，冗余存出来是为了让
 *   peekMeta() / list() 不必反序列化整个 state_json
 */

export const ENGINE_CHECKPOINTS_SCHEMA: string[] = [
  `
  CREATE TABLE IF NOT EXISTS engine_checkpoints (
    conversation_id          TEXT    PRIMARY KEY,
    state_json               TEXT    NOT NULL,
    schema_version           INTEGER NOT NULL,
    saved_at                 INTEGER NOT NULL,
    current_node             TEXT,
    iterations               INTEGER,
    has_pending_tool_calls   INTEGER NOT NULL DEFAULT 0
  );
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_engine_checkpoints_saved_at
    ON engine_checkpoints (saved_at DESC);
  `,
];
