import { randomUUID } from 'node:crypto';

import {
  createConversationDirectoryCleanupJob,
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
import type { ConversationCommandCardSettlementDeletionPort } from '../definitions/conversationCommandCardSettlementDeletionPort';
import type {
  ConversationFactsDeletionPort,
} from '../definitions/conversationFactsDeletionPort';
import type {
  ConversationFactsPort,
} from '../definitions/conversationFactsPort';
import type {
  ConversationLifecycleGate,
} from '../definitions/conversationLifecycleGate';
import type {
  ConversationWorkDirectoryClearResult,
} from '../definitions/conversationCleanupUseCasePort';
import { executeConversationDirectoryCleanupJob } from './executeConversationDirectoryCleanupJob';

/**
 * 精准清理与删除对话共用同一个持久屏障和活动 owner。区别只由 job operation
 * 决定，不能为设置页另写一条直接删除目录的捷径。
 */
export async function requestConversationWorkDirectoryClear(input: {
  readonly conversationId: unknown;
  readonly gate: ConversationLifecycleGate;
  readonly jobs: ConversationDirectoryCleanupJobPort;
  readonly directories: ConversationDirectoryDeletionPort;
  readonly approvals: ConversationCommandApprovalDeletionPort;
  readonly commandCardSettlements: ConversationCommandCardSettlementDeletionPort;
  readonly activity: ConversationCleanupActivityPort;
  readonly facts: ConversationFactsPort;
  readonly factsDeletion: ConversationFactsDeletionPort;
  readonly createJobUuid?: () => string;
  readonly now?: () => number;
}): Promise<ConversationWorkDirectoryClearResult> {
  const identity = deriveConversationWorkDirectoryIdentity(input.conversationId);
  const requested = createConversationDirectoryCleanupJob({
    jobId: `conversation_cleanup_${(input.createJobUuid ?? randomUUID)()}`,
    identity,
    operation: 'clear_work_directory',
    requestedAt: (input.now ?? Date.now)(),
  });

  const job = await input.gate.runExclusive({
    scope: {
      conversationId: identity.conversationId,
      operation: 'directory_cleanup_job',
    },
    run: async () => {
      const existing = await input.jobs.read(identity.conversationId);
      if (!existing && !await input.facts.exists(identity.conversationId)) {
        return null;
      }
      const begun = (await input.jobs.begin(requested)).job;
      if (begun.operation === 'delete_conversation') {
        // 较窄的“清工作文件”请求绝不能接手更强的整段删除任务，否则设置页一次点击
        // 会删除聊天事实。原删除 owner 或启动恢复负责继续那份持久任务。
        return 'deletion_in_progress' as const;
      }
      input.activity.beginStopping(identity.conversationId);
      return begun;
    },
  });
  if (!job) return 'not_found';
  if (job === 'deletion_in_progress') return job;

  await executeConversationDirectoryCleanupJob({
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
  return 'cleared';
}
