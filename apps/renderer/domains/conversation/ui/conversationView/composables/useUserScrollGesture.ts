import { onUnmounted, watch, type Ref } from 'vue';

export const USER_SCROLL_GESTURE_WINDOW_MS = 250;

const SCROLL_KEYS = new Set([
  'ArrowDown',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp',
  ' ',
]);

/**
 * 对话滚动的原生手势事实源。
 *
 * wheel/touch/key 覆盖滚动输入与惯性尾窗，pointer 生命周期覆盖拖动滚动条。
 * 程序化 scroll 不会激活该状态，因此可安全区分用户手势与 virtualizer 写入。
 */
export function useUserScrollGesture(
  scrollElementRef: Ref<HTMLElement | null | undefined>,
) {
  let pointerActive = false;
  let lastIntentAt = Number.NEGATIVE_INFINITY;
  let attachedElement: HTMLElement | null = null;

  const markIntent = (): void => {
    lastIntentAt = globalThis.performance.now();
  };

  const handlePointerDown = (): void => {
    pointerActive = true;
    markIntent();
  };

  const handlePointerUp = (): void => {
    pointerActive = false;
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (SCROLL_KEYS.has(event.key)) markIntent();
  };

  const detach = (): void => {
    if (attachedElement) {
      attachedElement.removeEventListener('wheel', markIntent);
      attachedElement.removeEventListener('touchmove', markIntent);
      attachedElement.removeEventListener('pointerdown', handlePointerDown);
      attachedElement.removeEventListener('keydown', handleKeyDown);
      attachedElement = null;
    }
    globalThis.window.removeEventListener('pointerup', handlePointerUp);
    pointerActive = false;
  };

  const attach = (element: HTMLElement | null | undefined): void => {
    if (element === attachedElement) return;
    detach();
    if (!element) return;
    attachedElement = element;
    element.addEventListener('wheel', markIntent, { passive: true });
    element.addEventListener('touchmove', markIntent, { passive: true });
    element.addEventListener('pointerdown', handlePointerDown, { passive: true });
    element.addEventListener('keydown', handleKeyDown);
    globalThis.window.addEventListener('pointerup', handlePointerUp, { passive: true });
  };

  watch(
    () => scrollElementRef.value,
    element => attach(element),
    { immediate: true, flush: 'sync' },
  );

  onUnmounted(detach);

  const isGestureActive = (): boolean => (
    pointerActive
    || globalThis.performance.now() - lastIntentAt <= USER_SCROLL_GESTURE_WINDOW_MS
  );

  return { isGestureActive };
}
