import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { migrateV64ToV65ConversationExecutionNotices } from '../v64-to-v65-conversation-execution-notices';

it('preserves child trace identities, enables retry kinds and makes historical errors rebuildable atomically', () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE subrun_trace_runs (subrun_id TEXT PRIMARY KEY);
      INSERT INTO subrun_trace_runs VALUES ('child');
      CREATE TABLE subrun_trace_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT, subrun_id TEXT NOT NULL,
        source_event_id TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL CHECK(kind IN ('thought_complete','tool_call_decision','tool_output','final_answer','history_summary')),
        timestamp INTEGER NOT NULL, payload_json TEXT NOT NULL,
        FOREIGN KEY(subrun_id) REFERENCES subrun_trace_runs(subrun_id) ON DELETE CASCADE
      );
      CREATE INDEX idx_subrun_trace_items_subrun_order ON subrun_trace_items(subrun_id,id);
      INSERT INTO subrun_trace_items VALUES (7,'child','source','final_answer',1,'{"content":"saved"}');
      CREATE TABLE conversation_ui_projection_state (conversation_id TEXT PRIMARY KEY,status TEXT NOT NULL);
      INSERT INTO conversation_ui_projection_state VALUES ('conversation','ready');
    `);
    const original = db.prepare('SELECT * FROM subrun_trace_items').all();
    expect(() =>
      db.transaction(() => {
        migrateV64ToV65ConversationExecutionNotices(db);
        throw new Error('interrupt');
      })()
    ).toThrow('interrupt');
    expect(db.prepare('SELECT * FROM subrun_trace_items').all()).toEqual(original);
    expect(db.prepare('SELECT status FROM conversation_ui_projection_state').get()).toEqual({
      status: 'ready',
    });
    db.transaction(() => migrateV64ToV65ConversationExecutionNotices(db))();
    expect(db.prepare('SELECT * FROM subrun_trace_items').all()).toEqual(original);
    db.prepare(
      'INSERT INTO subrun_trace_items (subrun_id,source_event_id,kind,timestamp,payload_json) VALUES (?,?,?,?,?)'
    ).run('child', 'retry', 'llm_retry', 2, '{}');
    expect(
      db.prepare('SELECT id FROM subrun_trace_items WHERE source_event_id=?').get('retry')
    ).toEqual({ id: 8 });
    expect(db.prepare('SELECT status FROM conversation_ui_projection_state').get()).toEqual({
      status: 'pending',
    });
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_subrun_trace_items_subrun_order'"
        )
        .get()
    ).toBeDefined();
    db.prepare('DELETE FROM subrun_trace_runs').run();
    expect(db.prepare('SELECT * FROM subrun_trace_items').all()).toEqual([]);
  } finally {
    db.close();
  }
});
