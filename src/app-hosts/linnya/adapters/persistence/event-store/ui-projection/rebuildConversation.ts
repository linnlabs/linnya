import type Database from 'better-sqlite3';
import { readConversationClientNotices } from '../../conversation-client-notices/sqliteClientNoticeAdmission';
import { projectClientNoticeToUiRow } from '../../conversation-client-notices/projectClientNotice';
import {
  projectCommandPermissionChangeToUiRow,
  readConversationCommandPermissionChanges,
} from '../../conversation-command-permissions/commandPermissionChangeFacts';
import { parseRuntimeEventRoutingIdentity, type RuntimeEvent } from '@linnlabs/linnkit/contracts';
import { RUNTIME_EVENT_TYPES_NEVER_REPLAYED_TO_UI } from '@linnlabs/linnkit/runtime-kernel/events';
import { InMemoryUiProjectionAccess } from './memoryApplier';
import { projectEventToUiRowOps } from './projectEvent';
import { writeUiMessageRow } from './sqliteUiMessageRow';
import { parseStoredRuntimeEvent } from '../functions/runtimeEventStorageCodec';
import { SqliteConversationCitationFactIndex } from './sqliteCitationFactIndex';
import { SqliteUiProjectionApplier } from './sqliteApplier';
import type { NewUiMessageRow } from './types';

interface RebuildEventRow {
  event_rowid: number;
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
  'llm_retry',
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
  const projection = projectRowsInMemory(events, conversationId, readAnchoredProductFactRows(db, conversationId));
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
      writeUiMessageRow(db, row, 'insert');
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
    new SqliteUiProjectionApplier(db).rebuildSubrunSummaries(conversationId);

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
      SELECT e.rowid AS event_rowid, e.id, e.type, e.payload, e.ts, e.run_id, r.parent_run_id
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

/**
 * 不属于任何运行的产品事实（客户端提示、档位变更）。各自记下接纳时对话最后一个事件的位置，
 * 重建时插回该事件之后；同一位置按接纳时间排。
 */
interface AnchoredProductFactRow {
  readonly anchorEventRowId: number;
  readonly at: number;
  readonly row: NewUiMessageRow;
}

function readAnchoredProductFactRows(db: Database.Database, conversationId: string): readonly AnchoredProductFactRow[] {
  const notices = readConversationClientNotices(db, conversationId).map(notice => ({
    anchorEventRowId: notice.anchorEventRowId, at: notice.acceptedAt, row: projectClientNoticeToUiRow(notice),
  }));
  const changes = readConversationCommandPermissionChanges(db, conversationId).map(fact => ({
    anchorEventRowId: fact.anchorEventRowId, at: fact.change.changed_at_ms, row: projectCommandPermissionChangeToUiRow(fact),
  }));
  // 两组各自已按锚点有序；稳定排序保留各自的原有次序。
  return [...notices, ...changes].sort((a, b) => a.anchorEventRowId - b.anchorEventRowId || a.at - b.at);
}

function projectRowsInMemory(rows: readonly RebuildEventRow[], conversationId: string, facts: readonly AnchoredProductFactRow[]) {
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
  let factIndex = 0;
  for (const [index, event] of resolved.entries()) {
    const row = rows[index];
    if (!row) throw new Error('UI rebuild event ordering mismatch');
    while (factIndex < facts.length) {
      const fact = facts[factIndex];
      if (!fact || fact.anchorEventRowId >= row.event_rowid) break;
      access.applyOps([{ op: 'insert', row: fact.row }]);
      factIndex += 1;
    }
    access.applyOps(projectEventToUiRowOps(event, access));
  }
  for (const fact of facts.slice(factIndex)) {
    access.applyOps([{ op: 'insert', row: fact.row }]);
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
