import type Database from 'better-sqlite3';
import { readRuntimeEventsByIds } from './readRuntimeEventsByIds';

/** 等待事实与断点同事务，但不属于模型 history；按原 run/revision 从事实 owner 读取。 */
export function readRunCheckpointInteractions(
  db: Database.Database,
  conversationId: string,
  runId: string,
  revision: number
) {
  const rows = db
    .prepare<[string, number], { id: string }>(
      `
    SELECT id FROM events WHERE run_id = ? AND type = 'requires_user_interaction'
    AND json_extract(payload, '$.checkpoint_revision') = ? LIMIT 2
  `
    )
    .all(runId, revision);
  if (rows.length !== 1)
    throw new Error('Waiting checkpoint must have exactly one committed interaction');
  return readRuntimeEventsByIds(
    db,
    conversationId,
    rows.map(row => row.id)
  );
}
