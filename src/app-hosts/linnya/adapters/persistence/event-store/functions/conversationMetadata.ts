import { ConversationOriginSchema, type ConversationOrigin } from '@app/schemas';
import { isRecord } from '@linnya/foundation';

/** `conversations.metadata` 是 JSON 对象（可为空）；不是对象说明数据被外部改写，不能当作空处理。 */
export function parseConversationMetadata(
  conversationId: string,
  metadata: string | null
): Record<string, unknown> {
  if (!metadata) {
    return {};
  }

  const parsed: unknown = JSON.parse(metadata);
  if (!isRecord(parsed)) {
    throw new Error(
      `[SQLiteEventStore] conversation ${conversationId} metadata must be a JSON object`
    );
  }

  return { ...parsed };
}

/**
 * 会话的发起入口，保存在 metadata 里；没有该字段即普通会话。
 * 历史列表与项目对话查询都经此读取，入口标记只有一处解释。
 */
export function readConversationOrigin(
  conversationId: string,
  metadata: string | null
): ConversationOrigin | undefined {
  if (!metadata) return undefined;
  const origin: unknown = parseConversationMetadata(conversationId, metadata).origin;
  if (origin === undefined) return undefined;
  // 写入方只有 materializeOriginConversation；读到未知值说明数据被外部改写，不能静默当作普通会话。
  return ConversationOriginSchema.parse(origin);
}
