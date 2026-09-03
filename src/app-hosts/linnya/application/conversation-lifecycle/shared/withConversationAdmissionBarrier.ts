import {
  ConversationDirectoryError,
  deriveConversationWorkDirectoryIdentity,
  type ConversationDirectoryCleanupJobPort,
  type ConversationWorkDirectoryIdentity,
} from '../../../../../domains/conversation-files';
import type {
  ConversationLifecycleGate,
} from '../definitions/conversationLifecycleGate';

/**
 * 所有 admission 都必须复用这一段“gate 后再查持久 job”的顺序。只在调用方外层查一次
 * 会留下检查与 mkdir/注册 owner 之间的竞态窗口。
 */
export async function withConversationAdmissionBarrier<T>(input: {
  readonly conversationId: unknown;
  readonly gate: ConversationLifecycleGate;
  readonly cleanupJobs: ConversationDirectoryCleanupJobPort;
  readonly admit: (identity: ConversationWorkDirectoryIdentity) => Promise<T> | T;
}): Promise<T> {
  const identity = deriveConversationWorkDirectoryIdentity(input.conversationId);
  return input.gate.runExclusive({
    scope: {
      conversationId: identity.conversationId,
      operation: 'conversation_admission',
    },
    run: async () => {
      const cleanupJob = await input.cleanupJobs.read(identity.conversationId);
      if (cleanupJob) {
        throw new ConversationDirectoryError(
          'work_directory_cleanup_in_progress',
          'check_cleanup_barrier',
        );
      }
      return input.admit(identity);
    },
  });
}
