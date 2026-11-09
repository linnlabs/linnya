import type Database from 'better-sqlite3';

/**
 * 读一个项目里若干对话的标题。只返回仍属于该项目的对话：已删除或转到别处的对话不给标题，
 * 调用方不能借此看到其他项目的对话。
 */
export function readProjectConversationTitles(
  db: Database.Database,
  projectId: string,
  conversationIds: readonly string[],
): Map<string, string> {
  const titles = new Map<string, string>();
  if (conversationIds.length === 0) return titles;
  const rows = db.prepare<[string, string], { conversation_id: string; title: string }>(`
    SELECT conversation_id, title FROM conversations
    WHERE project_id = ? AND conversation_id IN (SELECT value FROM json_each(?))
  `).all(projectId, JSON.stringify([...new Set(conversationIds)]));
  for (const row of rows) titles.set(row.conversation_id, row.title);
  return titles;
}
