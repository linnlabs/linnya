import type Database from 'better-sqlite3';
import type { RuntimeEvent } from '@linnlabs/linnkit/contracts';
import {
  ConversationUiMessageSchema,
  type ConversationUiMessage,
  type JsonRecord,
} from '@app/schemas';
import { isRecord, toSerializableValue } from './json';
import { projectEventToUiRowOps } from './projectEvent';
import type {
  NewUiMessageRow,
  UiMessagePayload,
  UiMessageRow,
  UiProjectionReadAccess,
  UiRowOp,
} from './types';
import { parseUiMessageAttachments, serializeUiMessageAttachments } from './attachments';
import { SqliteConversationCitationFactIndex } from './sqliteCitationFactIndex';

interface UiMessageSqlRow {
  message_id: string;
  conversation_id: string;
  turn_id: string;
  role: string;
  message_type: string;
  sort_seq: number;
  timestamp: number;
  content: string | null;
  attachments_json: string | null;
  payload_json: string | null;
  merge_key: string | null;
  presentation: string | null;
  run_id: string;
}

interface ConversationEventCountRow {
  total_events: number;
}

interface ProjectionStateRow {
  status: 'pending' | 'ready';
}

export class SqliteUiProjectionAccess implements UiProjectionReadAccess {
  constructor(private readonly db: Database.Database) {}

  getRowByMergeKey(conversationId: string, mergeKey: string): UiMessageRow | null {
    const row = this.db
      .prepare<unknown[], UiMessageSqlRow>(
        `
        SELECT *
        FROM conversation_ui_messages
        WHERE conversation_id = ? AND merge_key = ?
        LIMIT 1
      `
      )
      .get(conversationId, mergeKey);

    return row ? toUiMessageRow(row) : null;
  }

  getRowByMessageId(conversationId: string, messageId: string): UiMessageRow | null {
    const row = this.db
      .prepare<unknown[], UiMessageSqlRow>(
        `
        SELECT *
        FROM conversation_ui_messages
        WHERE conversation_id = ? AND message_id = ?
        LIMIT 1
      `
      )
      .get(conversationId, messageId);

    return row ? toUiMessageRow(row) : null;
  }
}

export class SqliteUiProjectionApplier {
  private readonly access: SqliteUiProjectionAccess;
  private readonly citationFactIndex: SqliteConversationCitationFactIndex;

  constructor(private readonly db: Database.Database) {
    this.access = new SqliteUiProjectionAccess(db);
    this.citationFactIndex = new SqliteConversationCitationFactIndex(db);
  }

  projectAppendedEvent(
    conversationId: string,
    runId: string,
    event: RuntimeEvent,
    totalEventsBeforeAppend: number
  ): void {
    // AuditEnvelope 是隐藏事实，不应改变 UI projection revision；否则高等级审计
    // 会让前端误以为 conversation history 发生了可见更新。
    if (event.type === 'audit_envelope') {
      return;
    }
    const ops = projectEventToUiRowOps(event, this.access);
    this.applyOps(conversationId, runId, ops);
    if (event.type === 'tool_output') {
      this.citationFactIndex.projectMainToolOutput(event, runId);
    }
    this.touchProjectionStateAfterAppend(conversationId, totalEventsBeforeAppend);
  }

  deleteRowsForRuns(conversationId: string, runIds: readonly string[]): number {
    if (runIds.length === 0) {
      return 0;
    }

    this.citationFactIndex.deleteForRuns(conversationId, runIds);
    const placeholders = runIds.map(() => '?').join(',');
    const result = this.db
      .prepare(
        `DELETE FROM conversation_ui_messages WHERE conversation_id = ? AND run_id IN (${placeholders})`
      )
      .run(conversationId, ...runIds);
    return result.changes;
  }

  bumpProjectionRevision(conversationId: string): void {
    this.db
      .prepare(
        `
        UPDATE conversation_ui_projection_state
        SET revision = revision + 1
        WHERE conversation_id = ?
      `
      )
      .run(conversationId);
  }

  deleteProjectionRowsForConversation(conversationId: string): void {
    this.citationFactIndex.deleteForConversation(conversationId);
    this.db
      .prepare('DELETE FROM conversation_ui_messages WHERE conversation_id = ?')
      .run(conversationId);
    this.deleteProjectionState(conversationId);
  }

  deleteProjectionState(conversationId: string): void {
    this.db
      .prepare('DELETE FROM conversation_ui_projection_state WHERE conversation_id = ?')
      .run(conversationId);
  }

  private applyOps(conversationId: string, runId: string, ops: readonly UiRowOp[]): void {
    for (const op of ops) {
      switch (op.op) {
        case 'insert':
          this.insertRow({ ...op.row, runId });
          break;
        case 'replace':
          this.replaceRow({ ...op.row, runId });
          break;
        case 'hide':
          this.hideRows(conversationId, op.messageIds);
          break;
        case 'skip':
          break;
      }
    }
  }

  private insertRow(row: NewUiMessageRow): void {
    const existing = this.access.getRowByMessageId(row.conversationId, row.messageId);
    if (existing) {
      this.replaceRow({ ...row, sortSeq: existing.sortSeq });
      return;
    }

    this.replaceRow({
      ...row,
      sortSeq: this.computeNextSortSeq(row.conversationId),
    });
  }

  private replaceRow(row: UiMessageRow): void {
    this.db
      .prepare(
        `
        INSERT INTO conversation_ui_messages (
          message_id,
          conversation_id,
          turn_id,
          role,
          message_type,
          sort_seq,
          timestamp,
          content,
          attachments_json,
          payload_json,
          merge_key,
          presentation,
          run_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(message_id) DO UPDATE SET
          conversation_id = excluded.conversation_id,
          turn_id = excluded.turn_id,
          role = excluded.role,
          message_type = excluded.message_type,
          sort_seq = excluded.sort_seq,
          timestamp = excluded.timestamp,
          content = excluded.content,
          attachments_json = excluded.attachments_json,
          payload_json = excluded.payload_json,
          merge_key = excluded.merge_key,
          presentation = excluded.presentation,
          run_id = excluded.run_id
      `
      )
      .run(
        row.messageId,
        row.conversationId,
        row.turnId,
        row.role,
        row.messageType,
        row.sortSeq,
        row.timestamp,
        row.content,
        serializeUiMessageAttachments(row.attachments),
        serializePayload(row.payload),
        row.mergeKey,
        row.presentation,
        row.runId
      );
  }

  private hideRows(conversationId: string, messageIds: readonly string[]): void {
    if (messageIds.length === 0) {
      return;
    }

    const placeholders = messageIds.map(() => '?').join(',');
    this.db
      .prepare(
        `UPDATE conversation_ui_messages SET presentation = 'hidden' WHERE conversation_id = ? AND message_id IN (${placeholders})`
      )
      .run(conversationId, ...messageIds);
  }

  private touchProjectionStateAfterAppend(
    conversationId: string,
    totalEventsBeforeAppend: number
  ): void {
    const state = this.db
      .prepare<unknown[], ProjectionStateRow>(
        `
        SELECT status
        FROM conversation_ui_projection_state
        WHERE conversation_id = ?
        LIMIT 1
      `
      )
      .get(conversationId);

    if (state) {
      this.db
        .prepare(
          `
          UPDATE conversation_ui_projection_state
          SET revision = revision + 1
          WHERE conversation_id = ?
        `
        )
        .run(conversationId);
      return;
    }

    const status: ProjectionStateRow['status'] =
      totalEventsBeforeAppend === 0 ? 'ready' : 'pending';
    this.db
      .prepare(
        `
        INSERT INTO conversation_ui_projection_state (
          conversation_id,
          status,
          revision,
          last_event_rowid,
          rebuilt_at
        )
        VALUES (?, ?, 1, 0, NULL)
      `
      )
      .run(conversationId, status);
  }

  private computeNextSortSeq(conversationId: string): number {
    const row = this.db
      .prepare<
        unknown[],
        { max_sort_seq: number }
      >('SELECT COALESCE(MAX(sort_seq), 0) as max_sort_seq FROM conversation_ui_messages WHERE conversation_id = ?')
      .get(conversationId);
    return (row?.max_sort_seq ?? 0) + 1;
  }
}

export function readConversationTotalEvents(db: Database.Database, conversationId: string): number {
  const row = db
    .prepare<
      unknown[],
      ConversationEventCountRow
    >('SELECT total_events FROM conversations WHERE conversation_id = ? LIMIT 1')
    .get(conversationId);
  return row?.total_events ?? 0;
}

export function isForeignKeyEnforcementEnabled(db: Database.Database): boolean {
  return db.pragma('foreign_keys', { simple: true }) === 1;
}

function toUiMessageRow(row: UiMessageSqlRow): UiMessageRow {
  const attachments = parseUiMessageAttachments(row.message_id, row.attachments_json);
  const parsed = ConversationUiMessageSchema.safeParse({
    message_id: row.message_id,
    conversation_id: row.conversation_id,
    turn_id: row.turn_id,
    role: row.role,
    message_type: row.message_type,
    sort_seq: row.sort_seq,
    timestamp: row.timestamp,
    content: row.content,
    ...(attachments ? { attachments } : {}),
    payload: parsePayload(row.message_id, row.payload_json),
    merge_key: row.merge_key,
    presentation: row.presentation,
    run_id: row.run_id,
  });
  if (!parsed.success) {
    throw new Error(
      `[SQLiteUiProjectionApplier] row ${row.message_id} violates the ConversationUiMessage contract: ${parsed.error.message}`
    );
  }
  return mapUiMessageToInternalRow(parsed.data);
}

function mapUiMessageToInternalRow(message: ConversationUiMessage): UiMessageRow {
  const common = {
    messageId: message.message_id,
    conversationId: message.conversation_id,
    turnId: message.turn_id,
    sortSeq: message.sort_seq,
    timestamp: message.timestamp,
    content: message.content,
    attachments: message.attachments ?? null,
    payload: message.payload,
    mergeKey: message.merge_key,
    presentation: message.presentation,
    runId: message.run_id,
  };
  // 公共 DTO 与 Host row 仅字段命名不同；逐 variant 映射以保留 payload 判别关系。
  switch (message.message_type) {
    case 'user_input':
      return {
        ...common,
        role: message.role,
        messageType: message.message_type,
        payload: message.payload,
      };
    case 'thought':
      return {
        ...common,
        role: message.role,
        messageType: message.message_type,
        payload: message.payload,
      };
    case 'tool_calls':
      return {
        ...common,
        role: message.role,
        messageType: message.message_type,
        payload: message.payload,
      };
    case 'final_answer':
      return {
        ...common,
        role: message.role,
        messageType: message.message_type,
        payload: message.payload,
      };
    case 'tool_preamble':
      return {
        ...common,
        role: message.role,
        messageType: message.message_type,
        payload: message.payload,
      };
    case 'partial_answer':
      return {
        ...common,
        role: message.role,
        messageType: message.message_type,
        payload: message.payload,
      };
    case 'history_summary':
      return {
        ...common,
        role: message.role,
        messageType: message.message_type,
        payload: message.payload,
      };
  }
}

function serializePayload(payload: UiMessagePayload | null): string | null {
  return payload ? JSON.stringify(payload) : null;
}

function parsePayload(messageId: string, payloadJson: string | null): JsonRecord | null {
  if (!payloadJson) {
    return null;
  }

  const parsed: unknown = JSON.parse(payloadJson);
  if (!isRecord(parsed)) {
    throw new Error(
      `[SQLiteUiProjectionApplier] payload_json for message ${messageId} must be a JSON object`
    );
  }

  const payload: JsonRecord = {};
  for (const [key, value] of Object.entries(parsed)) {
    payload[key] = toSerializableValue(value);
  }
  return payload;
}
