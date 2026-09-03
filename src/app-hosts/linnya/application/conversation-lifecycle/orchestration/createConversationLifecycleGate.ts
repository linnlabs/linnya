import type {
  ConversationWorkDirectoryConversationId,
} from '../../../../../domains/conversation-files';
import type {
  ConversationLifecycleGate,
  ConversationLifecycleGateScope,
} from '../definitions/conversationLifecycleGate';

/**
 * 内存 gate 只负责当前 App owner 内的竞态排序；跨重启删除屏障仍由 SQLite cleanup job 持有。
 * 同一对话的公开 use case 必须是叶子入口，不能在回调内再次获取同一 gate，否则会自我等待。
 */
export function createConversationLifecycleGate(): ConversationLifecycleGate {
  const tails = new Map<ConversationWorkDirectoryConversationId, Promise<void>>();

  return Object.freeze({
    async runExclusive<T>(input: {
      readonly scope: ConversationLifecycleGateScope;
      readonly run: () => Promise<T> | T;
    }): Promise<T> {
      const conversationId = input.scope.conversationId;
      const previous = tails.get(conversationId) ?? Promise.resolve();
      let releaseCurrent: () => void = () => {};
      const current = new Promise<void>((resolve) => {
        releaseCurrent = resolve;
      });
      const tail = previous.then(() => current);
      tails.set(conversationId, tail);

      await previous;
      try {
        return await input.run();
      } finally {
        releaseCurrent();
        if (tails.get(conversationId) === tail) {
          tails.delete(conversationId);
        }
      }
    },
  });
}
