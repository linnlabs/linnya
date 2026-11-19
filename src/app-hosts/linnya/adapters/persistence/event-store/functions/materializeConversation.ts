import type Database from 'better-sqlite3';

/**
 * 草稿对话第一次落库：只建身份行，预览、统计等由之后的事件补齐；已存在时不动。
 * 在草稿上选 Agent、改命令档位都经过这里，对话表只有事件库这一个写入方。
 */
export function materializeConversation(
  db: Database.Database,
  input: { readonly conversationId: string; readonly projectId: string | null; readonly at: number },
): void {
  db.prepare(`
    INSERT INTO conversations (conversation_id, project_id, created_at, last_event_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(conversation_id) DO NOTHING
  `).run(input.conversationId, input.projectId, input.at, input.at);
}
