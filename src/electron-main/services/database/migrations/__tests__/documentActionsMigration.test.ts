import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { ACTION_LEDGER_SCHEMAS } from 'src/domains/action-ledger/infrastructure/sqlite/actionLedger.schema';
import { migrateV73ToV74DocumentActions } from '../v73-to-v74-document-actions';

it('v73 已转移文档保留原项目记录，升级后删除原项目不会删除新项目的文档历史', () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY);
      CREATE TABLE workspace_nodes (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE);
      INSERT INTO projects VALUES ('old'), ('new'); INSERT INTO workspace_nodes VALUES ('doc', 'new');`);
    db.exec(ACTION_LEDGER_SCHEMAS[0].replace('project_id TEXT NOT NULL,',
      'project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,'));
    for (const ddl of ACTION_LEDGER_SCHEMAS.slice(1)) db.exec(ddl);
    db.exec(`INSERT INTO action_ledger_entries (id, recorded_at, project_id, document_id, document_type, action, granularity, actor_kind)
      VALUES (42, 100, 'old', 'doc', 'document', 'update', 'coarse', 'user')`);
    db.transaction(() => migrateV73ToV74DocumentActions(db))();
    db.exec("DELETE FROM projects WHERE id = 'old'");
    expect(db.prepare('SELECT id, project_id, document_id FROM action_ledger_entries').get())
      .toEqual({ id: 42, project_id: 'old', document_id: 'doc' });
    expect(db.pragma('foreign_key_check')).toEqual([]);
    db.exec("DELETE FROM projects WHERE id = 'new'");
    expect(db.prepare('SELECT id FROM action_ledger_entries').all()).toEqual([]);
  } finally {
    db.close();
  }
});
