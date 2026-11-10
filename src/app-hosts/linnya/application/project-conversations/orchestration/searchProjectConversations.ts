import type Database from 'better-sqlite3';
import {
  PROJECT_CONVERSATIONS_SEARCH_LIMIT,
  type ProjectConversationSearchMatch,
  type ProjectConversationsSearch,
  type ProjectConversationsSearchRequest,
} from '@app/schemas';
import { buildReadableConversationMatch } from 'src/app-hosts/linnya/adapters/persistence/readable-conversation/readableConversationMatch';
import { excerptAroundMatch } from '../functions/conversationExcerpt';

/** 一个对话最多看多少条候选消息找出命中的那句。 */
const CANDIDATES_PER_CONVERSATION = 20;

/**
 * 按标题和可读内容搜项目里的对话。三字以上用全文索引缩小候选，不足三字逐条扫描可读消息；
 * 是否命中都按字面（忽略大小写）再比较一次。标题命中排在前面。
 */
export function searchProjectConversations(
  db: Database.Database,
  request: ProjectConversationsSearchRequest,
): ProjectConversationsSearch {
  const query = request.query.trim();
  const needle = query.toLowerCase();
  const matches = new Map<string, ProjectConversationSearchMatch>();

  const conversations = db.prepare<[string], { conversation_id: string; title: string }>(
    'SELECT conversation_id, title FROM conversations WHERE project_id = ? ORDER BY last_event_at DESC',
  ).all(request.project_id);
  for (const conversation of conversations) {
    if (conversation.title.toLowerCase().includes(needle)) {
      matches.set(conversation.conversation_id, { conversation_id: conversation.conversation_id, excerpt: null });
    }
  }

  const match = buildReadableConversationMatch(query);
  const candidates = match === null
    ? db.prepare<[string, string], { conversation_id: string; content: string }>(`
        SELECT m.conversation_id, m.content FROM conversation_readable_messages m
        JOIN conversations c ON c.conversation_id = m.conversation_id
        WHERE c.project_id = ? AND instr(lower(m.content), ?) > 0
        ORDER BY c.last_event_at DESC, m.sort_seq
      `).all(request.project_id, needle)
    : db.prepare<[string, string], { conversation_id: string; content: string }>(`
        SELECT m.conversation_id, m.content FROM conversation_readable_fts f
        JOIN conversation_readable_messages m ON m.message_rowid = f.rowid
        JOIN conversations c ON c.conversation_id = m.conversation_id
        WHERE conversation_readable_fts MATCH ? AND c.project_id = ?
        ORDER BY c.last_event_at DESC, m.sort_seq
      `).all(match, request.project_id);

  const seen = new Map<string, number>();
  for (const candidate of candidates) {
    const existing = matches.get(candidate.conversation_id);
    if (existing && existing.excerpt !== null) continue;
    const checked = seen.get(candidate.conversation_id) ?? 0;
    if (checked >= CANDIDATES_PER_CONVERSATION) continue;
    seen.set(candidate.conversation_id, checked + 1);
    const excerpt = excerptAroundMatch(candidate.content, query);
    if (excerpt === null) continue;
    matches.set(candidate.conversation_id, { conversation_id: candidate.conversation_id, excerpt });
  }

  const ordered = [...matches.values()];
  return {
    matches: ordered.slice(0, PROJECT_CONVERSATIONS_SEARCH_LIMIT),
    truncated: ordered.length > PROJECT_CONVERSATIONS_SEARCH_LIMIT,
  };
}
