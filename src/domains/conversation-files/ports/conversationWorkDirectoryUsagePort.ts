import type {
  ConversationWorkDirectoryIdentity,
} from '../definitions/conversationWorkDirectory';
import type {
  ConversationWorkDirectoryUsage,
} from '../definitions/conversationWorkDirectoryUsage';

/** 只读计量不能创建、恢复或删除对话目录。 */
export interface ConversationWorkDirectoryUsagePort {
  measureWorkDirectory(
    identity: ConversationWorkDirectoryIdentity,
  ): Promise<ConversationWorkDirectoryUsage>;
}
