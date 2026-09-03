import { nextTick, onMounted, onUnmounted, ref, watch, type ComputedRef, type Ref } from 'vue';
import { resolveConversationVirtualizerGeometry } from '../functions/conversationVirtualizerGeometry';

function readPixelValue(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function useConversationVirtualizerGeometry(params: {
  readonly conversationRef: Ref<HTMLElement | undefined>;
  readonly listStartRef: Ref<HTMLElement | null>;
  readonly scrollElementRef: Ref<HTMLElement | null | undefined>;
  readonly resetKey: ComputedRef<string>;
}) {
  const scrollMargin = ref(0);
  const scrollEndThreshold = ref(16);
  let resizeObserver: ResizeObserver | null = null;

  const updateGeometry = (): void => {
    const conversation = params.conversationRef.value;
    const listStart = params.listStartRef.value;
    const scrollElement = params.scrollElementRef.value;
    if (!conversation || !listStart || !scrollElement) return;

    const footer = scrollElement.querySelector('.panel-footer');
    const geometry = resolveConversationVirtualizerGeometry({
      scrollTop: scrollElement.scrollTop,
      scrollClientTop: scrollElement.clientTop,
      scrollRectTop: scrollElement.getBoundingClientRect().top,
      listRectTop: listStart.getBoundingClientRect().top,
      footerHeight: footer instanceof HTMLElement ? footer.getBoundingClientRect().height : 0,
      contentPaddingBottom: readPixelValue(getComputedStyle(conversation).paddingBottom),
    });
    scrollMargin.value = geometry.scrollMargin;
    scrollEndThreshold.value = geometry.scrollEndThreshold;
  };

  const bind = async (): Promise<void> => {
    await nextTick();
    resizeObserver?.disconnect();
    resizeObserver = null;

    const conversation = params.conversationRef.value;
    const scrollElement = params.scrollElementRef.value;
    if (!conversation || !params.listStartRef.value || !scrollElement) return;

    const footer = scrollElement.querySelector('.panel-footer');
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(updateGeometry);
      resizeObserver.observe(scrollElement);
      resizeObserver.observe(conversation);
      if (footer instanceof HTMLElement) resizeObserver.observe(footer);
    }
    updateGeometry();
  };

  onMounted(() => { void bind(); });
  onUnmounted(() => {
    resizeObserver?.disconnect();
    resizeObserver = null;
  });
  watch(
    () => [
      params.resetKey.value,
      params.listStartRef.value,
      params.scrollElementRef.value,
    ] as const,
    () => { void bind(); },
    { flush: 'post' },
  );

  return { scrollMargin, scrollEndThreshold, updateGeometry };
}
