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
import { executeConversationDirectoryCleanupJob } from './executeConversationDirectoryCleanupJob';

/**
 * lifecycle gate 只保护“事实检查到 job 落盘”。job 成为持久 barrier 后必须立即释放 gate，
 * 否则删除期间排队的 admission 会在 job 完成后错过屏障并重建刚删除的对话。
 */
export async function requestConversationDeletion(input: {
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
}): Promise<boolean> {
  const identity = deriveConversationWorkDirectoryIdentity(input.conversationId);
  const requested = createConversationDirectoryCleanupJob({
    jobId: `conversation_cleanup_${(input.createJobUuid ?? randomUUID)()}`,
    identity,
    operation: 'delete_conversation',
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
      // 与 admission 共用同一个 gate：job 先落盘，Commands tombstone 随后同步建立。
      // gate 释放后迟到审批已不能 claim start，但真正收树仍在 gate 外完成。
      input.activity.beginStopping(identity.conversationId);
      return begun;
    },
  });
  if (!job) {
    return false;
  }

  // 必须执行 begin 返回的实际 operation；现有 delete 不能被后来的窄请求降级。
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
  return true;
}
