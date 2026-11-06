import type Database from 'better-sqlite3';
import { CONVERSATION_SCHEMAS } from '../../../../app-hosts/linnya/adapters/persistence/event-store/conversation.schema';

/** 消息行是可重建投影；只有正式 projector 知道哪次输出或审批表单贡献了每个字段。 */
export function migrateV71ToV72ToolResultSources(db: Database.Database): void {
  db.exec('DROP TABLE conversation_ui_messages');
  for (const statement of CONVERSATION_SCHEMAS) db.exec(statement);
  db.prepare("UPDATE conversation_ui_projection_state SET status = 'pending'").run();
}
