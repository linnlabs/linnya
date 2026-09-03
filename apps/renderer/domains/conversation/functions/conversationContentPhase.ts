export type ConversationContentPhase =
  | 'draft'
  | 'history-loading'
  | 'ready'
  | 'ready-empty';

export interface ResolveConversationContentPhaseInput {
  activeConversationId: string | null;
  selectedConversationId: string | null;
  isHistoryReplayLoading: boolean;
  hasRenderableSourceMessages: boolean;
  hasRenderableItems: boolean;
}

export function isConversationHistoryPendingPhase(phase: ConversationContentPhase): boolean {
  return phase === 'history-loading';
}

/**
 * Surface 只在需要真实会话内容树时挂载 Host。
 *
 * history-loading 必须挂载 Host 承载加载态；draft / ready-empty 则由 Surface
 * 展示可输入空态。这个边界保证 virtualizer、Teleport 与滚动 observer 同进同退。
 */
export function shouldMountConversationHost(phase: ConversationContentPhase): boolean {
  return phase === 'history-loading' || phase === 'ready';
}

/**
 * 对话内容生命周期的唯一判定入口。
 *
 * 为什么这里同时看 source message 和 render item：
 * 历史窗口加载期间不展示“半 ready”预览态。窗口 ready 后再由消费方读取 window ∪ live
 * 合成视图，避免 loading 壳和可渲染数据源各自发明生命周期口径。
 */
export function resolveConversationContentPhase(
  input: ResolveConversationContentPhaseInput,
): ConversationContentPhase {
  const currentConversationId = input.activeConversationId ?? input.selectedConversationId;

  if (!currentConversationId) {
    return 'draft';
  }

  const hasRenderableContent = input.hasRenderableSourceMessages && input.hasRenderableItems;

  if (input.isHistoryReplayLoading) {
    return 'history-loading';
  }

  return hasRenderableContent ? 'ready' : 'ready-empty';
}
