import type { ConversationAttentionNotification } from '@app/schemas';
import type { ConversationMessageResolver } from '../../../definitions/conversationMessages';

/**
 * 窗口在前台时 Main 转来的“外部发起的运行在等你”，变成应用内提示的一句话。
 * 调用方没报名称时用入口名 Linnya CLI，与消息气泡和项目概览里的叫法一致。
 */
export function formatConversationAttentionNotice(
  notification: ConversationAttentionNotification,
  message: ConversationMessageResolver,
): string {
  return message(
    notification.kind === 'awaiting_approval'
      ? 'conversation.attention.awaitingApproval'
      : 'conversation.attention.awaitingAnswer',
    {
      title: notification.conversation_title?.trim() || message('conversation.attention.untitled'),
      who: notification.sender.name ?? 'Linnya CLI',
    },
  );
}
