import type { ConversationWorkDirectoryConversationId } from '../../../../../domains/conversation-files';

/** 删除步骤先排空已观察 terminal，再显式删除 sidecar；两步由同一 host owner 保证顺序。 */
export interface ConversationCommandCardSettlementDeletionPort {
  deleteForConversationAndWait(
    conversationId: ConversationWorkDirectoryConversationId,
  ): Promise<void>;
}
