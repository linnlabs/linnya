import type {
  ConversationDirectoryDeletionPort,
} from '../../../ports/conversationDirectoryDeletionPort';
import { deriveConversationWorkDirectoryIdentity } from '../../work-directory/functions/deriveConversationWorkDirectoryIdentity';

/**
 * 只有完整对话删除才调用此步骤；精准清理必须保留 metadata，才能把下次空目录恢复投影为
 * previous_files_unavailable，而不是误报成从未拥有过工作文件。
 */
export async function deleteConversationDirectoryIdentityMetadata(input: {
  readonly conversationId: unknown;
  readonly deletionPort: ConversationDirectoryDeletionPort;
}): Promise<void> {
  const identity = deriveConversationWorkDirectoryIdentity(input.conversationId);
  await input.deletionPort.deleteIdentityMetadata(identity);
}
