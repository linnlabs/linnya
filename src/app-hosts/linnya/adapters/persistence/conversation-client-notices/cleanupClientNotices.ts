import type Database from 'better-sqlite3';

/** 截断后的 notice 不应在下次 read-model 重建时复活；必须和原始事实一起删除。 */
export function deleteClientNoticesFromRuns(
  db: Database.Database,
  conversationId: string,
  runIds: readonly string[],
): void {
  if (runIds.length === 0) return;
  const placeholders = runIds.map(() => '?').join(',');
  const first = db.prepare<unknown[], { first_rowid: number | null }>(
    `SELECT MIN(rowid) AS first_rowid FROM events WHERE run_id IN (${placeholders})`,
  ).get(...runIds)?.first_rowid;
  if (first === null || first === undefined) return;
  db.prepare(`DELETE FROM conversation_ui_messages WHERE conversation_id = ? AND message_id IN (
    SELECT 'client-notice:' || notice_id FROM conversation_client_notices
    WHERE conversation_id = ? AND anchor_event_rowid >= ?
  )`).run(conversationId, conversationId, first);
  // 已接纳但 ACK 丢失的客户端稍后仍会补送同 UUID；tombstone 阻止截断历史被再次接纳。
  db.prepare(`UPDATE conversation_client_notices SET retained = 0
    WHERE conversation_id = ? AND anchor_event_rowid >= ?`).run(conversationId, first);
}
