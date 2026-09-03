import type {
  ConversationFactsPort,
  EnsureConversationFactsInput,
} from '../../../application/conversation-lifecycle';
import type {
  ConversationWorkDirectoryConversationId,
} from '../../../../../domains/conversation-files';
import type { IEventStore } from '../event-store';

/**
 * EventStore 仍拥有 conversations 表；这里仅把完整 metadata 投影成存在性，并复制只读
 * incoming events 后调用公开 ensure 合同，不把 History Repository 的读取能力带入 workflow。
 */
export function createEventStoreConversationFactsPort(
  eventStore: IEventStore,
): ConversationFactsPort {
  return Object.freeze({
    async exists(conversationId: ConversationWorkDirectoryConversationId): Promise<boolean> {
      return (await eventStore.getConversationMetadata(conversationId)) !== null;
    },
    async ensure(input: EnsureConversationFactsInput): Promise<void> {
      await eventStore.ensureConversation(
        input.conversationId,
        [...input.initialEvents],
        input.projectId,
        input.mode,
      );
    },
  });
}
