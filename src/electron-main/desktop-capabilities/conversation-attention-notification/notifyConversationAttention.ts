import { CONVERSATION_ATTENTION_NOTIFY_CHANNEL, type ConversationAttentionNotification } from '@app/schemas/conversation-attention';
import { createDesktopNoticeDelivery } from '../desktop-notice/createDesktopNoticeDelivery';
import { describeConversationAttentionNotice } from './functions/describeConversationAttentionNotice';

export function createConversationAttentionDesktopNotifications() {
  return createDesktopNoticeDelivery<ConversationAttentionNotification>({
    channel: CONVERSATION_ATTENTION_NOTIFY_CHANNEL,
    describe: describeConversationAttentionNotice,
  });
}
