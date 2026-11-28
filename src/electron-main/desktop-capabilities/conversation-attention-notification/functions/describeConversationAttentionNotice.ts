import type { ConversationAttentionNotification } from '@app/schemas/conversation-attention';
import type { DesktopNoticeText } from '../../desktop-notice/createDesktopNoticeDelivery';

/**
 * 系统通知的文案：标题是对话名，正文说在等什么、谁发起的。
 * 调用方没报名称时用入口名 Linnya CLI，与对话和项目概览里的叫法一致。
 */
export function describeConversationAttentionNotice(event: ConversationAttentionNotification, chinese: boolean): DesktopNoticeText {
  const who = event.sender.name ?? 'Linnya CLI';
  const approval = event.kind === 'awaiting_approval';
  return {
    title: event.conversation_title?.trim() || (chinese ? '未命名对话' : 'Untitled conversation'),
    body: chinese
      ? `${approval ? '等你批准命令' : '等你回答'}（${who} 发起）`
      : `${approval ? 'Waiting for you to approve a command' : 'Waiting for your answer'} (started by ${who})`,
  };
}
