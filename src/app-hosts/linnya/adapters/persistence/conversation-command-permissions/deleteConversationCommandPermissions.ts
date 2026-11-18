import type Database from 'better-sqlite3';

export function deleteConversationCommandPermissions(db: Database.Database, conversationId: string): void {
  db.prepare('DELETE FROM conversation_command_permissions WHERE conversation_id = ?').run(conversationId);
  db.prepare('DELETE FROM conversation_command_permission_changes WHERE conversation_id = ?').run(conversationId);
  db.prepare('DELETE FROM conversation_run_command_permissions WHERE conversation_id = ?').run(conversationId);
}
