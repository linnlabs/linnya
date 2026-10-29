import type { ConversationUiWindowRefreshQuery } from '@app/schemas';
import type { UiMessagesWindowDto, UiMessagesRefreshDto } from './uiMessagesDto';

export type MessageWindowRequestStage = 'request' | 'http' | 'response-json' | 'response-contract';

/** 技术阶段与 HTTP 状态保留到加载边界，不能压成没有上下文的 unknown。 */
export class MessageWindowRequestError extends Error {
  constructor(
    readonly stage: MessageWindowRequestStage,
    readonly httpStatus?: number,
    readonly cause?: unknown,
  ) {
    super(`Conversation window ${stage} failed${httpStatus === undefined ? '' : ` (HTTP ${httpStatus})`}`);
    this.name = 'MessageWindowRequestError';
  }
}

export interface MessageWindowApiPort {
  readRefresh(conversationId: string, query: ConversationUiWindowRefreshQuery): Promise<UiMessagesRefreshDto>;
  readTail(conversationId: string, limit: number): Promise<UiMessagesWindowDto>;
  readBefore(conversationId: string, cursor: number, limit: number): Promise<UiMessagesWindowDto>;
  readAfter(conversationId: string, cursor: number, limit: number): Promise<UiMessagesWindowDto>;
  readAround(conversationId: string, anchorMessageId: string, limit: number): Promise<UiMessagesWindowDto>;
}
