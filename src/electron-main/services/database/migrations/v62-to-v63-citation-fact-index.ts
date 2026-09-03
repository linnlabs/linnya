import type Database from 'better-sqlite3';

/**
 * 新索引表由 schema provider 建立；旧 UI projection 必须重建以填充 citation facts。
 * child_run_id 过去始终重复 subrun_id 且没有读者，v63 同步移除这份伪状态。
 */
export function migrateV62ToV63CitationFactIndex(db: Database.Database): void {
  const obsoleteColumn = db
    .prepare(
      `
      SELECT 1
      FROM pragma_table_info('subrun_trace_runs')
      WHERE name = 'child_run_id'
      LIMIT 1
    `
    )
    .get();
  if (obsoleteColumn) {
    db.exec('ALTER TABLE subrun_trace_runs DROP COLUMN child_run_id');
  }
  db.prepare(
    `
    UPDATE conversation_ui_projection_state
    SET status = 'pending'
  `
  ).run();
}
