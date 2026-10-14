import type Database from 'better-sqlite3';
import { CONVERSATION_SCHEMAS } from '../../../../app-hosts/linnya/adapters/persistence/event-store/conversation.schema';

/** 只重建可再生 UI 表；Runtime facts、模型上下文和已有 client facts 都保持原样。 */
export function migrateV65ToV66ConversationClientNotice(db: Database.Database): void {
  db.exec('DROP TABLE conversation_ui_messages');
  for (const statement of CONVERSATION_SCHEMAS) db.exec(statement);
  db.prepare("UPDATE conversation_ui_projection_state SET status = 'pending'").run();
}
