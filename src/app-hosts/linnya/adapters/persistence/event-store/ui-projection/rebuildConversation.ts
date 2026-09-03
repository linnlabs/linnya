import type Database from 'better-sqlite3';
import { parseRuntimeEventRoutingIdentity, type RuntimeEvent } from 'linnkit/contracts';
import { RUNTIME_EVENT_TYPES_NEVER_REPLAYED_TO_UI } from 'linnkit/runtime-kernel/events';
import { InMemoryUiProjectionAccess } from './memoryApplier';
import { projectEventToUiRowOps } from './projectEvent';
import type { UiMessagePayload, UiMessageRow } from './types';
import { serializeUiMessageAttachments } from './attachments';
import { parseStoredRuntimeEvent } from '../functions/runtimeEventStorageCodec';
import { SqliteConversationCitationFactIndex } from './sqliteCitationFactIndex';

interface RebuildEventRow {
  id: string;
  type: string;
  payload: string;
  ts: number;
  run_id: string;
  parent_run_id: string | null;
}

interface ProjectionStateRow {
  status: 'pending' | 'ready';
  revision: number;
}

interface MaxRowIdRow {
  max_rowid: number | null;
}

interface ConversationRebuildCandidateRow {
  conversation_id: string;
  status: 'missing' | 'pending';
  revision: number;
  total_events: number;
}

interface CountRow {
  count: number;
}

/** UI rebuild 只读取当前投影器拥有的 durable RuntimeEvent 类型。 */
const RUNTIME_EVENT_TYPES_READ_BY_UI_REBUILD: readonly RuntimeEvent['type'][] = [
  'user_input',
  'thought',
  'tool_call_decision',
  'tool_process',
  'tool_output',
  'requires_user_interaction',
  'final_answer',
  'history_summary',
  'error',
  'control',
  'run_execution_metrics',
];

export interface ConversationUiProjectionRebuildCandidate {
  readonly conversationId: string;
  readonly status: 'missing' | 'pending';
  readonly revision: number;
  readonly totalEvents: number;
}

export type ConversationUiProjectionRebuildResult =
  | {
      readonly status: 'skipped';
      readonly conversationId: string;
      readonly reason: 'already-ready' | 'conversation-not-found';
      readonly durationMs: number;
    }
  | {
      readonly status: 'rebuilt';
      readonly conversationId: string;
      readonly eventCount: number;
      readonly messageCount: number;
      readonly skippedEventCount: number;
      readonly sqlExcludedEventCount: number;
      readonly previousRevision: number;
      readonly nextRevision: number;
      readonly durationMs: number;
    };

export interface RebuildConversationUiProjectionOptions {
  readonly force?: boolean;
}

export function findConversationsNeedingUiProjectionRebuild(
  db: Database.Database
): ConversationUiProjectionRebuildCandidate[] {
  const rows = db
    .prepare<unknown[], ConversationRebuildCandidateRow>(
      `
      SELECT
        c.conversation_id,
        CASE
          WHEN s.conversation_id IS NULL THEN 'missing'
          ELSE s.status
        END AS status,
        COALESCE(s.revision, 0) AS revision,
        c.total_events
      FROM conversations c
      LEFT JOIN conversation_ui_projection_state s
        ON s.conversation_id = c.conversation_id
      WHERE s.conversation_id IS NULL OR s.status = 'pending'
      ORDER BY c.last_event_at DESC, c.conversation_id ASC
    `
    )
    .all();

  return rows.map(row => ({
    conversationId: row.conversation_id,
    status: row.status,
    revision: row.revision,
    totalEvents: row.total_events,
  }));
}

export function rebuildConversationUiProjection(
  db: Database.Database,
  conversationId: string,
  options: RebuildConversationUiProjectionOptions = {}
): ConversationUiProjectionRebuildResult {
  const start = Date.now();
  const state = readProjectionState(db, conversationId);
  if (state?.status === 'ready' && options.force !== true) {
    return {
      status: 'skipped',
      conversationId,
      reason: 'already-ready',
      durationMs: Date.now() - start,
    };
  }

  if (!conversationExists(db, conversationId)) {
    return {
      status: 'skipped',
      conversationId,
      reason: 'conversation-not-found',
      durationMs: Date.now() - start,
    };
  }

  const events = readRenderableEventRowsForRebuild(db, conversationId);
  const sqlExcludedEventCount = readTotalEventCount(db, conversationId) - events.length;
  const projection = projectRowsInMemory(events, conversationId);
  const previousRevision = state?.revision ?? 0;
  const nextRevision = previousRevision + 1;
  const lastEventRowId = readLastEventRowId(db, conversationId);

  const writeSnapshot = db.transaction(() => {
    const citationFactIndex = new SqliteConversationCitationFactIndex(db);
    citationFactIndex.deleteForConversation(conversationId);
    db.prepare('DELETE FROM conversation_ui_messages WHERE conversation_id = ?').run(
      conversationId
    );
    for (const row of projection.rows) {
      insertSnapshotRow(db, row);
    }
    for (const event of projection.events) {
      if (event.type === 'tool_output') {
        citationFactIndex.projectMainToolOutput(
          event,
          parseRuntimeEventRoutingIdentity(event).run_id
        );
      }
    }
    citationFactIndex.rebuildSubrunFacts(conversationId);

    db.prepare(
      `
      INSERT INTO conversation_ui_projection_state (
        conversation_id,
        status,
        revision,
        last_event_rowid,
        rebuilt_at
      )
      VALUES (?, 'ready', ?, ?, ?)
      ON CONFLICT(conversation_id) DO UPDATE SET
        status = 'ready',
        revision = excluded.revision,
        last_event_rowid = excluded.last_event_rowid,
        rebuilt_at = excluded.rebuilt_at
    `
    ).run(conversationId, nextRevision, lastEventRowId, Date.now());
  });

  writeSnapshot();

  return {
    status: 'rebuilt',
    conversationId,
    eventCount: events.length,
    messageCount: projection.rows.length,
    skippedEventCount: projection.skipped.length,
    sqlExcludedEventCount,
    previousRevision,
    nextRevision,
    durationMs: Date.now() - start,
  };
}

function readProjectionState(
  db: Database.Database,
  conversationId: string
): ProjectionStateRow | null {
  const row = db
    .prepare<unknown[], ProjectionStateRow>(
      `
      SELECT status, revision
      FROM conversation_ui_projection_state
      WHERE conversation_id = ?
      LIMIT 1
    `
    )
    .get(conversationId);
  return row ?? null;
}

function conversationExists(db: Database.Database, conversationId: string): boolean {
  const row = db
    .prepare<
      unknown[],
      CountRow
    >('SELECT COUNT(*) AS count FROM conversations WHERE conversation_id = ?')
    .get(conversationId);
  return (row?.count ?? 0) > 0;
}

function readRenderableEventRowsForRebuild(
  db: Database.Database,
  conversationId: string
): RebuildEventRow[] {
  const excludedPlaceholders = RUNTIME_EVENT_TYPES_NEVER_REPLAYED_TO_UI.map(() => '?').join(',');
  const readablePlaceholders = RUNTIME_EVENT_TYPES_READ_BY_UI_REBUILD.map(() => '?').join(',');
  return db
    .prepare<unknown[], RebuildEventRow>(
      `
      SELECT e.id, e.type, e.payload, e.ts, e.run_id, r.parent_run_id
      FROM events e
      JOIN runs r ON r.id = e.run_id
      WHERE r.conversation_id = ?
        AND e.type IN (${readablePlaceholders})
        AND e.type NOT IN (${excludedPlaceholders})
      ORDER BY e.rowid ASC
    `
    )
    .all(
      conversationId,
      ...RUNTIME_EVENT_TYPES_READ_BY_UI_REBUILD,
      ...RUNTIME_EVENT_TYPES_NEVER_REPLAYED_TO_UI
    );
}

function readTotalEventCount(db: Database.Database, conversationId: string): number {
  const row = db
    .prepare<unknown[], CountRow>(
      `
      SELECT COUNT(*) AS count
      FROM events e
      JOIN runs r ON r.id = e.run_id
      WHERE r.conversation_id = ?
    `
    )
    .get(conversationId);
  return row?.count ?? 0;
}

function projectRowsInMemory(rows: readonly RebuildEventRow[], conversationId: string) {
  const access = new InMemoryUiProjectionAccess();
  const resolved = rows.map(row =>
    parseStoredRuntimeEvent(row.payload, {
      eventId: row.id,
      eventType: row.type,
      conversationId,
      runId: row.run_id,
      parentRunId: row.parent_run_id,
      timestamp: row.ts,
    })
  );
  for (const event of resolved) {
    access.applyOps(projectEventToUiRowOps(event, access));
  }
  return { ...access.snapshot(), events: resolved };
}

function readLastEventRowId(db: Database.Database, conversationId: string): number {
  const row = db
    .prepare<unknown[], MaxRowIdRow>(
      `
      SELECT MAX(e.rowid) AS max_rowid
      FROM events e
      JOIN runs r ON r.id = e.run_id
      WHERE r.conversation_id = ?
    `
    )
    .get(conversationId);
  return row?.max_rowid ?? 0;
}

function insertSnapshotRow(db: Database.Database, row: UiMessageRow): void {
  db.prepare(
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
  `
  ).run(
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

function serializePayload(payload: UiMessagePayload | null): string | null {
  return payload ? JSON.stringify(payload) : null;
}
