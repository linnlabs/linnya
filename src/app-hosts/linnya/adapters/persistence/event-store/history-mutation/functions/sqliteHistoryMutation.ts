import type Database from 'better-sqlite3';
import type { RuntimeEvent } from 'linnkit/contracts';

import type { SqliteEventAssetLinks } from '../../event-asset-links/sqliteEventAssetLinks';
import type { SqliteUiProjectionApplier } from '../../ui-projection/sqliteApplier';
import { SqliteSubrunTraceHistoryCleanup } from '../../../subrun-trace-history/sqliteSubrunTraceHistoryCleanup';
import { parseStoredRuntimeEvent } from '../../functions/runtimeEventStorageCodec';

interface StoredEventTargetRow {
  readonly id: string;
  readonly type: string;
  readonly run_id: string;
  readonly run_rowid: number;
  readonly payload: string;
  readonly ts: number;
  readonly conversation_id: string;
  readonly parent_run_id: string | null;
}

interface RunIdRow {
  readonly id: string;
}

export interface StoredEventTarget {
  readonly runId: string;
  readonly runRowId: number;
  readonly event: RuntimeEvent;
}

export interface DeletedHistoryFacts {
  readonly deletedEventCount: number;
  readonly deletedRunCount: number;
}

/**
 * 编辑与重跑必须从 immutable event 定位事实所属 run，不能让 UI read model 决定删除范围。
 */
export function readStoredEventTarget(
  db: Database.Database,
  conversationId: string,
  eventId: string,
): StoredEventTarget | null {
  const row = db.prepare<unknown[], StoredEventTargetRow>(`
    SELECT
      e.id AS id,
      e.type AS type,
      e.run_id AS run_id,
      r.rowid AS run_rowid,
      e.payload AS payload,
      e.ts AS ts,
      r.conversation_id AS conversation_id,
      r.parent_run_id AS parent_run_id
    FROM events e
    JOIN runs r ON r.id = e.run_id
    WHERE e.id = ? AND r.conversation_id = ?
    LIMIT 1
  `).get(eventId, conversationId);

  if (!row) return null;
  return {
    runId: row.run_id,
    runRowId: row.run_rowid,
    event: parseStoredRuntimeEvent(row.payload, {
      eventId: row.id,
      eventType: row.type,
      conversationId: row.conversation_id,
      runId: row.run_id,
      parentRunId: row.parent_run_id,
      timestamp: row.ts,
    }),
  };
}

/**
 * run.rowid 是宿主持久化 run 的稳定插入顺序。截断以目标 run 为最小原子单位；
 * destination run 可显式排除，保证“删除旧历史 + 写入替换事实”处于同一事务。
 */
export function deleteHistoryFromRun(
  params: {
    readonly db: Database.Database;
    readonly uiProjection: SqliteUiProjectionApplier;
    readonly eventAssetLinks: SqliteEventAssetLinks;
    readonly conversationId: string;
    readonly firstRunRowId: number;
    readonly excludedRunIds?: readonly string[];
  },
): DeletedHistoryFacts {
  const excludedRunIds = params.excludedRunIds ?? [];
  const queryParams: Array<string | number> = [params.conversationId, params.firstRunRowId];
  let sql = `
    SELECT id
    FROM runs
    WHERE conversation_id = ? AND rowid >= ?
  `;
  if (excludedRunIds.length > 0) {
    sql += ` AND id NOT IN (${excludedRunIds.map(() => '?').join(',')})`;
    queryParams.push(...excludedRunIds);
  }
  sql += ' ORDER BY rowid ASC';

  const runIds = params.db
    .prepare<unknown[], RunIdRow>(sql)
    .all(...queryParams)
    .map(row => row.id);
  if (runIds.length === 0) {
    return { deletedEventCount: 0, deletedRunCount: 0 };
  }

  params.uiProjection.deleteRowsForRuns(params.conversationId, runIds);
  params.eventAssetLinks.deleteForRuns(runIds);
  new SqliteSubrunTraceHistoryCleanup(params.db).deleteForParentRunIds(runIds);

  const placeholders = runIds.map(() => '?').join(',');
  const deletedEventCount = params.db
    .prepare(`DELETE FROM events WHERE run_id IN (${placeholders})`)
    .run(...runIds)
    .changes;
  const deletedRunCount = params.db
    .prepare(`DELETE FROM runs WHERE id IN (${placeholders})`)
    .run(...runIds)
    .changes;

  return { deletedEventCount, deletedRunCount };
}
