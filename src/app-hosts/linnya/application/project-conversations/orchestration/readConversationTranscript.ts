import type Database from 'better-sqlite3';

/**
 * 读别的对话时能看到哪些对话。现在只有项目范围：项目里的 Agent 只看本项目的对话。
 * 以后跨项目的个人 Agent 另加范围种类，由调用方按授权传入，不在读取处写死。
 */
export type ConversationReadScope = { readonly kind: 'project'; readonly projectId: string };

export interface ConversationTranscriptMessage {
  readonly seq: number;
  readonly role: 'user' | 'assistant';
  /** 可读消息类型：用户输入、最终答复、工具前言、被中断的答复。 */
  readonly type: string;
  readonly at: number;
  readonly text: string;
}

export interface ConversationTranscriptPage {
  readonly conversationId: string;
  readonly title: string;
  readonly messages: readonly ConversationTranscriptMessage[];
  /** 还有更多消息时为下一页的起点（不含），否则为 null。 */
  readonly nextAfterSeq: number | null;
}

/**
 * 一个对话的可读全文（只含写给人看的消息，不含思考、工具调用与结果）。
 * 对话不在范围内时返回 null，与对话不存在不作区分。
 */
export function readConversationTranscript(
  db: Database.Database,
  input: {
    readonly scope: ConversationReadScope;
    readonly conversationId: string;
    readonly afterSeq?: number;
    readonly limit: number;
  },
): ConversationTranscriptPage | null {
  const conversation = db.prepare<[string, string], { conversation_id: string; title: string }>(
    'SELECT conversation_id, title FROM conversations WHERE conversation_id = ? AND project_id = ?',
  ).get(input.conversationId, input.scope.projectId);
  if (!conversation) return null;
  const rows = db.prepare<[string, number, number], { message_type: string; sort_seq: number; timestamp: number; content: string }>(`
    SELECT message_type, sort_seq, timestamp, content FROM conversation_readable_messages
    WHERE conversation_id = ? AND sort_seq > ?
    ORDER BY sort_seq
    LIMIT ?
  `).all(conversation.conversation_id, input.afterSeq ?? Number.MIN_SAFE_INTEGER, input.limit + 1);
  const page = rows.slice(0, input.limit);
  return {
    conversationId: conversation.conversation_id,
    title: conversation.title,
    messages: page.map(row => ({
      seq: row.sort_seq,
      role: row.message_type === 'user_input' ? 'user' : 'assistant',
      type: row.message_type,
      at: row.timestamp,
      text: row.content,
    })),
    nextAfterSeq: rows.length > input.limit ? page[page.length - 1]?.sort_seq ?? null : null,
  };
}
