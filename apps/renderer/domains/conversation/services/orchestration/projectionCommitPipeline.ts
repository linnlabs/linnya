import type { useConversationState } from '../../store/conversationState';
import type { MessageProjectionState } from '../messageProjection';
import type { Conversation } from '../../types';

type ConversationStateStore = ReturnType<typeof useConversationState>;

interface ProjectionCommitPipelineDeps {
  conversationState: Pick<ConversationStateStore, 'conversations'>;
}

export interface ProjectionCommitPipeline {
  schedule: (conversationId: string, state: MessageProjectionState) => void;
  flush: (conversationId: string, state?: MessageProjectionState) => void;
  discard: (conversationId: string) => void;
  discardAll: () => void;
  hasPending: (conversationId: string) => boolean;
  hasPendingCommit: (conversationId: string) => boolean;
  hasCommitTimer: (conversationId: string) => boolean;
}

const COMMIT_DELAY_MS = 50;

/**
 * MessageProjection 只拥有消息、消息派生 metadata 与消息活动时间。
 * 标题、标签和创建信息由各自 feature 持有，不能被延迟投影快照整对象覆盖。
 */
export function mergeProjectedConversation(
  current: Conversation,
  projected: Conversation,
): Conversation {
  return {
    ...current,
    messages: [...projected.messages],
    metadata: projected.metadata,
    updatedAt: Math.max(current.updatedAt, projected.updatedAt),
  };
}

/**
 * 投影状态提交管线。
 *
 * 这里只负责“投影内存态 → Vue conversation 数组”的合并提交，不处理历史加载守卫。
 * 历史加载期间的 live 事件拒绝统一留在 projectionStore.handleSseEvent 入口，避免同一不变量散落两处。
 */
export function createProjectionCommitPipeline(
  deps: ProjectionCommitPipelineDeps,
): ProjectionCommitPipeline {
  const pendingProjectionStates = new Map<string, MessageProjectionState>();
  const commitTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const discard = (conversationId: string): void => {
    const timer = commitTimers.get(conversationId);
    if (timer) clearTimeout(timer);
    commitTimers.delete(conversationId);
    pendingProjectionStates.delete(conversationId);
  };

  const discardAll = (): void => {
    for (const timer of commitTimers.values()) clearTimeout(timer);
    commitTimers.clear();
    pendingProjectionStates.clear();
  };

  const hasPendingCommit = (conversationId: string): boolean => pendingProjectionStates.has(conversationId);
  const hasCommitTimer = (conversationId: string): boolean => commitTimers.has(conversationId);
  const hasPending = (conversationId: string): boolean => {
    return hasPendingCommit(conversationId) || hasCommitTimer(conversationId);
  };

  /**
   * 批量提交投影状态到 Vue 响应式层（50ms 合并高频事件）。
   *
   * 为什么必须浅拷贝 messages：
   * 投影器就地修改纯 JS 对象，Vue 无法感知深层 content 变化；替换 messages 数组引用后，
   * activeMessages → turns → renderableItems → visibleItems 的 computed 链路才能稳定传播。
   */
  const schedule = (conversationId: string, state: MessageProjectionState): void => {
    pendingProjectionStates.set(conversationId, state);
    if (commitTimers.has(conversationId)) return;

    const timer = setTimeout(() => {
      try {
        const latest = pendingProjectionStates.get(conversationId);
        if (!latest) return;

        const idx = deps.conversationState.conversations.findIndex(conv => conv.id === conversationId);
        if (idx !== -1) {
          const current = deps.conversationState.conversations[idx];
          if (current) {
            deps.conversationState.conversations[idx] = mergeProjectedConversation(
              current,
              latest.conversation,
            );
          }
        }
      } finally {
        pendingProjectionStates.delete(conversationId);
        const activeTimer = commitTimers.get(conversationId);
        if (activeTimer) clearTimeout(activeTimer);
        commitTimers.delete(conversationId);
      }
    }, COMMIT_DELAY_MS);

    commitTimers.set(conversationId, timer);
  };

  const flush = (conversationId: string, state?: MessageProjectionState): void => {
    if (state) pendingProjectionStates.set(conversationId, state);

    const latest = pendingProjectionStates.get(conversationId);
    if (latest) {
      const idx = deps.conversationState.conversations.findIndex(conv => conv.id === conversationId);
      if (idx !== -1) {
        const current = deps.conversationState.conversations[idx];
        if (current) {
          deps.conversationState.conversations[idx] = mergeProjectedConversation(
            current,
            latest.conversation,
          );
        }
      }
    }

    discard(conversationId);
  };

  return {
    schedule,
    flush,
    discard,
    discardAll,
    hasPending,
    hasPendingCommit,
    hasCommitTimer,
  };
}
