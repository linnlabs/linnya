import type { ConversationVisualTurnId } from '@app/schemas';
import type { BaseMessage } from '../../../types';
import type { ConversationVisualRow } from '../definitions/conversationVisualRow';

/**
 * 同一视觉轮次的消息集合由 visual-row 投影决定；画布只建立读取索引。
 * 不能在每一行里扫描完整 messages，否则静态 Subrun 画布会退化为 O(n²)。
 */
export function indexConversationVisualTurnMessages(
  rows: readonly ConversationVisualRow[],
  messages: readonly BaseMessage[],
): ReadonlyMap<ConversationVisualTurnId, readonly BaseMessage[]> {
  const messageById = new Map(messages.map(message => [message.id, message] as const));
  const messagesByVisualTurnId = new Map<ConversationVisualTurnId, readonly BaseMessage[]>();

  for (const row of rows) {
    if (messagesByVisualTurnId.has(row.visualTurnId)) continue;
    const turnMessages = row.turnContext.sourceMessageIds.flatMap((messageId) => {
      const message = messageById.get(messageId);
      return message ? [message] : [];
    });
    messagesByVisualTurnId.set(row.visualTurnId, turnMessages);
  }

  return messagesByVisualTurnId;
}
