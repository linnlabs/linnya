/** 缩略图与大图共用的 view-transition-name；同一时刻只会有一张图带着它。 */
export const IMAGE_PREVIEW_TRANSITION_NAME = 'linnya-image-preview';

/** 传入的触发元素可以是缩略图本身，也可以是包着缩略图的按钮。 */
export function resolveImagePreviewSourceImage(trigger: HTMLElement | null | undefined): HTMLImageElement | null {
  if (trigger === null || trigger === undefined) return null;
  if (trigger instanceof HTMLImageElement) return trigger;
  return trigger.querySelector('img');
}

function isIntersectingViewport(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 0
    && rect.height > 0
    && rect.bottom > 0
    && rect.right > 0
    && rect.top < window.innerHeight
    && rect.left < window.innerWidth;
}

/** 只有浏览器支持、用户未要求减少动态效果、且缩略图仍在屏幕上时，才值得做共享元素过渡。 */
export function canRunImagePreviewTransition(source: HTMLImageElement | null): source is HTMLImageElement {
  if (source === null || !source.isConnected) return false;
  if (typeof document.startViewTransition !== 'function') return false;
  if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return false;
  }
  return isIntersectingViewport(source);
}
