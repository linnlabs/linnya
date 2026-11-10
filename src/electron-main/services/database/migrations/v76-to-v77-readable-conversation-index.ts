import type Database from 'better-sqlite3';
import {
  READABLE_CONVERSATION_FTS_TABLE,
  READABLE_CONVERSATION_VIEW,
} from '../../../../app-hosts/linnya/adapters/persistence/readable-conversation/readableConversation.schema';

/**
 * 给已有对话的可读消息建全文索引。表随 provider 建立，视图和触发器本应在迁移之后建立，
 * 这里先在事务内建视图供整体重建使用；触发器随后由 provider 建立，此后新消息自动入索引。
 */
export function migrateV76ToV77ReadableConversationIndex(db: Database.Database): void {
  db.exec(READABLE_CONVERSATION_FTS_TABLE);
  db.exec(READABLE_CONVERSATION_VIEW);
  db.exec("INSERT INTO conversation_readable_fts(conversation_readable_fts) VALUES ('rebuild')");
}
