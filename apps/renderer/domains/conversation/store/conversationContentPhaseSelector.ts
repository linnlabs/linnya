import { computed, type ComputedRef } from 'vue';
import {
  resolveConversationContentPhase,
  type ConversationContentPhase,
} from '../functions/conversationContentPhase';
import { useAssistantStore } from './assistantStore';
import { useConversationState } from './conversationState';
import { useMessageWindowStore } from '../message-window/store/messageWindowStore';

interface ConversationContentPhaseSelectorOptions {
  isHistoryReplayLoading?: ComputedRef<boolean>;
  hasRenderableSourceMessages?: ComputedRef<boolean>;
  hasRenderableItems?: ComputedRef<boolean>;
}

export function useConversationContentPhaseSelector(
  options: ConversationContentPhaseSelectorOptions = {},
): ComputedRef<ConversationContentPhase> {
  const assistantStore = useAssistantStore();
  const conversationState = useConversationState();
  const messageWindowStore = useMessageWindowStore();
  const currentConversationId = computed(() => (
    assistantStore.activeConversationId ?? assistantStore.selectedConversationId
  ));
  const isCurrentWindowConversation = computed(() => (
    messageWindowStore.conversationId !== null
    && messageWindowStore.conversationId === currentConversationId.value
  ));

  const isHistoryReplayLoading = options.isHistoryReplayLoading ?? computed(() => (
    (
      conversationState.historyLoadingConversationId !== null
      && conversationState.historyLoadingConversationId === currentConversationId.value
    )
    || (
      isCurrentWindowConversation.value
      && (messageWindowStore.isInitialWindowLoading || messageWindowStore.status === 'preparing')
    )
  ));
  const hasRenderableSourceMessages = options.hasRenderableSourceMessages ?? computed(() => (
    assistantStore.hasRenderableMessages
    || (
      isCurrentWindowConversation.value
      && (
        messageWindowStore.status === 'ready'
        || messageWindowStore.isBackgroundPaging
        || messageWindowStore.isNavigationLoading
      )
      && messageWindowStore.rows.length > 0
    )
  ));
  const hasRenderableItems = options.hasRenderableItems ?? hasRenderableSourceMessages;

  return computed(() => resolveConversationContentPhase({
    activeConversationId: assistantStore.activeConversationId,
    selectedConversationId: assistantStore.selectedConversationId,
    isHistoryReplayLoading: isHistoryReplayLoading.value,
    hasRenderableSourceMessages: hasRenderableSourceMessages.value,
    hasRenderableItems: hasRenderableItems.value,
  }));
}
