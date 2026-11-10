import type Database from 'better-sqlite3';
import { planDocumentVersionRetention } from '../../../document-history';

/** 同一工具调用的多个部分构成一次改动，按整次改动保留，不能只剩半份细账。 */
export function pruneDocumentActions(db: Database.Database, documentId: string): void {
  const groups = db.prepare<[string], { lastId: number; recordedAt: number; ids: string }>(`
    SELECT MAX(id) AS lastId, MAX(recorded_at) AS recordedAt, json_group_array(id) AS ids
    FROM action_ledger_entries WHERE document_id = ?
    GROUP BY run_id, tool_call_id, CASE WHEN tool_call_id IS NULL THEN id END
    ORDER BY lastId DESC
  `).all(documentId);
  const plan = planDocumentVersionRetention(groups.map((group, index) => ({
    versionId: String(group.lastId), order: group.lastId, createdAt: group.recordedAt, isCurrent: index === 0,
  })));
  const removed = new Set(plan.removeVersionIds);
  const remove = db.prepare('DELETE FROM action_ledger_entries WHERE id IN (SELECT value FROM json_each(?))');
  for (const group of groups) {
    if (removed.has(String(group.lastId))) remove.run(group.ids);
  }
}
