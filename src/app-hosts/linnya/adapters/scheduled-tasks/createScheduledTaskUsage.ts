import type Database from 'better-sqlite3';
import { SqliteRunCostStateStore } from '../token-accounting';

export function createScheduledTaskUsage(db: Database.Database) {
  const costs = new SqliteRunCostStateStore(db);
  const storage = db.prepare<[string], { bytes: number | null }>(`
    SELECT SUM(s.record_bytes + s.attachment_bytes + COALESCE(s.work_file_bytes, 0)) AS bytes
    FROM scheduled_task_runs r JOIN conversation_storage_usage s ON s.conversation_id = r.conversation_id
    WHERE r.task_id = ?
  `);
  return {
    tokens(runId: string): number | null {
      const root = costs.load(runId);
      if (!root) return null;
      let total = root.tokensInput + root.tokensOutput;
      const descendants = [...root.childRunIds];
      for (const id of descendants) {
        const cost = costs.load(id);
        if (!cost) continue;
        total += cost.tokensInput + cost.tokensOutput;
        descendants.push(...cost.childRunIds);
      }
      return total;
    },
    storage: (taskId: string) => storage.get(taskId)?.bytes ?? null,
  };
}
