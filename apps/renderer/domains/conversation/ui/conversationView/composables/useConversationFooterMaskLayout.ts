import { nextTick, onMounted, onUnmounted, watch } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import { resolveScrollContainer } from '../utils/resolveScrollContainer';

const timelineVisibleHeightVariable = '--conversation-timeline-visible-height';

interface ConversationFooterMaskLayoutElements {
  composer: HTMLElement;
  scrollContainer: HTMLElement;
}

export function useConversationFooterMaskLayout(params: {
  conversationRef: Ref<HTMLElement | undefined>;
  resetKey: ComputedRef<string>;
  watchKey: ComputedRef<string>;
}) {
  let resizeObserver: ResizeObserver | null = null;

  const readElements = (): ConversationFooterMaskLayoutElements | null => {
    const root = params.conversationRef.value;
    if (!root) return null;

    const scrollContainer = resolveScrollContainer(root);
    const composer = scrollContainer.querySelector('.panel-footer');

    if (!(composer instanceof HTMLElement)) {
      return null;
    }

    return { composer, scrollContainer };
  };

  const updateLayout = (): void => {
    const elements = readElements();
    if (!elements) return;

    const scrollContainerHeight = elements.scrollContainer.clientHeight;
    const composerHeight = elements.composer.getBoundingClientRect().height;

    elements.scrollContainer.style.setProperty(
      timelineVisibleHeightVariable,
      `${String(Math.max(0, scrollContainerHeight - composerHeight))}px`,
    );
  };

  const disconnectObservers = (): void => {
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
  };

  const bindObservers = async (): Promise<void> => {
    await nextTick();
    disconnectObservers();

    const elements = readElements();
    if (!elements) return;

    if (typeof window !== 'undefined' && window.ResizeObserver) {
      resizeObserver = new ResizeObserver(() => {
        updateLayout();
      });
      resizeObserver.observe(elements.scrollContainer);
      resizeObserver.observe(elements.composer);
    }

    updateLayout();
  };

  onMounted(() => {
    void bindObservers();
  });

  onUnmounted(() => {
    disconnectObservers();
  });

  watch(
    () => `${params.resetKey.value}:${params.watchKey.value}`,
    () => {
      void bindObservers();
    },
    { flush: 'post' },
  );

  return { updateLayout };
}
