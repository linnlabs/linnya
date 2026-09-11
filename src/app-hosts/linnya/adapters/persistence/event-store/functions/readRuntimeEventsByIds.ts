import type Database from 'better-sqlite3';
import type { RoutedRuntimeEvent } from '@linnlabs/linnkit/contracts';
import { parseStoredRuntimeEvent } from './runtimeEventStorageCodec';

interface ReferencedEventRow {
  id: string;
  type: string;
  payload: string;
  ts: number;
  run_id: string;
  parent_run_id: string | null;
}

/** 按原输入引用与原顺序重建，不把恢复后新增的会话历史注入旧 run。 */
export function readRuntimeEventsByIds(
  db: Database.Database,
  conversationId: string,
  eventIds: readonly string[]
): RoutedRuntimeEvent[] {
  const statement = db.prepare<[string, string], ReferencedEventRow>(`
    SELECT e.id, e.type, e.payload, e.ts, e.run_id, r.parent_run_id
    FROM events e JOIN runs r ON r.id = e.run_id
    WHERE e.id = ? AND r.conversation_id = ?
  `);
  return eventIds.map(id => {
    const row = statement.get(id, conversationId);
    if (!row) throw new Error(`Required run input event unavailable: ${id}`);
    return parseStoredRuntimeEvent(row.payload, {
      eventId: row.id,
      eventType: row.type,
      conversationId,
      runId: row.run_id,
      parentRunId: row.parent_run_id,
      timestamp: row.ts,
    });
  });
}
