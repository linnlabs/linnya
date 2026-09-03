import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { migrateV62ToV63CitationFactIndex } from '../v62-to-v63-citation-fact-index';

describe('v62 -> v63 citation fact index migration', () => {
  it('把已有 UI projection 标记为 pending，由正式 rebuild 填充新派生索引', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE subrun_trace_runs (
        subrun_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        parent_run_id TEXT,
        parent_tool_call_id TEXT NOT NULL,
        subrun_parent_id TEXT,
        child_run_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE conversation_ui_projection_state (
        conversation_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        revision INTEGER NOT NULL,
        last_event_rowid INTEGER NOT NULL,
        rebuilt_at INTEGER
      );
      INSERT INTO conversation_ui_projection_state (
        conversation_id,
        status,
        revision,
        last_event_rowid,
        rebuilt_at
      ) VALUES
        ('conversation-ready', 'ready', 7, 12, 100),
        ('conversation-pending', 'pending', 3, 4, NULL);
    `);

    migrateV62ToV63CitationFactIndex(db);
    migrateV62ToV63CitationFactIndex(db);

    expect(
      db
        .prepare(
          `
      SELECT conversation_id, status, revision
      FROM conversation_ui_projection_state
      ORDER BY conversation_id
    `
        )
        .all()
    ).toEqual([
      { conversation_id: 'conversation-pending', status: 'pending', revision: 3 },
      { conversation_id: 'conversation-ready', status: 'pending', revision: 7 },
    ]);
    expect(db.prepare('PRAGMA table_info(subrun_trace_runs)').all()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'child_run_id' })])
    );
    db.close();
  });
});
