import type { BaseMessage } from '../../../types';
import type { ConversationVisualTurnId } from '@app/schemas';

export interface ConversationVisualTurnContext {
  readonly id: ConversationVisualTurnId;
  readonly userMessageId: string | null;
  readonly sourceMessageIds: readonly string[];
}

/** 消息画布的唯一展示 item：一条可见消息对应一行；是否虚拟定位由外层 adapter 决定。 */
export interface ConversationVisualRow {
  readonly key: string;
  readonly kind: 'message';
  readonly estimatedHeight: number;
  readonly visualTurnId: ConversationVisualTurnId;
  readonly turnContext: ConversationVisualTurnContext;
  readonly isTurnStart: boolean;
  readonly isTurnEnd: boolean;
  readonly role: BaseMessage['role'];
  readonly bounded: boolean;
  readonly payload: BaseMessage;
}
