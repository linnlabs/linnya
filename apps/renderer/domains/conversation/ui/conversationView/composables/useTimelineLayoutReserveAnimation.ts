import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue';
import {
  calculateTimelineLayoutAnimationReserve,
  type TimelineLayoutAnimationReserve,
} from '../functions/timelineLayoutReserve';

interface UseTimelineLayoutReserveAnimationParams {
  conversationRef: Ref<HTMLElement | undefined>;
  isTimelineCollapsed: () => boolean;
}

const RESERVE_VARIABLE_NAME = '--conversation-content-timeline-reserve-px';
const ANIMATION_DURATION_MS = 240;

function parsePixelValue(rawValue: string): number {
  const parsedValue = Number.parseFloat(rawValue);
  return Number.isFinite(parsedValue) ? Math.max(0, parsedValue) : 0;
}

function readPixelCustomProperty(element: HTMLElement, propertyName: string): number {
  return parsePixelValue(getComputedStyle(element).getPropertyValue(propertyName).trim());
}

function readHorizontalPadding(element: HTMLElement): number {
  const style = getComputedStyle(element);
  return parsePixelValue(style.paddingLeft) + parsePixelValue(style.paddingRight);
}

function easeInOutCubic(progress: number): number {
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

function readTimelineReserve(element: HTMLElement): number {
  const timelineWidth = readPixelCustomProperty(element, '--timeline-width');
  const timelineSpacing = readPixelCustomProperty(element, '--timeline-spacing');
  const timelineOffsetRight = readPixelCustomProperty(element, '--timeline-offset-right');
  return timelineWidth + timelineSpacing + timelineOffsetRight;
}

function resolveAnimationReserve(element: HTMLElement, isTimelineCollapsed: boolean): TimelineLayoutAnimationReserve {
  const contentBoxWidth = Math.max(element.clientWidth - readHorizontalPadding(element), 0);
  return calculateTimelineLayoutAnimationReserve({
    columnMaxWidth: readPixelCustomProperty(element, '--conversation-content-column-max-width'),
    contentBoxWidth,
    currentReserve: readCurrentReserve(element),
    isTimelineCollapsed,
    timelineReserve: readTimelineReserve(element),
  });
}

function readCurrentReserve(element: HTMLElement): number {
  return readPixelCustomProperty(element, RESERVE_VARIABLE_NAME);
}

function writeReserve(element: HTMLElement, reservePx: number): void {
  element.style.setProperty(RESERVE_VARIABLE_NAME, `${reservePx}px`);
}

export function useTimelineLayoutReserveAnimation(params: UseTimelineLayoutReserveAnimationParams): void {
  let animationFrameId: number | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let observedClientWidth: number | null = null;

  const cancelAnimationFrameIfNeeded = (): void => {
    if (animationFrameId === null) return;
    window.cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  };

  const applyTargetReserve = (animate: boolean): void => {
    const element = params.conversationRef.value;
    if (!element) return;

    const animationReserve = resolveAnimationReserve(element, params.isTimelineCollapsed());
    const {
      finalReserve,
      startContentWidth,
      startReserve,
      targetContentWidth,
      targetReserve,
    } = animationReserve;

    cancelAnimationFrameIfNeeded();

    if (
      !animate ||
      Math.abs(startContentWidth - targetContentWidth) < 0.5 ||
      Math.abs(startReserve - targetReserve) < 0.5
    ) {
      writeReserve(element, finalReserve);
      return;
    }

    const startTime = performance.now();
    const delta = targetReserve - startReserve;
    writeReserve(element, startReserve);

    const step = (now: number): void => {
      const rawProgress = Math.min(Math.max((now - startTime) / ANIMATION_DURATION_MS, 0), 1);
      const easedProgress = easeInOutCubic(rawProgress);
      writeReserve(element, startReserve + delta * easedProgress);

      if (rawProgress < 1) {
        animationFrameId = window.requestAnimationFrame(step);
        return;
      }

      animationFrameId = null;
      writeReserve(element, finalReserve);
    };

    animationFrameId = window.requestAnimationFrame(step);
  };

  watch(
    params.isTimelineCollapsed,
    () => {
      applyTargetReserve(true);
    },
    { flush: 'post' },
  );

  onMounted(() => {
    applyTargetReserve(false);

    const element = params.conversationRef.value;
    if (!element || typeof window === 'undefined' || !window.ResizeObserver) return;

    observedClientWidth = element.clientWidth;
    resizeObserver = new ResizeObserver(() => {
      const currentElement = params.conversationRef.value;
      if (!currentElement) return;

      const nextClientWidth = currentElement.clientWidth;
      if (observedClientWidth !== null && Math.abs(nextClientWidth - observedClientWidth) < 0.5) {
        return;
      }

      observedClientWidth = nextClientWidth;
      applyTargetReserve(false);
    });
    resizeObserver.observe(element);
  });

  onBeforeUnmount(() => {
    cancelAnimationFrameIfNeeded();
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
  });
}
