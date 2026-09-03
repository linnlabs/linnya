/**
 * 会话列表分页 cursor 协议。
 *
 * 中文说明：
 * - cursor 对外是 opaque string，renderer 只能原样传回；
 * - 内部包含排序主键和 conversation_id tie-breaker，避免同一 sort cursor 跨页漏项；
 * - 该协议属于 EventStore 会话列表能力，不放到全局 shared，避免变成无边界工具函数。
 */
import { Buffer } from 'node:buffer';

export const CONVERSATION_LIST_PINNED_SORT_OFFSET = 4_000_000_000_000_000;

export interface ConversationListCursor {
  readonly sortCursor: number;
  readonly conversationId: string;
}

interface ConversationListSortTarget {
  readonly conversation_id: string;
  readonly last_event_at: number;
  readonly is_pinned: boolean;
  readonly pinned_at?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function getConversationListSortCursor(conversation: ConversationListSortTarget): number {
  return conversation.is_pinned
    ? CONVERSATION_LIST_PINNED_SORT_OFFSET + (conversation.pinned_at ?? 0)
    : conversation.last_event_at;
}

export function isValidConversationListCursor(cursor: ConversationListCursor): boolean {
  return Number.isFinite(cursor.sortCursor)
    && Number.isInteger(cursor.sortCursor)
    && cursor.conversationId.trim().length > 0;
}

export function encodeConversationListCursor(cursor: ConversationListCursor): string {
  if (!isValidConversationListCursor(cursor)) {
    throw new Error('[ConversationListCursor] invalid cursor payload');
  }

  return Buffer
    .from(JSON.stringify({
      sortCursor: cursor.sortCursor,
      conversationId: cursor.conversationId,
    }), 'utf8')
    .toString('base64');
}

export function decodeConversationListCursor(value: string | undefined): ConversationListCursor | undefined {
  if (!value || value.trim().length === 0) {
    return undefined;
  }

  try {
    const rawJson = Buffer.from(value, 'base64').toString('utf8');
    const parsed: unknown = JSON.parse(rawJson);
    if (!isRecord(parsed)) {
      return undefined;
    }

    const sortCursor = parsed.sortCursor;
    const conversationId = parsed.conversationId;
    if (typeof sortCursor !== 'number' || typeof conversationId !== 'string') {
      return undefined;
    }

    const cursor = { sortCursor, conversationId };
    return isValidConversationListCursor(cursor) ? cursor : undefined;
  } catch {
    return undefined;
  }
}
