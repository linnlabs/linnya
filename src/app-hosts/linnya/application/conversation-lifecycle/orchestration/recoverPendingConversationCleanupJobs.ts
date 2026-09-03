import type {
  ConversationDirectoryCleanupJobPort,
  ConversationDirectoryDeletionPort,
} from '../../../../../domains/conversation-files';
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
  type ConversationCleanupRecoveryFailure,
  type ConversationCleanupRecoverySummary,
} from '../definitions/conversationCleanupUseCase';
import type {
  ConversationLifecycleGate,
} from '../definitions/conversationLifecycleGate';
import { projectConversationCleanupFailure } from '../functions/projectConversationCleanupFailure';
import { executeConversationDirectoryCleanupJob } from './executeConversationDirectoryCleanupJob';

/**
 * 启动恢复只扫描一次 host 自己的确定性 cleanup intent，不恢复旧 Agent 命令，也不建立
 * 后台调度器。list 只是提示；每项执行前必须在唯一 gate 内重读当前 generation/operation。
 */
export async function recoverPendingConversationCleanupJobs(input: {
  readonly gate: ConversationLifecycleGate;
  readonly jobs: ConversationDirectoryCleanupJobPort;
  readonly directories: ConversationDirectoryDeletionPort;
  readonly approvals: ConversationCommandApprovalDeletionPort;
  readonly commandCardSettlements: ConversationCommandCardSettlementDeletionPort;
  readonly activity: ConversationCleanupActivityPort;
  readonly facts: ConversationFactsDeletionPort;
}): Promise<ConversationCleanupRecoverySummary> {
  const listed = await input.jobs.list();
  let completedCount = 0;
  let supersededCount = 0;
  const failures: ConversationCleanupRecoveryFailure[] = [];

  for (const listedJob of listed) {
    const current = await input.gate.runExclusive({
      scope: {
        conversationId: listedJob.conversationId,
        operation: 'directory_cleanup_job',
      },
      run: async () => {
        const job = await input.jobs.read(listedJob.conversationId);
        if (job) input.activity.beginStopping(job.conversationId);
        return job;
      },
    });
    if (!current || current.jobId !== listedJob.jobId) {
      supersededCount += 1;
      continue;
    }

    try {
      const status = await executeConversationDirectoryCleanupJob({
        job: current,
        ports: {
          activity: input.activity,
          directories: input.directories,
          approvals: input.approvals,
          commandCardSettlements: input.commandCardSettlements,
          facts: input.facts,
          jobs: input.jobs,
        },
      });
      if (status === 'superseded') {
        supersededCount += 1;
      } else {
        completedCount += 1;
      }
    } catch (error: unknown) {
      failures.push(Object.freeze({
        job: current,
        failure: error instanceof ConversationCleanupUseCaseError
          ? error.failure
          : projectConversationCleanupFailure({
            stage: 'complete_cleanup_job',
            error,
          }),
      }));
    }
  }

  return Object.freeze({
    listedCount: listed.length,
    completedCount,
    supersededCount,
    failures: Object.freeze(failures),
  });
}
