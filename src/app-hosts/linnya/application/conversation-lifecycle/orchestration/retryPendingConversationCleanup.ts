import type { ConversationCleanupRetryOutcome } from '@app/schemas';
import {
  deriveConversationWorkDirectoryIdentity,
  type ConversationDirectoryCleanupJobPort,
  type ConversationDirectoryDeletionPort,
} from '../../../../../domains/conversation-files';
import type {
  ConversationCommandApprovalDeletionPort,
} from '../../../../../domains/commands';
import type {
  ConversationCleanupActivityPort,
} from '../definitions/conversationCleanupActivityPort';
import type {
  ConversationCommandCardSettlementDeletionPort,
} from '../definitions/conversationCommandCardSettlementDeletionPort';
import type {
  ConversationFactsDeletionPort,
} from '../definitions/conversationFactsDeletionPort';
import type {
  ConversationLifecycleGate,
} from '../definitions/conversationLifecycleGate';
import { executeConversationDirectoryCleanupJob } from './executeConversationDirectoryCleanupJob';

/**
 * 用户重试必须执行持久 job 里原本的操作。不能重新走删除入口，否则一次失败的
 * “清空工作目录”会被无意升级成“删除整个对话”。
 */
export async function retryPendingConversationCleanup(input: {
  readonly conversationId: unknown;
  readonly gate: ConversationLifecycleGate;
  readonly jobs: ConversationDirectoryCleanupJobPort;
  readonly directories: ConversationDirectoryDeletionPort;
  readonly approvals: ConversationCommandApprovalDeletionPort;
  readonly commandCardSettlements: ConversationCommandCardSettlementDeletionPort;
  readonly activity: ConversationCleanupActivityPort;
  readonly factsDeletion: ConversationFactsDeletionPort;
}): Promise<ConversationCleanupRetryOutcome> {
  const identity = deriveConversationWorkDirectoryIdentity(input.conversationId);
  const job = await input.gate.runExclusive({
    scope: {
      conversationId: identity.conversationId,
      operation: 'directory_cleanup_job',
    },
    run: async () => {
      const current = await input.jobs.read(identity.conversationId);
      if (current) input.activity.beginStopping(current.conversationId);
      return current;
    },
  });
  if (!job) return 'not_found';

  const status = await executeConversationDirectoryCleanupJob({
    job,
    ports: {
      activity: input.activity,
      directories: input.directories,
      approvals: input.approvals,
      commandCardSettlements: input.commandCardSettlements,
      facts: input.factsDeletion,
      jobs: input.jobs,
    },
  });
  if (status === 'superseded') return 'still_pending';
  return job.operation === 'delete_conversation'
    ? 'conversation_deleted'
    : 'work_directory_cleared';
}
