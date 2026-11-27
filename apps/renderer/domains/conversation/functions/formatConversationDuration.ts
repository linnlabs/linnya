import type { ConversationMessageResolver } from '../definitions/conversationMessages';

/**
 * 对话里所有“时长”的唯一写法：“12秒”“1分钟5秒”（英文 “12s”“1m 5s”）。
 * 思考行、底部状态行和“已工作”折叠行共用，避免同一屏出现两种写法。
 */
export function formatConversationDuration(
  durationMs: number,
  conversationMessage: ConversationMessageResolver,
): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  if (totalSeconds < 60) {
    return conversationMessage('conversation.thought.duration.seconds', { seconds: totalSeconds });
  }
  return conversationMessage('conversation.thought.duration.minutesSeconds', {
    minutes: Math.floor(totalSeconds / 60),
    seconds: totalSeconds % 60,
  });
}
