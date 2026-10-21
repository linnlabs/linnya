import type Database from 'better-sqlite3';

export interface ConversationToolHistoryRow {
  readonly kind: 'decision' | 'output';
  readonly runId: string;
  readonly toolCallId: string;
  readonly argumentsJson: string | null;
  readonly status: 'success' | 'error' | null;
  readonly errorCode: string | null;
}

/**
 * 只投影指定工具的调用身份、参数及终态。SQLite 内筛掉其他工具，逐行读取；
 * 网页正文、工具 observation、错误正文及其他大 payload 不进入调用方内存。
 * 关系表限定 conversation，因此 child 与父运行共享事实，截断/删除自然生效。
 */
export function readConversationToolHistory(
  db: Database.Database,
  conversationId: string,
  toolName: string,
): Iterable<ConversationToolHistoryRow> {
  return db.prepare<[string, string, string, string, string, string], ConversationToolHistoryRow>(`
    SELECT kind, runId, toolCallId, argumentsJson, status, errorCode FROM (
    SELECT 'decision' AS kind, e.run_id AS runId,
      json_extract(c.value, '$.id') AS toolCallId,
      json_extract(c.value, '$.function.arguments') AS argumentsJson,
      NULL AS status, NULL AS errorCode, e.ts AS eventTimestamp, e.id AS eventId
    FROM events e JOIN runs r ON r.id = e.run_id,
      json_each(e.payload, '$.payload.tool_calls') c
    WHERE r.conversation_id = ? AND e.type = 'tool_call_decision'
      AND json_extract(c.value, '$.function.name') = ?
    UNION ALL
    SELECT 'decision', e.run_id,
      json_extract(e.payload, '$.tool_call_id'),
      COALESCE(json_extract(e.payload, '$.args'), json_extract(e.payload, '$.payload.args')), NULL, NULL, e.ts, e.id
    FROM events e JOIN runs r ON r.id = e.run_id
    WHERE r.conversation_id = ? AND e.type = 'tool_call_decision'
      AND json_extract(e.payload, '$.tool_name') = ?
      AND COALESCE(json_array_length(e.payload, '$.payload.tool_calls'), 0) = 0
    UNION ALL
    SELECT 'output', e.run_id,
      json_extract(e.payload, '$.tool_call_id'), NULL,
      json_extract(e.payload, '$.status'), json_extract(e.payload, '$.error_code'), e.ts, e.id
    FROM events e JOIN runs r ON r.id = e.run_id
    WHERE r.conversation_id = ? AND e.type = 'tool_output'
      AND json_extract(e.payload, '$.tool_name') = ?
    ) ORDER BY runId, toolCallId, eventTimestamp, eventId
  `).iterate(conversationId, toolName, conversationId, toolName, conversationId, toolName);
}
