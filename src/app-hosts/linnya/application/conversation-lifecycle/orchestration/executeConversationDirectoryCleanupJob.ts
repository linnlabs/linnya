import {
  type ConversationDirectoryCleanupJob,
  type ConversationDirectoryCleanupJobPort,
  type ConversationDirectoryCleanupJobScope,
  type ConversationDirectoryDeletionPort,
  deriveConversationWorkDirectoryIdentity,
} from '../../../../../domains/conversation-files';
import { CommandConversationIdSchema } from '@app/schemas/commands';
import type {
  ConversationCommandApprovalDeletionPort,
} from '../../../../../domains/commands';
import type {
  ConversationCleanupActivityPort,
} from '../definitions/conversationCleanupActivityPort';
import type { ConversationCommandCardSettlementDeletionPort } from '../definitions/conversationCommandCardSettlementDeletionPort';
import type {
  ConversationFactsDeletionPort,
} from '../definitions/conversationFactsDeletionPort';
import {
  ConversationCleanupUseCaseError,
  type ConversationCleanupFailureStage,
  type ConversationCleanupExecutionStatus,
} from '../definitions/conversationCleanupUseCase';
import { projectConversationCleanupFailure } from '../functions/projectConversationCleanupFailure';

interface ConversationCleanupExecutionPorts {
  readonly activity: ConversationCleanupActivityPort;
  readonly directories: ConversationDirectoryDeletionPort;
  readonly approvals: ConversationCommandApprovalDeletionPort;
  readonly commandCardSettlements: ConversationCommandCardSettlementDeletionPort;
  readonly facts: ConversationFactsDeletionPort;
  readonly jobs: ConversationDirectoryCleanupJobPort;
}

function scopeFromJob(job: ConversationDirectoryCleanupJob): ConversationDirectoryCleanupJobScope {
  return {
    jobId: job.jobId,
    conversationId: job.conversationId,
    operation: job.operation,
  };
}

async function resolveStaleWorker(input: {
  readonly job: ConversationDirectoryCleanupJob;
  readonly jobs: ConversationDirectoryCleanupJobPort;
  readonly operationError: unknown;
  readonly stage: ConversationCleanupFailureStage;
}): Promise<ConversationCleanupExecutionStatus> {
  const current = await input.jobs.read(input.job.conversationId);
  if (!current) {
    return 'completed_by_other_worker';
  }
  if (
    current.jobId !== input.job.jobId
    || current.operation !== input.job.operation
  ) {
    return 'superseded';
  }

  const failure = projectConversationCleanupFailure({
    stage: input.stage,
    error: input.operationError,
  });
  throw new ConversationCleanupUseCaseError(failure, input.operationError);
}

async function settleFailedAttempt(input: {
  readonly job: ConversationDirectoryCleanupJob;
  readonly jobs: ConversationDirectoryCleanupJobPort;
  readonly operationError: unknown;
  readonly stage: ConversationCleanupFailureStage;
}): Promise<ConversationCleanupExecutionStatus> {
  const failure = projectConversationCleanupFailure({
    stage: input.stage,
    error: input.operationError,
  });
  let recorded: ConversationDirectoryCleanupJob | null;
  try {
    recorded = await input.jobs.recordFailure({
      ...scopeFromJob(input.job),
      failure,
    });
  } catch (failurePersistenceError: unknown) {
    throw new ConversationCleanupUseCaseError(
      failure,
      input.operationError,
      failurePersistenceError,
    );
  }
  if (recorded) {
    throw new ConversationCleanupUseCaseError(failure, input.operationError);
  }
  return resolveStaleWorker(input);
}

/**
 * 每轮总是从头重放固定幂等步骤，不保存步骤游标。这样崩溃恢复只有一个执行合同，
 * jobId + operation 则保证升级前或上一代 worker 不能完成、改写当前任务。
 */
export async function executeConversationDirectoryCleanupJob(input: {
  readonly job: ConversationDirectoryCleanupJob;
  readonly ports: ConversationCleanupExecutionPorts;
}): Promise<ConversationCleanupExecutionStatus> {
  const identity = deriveConversationWorkDirectoryIdentity(input.job.conversationId);
  let stage: ConversationCleanupFailureStage = 'stop_conversation_activity';
  try {
    // 恢复任务和直接重放也要幂等建立 tombstone；首次删除已在 lifecycle gate 内先做过。
    input.ports.activity.beginStopping(input.job.conversationId);
    await input.ports.activity.stopAndWait(input.job.conversationId);

    stage = 'delete_work_directory';
    await input.ports.directories.deleteWorkDirectory(identity);

    if (input.job.operation === 'delete_conversation') {
      stage = 'delete_conversation_approvals';
      await input.ports.approvals.deleteForConversation(
        CommandConversationIdSchema.parse(input.job.conversationId),
      );

      stage = 'delete_command_card_settlements';
      await input.ports.commandCardSettlements.deleteForConversationAndWait(input.job.conversationId);

      stage = 'delete_conversation_facts';
      await input.ports.facts.deleteConversationFacts(input.job.conversationId);

      stage = 'delete_identity_metadata';
      await input.ports.directories.deleteIdentityMetadata(identity);
      // 只有持久对话事实与 identity metadata 都已删除，旧 handle 才真正失效。
      // 较早清除会让删除后续失败时丢掉仍可诊断的终态。
      input.ports.activity.forgetDeletedConversation(input.job.conversationId);
    }

    stage = 'complete_cleanup_job';
    const completed = await input.ports.jobs.complete(scopeFromJob(input.job));
    if (completed) {
      return 'completed';
    }
    return resolveStaleWorker({
      job: input.job,
      jobs: input.ports.jobs,
      operationError: new Error('cleanup job completion rejected for current scope'),
      stage,
    });
  } catch (operationError: unknown) {
    return settleFailedAttempt({
      job: input.job,
      jobs: input.ports.jobs,
      operationError,
      stage,
    });
  }
}
