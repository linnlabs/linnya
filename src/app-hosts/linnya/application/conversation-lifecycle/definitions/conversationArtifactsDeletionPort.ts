/** 对话专属的工具输出、证据等文件；活动 owner 停止后才能删除，不包含共享 asset。 */
export interface ConversationArtifactsDeletionPort {
  deleteForConversation(conversationId: string): Promise<void>;
}
