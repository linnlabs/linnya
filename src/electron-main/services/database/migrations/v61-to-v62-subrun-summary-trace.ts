import type Database from 'better-sqlite3';

/** 扩展紧凑 Subrun 历史的正式 kind；SQLite CHECK 只能通过重建表更新。 */
export function migrateV61ToV62SubrunSummaryTrace(db: Database.Database): void {
  db.exec(`
    CREATE TABLE subrun_trace_items_v62 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subrun_id TEXT NOT NULL,
      source_event_id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK(kind IN (
        'thought_complete',
        'tool_call_decision',
        'tool_output',
        'final_answer',
        'history_summary'
      )),
      timestamp INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY(subrun_id) REFERENCES subrun_trace_runs(subrun_id) ON DELETE CASCADE
    );

    INSERT INTO subrun_trace_items_v62 (
      id,
      subrun_id,
      source_event_id,
      kind,
      timestamp,
      payload_json
    )
    SELECT
      id,
      subrun_id,
      source_event_id,
      kind,
      timestamp,
      payload_json
    FROM subrun_trace_items;

    DROP TABLE subrun_trace_items;
    ALTER TABLE subrun_trace_items_v62 RENAME TO subrun_trace_items;
  `);
}
