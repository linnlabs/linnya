import type {
  ConversationFactsDeletionPort,
  ConversationFactsDeletionResult,
} from '../../../application/conversation-lifecycle';
import type {
  ConversationWorkDirectoryConversationId,
} from '../../../../../domains/conversation-files';
import type { IEventStore } from '../event-store';

/**
 * 对话事实继续由 EventStore 的原子事务拥有。这里仅收窄删除结果，避免 application use case
 * 依赖 History DTO、repository 或 EventStore 的其他读写能力。
 */
export function createEventStoreConversationFactsDeletionPort(
  eventStore: IEventStore,
): ConversationFactsDeletionPort {
  return Object.freeze({
    async deleteConversationFacts(
      conversationId: ConversationWorkDirectoryConversationId,
    ): Promise<ConversationFactsDeletionResult> {
      return await eventStore.deleteConversation(conversationId)
        ? 'deleted'
        : 'not_found';
    },
  });
}
