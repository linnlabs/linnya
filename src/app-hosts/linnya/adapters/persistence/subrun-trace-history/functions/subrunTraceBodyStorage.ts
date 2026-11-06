import type Database from 'better-sqlite3';
import type { DurableSubrunTraceKind } from '../definitions/subrunTraceHistory';

/** 每种 trace 仅共享一个有明确来源的字段。展示扩展、缺少 child 事实或与其不同的正文继续随 trace 存储。 */
export const SUBRUN_TRACE_BODY_SCHEMA = [
  `CREATE VIEW IF NOT EXISTS subrun_trace_body_sources AS
    SELECT id, run_id,
      CASE type WHEN 'thought' THEN 'thought_complete' ELSE type END AS kind,
      CASE type WHEN 'tool_output' THEN '$.output' ELSE '$.content' END AS field,
      payload ->> '$.tool_call_id' AS call_id, payload ->> '$.tool_name' AS tool_name,
      payload ->> '$.status' AS status, payload ->> '$.answer_id' AS answer_id,
      CASE WHEN type <> 'tool_output' THEN payload -> '$.content'
        WHEN payload ->> '$.status' = 'success'
          THEN json_object('data', payload -> '$.data', 'observation', payload -> '$.observation')
        WHEN payload ->> '$.status' = 'error' THEN CASE WHEN json_type(payload, '$.error') IS NULL
          THEN json_object('observation', payload -> '$.observation')
          ELSE json_object('observation', payload -> '$.observation', 'error', payload -> '$.error') END
      END AS value_json
    FROM events WHERE type IN ('tool_output', 'final_answer')
      OR (type = 'thought' AND payload ->> '$.is_complete' = 1)`,
  `CREATE VIEW IF NOT EXISTS subrun_trace_history_items AS
    SELECT i.id, i.subrun_id, i.source_event_id, i.kind, i.timestamp,
      CASE WHEN i.payload_json ->> '$.body_from_event' = 1 THEN
        CASE WHEN s.value_json IS NOT NULL THEN json_set(json_remove(i.payload_json, '$.body_from_event'),
          s.field, json(s.value_json)) END
        ELSE i.payload_json END AS payload_json
    FROM subrun_trace_items i LEFT JOIN subrun_trace_body_sources s
      ON i.payload_json ->> '$.body_from_event' = 1 AND s.id = i.source_event_id
      AND s.run_id = i.subrun_id AND s.kind = i.kind`,
  // trace 跟随父运行清理。若只删除 child 事实，先在同一事务还原正文，保留父详情的原有寿命。
  `CREATE TRIGGER IF NOT EXISTS restore_subrun_body_before_event_delete
    BEFORE DELETE ON events WHEN OLD.type IN ('tool_output', 'thought', 'final_answer')
    BEGIN
      UPDATE subrun_trace_items
      SET payload_json = (SELECT payload_json FROM subrun_trace_history_items WHERE source_event_id = OLD.id)
      WHERE source_event_id = OLD.id AND payload_json ->> '$.body_from_event' = 1;
    END`,
];

// 比较实际 JSON 后才引用。只替换字段值，所以 output 内的键序、附件、持续时间和独有元数据原样保留。
const SAME_BODY = `s.id = i.source_event_id AND s.run_id = i.subrun_id AND s.kind = i.kind
  AND (s.kind <> 'tool_output' OR (s.call_id = i.payload_json ->> '$.tool_call_id'
    AND s.tool_name = i.payload_json ->> '$.tool_name' AND s.status = i.payload_json ->> '$.status'))
  AND (s.kind <> 'final_answer' OR s.answer_id = i.payload_json ->> '$.answer_id')
  AND s.value_json = i.payload_json -> s.field`;
const COMPACT_PAYLOAD = "json_set(i.payload_json, s.field, NULL, '$.body_from_event', 1)";

export function encodeSubrunTraceBody(
  db: Database.Database, kind: DurableSubrunTraceKind, subrunId: string, sourceId: string, payloadJson: string,
): string {
  if (kind !== 'tool_output' && kind !== 'thought_complete' && kind !== 'final_answer') return payloadJson;
  const match = db.prepare<[string, string, string, string], { compact: string }>(`
    WITH i(kind, subrun_id, source_event_id, payload_json) AS (VALUES (?, ?, ?, ?))
    SELECT ${COMPACT_PAYLOAD} AS compact FROM i JOIN subrun_trace_body_sources s ON ${SAME_BODY}
  `).get(kind, subrunId, sourceId, payloadJson);
  return match?.compact ?? payloadJson;
}

export function compactExistingSubrunTraceBodies(db: Database.Database): void {
  db.exec(`UPDATE subrun_trace_items AS i SET payload_json = ${COMPACT_PAYLOAD}
    FROM subrun_trace_body_sources s WHERE ${SAME_BODY}`);
}
