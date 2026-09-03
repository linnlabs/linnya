import {
  onBeforeUnmount,
  ref,
  watch,
  type Ref,
} from 'vue';
import { resolveConversationEstimationWidth } from '../functions/conversationContentWidth';

interface UseSettledConversationContentWidthInput {
  readonly contentColumnRef: Readonly<Ref<HTMLElement | null>>;
  readonly resetKey: Readonly<Ref<string>>;
}

export interface SettledConversationContentWidth {
  /** 仅在宽度稳定后提交，供离屏行估高与 virtualizer cache 失效使用。 */
  readonly committedWidthPx: Readonly<Ref<number>>;
  /** 真实内容列正在连续变宽/变窄；供高成本流式渲染避开同一段布局事务。 */
  readonly isChanging: Readonly<Ref<boolean>>;
}

const DEFAULT_CONVERSATION_ESTIMATION_WIDTH_PX = 720;
export const CONVERSATION_WIDTH_SETTLE_DELAY_MS = 120;

function parsePixelValue(rawValue: string): number {
  const parsedValue = Number.parseFloat(rawValue);
  return Number.isFinite(parsedValue) ? Math.max(0, parsedValue) : 0;
}

function readContentSideGap(element: HTMLElement): number {
  return parsePixelValue(
    getComputedStyle(element).getPropertyValue('--conversation-content-side-gap').trim(),
  );
}

function readEstimationWidth(element: HTMLElement, contentColumnWidthPx = element.clientWidth): number {
  return resolveConversationEstimationWidth({
    contentColumnWidthPx,
    contentSideGapPx: readContentSideGap(element),
  });
}

/**
 * 将连续 ResizeObserver 输入收敛成一次最终估高宽度提交。
 * 当前挂载行在动画期间仍由 TanStack 实测；离屏行只在宽度稳定后重新估高。
 */
export function useSettledConversationContentWidth(
  input: UseSettledConversationContentWidthInput,
): SettledConversationContentWidth {
  const committedWidthPx = ref(DEFAULT_CONVERSATION_ESTIMATION_WIDTH_PX);
  const isChanging = ref(false);
  let resizeObserver: ResizeObserver | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingContentColumnWidthPx: number | null = null;
  let observedContentColumnWidthPx: number | null = null;
  let bindingRevision = 0;

  const cancelPendingCommit = (): void => {
    if (settleTimer !== null) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
    pendingContentColumnWidthPx = null;
    isChanging.value = false;
  };

  const commitWidth = (widthPx: number): void => {
    pendingContentColumnWidthPx = null;
    if (committedWidthPx.value === widthPx) return;
    committedWidthPx.value = widthPx;
  };

  const scheduleSettledCommit = (element: HTMLElement, revision: number): void => {
    // ResizeObserver 已经完成当前帧布局；这里只读取列宽，避免动画每帧再读取 computed style。
    pendingContentColumnWidthPx = element.clientWidth;
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      if (revision !== bindingRevision || input.contentColumnRef.value !== element) return;
      const contentColumnWidthPx = pendingContentColumnWidthPx;
      if (contentColumnWidthPx !== null) {
        commitWidth(readEstimationWidth(element, contentColumnWidthPx));
      }
      isChanging.value = false;
    }, CONVERSATION_WIDTH_SETTLE_DELAY_MS);
  };

  const bind = (element: HTMLElement | null): void => {
    bindingRevision += 1;
    const revision = bindingRevision;
    cancelPendingCommit();
    resizeObserver?.disconnect();
    resizeObserver = null;
    observedContentColumnWidthPx = null;
    if (!element) return;

    // 初次挂载直接使用真实列宽，只有后续连续变化需要等待 quiet window。
    observedContentColumnWidthPx = element.clientWidth;
    commitWidth(readEstimationWidth(element));
    if (typeof window === 'undefined' || !window.ResizeObserver) return;

    resizeObserver = new ResizeObserver(() => {
      if (revision !== bindingRevision || input.contentColumnRef.value !== element) return;
      const nextContentColumnWidthPx = element.clientWidth;
      if (observedContentColumnWidthPx === nextContentColumnWidthPx) return;
      observedContentColumnWidthPx = nextContentColumnWidthPx;
      isChanging.value = true;
      scheduleSettledCommit(element, revision);
    });
    resizeObserver.observe(element);
  };

  watch(
    () => [input.contentColumnRef.value, input.resetKey.value] as const,
    ([element]) => bind(element),
    { immediate: true, flush: 'post' },
  );

  onBeforeUnmount(() => {
    bindingRevision += 1;
    cancelPendingCommit();
    resizeObserver?.disconnect();
    resizeObserver = null;
    observedContentColumnWidthPx = null;
  });

  return {
    committedWidthPx,
    isChanging,
  };
}
