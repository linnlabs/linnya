import { onBeforeUnmount, watch, type Ref } from 'vue';
import highlightState from '../AnnoHighlightState';

export interface UseAnnotationBlockHoverHighlightOptions {
  hoveredBlockId: Ref<string | null>;
}

/**
 * 将 rootBlock hover 同步到批注面板高亮。
 *
 * 中文说明：大文档 Host 路径不再挂载旧 BlockChrome，因此旧路径里
 * `useBlockAnnotations` 注册在 `.root-block-outer` 上的 hover 联动也需要迁到
 * Annotation feature 内部。这里只消费 Host 提供的 hovered blockId，不反向读取
 * Host 或虚拟化内部状态，避免把批注 UI 规则散落到 BlockChromeHost。
 */
export function useAnnotationBlockHoverHighlight(
  options: UseAnnotationBlockHoverHighlightOptions
): void {
  let highlightedBlockId: string | null = null;

  function clearCurrentHighlight(): void {
    if (!highlightedBlockId) return;
    highlightState.clearBlockHighlight(highlightedBlockId);
    highlightedBlockId = null;
  }

  watch(
    () => options.hoveredBlockId.value,
    (nextBlockId) => {
      if (highlightedBlockId && highlightedBlockId !== nextBlockId) {
        highlightState.clearBlockHighlight(highlightedBlockId);
        highlightedBlockId = null;
      }

      if (!nextBlockId) return;

      highlightState.highlightBlock(nextBlockId);
      highlightedBlockId = nextBlockId;
    },
    { immediate: true }
  );

  onBeforeUnmount(() => {
    clearCurrentHighlight();
  });
}
