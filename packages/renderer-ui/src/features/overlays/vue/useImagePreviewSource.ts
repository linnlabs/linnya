import { shallowRef } from 'vue';

/**
 * 记录触发预览的缩略图，供 ImagePreviewModal 的 sourceElement 使用：
 * 在打开预览的点击处调用 rememberSource($event) 即可。
 * 触发按钮不包着缩略图、而与缩略图同在一个容器里时，传入容器选择器（如 '.image-container'）。
 */
export function useImagePreviewSource() {
  const sourceElement = shallowRef<HTMLElement | null>(null);

  function rememberSource(event: Event, containerSelector?: string): void {
    const trigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    sourceElement.value = containerSelector === undefined
      ? trigger
      : trigger?.closest<HTMLElement>(containerSelector) ?? null;
  }

  return { sourceElement, rememberSource };
}
