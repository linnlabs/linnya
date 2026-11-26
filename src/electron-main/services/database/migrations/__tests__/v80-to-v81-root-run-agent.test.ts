import Database from 'better-sqlite3';
import { afterEach, expect, it } from 'vitest';
import { migrateV80ToV81RootRunAgent } from '../v80-to-v81-root-run-agent';

const databases: Database.Database[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

/** v80 的三张表只保留回填用到的列；运行表里 conv-gone 的运行已随对话删除。 */
function v80Database(): Database.Database {
  const db = new Database(':memory:');
  databases.push(db);
  db.exec(`
    CREATE TABLE runs (id TEXT PRIMARY KEY, parent_run_id TEXT, agent_spec_id TEXT);
    INSERT INTO runs VALUES
      ('root', NULL, 'default'), ('child', 'root', 'subagent_general'), ('grandchild', 'child', 'subagent_general'),
      ('orphan', 'root-gone', 'subagent_general');
    CREATE TABLE action_ledger_entries (
      id INTEGER PRIMARY KEY, actor_kind TEXT NOT NULL, run_id TEXT, root_run_id TEXT, agent_id TEXT
    );
    INSERT INTO action_ledger_entries VALUES
      (1, 'subrun', 'child', 'root', 'subagent_general'),
      (2, 'run', 'root', 'root', 'default'),
      (3, 'run', 'research-root', 'research-root', 'research_v1'),
      (4, 'subrun', 'research-child', 'research-root', 'subagent_general'),
      (5, 'subrun', 'lost-child', 'lost-root', 'subagent_general'),
      (6, 'user', NULL, NULL, NULL);
    CREATE TABLE semantic_tags (id TEXT PRIMARY KEY, created_by_kind TEXT, created_agent_id TEXT);
    INSERT INTO semantic_tags VALUES ('t-run', 'run', 'research_v1'), ('t-subrun', 'subrun', 'subagent_general'), ('t-old', NULL, NULL);
    CREATE TABLE semantic_schema_changes (id TEXT PRIMARY KEY, actor_kind TEXT NOT NULL, run_id TEXT, agent_id TEXT, undone_at INTEGER);
    INSERT INTO semantic_schema_changes VALUES
      ('c-run', 'run', 'research-root', 'research_v1', NULL),
      ('c-grandchild', 'subrun', 'grandchild', 'subagent_general', NULL),
      ('c-orphan', 'subrun', 'orphan', 'subagent_general', NULL),
      ('c-user', 'user', NULL, NULL, NULL);
  `);
  return db;
}

it('v80→v81 补根运行 Agent：能确定的历史行回填，确定不了的留空、界面退回“子任务”；重跑不改已有值', () => {
  const db = v80Database();
  db.transaction(() => migrateV80ToV81RootRunAgent(db))();

  expect(db.prepare('SELECT id, root_agent_id FROM action_ledger_entries ORDER BY id').all()).toEqual([
    { id: 1, root_agent_id: 'default' },
    { id: 2, root_agent_id: 'default' },
    // research-root 的运行记录已随对话删除，根运行自己的账本行登记时记下了它的 Agent。
    { id: 3, root_agent_id: 'research_v1' },
    { id: 4, root_agent_id: 'research_v1' },
    // 根运行既不在运行表、也没有自己的账本行：查不回发起者。
    { id: 5, root_agent_id: null },
    { id: 6, root_agent_id: null },
  ]);
  // 标签不记运行编号，子任务建的标签查不回发起者。
  expect(db.prepare('SELECT id, created_root_agent_id FROM semantic_tags ORDER BY id').all()).toEqual([
    { id: 't-old', created_root_agent_id: null },
    { id: 't-run', created_root_agent_id: 'research_v1' },
    { id: 't-subrun', created_root_agent_id: null },
  ]);
  // 改动批次沿父运行链找根；中间运行已删除时链条中断，留空。
  expect(db.prepare('SELECT id, root_agent_id FROM semantic_schema_changes ORDER BY id').all()).toEqual([
    { id: 'c-grandchild', root_agent_id: 'default' },
    { id: 'c-orphan', root_agent_id: null },
    { id: 'c-run', root_agent_id: 'research_v1' },
    { id: 'c-user', root_agent_id: null },
  ]);

  // 中途失败后重跑：列已存在时不重复加，只补仍为空的行，已有值不动。
  db.exec("UPDATE action_ledger_entries SET root_agent_id = 'kept' WHERE id = 1; UPDATE action_ledger_entries SET root_agent_id = NULL WHERE id = 2");
  db.transaction(() => migrateV80ToV81RootRunAgent(db))();
  expect(db.prepare('SELECT id, root_agent_id FROM action_ledger_entries WHERE id IN (1, 2) ORDER BY id').all()).toEqual([
    { id: 1, root_agent_id: 'kept' },
    { id: 2, root_agent_id: 'default' },
  ]);
});

it('v80→v81 中途失败时整步回滚，三张表都不留新列', () => {
  const db = v80Database();
  db.exec('DROP TABLE semantic_schema_changes');
  expect(() => db.transaction(() => migrateV80ToV81RootRunAgent(db))()).toThrow();
  const columns = (table: string) => db.prepare<[], { name: string }>(`SELECT name FROM pragma_table_info('${table}')`).all()
    .map(row => row.name);
  expect(columns('action_ledger_entries')).not.toContain('root_agent_id');
  expect(columns('semantic_tags')).not.toContain('created_root_agent_id');
});
