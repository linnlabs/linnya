import type {
  ConversationBatchSelectionState,
  ConversationSelectionGestureInput,
  ConversationSelectionGestureResult,
} from '../definitions/conversationSelection';
import { mergeOrderedSelectionRange } from '@/shared/selection';

export function createSingleConversationBatchSelection(
  conversationId: string,
): ConversationBatchSelectionState {
  return { selectedIds: [conversationId], anchorId: conversationId };
}

export function toggleConversationBatchSelection(
  state: ConversationBatchSelectionState,
  conversationId: string,
): ConversationBatchSelectionState {
  const selected = new Set(state.selectedIds);
  if (selected.has(conversationId)) selected.delete(conversationId);
  else selected.add(conversationId);
  return { selectedIds: [...selected], anchorId: conversationId };
}

export function extendConversationBatchSelection(
  state: ConversationBatchSelectionState,
  orderedConversationIds: readonly string[],
  endId: string,
  fallbackAnchorId: string | null = null,
): ConversationBatchSelectionState {
  const anchorId = state.anchorId ?? fallbackAnchorId;
  if (!anchorId) return createSingleConversationBatchSelection(endId);
  const selectedIds = mergeOrderedSelectionRange({
    selectedIds: state.selectedIds,
    orderedIds: orderedConversationIds,
    anchorId,
    targetId: endId,
  });
  if (!selectedIds) return state;

  // 与文件列表一致：Shift 只扩展选择范围，不把本次落点改成下一次范围选择的起点。
  return { selectedIds, anchorId };
}

/**
 * 把一次列表点击解释成“打开会话”或“更新批量选择”。
 * 普通点击的单选语义由 activeConversationId 承担，不再复制进批量选择集合。
 */
export function resolveConversationSelectionGesture(
  state: ConversationBatchSelectionState,
  orderedConversationIds: readonly string[],
  conversationId: string,
  gesture: ConversationSelectionGestureInput,
): ConversationSelectionGestureResult {
  if (gesture.shiftKey) {
    return {
      kind: 'update-batch-selection',
      selection: extendConversationBatchSelection(
        state,
        orderedConversationIds,
        conversationId,
        gesture.activeConversationId,
      ),
    };
  }
  if (gesture.toggleKey) {
    return {
      kind: 'update-batch-selection',
      selection: toggleConversationBatchSelection(state, conversationId),
    };
  }
  return { kind: 'open-conversation' };
}
