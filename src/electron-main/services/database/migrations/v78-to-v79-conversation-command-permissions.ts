import type Database from 'better-sqlite3';
import { CONVERSATION_SCHEMAS } from '../../../../app-hosts/linnya/adapters/persistence/event-store/conversation.schema';
import { READABLE_CONVERSATION_VIEW } from '../../../../app-hosts/linnya/adapters/persistence/readable-conversation/readableConversation.schema';

const UI_MESSAGE_COLUMNS = [
  'message_id', 'conversation_id', 'turn_id', 'role', 'message_type', 'sort_seq', 'timestamp', 'content',
  'attachments_json', 'payload_json', 'merge_key', 'presentation', 'run_id', 'content_event_id', 'data_event_id',
].join(', ');

/**
 * 只取界面消息表本身和它的索引。整套 conversation DDL 里还有可读消息的触发器，
 * 若在搬行前建立，会把已索引的行再写进全文索引一遍。
 */
const UI_MESSAGE_TABLE_AND_INDEX_DDL = CONVERSATION_SCHEMAS.filter(statement =>
  /^\s*CREATE TABLE IF NOT EXISTS conversation_ui_messages\s*\(/.test(statement)
  || /^\s*CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+\S+\s+ON\s+conversation_ui_messages\s*\(/.test(statement));

function hasTable(db: Database.Database, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

/** v78 的运行描述符只可能由全局档位生成。恢复继续使用已冻结的旧档。 */
function addBaseSourceToRunDescriptors(db: Database.Database): void {
  if (!hasTable(db, 'agent_run_descriptors')) return;
  db.exec(`
    UPDATE agent_run_descriptors
    SET descriptor_json = json_set(
      descriptor_json,
      '$.commandPermission.snapshot.source', 'global_setting',
      '$.commandPermission.snapshot.conversation_revision', 0
    )
    WHERE CASE WHEN json_valid(descriptor_json) THEN
      json_extract(descriptor_json, '$.schemaVersion') = 1
      AND json_extract(descriptor_json, '$.commandPermission.status') = 'available'
      AND json_type(descriptor_json, '$.commandPermission.snapshot') = 'object'
      AND json_type(descriptor_json, '$.commandPermission.snapshot.source') IS NULL
      AND json_type(descriptor_json, '$.commandPermission.snapshot.conversation_revision') IS NULL
    ELSE 0 END
  `);
}

/**
 * 档位变更记录与客户端提示一样不属于任何运行。表约束只能整表重建才能放宽：
 * 已有行连同 rowid 原样搬到新表，界面投影仍是 ready，全文索引按 rowid 引用，不需要重建。
 * 旧表的触发器随旧表删除，迁移后由 provider 重新建立（搬行时没有触发器，全文索引不会重复写入）；
 * 视图先删后建，避免改名时引用失效。
 */
function allowCommandPermissionChangeRows(db: Database.Database): void {
  if (!hasTable(db, 'conversation_ui_messages')) return;
  db.exec('DROP VIEW IF EXISTS conversation_readable_messages');
  db.exec('ALTER TABLE conversation_ui_messages RENAME TO conversation_ui_messages_v78');
  const indexes = db.prepare<[], { name: string }>(`
    SELECT name FROM sqlite_master
    WHERE type = 'index' AND tbl_name = 'conversation_ui_messages_v78' AND sql IS NOT NULL
  `).all();
  for (const { name } of indexes) db.exec(`DROP INDEX "${name.split('"').join('""')}"`);
  if (!UI_MESSAGE_TABLE_AND_INDEX_DDL.some(statement => /CREATE TABLE/.test(statement))) {
    throw new Error('[Migration v78->v79] conversation_ui_messages DDL not found');
  }
  for (const statement of UI_MESSAGE_TABLE_AND_INDEX_DDL) db.exec(statement);
  db.exec(`
    INSERT INTO conversation_ui_messages (rowid, ${UI_MESSAGE_COLUMNS})
    SELECT rowid, ${UI_MESSAGE_COLUMNS} FROM conversation_ui_messages_v78 ORDER BY rowid
  `);
  db.exec('DROP TABLE conversation_ui_messages_v78');
  db.exec(READABLE_CONVERSATION_VIEW);
}

export function migrateV78ToV79ConversationCommandPermissions(db: Database.Database): void {
  addBaseSourceToRunDescriptors(db);
  allowCommandPermissionChangeRows(db);
}
