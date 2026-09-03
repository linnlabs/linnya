import type {
  ConversationCleanupRecoverySummary,
} from './conversationCleanupUseCase';
import type { ConversationCleanupRetryOutcome } from '@app/schemas';

export type ConversationWorkDirectoryClearResult =
  | 'cleared'
  | 'not_found'
  | 'deletion_in_progress';

/**
 * Electron 组合根只取得三个完整用例，不能逐步调用目录、审批或事实删除能力。
 * 三个动作共享创建时绑定的同一 gate 和 ports，避免精准清理、删除与恢复顺序分叉。
 */
export interface ConversationCleanupUseCasePort {
  requestWorkDirectoryClear(
    conversationId: unknown,
  ): Promise<ConversationWorkDirectoryClearResult>;
  requestDeletion(conversationId: unknown): Promise<boolean>;
  readPendingConversationIds(conversationIds: readonly string[]): Promise<ReadonlySet<string>>;
  retryPending(conversationId: unknown): Promise<ConversationCleanupRetryOutcome>;
  recoverPending(): Promise<ConversationCleanupRecoverySummary>;
}
