import type Database from 'better-sqlite3';
import { ConversationUiMessageSchema, type ConversationUiMessage } from '@app/schemas';
import { parseUiMessageAttachments, serializeUiMessageAttachments } from './attachments';
import { isRecord } from './json';
import type { UiMessageRow } from './types';

export interface UiMessageSqlRow {
  message_id: string;
  conversation_id: string;
  turn_id: string | null;
  role: string;
  message_type: string;
  sort_seq: number;
  timestamp: number;
  content: string | null;
  attachments_json: string | null;
  payload_json: string | null;
  merge_key: string | null;
  presentation: string | null;
  run_id: string | null;
  content_event_id: string | null;
  data_event_id: string | null;
  tool_content_json: string | null;
  tool_data_json: string | null;
}

// 外层窗口仍按 conversation/sort_seq 索引分页；每个来源由事件主键定位。
// 用 -> 保留 JSON 的 null、字符串、数组等类型，与字段缺失（SQL NULL）区分。
export const UI_ROWS_WITH_TOOL_RESULTS = `(
  SELECT m.*,
    CASE c.type WHEN 'tool_output' THEN c.payload -> '$.observation'
      WHEN 'requires_user_interaction' THEN c.payload -> '$.form.observation' END AS tool_content_json,
    CASE d.type WHEN 'tool_output' THEN d.payload -> '$.data'
      WHEN 'requires_user_interaction' THEN d.payload -> '$.form.data' END AS tool_data_json
  FROM conversation_ui_messages m
  LEFT JOIN events c ON c.id = m.content_event_id AND c.run_id = m.run_id
    AND c.payload ->> '$.tool_call_id' = m.payload_json ->> '$.tool_call_id'
  LEFT JOIN events d ON d.id = m.data_event_id AND d.run_id = m.run_id
    AND d.payload ->> '$.tool_call_id' = m.payload_json ->> '$.tool_call_id'
)`;

function readReferencedField(messageId: string, eventId: string, json: string | null): unknown {
  if (json === null) throw new Error(`Tool message ${messageId} cannot read its result from event ${eventId}`);
  return JSON.parse(json);
}

export function toUiMessageView(row: UiMessageSqlRow): ConversationUiMessage {
  const attachments = parseUiMessageAttachments(row.message_id, row.attachments_json);
  let payload: unknown = row.payload_json === null ? null : JSON.parse(row.payload_json);
  if (row.data_event_id !== null) {
    if (!isRecord(payload)) throw new Error(`Invalid tool payload for message ${row.message_id}`);
    payload = { ...payload, data: readReferencedField(row.message_id, row.data_event_id, row.tool_data_json) };
  }
  const content = row.content_event_id === null ? row.content
    : readReferencedField(row.message_id, row.content_event_id, row.tool_content_json);
  const parsed = ConversationUiMessageSchema.safeParse({
    message_id: row.message_id,
    conversation_id: row.conversation_id,
    turn_id: row.turn_id,
    role: row.role,
    message_type: row.message_type,
    sort_seq: row.sort_seq,
    timestamp: row.timestamp,
    content,
    ...(attachments ? { attachments } : {}),
    payload,
    merge_key: row.merge_key,
    presentation: row.presentation,
    run_id: row.run_id,
  });
  if (!parsed.success) {
    throw new Error(`UI row ${row.message_id} violates the ConversationUiMessage contract: ${parsed.error.message}`);
  }
  return parsed.data;
}

/** append 与 rebuild 共用同一物理行编码；来源身份不进入对外 DTO。 */
export function writeUiMessageRow(db: Database.Database, row: UiMessageRow, mode: 'insert' | 'upsert'): void {
  let payload = row.payload;
  let contentEventId: string | undefined;
  let dataEventId: string | undefined;
  if (row.messageType === 'tool_calls') {
    ({ contentEventId, dataEventId } = row);
    const { data, ...card } = row.payload;
    if (data !== undefined && dataEventId === undefined) {
      throw new Error(`Tool message ${row.messageId} has data without a source event`);
    }
    payload = card;
  }
  db.prepare(`
    INSERT INTO conversation_ui_messages (
      message_id, conversation_id, turn_id, role, message_type, sort_seq, timestamp,
      content, attachments_json, payload_json, merge_key, presentation, run_id, content_event_id, data_event_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ${mode === 'upsert' ? UPDATE_EXISTING_ROW : ''}
  `).run(
    row.messageId, row.conversationId, row.turnId, row.role, row.messageType, row.sortSeq, row.timestamp,
    contentEventId === undefined ? row.content : null, serializeUiMessageAttachments(row.attachments),
    payload === null ? null : JSON.stringify(payload), row.mergeKey, row.presentation, row.runId,
    contentEventId ?? null, dataEventId ?? null,
  );
}

// rebuild 已清空当前会话，普通 INSERT 应保留跨会话身份冲突的错误。
const UPDATE_EXISTING_ROW = `
ON CONFLICT(message_id) DO UPDATE SET
  conversation_id = excluded.conversation_id, turn_id = excluded.turn_id, role = excluded.role,
  message_type = excluded.message_type, sort_seq = excluded.sort_seq, timestamp = excluded.timestamp,
  content = excluded.content, attachments_json = excluded.attachments_json, payload_json = excluded.payload_json,
  merge_key = excluded.merge_key, presentation = excluded.presentation, run_id = excluded.run_id,
  content_event_id = excluded.content_event_id, data_event_id = excluded.data_event_id
`;
