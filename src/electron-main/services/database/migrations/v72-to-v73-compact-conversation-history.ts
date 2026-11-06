import type Database from 'better-sqlite3';
import {
  compactExistingSubrunTraceBodies,
  SUBRUN_TRACE_BODY_SCHEMA,
} from '../../../../app-hosts/linnya/adapters/persistence/subrun-trace-history/functions/subrunTraceBodyStorage';

/** 三类载荷一起迁移；runner 在同一事务内更新数据与 user_version。 */
export function migrateV72ToV73CompactConversationHistory(db: Database.Database): void {
  for (const sql of SUBRUN_TRACE_BODY_SCHEMA) db.exec(sql);
  compactExistingSubrunTraceBodies(db);
  db.exec(`
    UPDATE events SET payload = json_set(json_remove(payload, '$.payload.args'),
      '$.__linnya_shared_tool_args', json('true'))
    WHERE type = 'tool_call_decision' AND payload -> '$.args' = payload -> '$.payload.args';
    UPDATE conversation_ui_projection_state SET status = 'pending'
    WHERE conversation_id IN (SELECT conversation_id FROM conversation_ui_messages WHERE message_type = 'thought');
  `);
}
