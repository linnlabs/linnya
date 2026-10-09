import type { ConversationUiWindowRefreshQuery } from '@app/schemas';
import type { UiMessagesWindowDto, UiMessagesRefreshDto } from './uiMessagesDto';

export interface MessageWindowApiPort {
  readRefresh(conversationId: string, query: ConversationUiWindowRefreshQuery): Promise<UiMessagesRefreshDto>;
  readTail(conversationId: string, limit: number): Promise<UiMessagesWindowDto>;
  readBefore(conversationId: string, cursor: number, limit: number): Promise<UiMessagesWindowDto>;
  readAfter(conversationId: string, cursor: number, limit: number): Promise<UiMessagesWindowDto>;
  readAround(conversationId: string, anchorMessageId: string, limit: number): Promise<UiMessagesWindowDto>;
}
