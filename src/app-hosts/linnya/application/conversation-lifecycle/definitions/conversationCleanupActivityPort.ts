import type {
  ConversationWorkDirectoryConversationId,
} from '../../../../../domains/conversation-files';

/**
 * 删除流程只关心“该对话的活动已经全部停止并完成收尾”，不读取 Flow、Commands 或
 * Supervisor 的内部 registry。未来 Shell owner 接入时只扩组合 adapter，不改删除流程。
 */
export interface ConversationCleanupActivityPort {
  /**
   * cleanup job 成为持久 barrier 时同步禁止旧 reservation 迟到启动。这里不能等待
   * Flow、进程树或输出收尾；真正等待仍在 gate 外的 stopAndWait 中完成。
   */
  beginStopping(conversationId: ConversationWorkDirectoryConversationId): void;
  stopAndWait(conversationId: ConversationWorkDirectoryConversationId): Promise<void>;
  /** 只在对话事实和 identity metadata 都已删除后，使旧 process handle 失效。 */
  forgetDeletedConversation(conversationId: ConversationWorkDirectoryConversationId): void;
}
