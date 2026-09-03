import type {
  ConversationDirectoryCleanupJobPort,
  ConversationDirectoryPort,
  ConversationWorkDirectoryResolution,
} from '../../../../../domains/conversation-files';
import type {
  ConversationFactsPort,
} from '../definitions/conversationFactsPort';
import type {
  ConversationLifecycleGate,
} from '../definitions/conversationLifecycleGate';
import type {
  ConversationPersistenceAdmission,
  ConversationPersistenceAdmissionInput,
  ConversationPersistenceAdmissionPort,
} from '../definitions/conversationPersistenceAdmission';
import type {
  ConversationWorkDirectoryAdmissionInput,
  ConversationWorkDirectoryAdmissionPort,
} from '../definitions/conversationWorkDirectoryAdmission';
import { admitPersistentConversation } from './admitPersistentConversation';
import { createConversationLifecycleGate } from './createConversationLifecycleGate';
import { withAvailableConversationWorkDirectory } from './withAvailableConversationWorkDirectory';

export interface ConversationLifecycleApplicationScope {
  readonly gate: ConversationLifecycleGate;
  readonly persistenceAdmission: ConversationPersistenceAdmissionPort;
  readonly workDirectoryAdmission: ConversationWorkDirectoryAdmissionPort;
}

/**
 * 每个 App owner 只能创建一个 scope，再把其中的 gate 交给后续清理 use case。
 * 不使用模块级 singleton，避免测试、重载或第二个 host owner 共享错误生命周期。
 */
export function createConversationLifecycleApplicationScope(input: {
  readonly cleanupJobs: ConversationDirectoryCleanupJobPort;
  readonly directories: ConversationDirectoryPort;
  readonly facts: ConversationFactsPort;
}): ConversationLifecycleApplicationScope {
  const gate = createConversationLifecycleGate();
  const persistenceAdmission: ConversationPersistenceAdmissionPort = Object.freeze({
    withAdmission: <T>(
      request: ConversationPersistenceAdmissionInput,
      admitted: (admission: ConversationPersistenceAdmission) => Promise<T> | T,
    ) => admitPersistentConversation<T>({
      request,
      gate,
      cleanupJobs: input.cleanupJobs,
      directories: input.directories,
      facts: input.facts,
      admitted,
    }),
  });
  const workDirectoryAdmission: ConversationWorkDirectoryAdmissionPort = Object.freeze({
    withAdmission: <T>(
      request: ConversationWorkDirectoryAdmissionInput,
      admitted: (directory: ConversationWorkDirectoryResolution) => Promise<T> | T,
    ) => withAvailableConversationWorkDirectory<T>({
      conversationId: request.conversationId,
      gate,
      cleanupJobs: input.cleanupJobs,
      directories: input.directories,
      admit: admitted,
    }),
  });
  return Object.freeze({ gate, persistenceAdmission, workDirectoryAdmission });
}
