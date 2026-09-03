import type {
  ConversationWorkDirectoryClearResult,
} from '../../conversation-lifecycle';
import type { StorageSpaceOverview } from './storageSpace';

export interface StorageSpaceUseCasePort {
  readOverview(): Promise<StorageSpaceOverview>;
  clearConversationWorkDirectory(
    conversationId: unknown,
  ): Promise<ConversationWorkDirectoryClearResult>;
}
