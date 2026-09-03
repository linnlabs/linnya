import { onBeforeUnmount } from 'vue';

interface UseRightPaneResizeOptions {
  getRightBoundary: () => number;
  getWidthLimits: () => { min: number; max: number };
  setWidth: (width: number) => void;
}

interface UseRightPaneResizeReturn {
  startResize: (event: PointerEvent) => void;
}

/**
 * 右侧 pane 的宽度拖拽契约：右边界固定，用户拖动左边界。
 *
 * 文档 pane 和对话 pane 都属于 AppLayout 的右侧几何，不应该各自维护
 * 一套 delta 计算。这里直接用“右边界 - 当前鼠标 X”得到宽度，避免
 * transition 或 flex 重新排布时让视觉锚点漂移。
 */
export function useRightPaneResize(options: UseRightPaneResizeOptions): UseRightPaneResizeReturn {
  let isResizing = false;
  let rightBoundary = 0;
  let resizeRafId: number | null = null;
  let pendingWidth: number | null = null;

  const flushWidth = () => {
    resizeRafId = null;
    if (pendingWidth === null) return;
    options.setWidth(pendingWidth);
    pendingWidth = null;
  };

  const scheduleWidth = (width: number) => {
    const limits = options.getWidthLimits();
    pendingWidth = Math.min(limits.max, Math.max(limits.min, width));
    if (resizeRafId !== null) return;
    resizeRafId = window.requestAnimationFrame(flushWidth);
  };

  const stopResize = () => {
    if (!isResizing) return;
    isResizing = false;
    rightBoundary = 0;

    if (resizeRafId !== null) {
      window.cancelAnimationFrame(resizeRafId);
      resizeRafId = null;
    }
    if (pendingWidth !== null) {
      options.setWidth(pendingWidth);
      pendingWidth = null;
    }

    document.body.classList.remove('panel-resizing');
    document.body.classList.remove('workspace-split-resizing');
    window.removeEventListener('pointermove', handleResizeMove);
    window.removeEventListener('pointerup', stopResize);
    window.removeEventListener('pointercancel', stopResize);
  };

  const handleResizeMove = (event: PointerEvent) => {
    if (!isResizing) return;
    scheduleWidth(rightBoundary - event.clientX);
  };

  const startResize = (event: PointerEvent) => {
    const limits = options.getWidthLimits();
    if (limits.max < limits.min) return;

    event.preventDefault();
    isResizing = true;
    rightBoundary = options.getRightBoundary();

    document.body.classList.add('panel-resizing');
    document.body.classList.add('workspace-split-resizing');
    window.addEventListener('pointermove', handleResizeMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
  };

  onBeforeUnmount(stopResize);

  return { startResize };
}
