import type { ConversationMessageId } from '@app/schemas';
import type { InjectionKey } from 'vue';

/**
 * 消息入场动画的窄端口。
 *
 * 叶子消息只查询和消费自己的正式 message_id，不得读取台账内部集合，也不得在
 * provider 缺失时自行创建 fallback；否则页面装配错误会被静默掩盖。
 */
export interface MessageEntryAnimationPort {
  isPending(messageId: ConversationMessageId): boolean;
  consume(messageId: ConversationMessageId): void;
}

export const MESSAGE_ENTRY_ANIMATION_PORT_KEY: InjectionKey<MessageEntryAnimationPort> =
  Symbol('conversation:message-entry-animation');
