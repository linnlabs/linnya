import type {
  ConversationDirectoryDeletionPort,
} from '../../../ports/conversationDirectoryDeletionPort';
import { deriveConversationWorkDirectoryIdentity } from '../../work-directory/functions/deriveConversationWorkDirectoryIdentity';

export async function deleteConversationWorkDirectory(input: {
  readonly conversationId: unknown;
  readonly deletionPort: ConversationDirectoryDeletionPort;
}): Promise<void> {
  const identity = deriveConversationWorkDirectoryIdentity(input.conversationId);
  await input.deletionPort.deleteWorkDirectory(identity);
}
