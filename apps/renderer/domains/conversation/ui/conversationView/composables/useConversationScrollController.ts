import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import type { BaseMessage } from '../../../types';
import { readBottomDistance, type ConversationScrollMode } from '../functions/scrollPositionController';
import { resolveScrollContainer } from '../utils/resolveScrollContainer';
import { useUserScrollGesture } from './useUserScrollGesture';
import type { ConversationVisualTurnId } from '@app/schemas';

const SCROLL_TO_BOTTOM_BUTTON_THRESHOLD_PX = 200;

export interface ConversationVirtualizerCommands {
  readonly scrollToEnd: () => void;
  readonly scrollToVisualTurn: (
    visualTurnId: ConversationVisualTurnId,
    signal?: AbortSignal,
  ) => Promise<boolean>;
}

export function useConversationScrollController(params: {
  readonly conversationRef: Ref<HTMLElement | undefined>;
  readonly scrollContainerRef: Ref<HTMLElement | null | undefined>;
  readonly messages: ComputedRef<BaseMessage[]>;
  readonly initialRenderableContentKey: ComputedRef<string | null>;
  readonly scrollEndThreshold: Ref<number>;
  readonly resetKey: ComputedRef<string>;
  readonly virtualizer: ConversationVirtualizerCommands;
  readonly onDomMutated?: () => void;
}) {
  const mode = ref<ConversationScrollMode>('follow-bottom');
  const showScrollToBottomBtn = ref(false);
  let domObserver: MutationObserver | null = null;
  let pendingDomMutatedFrame: number | null = null;
  let initialEndPending = true;
  const { isGestureActive: isUserScrollGestureActive } = useUserScrollGesture(
    params.scrollContainerRef,
  );

  const syncViewport = (element: HTMLElement): void => {
    const metrics = {
      scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    };
    const distanceFromBottom = readBottomDistance(metrics);
    showScrollToBottomBtn.value = distanceFromBottom > SCROLL_TO_BOTTOM_BUTTON_THRESHOLD_PX;

    if (distanceFromBottom <= params.scrollEndThreshold.value) {
      mode.value = 'follow-bottom';
      return;
    }

    if (isUserScrollGestureActive()) {
      mode.value = 'anchored';
    }
  };

  const handleScroll = (): void => {
    const element = params.scrollContainerRef.value;
    if (element) syncViewport(element);
  };

  const scrollToBottom = (): void => {
    mode.value = 'follow-bottom';
    void nextTick(() => params.virtualizer.scrollToEnd());
  };

  const applyInitialEndIntentIfReady = (): void => {
    if (!initialEndPending || params.initialRenderableContentKey.value === null) return;
    initialEndPending = false;
    scrollToBottom();
  };

  const scrollToVisualTurn = (
    visualTurnId: ConversationVisualTurnId,
    signal?: AbortSignal,
  ): Promise<boolean> => {
    mode.value = 'free';
    return params.virtualizer.scrollToVisualTurn(visualTurnId, signal);
  };

  const scheduleDomMutationNotification = (): void => {
    if (!params.onDomMutated || pendingDomMutatedFrame !== null) return;
    pendingDomMutatedFrame = window.requestAnimationFrame(() => {
      pendingDomMutatedFrame = null;
      params.onDomMutated?.();
    });
  };

  onMounted(() => {
    const root = params.conversationRef.value;
    const element = root ? resolveScrollContainer(root) : undefined;
    if (!element) return;

    params.scrollContainerRef.value = element;
    syncViewport(element);
    element.addEventListener('scroll', handleScroll, { passive: true });

    if (params.onDomMutated) {
      domObserver = new MutationObserver(scheduleDomMutationNotification);
      domObserver.observe(element, { childList: true, subtree: true, characterData: true });
    }

    applyInitialEndIntentIfReady();
    void nextTick(() => params.onDomMutated?.());
  });

  onUnmounted(() => {
    const element = params.scrollContainerRef.value;
    if (element) {
      element.removeEventListener('scroll', handleScroll);
    }
    domObserver?.disconnect();
    domObserver = null;
    if (pendingDomMutatedFrame !== null) {
      window.cancelAnimationFrame(pendingDomMutatedFrame);
      pendingDomMutatedFrame = null;
    }
  });

  watch(
    () => [params.resetKey.value, params.initialRenderableContentKey.value] as const,
    ([nextResetKey, contentKey], [previousResetKey]) => {
      if (nextResetKey !== previousResetKey) {
        initialEndPending = true;
        mode.value = 'follow-bottom';
        showScrollToBottomBtn.value = false;
      }
      if (contentKey !== null) applyInitialEndIntentIfReady();
    },
    { flush: 'post' },
  );

  return {
    mode: computed(() => mode.value),
    showScrollToBottomBtn,
    scrollToBottomManual: scrollToBottom,
    scrollToVisualTurn,
  };
}
