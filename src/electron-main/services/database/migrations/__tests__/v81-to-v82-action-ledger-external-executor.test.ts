import Database from 'better-sqlite3';
import { afterEach, expect, it } from 'vitest';
import { migrateV81ToV82ActionLedgerExternalExecutor } from '../v81-to-v82-action-ledger-external-executor';

const databases: Database.Database[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

it('v81→v82 给账本补外部执行者一列：旧行留空（此前没人报过名称），重跑不报错也不改已有值', () => {
  const db = new Database(':memory:');
  databases.push(db);
  db.exec(`
    CREATE TABLE action_ledger_entries (
      id INTEGER PRIMARY KEY, actor_kind TEXT NOT NULL, run_id TEXT, root_run_id TEXT, agent_id TEXT, root_agent_id TEXT
    );
    INSERT INTO action_ledger_entries VALUES
      (1, 'external', 'cli-run', 'cli-run', NULL, NULL),
      (2, 'run', 'root', 'root', 'default', 'default');
  `);

  db.transaction(() => migrateV81ToV82ActionLedgerExternalExecutor(db))();
  expect(db.prepare('SELECT id, external_executor FROM action_ledger_entries ORDER BY id').all()).toEqual([
    { id: 1, external_executor: null },
    { id: 2, external_executor: null },
  ]);
  // 新列接在最后，与新建库的 DDL 列序一致。
  expect(db.prepare("SELECT name FROM pragma_table_info('action_ledger_entries') ORDER BY cid DESC LIMIT 1").pluck().get())
    .toBe('external_executor');

  db.prepare("UPDATE action_ledger_entries SET external_executor = 'Codex' WHERE id = 1").run();
  db.transaction(() => migrateV81ToV82ActionLedgerExternalExecutor(db))();
  expect(db.prepare('SELECT external_executor FROM action_ledger_entries WHERE id = 1').pluck().get()).toBe('Codex');
});
