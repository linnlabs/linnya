import type { ConversationCleanupRetryOutcome } from '@app/schemas';

/**
 * History 只消费用户可见的 cleanup 状态和完整重试动作，不读取 jobId、失败阶段或
 * 文件系统细节。真正的幂等步骤与持久 barrier 继续由 application use case 独占。
 */
export interface ConversationCleanupStatusPort {
  readPendingConversationIds(conversationIds: readonly string[]): Promise<ReadonlySet<string>>;
  retryPending(conversationId: string): Promise<ConversationCleanupRetryOutcome>;
}
