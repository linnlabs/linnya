import type {
  ConversationDirectoryCleanupJobPort,
  ConversationDirectoryPort,
} from '../../../../../domains/conversation-files';
import type {
  ConversationFactsPort,
} from '../definitions/conversationFactsPort';
import type {
  ConversationPersistenceAdmission,
  ConversationPersistenceAdmissionInput,
} from '../definitions/conversationPersistenceAdmission';
import type {
  ConversationLifecycleGate,
} from '../definitions/conversationLifecycleGate';
import { projectConversationPersistenceAdmission } from '../functions/projectConversationPersistenceAdmission';
import { withConversationAdmissionBarrier } from '../shared/withConversationAdmissionBarrier';

/**
 * 对话事实快照必须早于目录 ensure：只有这样才能区分真正新对话与功能上线前、
 * 或只迁移了数据库的历史对话。conversation ensure 仍放在目录发布之后，确保后续
 * 持久 run 一旦可见，就一定已有稳定 cwd；若数据库写入失败，重试会复用已发布目录。
 */
export async function admitPersistentConversation<T>(input: {
  readonly request: ConversationPersistenceAdmissionInput;
  readonly gate: ConversationLifecycleGate;
  readonly cleanupJobs: ConversationDirectoryCleanupJobPort;
  readonly directories: ConversationDirectoryPort;
  readonly facts: ConversationFactsPort;
  readonly admitted: (
    admission: ConversationPersistenceAdmission,
  ) => Promise<T> | T;
}): Promise<T> {
  return withConversationAdmissionBarrier({
    conversationId: input.request.conversationId,
    gate: input.gate,
    cleanupJobs: input.cleanupJobs,
    admit: async identity => {
      const conversationExisted = await input.facts.exists(identity.conversationId);
      const directory = await input.directories.ensureDirectory(identity);
      await input.facts.ensure({
        conversationId: identity.conversationId,
        initialEvents: input.request.initialEvents,
        ...(input.request.projectId !== undefined
          ? { projectId: input.request.projectId }
          : {}),
        ...(input.request.mode !== undefined ? { mode: input.request.mode } : {}),
      });
      const admission = projectConversationPersistenceAdmission({
        conversationExisted,
        directory,
      });
      // owner 注册或短 persist-only 提交必须在 callback 返回前完成；否则删除可以插入
      // “准入已通过”和“活动 owner 可见”之间，漏掉刚启动的工作。
      return input.admitted(admission);
    },
  });
}
