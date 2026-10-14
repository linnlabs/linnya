import type { MigrationFunction } from './types';

/** 保留全部运行事实；扩展 child 通知 kind，并由正式 projector 重建原 error 的 UI 行。 */
export const migrateV64ToV65ConversationExecutionNotices: MigrationFunction = db => {
  db.exec(`
    CREATE TABLE subrun_trace_items_v65 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subrun_id TEXT NOT NULL,
      source_event_id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK(kind IN ('thought_complete', 'tool_call_decision', 'tool_output', 'final_answer', 'history_summary', 'llm_retry', 'error')),
      timestamp INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY(subrun_id) REFERENCES subrun_trace_runs(subrun_id) ON DELETE CASCADE
    );
    INSERT INTO subrun_trace_items_v65 (id, subrun_id, source_event_id, kind, timestamp, payload_json)
    SELECT id, subrun_id, source_event_id, kind, timestamp, payload_json FROM subrun_trace_items;
    DROP TABLE subrun_trace_items;
    ALTER TABLE subrun_trace_items_v65 RENAME TO subrun_trace_items;
    CREATE INDEX idx_subrun_trace_items_subrun_order ON subrun_trace_items(subrun_id, id);
    UPDATE conversation_ui_projection_state SET status = 'pending';
  `);
};
