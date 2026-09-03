import type Database from 'better-sqlite3';
import {
  SubRunTraceKind as SubRunTraceKindSchema,
  type SubRunTraceEvent,
  type SubRunTraceKind,
} from 'linnkit/contracts';
import {
  ConversationUiMessageSchema,
  conversationVisualTurnIdFromUserMessageId,
  type ConversationUiMessage,
  type ConversationCompleteVisualTurnId,
  type JsonRecord,
} from '@app/schemas';
import { isRecord, toSerializableValue } from './json';
import {
  parseUiMessageAttachments,
  type UiMessageAttachments,
} from './attachments';
import type { DurableSubrunTraceKind } from '../../subrun-trace-history/definitions/subrunTraceHistory';
import { decodeSubrunTraceHistoryEvent } from '../../subrun-trace-history/functions/subrunTraceHistoryPayload';
import {
  readUiMessageCitationDependencies,
  type UiMessageCitationDependencies,
} from './citationDependencies';

type ProjectionStateStatus = 'pending' | 'ready';

interface ProjectionStateSqlRow {
  status: ProjectionStateStatus;
  revision: number;
}

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

interface SortSeqRow {
  sort_seq: number;
}

interface ExistsRow {
  exists_flag: number;
}

interface SubrunTraceSqlRow {
  id: number;
  conversation_id: string;
  turn_id: string;
  parent_run_id: string | null;
  parent_tool_call_id: string;
  subrun_id: string;
  subrun_parent_id: string | null;
  source_event_id: string;
  kind: DurableSubrunTraceKind;
  timestamp: number;
  payload_json: string;
}

/** Host 仅保留命名风格别名，取值集合由 Linnkit `SubRunTraceKind` 唯一拥有。 */
export type SubrunTraceKind = SubRunTraceKind;

export interface SubrunTraceReadOptions {
  readonly kinds?: readonly SubrunTraceKind[];
  readonly limit?: number;
  readonly cursor?: number;
}

export type UiMessageView = ConversationUiMessage;

export interface UiMessagesWindowReady {
  readonly status: 'ready';
  readonly conversation_id: string;
  readonly messages: readonly UiMessageView[];
  readonly citation_dependencies: UiMessageCitationDependencies;
  readonly has_more_before: boolean;
  readonly has_more_after: boolean;
  readonly prev_cursor?: number;
  readonly next_cursor?: number;
  readonly revision: number;
}

export interface UiMessagesPreparing {
  readonly status: 'preparing';
  readonly conversation_id: string;
}

export interface UiMessagesAnchorNotFound {
  readonly status: 'anchor-not-found';
  readonly conversation_id: string;
  readonly anchor_message_id: string;
}

export type UiMessagesWindowResult =
  | UiMessagesWindowReady
  | UiMessagesPreparing
  | UiMessagesAnchorNotFound;

export type RunFinalAnswerResult =
  | {
      readonly status: 'ready';
      readonly conversation_id: string;
      readonly message: Extract<ConversationUiMessage, { message_type: 'final_answer' }> | null;
    }
  | {
      readonly status: 'preparing';
      readonly conversation_id: string;
    };

export interface ConversationTurnIndexItem {
  readonly visual_turn_id: ConversationCompleteVisualTurnId;
  readonly ordinal: number;
  readonly summary: string;
  readonly anchor_message_id: string;
  readonly sort_seq: number;
}

export type ConversationTurnIndexResult =
  | {
      readonly status: 'ready';
      readonly conversation_id: string;
      readonly turns: readonly ConversationTurnIndexItem[];
      readonly revision: number;
    }
  | UiMessagesPreparing;

export type SubrunTraceResult =
  | {
      readonly status: 'ready';
      readonly conversation_id: string;
      readonly parent_tool_call_id: string;
      readonly subrun_id: string;
      readonly events: readonly SubRunTraceEvent[];
      readonly next_cursor: number | null;
      readonly revision: number;
    }
  | UiMessagesPreparing;

export function readTail(
  db: Database.Database,
  conversationId: string,
  limit: number,
): UiMessagesWindowResult {
  const state = readReadyProjectionState(db, conversationId);
  if (!state) {
    return { status: 'preparing', conversation_id: conversationId };
  }

  const rows = db
    .prepare<unknown[], UiMessageSqlRow>(`
      SELECT *
      FROM conversation_ui_messages
      WHERE conversation_id = ?
        AND ${VISIBLE_ROW_SQL}
      ORDER BY sort_seq DESC
      LIMIT ?
    `)
    .all(conversationId, limit)
    .reverse();

  return buildWindowResult(db, conversationId, state.revision, rows);
}

export function readBefore(
  db: Database.Database,
  conversationId: string,
  cursor: number,
  limit: number,
): UiMessagesWindowResult {
  const state = readReadyProjectionState(db, conversationId);
  if (!state) {
    return { status: 'preparing', conversation_id: conversationId };
  }

  const rows = db
    .prepare<unknown[], UiMessageSqlRow>(`
      SELECT *
      FROM conversation_ui_messages
      WHERE conversation_id = ?
        AND ${VISIBLE_ROW_SQL}
        AND sort_seq < ?
      ORDER BY sort_seq DESC
      LIMIT ?
    `)
    .all(conversationId, cursor, limit)
    .reverse();

  return buildWindowResult(db, conversationId, state.revision, rows);
}

export function readAfter(
  db: Database.Database,
  conversationId: string,
  cursor: number,
  limit: number,
): UiMessagesWindowResult {
  const state = readReadyProjectionState(db, conversationId);
  if (!state) {
    return { status: 'preparing', conversation_id: conversationId };
  }

  const rows = db
    .prepare<unknown[], UiMessageSqlRow>(`
      SELECT *
      FROM conversation_ui_messages
      WHERE conversation_id = ?
        AND ${VISIBLE_ROW_SQL}
        AND sort_seq > ?
      ORDER BY sort_seq ASC
      LIMIT ?
    `)
    .all(conversationId, cursor, limit);

  return buildWindowResult(db, conversationId, state.revision, rows);
}

/**
 * 按正式 run 归属读取最终回答，禁止用“会话最后一条 assistant 消息”猜结果。
 */
export function readRunFinalAnswer(
  db: Database.Database,
  conversationId: string,
  runId: string,
): RunFinalAnswerResult {
  const state = readReadyProjectionState(db, conversationId);
  if (!state) {
    return { status: 'preparing', conversation_id: conversationId };
  }

  const row = db
    .prepare<unknown[], UiMessageSqlRow>(`
      SELECT *
      FROM conversation_ui_messages
      WHERE conversation_id = ?
        AND run_id = ?
        AND message_type = 'final_answer'
        AND ${VISIBLE_ROW_SQL}
      ORDER BY sort_seq DESC
      LIMIT 1
    `)
    .get(conversationId, runId);
  if (!row) {
    return { status: 'ready', conversation_id: conversationId, message: null };
  }

  const message = toUiMessageView(row);
  if (message.message_type !== 'final_answer') {
    throw new Error(`Run ${runId} final answer query returned ${message.message_type}`);
  }
  return { status: 'ready', conversation_id: conversationId, message };
}

export function readAround(
  db: Database.Database,
  conversationId: string,
  anchorMessageId: string,
  limit: number,
): UiMessagesWindowResult {
  const state = readReadyProjectionState(db, conversationId);
  if (!state) {
    return { status: 'preparing', conversation_id: conversationId };
  }

  const anchor = db
    .prepare<unknown[], SortSeqRow>(`
      SELECT sort_seq
      FROM conversation_ui_messages
      WHERE conversation_id = ?
        AND message_id = ?
        AND ${VISIBLE_ROW_SQL}
      LIMIT 1
    `)
    .get(conversationId, anchorMessageId);

  if (!anchor) {
    return {
      status: 'anchor-not-found',
      conversation_id: conversationId,
      anchor_message_id: anchorMessageId,
    };
  }

  const beforeLimit = Math.floor((limit - 1) / 2);
  const afterLimit = limit - 1 - beforeLimit;
  const beforeRows = db
    .prepare<unknown[], UiMessageSqlRow>(`
      SELECT *
      FROM conversation_ui_messages
      WHERE conversation_id = ?
        AND ${VISIBLE_ROW_SQL}
        AND sort_seq < ?
      ORDER BY sort_seq DESC
      LIMIT ?
    `)
    .all(conversationId, anchor.sort_seq, beforeLimit)
    .reverse();
  const anchorRow = db
    .prepare<unknown[], UiMessageSqlRow>(`
      SELECT *
      FROM conversation_ui_messages
      WHERE conversation_id = ? AND message_id = ?
      LIMIT 1
    `)
    .get(conversationId, anchorMessageId);
  const afterRows = db
    .prepare<unknown[], UiMessageSqlRow>(`
      SELECT *
      FROM conversation_ui_messages
      WHERE conversation_id = ?
        AND ${VISIBLE_ROW_SQL}
        AND sort_seq > ?
      ORDER BY sort_seq ASC
      LIMIT ?
    `)
    .all(conversationId, anchor.sort_seq, afterLimit);

  return buildWindowResult(
    db,
    conversationId,
    state.revision,
    anchorRow ? [...beforeRows, anchorRow, ...afterRows] : [...beforeRows, ...afterRows],
  );
}

export function readTurnIndex(
  db: Database.Database,
  conversationId: string,
): ConversationTurnIndexResult {
  const state = readReadyProjectionState(db, conversationId);
  if (!state) {
    return { status: 'preparing', conversation_id: conversationId };
  }

  const rows = db
    .prepare<unknown[], UiMessageSqlRow>(`
      SELECT *
      FROM conversation_ui_messages
      WHERE conversation_id = ?
        AND ${VISIBLE_ROW_SQL}
        AND message_type = 'user_input'
      ORDER BY sort_seq ASC
    `)
    .all(conversationId);

  return {
    status: 'ready',
    conversation_id: conversationId,
    turns: rows.map((row, index) => ({
      // `/turns` 输出的是 Linnya UI 身份，不是表中保存的 Runtime turn_id。
      // 必须与 Renderer live fallback 调用同一 owner，禁止在此处手拼命名空间。
      visual_turn_id: conversationVisualTurnIdFromUserMessageId(row.message_id),
      ordinal: index + 1,
      summary: truncateSummary(row.content ?? '', 120),
      anchor_message_id: row.message_id,
      sort_seq: row.sort_seq,
    })),
    revision: state.revision,
  };
}

export function readSubrunTrace(
  db: Database.Database,
  conversationId: string,
  parentToolCallId: string,
  subrunId: string,
  options: SubrunTraceReadOptions = {},
): SubrunTraceResult {
  const state = readReadyProjectionState(db, conversationId);
  if (!state) {
    return { status: 'preparing', conversation_id: conversationId };
  }

  const requestedKinds = normalizeSubrunTraceKinds(options.kinds);
  const limit = normalizeSubrunTraceLimit(options.limit);
  const kindSql = requestedKinds
    ? `AND i.kind IN (${requestedKinds.map(() => '?').join(',')})`
    : '';
  const cursorSql = typeof options.cursor === 'number' ? 'AND i.id > ?' : '';
  const params: unknown[] = [
    conversationId,
    parentToolCallId,
    subrunId,
    ...(requestedKinds ?? []),
  ];
  if (typeof options.cursor === 'number') {
    params.push(options.cursor);
  }
  params.push(limit + 1);

  const rows = db
    .prepare<unknown[], SubrunTraceSqlRow>(`
      SELECT
        i.id,
        r.conversation_id,
        r.turn_id,
        r.parent_run_id,
        r.parent_tool_call_id,
        r.subrun_id,
        r.subrun_parent_id,
        i.source_event_id,
        i.kind,
        i.timestamp,
        i.payload_json
      FROM subrun_trace_items i
      JOIN subrun_trace_runs r ON r.subrun_id = i.subrun_id
      WHERE r.conversation_id = ?
        AND r.parent_tool_call_id = ?
        AND r.subrun_id = ?
        ${kindSql}
        ${cursorSql}
      ORDER BY i.id ASC
      LIMIT ?
    `)
    .all(...params);

  const pageRows = rows.slice(0, limit);
  const overflowRow = rows[limit];
  const lastPageRow = pageRows[pageRows.length - 1];

  return {
    status: 'ready',
    conversation_id: conversationId,
    parent_tool_call_id: parentToolCallId,
    subrun_id: subrunId,
    events: pageRows.map(row => decodeSubrunTraceHistoryEvent({
      itemId: row.id,
      conversationId: row.conversation_id,
      turnId: row.turn_id,
      parentRunId: row.parent_run_id,
      parentToolCallId: row.parent_tool_call_id,
      subrunId: row.subrun_id,
      subrunParentId: row.subrun_parent_id,
      sourceEventId: row.source_event_id,
      kind: row.kind,
      timestamp: row.timestamp,
      payloadJson: row.payload_json,
    })),
    next_cursor: overflowRow && lastPageRow ? lastPageRow.id : null,
    revision: lastPageRow?.id ?? state.revision,
  };
}

const VISIBLE_ROW_SQL = "(presentation IS NULL OR presentation != 'hidden')";

function normalizeSubrunTraceKinds(
  kinds: readonly SubrunTraceKind[] | undefined,
): readonly SubrunTraceKind[] | undefined {
  if (kinds === undefined) {
    return undefined;
  }
  if (kinds.length === 0) {
    throw new Error('[SQLiteUiMessagesReader] subrun trace kinds must not be empty');
  }
  return [...new Set(kinds.map((kind) => SubRunTraceKindSchema.parse(kind)))];
}

function normalizeSubrunTraceLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || limit === undefined) {
    return 2000;
  }
  return Math.min(Math.max(Math.trunc(limit), 1), 2000);
}

function readReadyProjectionState(
  db: Database.Database,
  conversationId: string,
): ProjectionStateSqlRow | null {
  const state = db
    .prepare<unknown[], ProjectionStateSqlRow>(`
      SELECT status, revision
      FROM conversation_ui_projection_state
      WHERE conversation_id = ?
      LIMIT 1
    `)
    .get(conversationId);
  return state?.status === 'ready' ? state : null;
}

function buildWindowResult(
  db: Database.Database,
  conversationId: string,
  revision: number,
  rows: readonly UiMessageSqlRow[],
): UiMessagesWindowReady {
  const messages = rows.map(toUiMessageView);
  const firstSortSeq = messages[0]?.sort_seq;
  const lastSortSeq = messages[messages.length - 1]?.sort_seq;

  return {
    status: 'ready',
    conversation_id: conversationId,
    messages,
    citation_dependencies: readUiMessageCitationDependencies(db, conversationId, messages),
    has_more_before: typeof firstSortSeq === 'number'
      ? hasVisibleRowsBefore(db, conversationId, firstSortSeq)
      : false,
    has_more_after: typeof lastSortSeq === 'number'
      ? hasVisibleRowsAfter(db, conversationId, lastSortSeq)
      : false,
    ...(typeof firstSortSeq === 'number' ? { prev_cursor: firstSortSeq } : {}),
    ...(typeof lastSortSeq === 'number' ? { next_cursor: lastSortSeq } : {}),
    revision,
  };
}

function hasVisibleRowsBefore(db: Database.Database, conversationId: string, sortSeq: number): boolean {
  const row = db
    .prepare<unknown[], ExistsRow>(`
      SELECT 1 AS exists_flag
      FROM conversation_ui_messages
      WHERE conversation_id = ?
        AND ${VISIBLE_ROW_SQL}
        AND sort_seq < ?
      LIMIT 1
    `)
    .get(conversationId, sortSeq);
  return Boolean(row);
}

function hasVisibleRowsAfter(db: Database.Database, conversationId: string, sortSeq: number): boolean {
  const row = db
    .prepare<unknown[], ExistsRow>(`
      SELECT 1 AS exists_flag
      FROM conversation_ui_messages
      WHERE conversation_id = ?
        AND ${VISIBLE_ROW_SQL}
        AND sort_seq > ?
      LIMIT 1
    `)
    .get(conversationId, sortSeq);
  return Boolean(row);
}

function toUiMessageView(row: UiMessageSqlRow): UiMessageView {
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
      `[SQLiteUiMessagesReader] row ${row.message_id} violates the ConversationUiMessage contract: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

function parsePayload(messageId: string, payloadJson: string | null): JsonRecord | null {
  if (!payloadJson) {
    return null;
  }

  const parsed: unknown = JSON.parse(payloadJson);
  if (!isRecord(parsed)) {
    throw new Error(`[SQLiteUiMessagesReader] payload_json for message ${messageId} must be a JSON object`);
  }

  const payload: JsonRecord = {};
  for (const [key, value] of Object.entries(parsed)) {
    payload[key] = toSerializableValue(value);
  }
  return payload;
}

function truncateSummary(content: string, maxLength: number): string {
  return content.length <= maxLength ? content : content.slice(0, maxLength);
}
