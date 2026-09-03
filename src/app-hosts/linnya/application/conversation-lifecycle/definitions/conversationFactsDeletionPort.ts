import type {
  ConversationWorkDirectoryConversationId,
} from '../../../../../domains/conversation-files';

export type ConversationFactsDeletionResult = 'deleted' | 'not_found';

/** 删除能力与 admission facts port 分开，避免目录准入意外获得不可逆数据库权限。 */
export interface ConversationFactsDeletionPort {
  deleteConversationFacts(
    conversationId: ConversationWorkDirectoryConversationId,
  ): Promise<ConversationFactsDeletionResult>;
}
