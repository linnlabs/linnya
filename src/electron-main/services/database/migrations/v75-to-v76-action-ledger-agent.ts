import type Database from 'better-sqlite3';

/**
 * 行动账本加 Agent 身份。对话删除会级联删掉运行记录，账本里不存 Agent 就答不出“这份文档是哪个 Agent 改的”。
 * 只加列；已有记录能从仍在的运行记录回填的回填，查不到的留空。
 * v73→v74 按当前 DDL 重建账本时已带上这一列，所以回填不以“刚加列”为条件。
 */
export function migrateV75ToV76ActionLedgerAgent(db: Database.Database): void {
  const hasAgent = db.prepare("SELECT 1 FROM pragma_table_info('action_ledger_entries') WHERE name = 'agent_id'").get();
  if (!hasAgent) db.exec('ALTER TABLE action_ledger_entries ADD COLUMN agent_id TEXT');
  db.exec(`
    UPDATE action_ledger_entries
    SET agent_id = (SELECT runs.agent_spec_id FROM runs WHERE runs.id = action_ledger_entries.run_id)
    WHERE run_id IS NOT NULL AND agent_id IS NULL
  `);
}
