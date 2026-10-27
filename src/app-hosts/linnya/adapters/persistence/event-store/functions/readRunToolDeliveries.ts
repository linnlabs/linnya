import type Database from 'better-sqlite3';

export interface RunToolDeliveryRow {
  readonly toolCallId: string;
  readonly argumentsJson: string;
  readonly dataJson: string;
}

/** 仅交付指定会话/运行/工具的已提交成功结果；不暴露任意事件或其他运行的正文。 */
export function readRunToolDeliveries(
  db: Database.Database, conversationId: string, runId: string, toolName: string,
): RunToolDeliveryRow[] {
  return db.prepare<[string, string, string], RunToolDeliveryRow>(`
    WITH calls AS (
      SELECT e.run_id, json_extract(c.value, '$.id') AS call_id,
        json_extract(c.value, '$.function.arguments') AS arguments_json
      FROM events e JOIN runs r ON r.id = e.run_id,
        json_each(e.payload, '$.payload.tool_calls') c
      WHERE r.conversation_id = ? AND e.run_id = ? AND e.type = 'tool_call_decision'
        AND json_extract(c.value, '$.function.name') = ?
    )
    SELECT calls.call_id AS toolCallId, calls.arguments_json AS argumentsJson,
      json_extract(e.payload, '$.data') AS dataJson
    FROM calls JOIN events e ON e.run_id = calls.run_id
      AND json_extract(e.payload, '$.tool_call_id') = calls.call_id
    WHERE e.type = 'tool_output' AND json_extract(e.payload, '$.status') = 'success'
    ORDER BY e.rowid
  `).all(conversationId, runId, toolName);
}
