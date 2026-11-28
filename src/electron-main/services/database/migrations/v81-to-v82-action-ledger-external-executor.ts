import type Database from 'better-sqlite3';

/**
 * 外部 Agent 经命令行改文档时自报一个名称，改动记录要显示“是谁经命令行改的”。
 * 对话删除会级联删掉运行记录，所以和 Agent 一样在登记时存进账本；这一步给账本补这一列。
 *
 * 不回填：此前的外部调用没有报过名称，没有可回填的事实，旧行留空，界面照旧显示 Linnya CLI。
 * 只加列，可重入；新建库的表由 provider 按当前 DDL 建好（已带这一列）。
 */
export function migrateV81ToV82ActionLedgerExternalExecutor(db: Database.Database): void {
  const exists = db
    .prepare("SELECT 1 FROM pragma_table_info('action_ledger_entries') WHERE name = 'external_executor'")
    .get();
  if (!exists) db.exec('ALTER TABLE action_ledger_entries ADD COLUMN external_executor TEXT');
}
