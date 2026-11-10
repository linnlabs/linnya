import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { migrateV74ToV75RetireWorkspaceNodeTags } from '../v74-to-v75-retire-workspace-node-tags';
import { migrateV75ToV76ActionLedgerAgent } from '../v75-to-v76-action-ledger-agent';

it('v74→v75 删除 workspace_nodes.tags，其余列与数据不变；没有这一列时不做事', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE workspace_nodes (id TEXT PRIMARY KEY, name TEXT NOT NULL, access_count INTEGER NOT NULL DEFAULT 0, tags TEXT);
      INSERT INTO workspace_nodes VALUES ('doc', '报告.md', 3, '{"linnyaRole":"resource_library"}');`);
    db.transaction(() => migrateV74ToV75RetireWorkspaceNodeTags(db))();
    expect(db.prepare('SELECT * FROM workspace_nodes').all()).toEqual([{ id: 'doc', name: '报告.md', access_count: 3 }]);
    db.transaction(() => migrateV74ToV75RetireWorkspaceNodeTags(db))();
    expect(db.prepare("SELECT name FROM pragma_table_info('workspace_nodes')").all().map(row => (row as { name: string }).name))
      .toEqual(['id', 'name', 'access_count']);
  } finally {
    db.close();
  }
});

it('v75→v76 账本加 agent_id，从仍在的运行记录回填；运行已删除或不是运行的记录留空', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE runs (id TEXT PRIMARY KEY, agent_spec_id TEXT);
      INSERT INTO runs VALUES ('run-a', 'research_v1'), ('run-b', NULL);
      CREATE TABLE action_ledger_entries (id INTEGER PRIMARY KEY, actor_kind TEXT NOT NULL, run_id TEXT);
      INSERT INTO action_ledger_entries VALUES (1, 'run', 'run-a'), (2, 'run', 'run-b'), (3, 'run', 'run-gone'), (4, 'user', NULL);`);
    db.transaction(() => migrateV75ToV76ActionLedgerAgent(db))();
    expect(db.prepare('SELECT id, agent_id FROM action_ledger_entries ORDER BY id').all()).toEqual([
      { id: 1, agent_id: 'research_v1' },
      { id: 2, agent_id: null },
      { id: 3, agent_id: null },
      { id: 4, agent_id: null },
    ]);
    // 已带这一列（v73→v74 按当前 DDL 重建过）时仍回填空值，不重复加列。
    db.exec("UPDATE action_ledger_entries SET agent_id = NULL WHERE id = 1");
    db.transaction(() => migrateV75ToV76ActionLedgerAgent(db))();
    expect(db.prepare('SELECT agent_id FROM action_ledger_entries WHERE id = 1').get()).toEqual({ agent_id: 'research_v1' });
  } finally {
    db.close();
  }
});
