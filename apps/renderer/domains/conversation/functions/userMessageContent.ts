import type { UserMessage } from '../types';
import type { UserMessageContent } from '../definitions/userMessageContent';
import { fromUserQuoteWire } from './userQuoteWire';

/** 从消息投影恢复可完整重放的 Renderer 用户内容。 */
export function readUserMessageContent(message: UserMessage): UserMessageContent {
  const userQuote = fromUserQuoteWire(message.metadata?.user_quote);
  return {
    text: message.content,
    ...(userQuote ? { userQuote } : {}),
    ...(message.attachments?.length
      ? { attachments: [...message.attachments] }
      : {}),
  };
}
