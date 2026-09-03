import type {
  ConversationDirectoryCleanupJobPort,
  ConversationDirectoryPort,
  ConversationWorkDirectoryResolution,
} from '../../../../../domains/conversation-files';
import type {
  ConversationLifecycleGate,
} from '../definitions/conversationLifecycleGate';
import { withConversationAdmissionBarrier } from '../shared/withConversationAdmissionBarrier';

/**
 * callback 在 gate 释放前完成 admission。未来命令入口必须在 callback 内 reserve process owner，
 * 不能先取出 cwd、释放 gate，再登记 owner，否则删除任务可插入两步之间。
 */
export async function withAvailableConversationWorkDirectory<T>(input: {
  readonly conversationId: unknown;
  readonly gate: ConversationLifecycleGate;
  readonly cleanupJobs: ConversationDirectoryCleanupJobPort;
  readonly directories: ConversationDirectoryPort;
  readonly admit: (directory: ConversationWorkDirectoryResolution) => Promise<T> | T;
}): Promise<T> {
  return withConversationAdmissionBarrier({
    conversationId: input.conversationId,
    gate: input.gate,
    cleanupJobs: input.cleanupJobs,
    admit: async identity => {
      const directory = await input.directories.ensureDirectory(identity);
      return input.admit(directory);
    },
  });
}
