import type {
  ConversationWorkDirectoryIdentity,
} from '../definitions/conversationWorkDirectory';

/**
 * 删除工作文件与删除 identity metadata 必须是两个动作：精准清理只做前者；删除整个
 * 对话要在聊天事实删除成功后才做后者，避免失败重试时失去目录 owner 依据。
 */
export interface ConversationDirectoryDeletionPort {
  deleteWorkDirectory(identity: ConversationWorkDirectoryIdentity): Promise<void>;
  deleteIdentityMetadata(identity: ConversationWorkDirectoryIdentity): Promise<void>;
}
