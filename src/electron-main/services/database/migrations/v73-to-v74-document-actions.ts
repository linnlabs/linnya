import type Database from 'better-sqlite3';
import { ACTION_LEDGER_SCHEMAS } from '../../../../domains/action-ledger/infrastructure/sqlite/actionLedger.schema';
import { pruneDocumentActions } from '../../../../domains/action-ledger/infrastructure/sqlite/pruneDocumentActions';

/** 初版账本的项目外键会随原项目误删已转移文档的记录。没有初版账本的库已由 provider 建好当前表。 */
export function migrateV73ToV74DocumentActions(db: Database.Database): void {
  const oldProjectKey = db.prepare("SELECT 1 FROM pragma_foreign_key_list('action_ledger_entries') WHERE [from] = 'project_id'").get();
  if (!oldProjectKey) return;
  db.exec('ALTER TABLE action_ledger_entries RENAME TO previous_action_ledger_entries');
  db.exec(ACTION_LEDGER_SCHEMAS[0]);
  const columns = 'id, recorded_at, project_id, document_id, document_type, action, granularity, part, before_ref, after_ref, summary_json, actor_kind, actor_plugin_id, author_run_id, conversation_id, run_id, root_run_id, parent_run_id, tool_call_id';
  db.exec(`INSERT INTO action_ledger_entries (${columns}) SELECT ${columns} FROM previous_action_ledger_entries`);
  db.exec('DROP TABLE previous_action_ledger_entries');
  for (const ddl of ACTION_LEDGER_SCHEMAS) db.exec(ddl);
  for (const { documentId } of db.prepare<[], { documentId: string }>(
    'SELECT DISTINCT document_id AS documentId FROM action_ledger_entries'
  ).all()) pruneDocumentActions(db, documentId);
}
