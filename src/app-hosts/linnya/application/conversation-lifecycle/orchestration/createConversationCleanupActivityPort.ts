import { CommandConversationIdSchema } from '@app/schemas/commands';
import type {
  CommandExecutionOwnerPort,
  CommandProcessObservationPort,
} from '../../../../../domains/commands';
import type {
  ConversationWorkDirectoryConversationId,
} from '../../../../../domains/conversation-files';
import type {
  ConversationCleanupActivityPort,
} from '../definitions/conversationCleanupActivityPort';

export class ConversationCleanupActivityStopError extends Error {
  constructor(readonly failures: readonly unknown[]) {
    super(`Failed to stop ${failures.length} conversation activity owner(s)`);
    this.name = 'ConversationCleanupActivityStopError';
  }
}

/**
 * Flow 与 Commands 必须同时开始并全部等待。若先串行等待 Flow，而 Flow 正在等待 command
 * tool 返回，会形成删除自锁；Promise.allSettled 也保证一边失败时另一边仍完成收尾。
 */
export function createConversationCleanupActivityPort(input: {
  readonly commands: Pick<
    CommandExecutionOwnerPort & CommandProcessObservationPort,
    'beginConversationStop' | 'stopConversationAndWait' | 'forgetDeletedConversation'
  >;
  readonly stopFlowAndWait: (
    conversationId: ConversationWorkDirectoryConversationId,
  ) => Promise<void>;
}): ConversationCleanupActivityPort {
  return Object.freeze({
    beginStopping(conversationId: ConversationWorkDirectoryConversationId) {
      input.commands.beginConversationStop(CommandConversationIdSchema.parse(conversationId));
    },

    async stopAndWait(conversationId: ConversationWorkDirectoryConversationId) {
      const commandConversationId = CommandConversationIdSchema.parse(conversationId);
      const results = await Promise.allSettled([
        input.commands.stopConversationAndWait(commandConversationId),
        input.stopFlowAndWait(conversationId),
      ]);
      const failures = results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map(result => result.reason);
      if (failures.length > 0) {
        throw new ConversationCleanupActivityStopError(Object.freeze(failures));
      }
    },

    forgetDeletedConversation(conversationId: ConversationWorkDirectoryConversationId) {
      input.commands.forgetDeletedConversation(CommandConversationIdSchema.parse(conversationId));
    },
  });
}
