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
  ConversationCleanupUseCasePort,
} from '../definitions/conversationCleanupUseCasePort';
import type {
  ConversationFactsDeletionPort,
} from '../definitions/conversationFactsDeletionPort';
import type {
  ConversationFactsPort,
} from '../definitions/conversationFactsPort';
import type {
  ConversationLifecycleGate,
} from '../definitions/conversationLifecycleGate';
import { requestConversationDeletion } from './deleteConversation';
import { requestConversationWorkDirectoryClear } from './clearConversationWorkDirectory';
import { recoverPendingConversationCleanupJobs } from './recoverPendingConversationCleanupJobs';
import { readPendingConversationCleanupIds } from './readPendingConversationCleanup';
import { retryPendingConversationCleanup } from './retryPendingConversationCleanup';

/**
 * 绑定当前 App owner 的唯一对话清理依赖。这里只组合完整用例，不复制任何清理步骤；
 * 精准清理、完整删除和崩溃恢复因此必然共用同一 gate、任务表和资源 adapters。
 */
export function createConversationCleanupUseCase(input: {
  readonly gate: ConversationLifecycleGate;
  readonly jobs: ConversationDirectoryCleanupJobPort;
  readonly directories: ConversationDirectoryDeletionPort;
  readonly approvals: ConversationCommandApprovalDeletionPort;
  readonly commandCardSettlements: ConversationCommandCardSettlementDeletionPort;
  readonly activity: ConversationCleanupActivityPort;
  readonly facts: ConversationFactsPort;
  readonly factsDeletion: ConversationFactsDeletionPort;
}): ConversationCleanupUseCasePort {
  return Object.freeze({
    requestWorkDirectoryClear: (conversationId: unknown) => requestConversationWorkDirectoryClear({
      conversationId,
      gate: input.gate,
      jobs: input.jobs,
      directories: input.directories,
      approvals: input.approvals,
      commandCardSettlements: input.commandCardSettlements,
      activity: input.activity,
      facts: input.facts,
      factsDeletion: input.factsDeletion,
    }),
    requestDeletion: (conversationId: unknown) => requestConversationDeletion({
      conversationId,
      gate: input.gate,
      jobs: input.jobs,
      directories: input.directories,
      approvals: input.approvals,
      commandCardSettlements: input.commandCardSettlements,
      activity: input.activity,
      facts: input.facts,
      factsDeletion: input.factsDeletion,
    }),
    readPendingConversationIds: (conversationIds: readonly string[]) => readPendingConversationCleanupIds({
      conversationIds,
      jobs: input.jobs,
    }),
    retryPending: (conversationId: unknown) => retryPendingConversationCleanup({
      conversationId,
      gate: input.gate,
      jobs: input.jobs,
      directories: input.directories,
      approvals: input.approvals,
      commandCardSettlements: input.commandCardSettlements,
      activity: input.activity,
      factsDeletion: input.factsDeletion,
    }),
    recoverPending: () => recoverPendingConversationCleanupJobs({
      gate: input.gate,
      jobs: input.jobs,
      directories: input.directories,
      approvals: input.approvals,
      commandCardSettlements: input.commandCardSettlements,
      activity: input.activity,
      facts: input.factsDeletion,
    }),
  });
}
