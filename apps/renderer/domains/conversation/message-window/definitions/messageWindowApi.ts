import type { UiMessagesWindowDto } from './uiMessagesDto';

export interface MessageWindowApiPort {
  readTail(conversationId: string, limit: number): Promise<UiMessagesWindowDto>;
  readBefore(conversationId: string, cursor: number, limit: number): Promise<UiMessagesWindowDto>;
  readAfter(conversationId: string, cursor: number, limit: number): Promise<UiMessagesWindowDto>;
  readAround(conversationId: string, anchorMessageId: string, limit: number): Promise<UiMessagesWindowDto>;
}
