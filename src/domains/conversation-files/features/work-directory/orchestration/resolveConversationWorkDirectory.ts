import type { ConversationDirectoryPort } from '../../../ports/conversationDirectoryPort';
import type { ConversationWorkDirectoryResolution } from '../../../definitions/conversationWorkDirectory';
import { deriveConversationWorkDirectoryIdentity } from '../functions/deriveConversationWorkDirectoryIdentity';

export async function resolveConversationWorkDirectory(input: {
  readonly conversationId: unknown;
  readonly directoryPort: ConversationDirectoryPort;
}): Promise<ConversationWorkDirectoryResolution> {
  const identity = deriveConversationWorkDirectoryIdentity(input.conversationId);
  return input.directoryPort.ensureDirectory(identity);
}
