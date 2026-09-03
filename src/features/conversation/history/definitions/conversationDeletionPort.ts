/**
 * History 只发起用户可感知的“删除整段对话”，不能取得 EventStore、目录、进程或批准的
 * 分步删除能力。实际顺序由 App 级生命周期工作流负责，避免任一入口绕过持久清理屏障。
 */
export interface ConversationDeletionPort {
  requestDeletion(conversationId: string): Promise<boolean>;
}
