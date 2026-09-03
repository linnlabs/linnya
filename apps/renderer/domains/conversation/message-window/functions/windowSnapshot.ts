import type { MessageWindowSnapshot, WindowMessageRow } from '../definitions/messageWindow';
import type { UiMessagesWindowReadyDto } from '../definitions/uiMessagesDto';

export function createMessageWindowSnapshot(
  dto: UiMessagesWindowReadyDto,
  rows: readonly WindowMessageRow[],
): MessageWindowSnapshot {
  return {
    conversationId: dto.conversation_id,
    rows,
    hasMoreBefore: dto.has_more_before,
    hasMoreAfter: dto.has_more_after,
    prevCursor: dto.prev_cursor,
    nextCursor: dto.next_cursor,
    revision: dto.revision,
  };
}
