import type Database from 'better-sqlite3';

import type {
  CommandExecutionOwnerPort,
  CommandProcessObservationPort,
  ConversationCommandApprovalDeletionPort,
} from '../../../domains/commands';
import type {
  ConversationWorkDirectoryConversationId,
  ConversationWorkDirectoryUsagePort,
} from '../../../domains/conversation-files';
import type { IEventStore } from '../../../app-hosts/linnya/adapters/persistence/event-store';
import {
  createEventStoreConversationFactsDeletionPort,
  createEventStoreConversationFactsPort,
} from '../../../app-hosts/linnya/adapters/persistence/conversation-facts';
import {
  SqliteConversationDirectoryCleanupJobPort,
} from '../../../app-hosts/linnya/adapters/persistence/conversation-files';
import {
  createConversationCleanupActivityPort,
  createConversationCleanupUseCase,
  createConversationLifecycleApplicationScope,
  type ConversationCleanupUseCasePort,
  type ConversationPersistenceAdmissionPort,
  type ConversationWorkDirectoryAdmissionPort,
} from '../../../app-hosts/linnya/application/conversation-lifecycle';
import {
  createLocalConversationDirectoryPort,
} from '../../../infra/adapters/conversation-files/local-directory';

export interface ConversationRouteCleanupBinding {
  readonly commands: Pick<
    CommandExecutionOwnerPort & CommandProcessObservationPort,
    'beginConversationStop' | 'stopConversationAndWait' | 'forgetDeletedConversation'
  >;
  readonly approvals: ConversationCommandApprovalDeletionPort;
  readonly commandCardSettlements: {
    drainConversation(conversationId: string): Promise<void>;
    deleteForConversation(conversationId: string): Promise<void>;
  };
  readonly stopFlowAndWait: (
    conversationId: ConversationWorkDirectoryConversationId,
  ) => Promise<void>;
}

export interface ConversationRouteLifecycle {
  readonly persistenceAdmission: ConversationPersistenceAdmissionPort;
  readonly workDirectoryAdmission: ConversationWorkDirectoryAdmissionPort;
  readonly workDirectoryUsage: ConversationWorkDirectoryUsagePort;
  bindCleanup(input: ConversationRouteCleanupBinding): ConversationCleanupUseCasePort;
}

/**
 * 当前 Electron App owner 只能创建这一份生命周期组合。admission 必须先交给 Commands/Flow，
 * 删除则等两个活动 owner 都创建后再绑定；底层 gate、任务表和目录端口始终是同一实例。
 */
export function createConversationRouteLifecycle(input: {
  readonly db: Database.Database;
  readonly eventStore: IEventStore;
  readonly storageRoot: string;
}): ConversationRouteLifecycle {
  const jobs = new SqliteConversationDirectoryCleanupJobPort(input.db);
  const directories = createLocalConversationDirectoryPort({ storageRoot: input.storageRoot });
  const facts = createEventStoreConversationFactsPort(input.eventStore);
  const factsDeletion = createEventStoreConversationFactsDeletionPort(input.eventStore);
  const scope = createConversationLifecycleApplicationScope({
    cleanupJobs: jobs,
    directories,
    facts,
  });

  return Object.freeze({
    persistenceAdmission: scope.persistenceAdmission,
    workDirectoryAdmission: scope.workDirectoryAdmission,
    workDirectoryUsage: directories,
    bindCleanup(binding: ConversationRouteCleanupBinding) {
      return createConversationCleanupUseCase({
        gate: scope.gate,
        jobs,
        directories,
        approvals: binding.approvals,
        commandCardSettlements: {
          async deleteForConversationAndWait(conversationId) {
            await binding.commandCardSettlements.drainConversation(conversationId);
            await binding.commandCardSettlements.deleteForConversation(conversationId);
          },
        },
        activity: createConversationCleanupActivityPort({
          commands: binding.commands,
          stopFlowAndWait: binding.stopFlowAndWait,
        }),
        facts,
        factsDeletion,
      });
    },
  });
}
