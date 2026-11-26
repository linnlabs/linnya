import type { BaseMessage } from '../../../types';
import type { ConversationVisualTurnId } from '@app/schemas';

export interface ConversationVisualTurnContext {
  readonly id: ConversationVisualTurnId;
  readonly userMessageId: string | null;
  readonly sourceMessageIds: readonly string[];
}

interface ConversationVisualRowBase {
  readonly key: string;
  readonly estimatedHeight: number;
  readonly visualTurnId: ConversationVisualTurnId;
  readonly turnContext: ConversationVisualTurnContext;
  readonly isTurnStart: boolean;
  readonly isTurnEnd: boolean;
  readonly bounded: boolean;
}

/** 一条可见消息对应一行；是否虚拟定位由外层 adapter 决定。 */
export interface ConversationMessageVisualRow extends ConversationVisualRowBase {
  readonly kind: 'message';
  readonly role: BaseMessage['role'];
  readonly payload: BaseMessage;
}

/**
 * 终态折叠行：一轮结束且有最终回答后，本轮的思考、叙述与工具调用收成这一行“已工作 x 分 x 秒”。
 * 它不是消息，只由主时间线的折叠投影插入；Subrun 详情和消息投影都不产生它。
 */
export interface ConversationTurnWorkFoldVisualRow extends ConversationVisualRowBase {
  readonly kind: 'turn-work-fold';
  readonly fold: {
    /** 触发本轮的用户消息；折叠的展开状态按它记。 */
    readonly rootUserMessageId: string;
    readonly durationMs: number;
    readonly expanded: boolean;
  };
}

/** 消息画布的唯一展示 item。 */
export type ConversationVisualRow = ConversationMessageVisualRow | ConversationTurnWorkFoldVisualRow;
