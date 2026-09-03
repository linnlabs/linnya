/**
 * @file useSidebarResize.ts
 * @description 侧边栏宽度拖拽调整逻辑（布局级通用 composable）
 *
 * 用于布局侧栏的宽度调整。
 * 与业务逻辑无关，只负责处理拖拽交互和宽度计算。
 *
 * 位置说明：
 * - 该逻辑仅由 app/layout 层使用，因此放在 app/layout/composables 下
 * - 如果未来有其他页面/布局需要复用，也可以继续从这里导入
 */

/**
 * useSidebarResize 配置选项
 */
interface UseSidebarResizeOptions {
  /** 从唯一状态源读取当前宽度。 */
  getWidth: () => number;
  /** 最小宽度（像素） */
  minWidth?: number;
  /** 最大宽度（像素） */
  maxWidth?: number;
  /** 拖拽方向：'left' 表示从左边拖拽，'right' 表示从右边拖拽 */
  direction?: 'left' | 'right';
  /** 通过公开 action 写回唯一状态源。 */
  setWidth: (width: number) => void;
}

/**
 * useSidebarResize 返回值类型
 */
interface UseSidebarResizeReturn {
  /** 开始拖拽调整 */
  startResize: (event: PointerEvent) => void;
  /** 用于分割线键盘交互的绝对宽度写入。 */
  resizeTo: (width: number) => void;
  /** 清理事件监听器 */
  cleanup: () => void;
}

/**
 * 侧边栏宽度拖拽调整 composable
 *
 * @param options - 配置选项
 * @returns 宽度状态和事件处理函数
 *
 */
export function useSidebarResize(options: UseSidebarResizeOptions): UseSidebarResizeReturn {
  const {
    getWidth,
    minWidth = 200,
    maxWidth = 500,
    direction = 'right',
    setWidth,
  } = options;

  let startX = 0;
  let startWidth = 0;
  let isResizing = false;
  let pendingWidth: number | null = null;
  let resizeRafId: number | null = null;

  const clampWidth = (width: number) => Math.max(minWidth, Math.min(width, maxWidth));

  const applyWidth = (width: number) => setWidth(clampWidth(width));

  const scheduleWidthApply = (width: number) => {
    pendingWidth = width;
    if (resizeRafId !== null) {
      return;
    }

    resizeRafId = window.requestAnimationFrame(() => {
      resizeRafId = null;
      if (pendingWidth === null) {
        return;
      }

      applyWidth(pendingWidth);
      pendingWidth = null;
    });
  };

  /**
   * 开始拖拽调整
   */
  const startResize = (event: PointerEvent) => {
    isResizing = true;
    startX = event.clientX;
    startWidth = clampWidth(getWidth());

    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
    document.body.classList.add('panel-resizing');

    event.preventDefault();
  };

  /**
   * 拖拽过程中更新宽度
   */
  const resize = (event: PointerEvent) => {
    if (!isResizing) return;

    // 根据拖拽方向计算新宽度
    const delta = event.clientX - startX;
    let newWidth: number;

    if (direction === 'right') {
      // 左侧侧边栏：向右拖拽增加宽度
      newWidth = startWidth + delta;
    } else {
      // 右侧面板：向左拖拽增加宽度
      newWidth = startWidth - delta;
    }

    // 限制在最小和最大宽度之间
    scheduleWidthApply(newWidth);
  };

  /**
   * 停止拖拽
   */
  const stopResize = () => {
    isResizing = false;
    if (pendingWidth !== null) {
      applyWidth(pendingWidth);
      pendingWidth = null;
    }
    if (resizeRafId !== null) {
      window.cancelAnimationFrame(resizeRafId);
      resizeRafId = null;
    }
    window.removeEventListener('pointermove', resize);
    window.removeEventListener('pointerup', stopResize);
    window.removeEventListener('pointercancel', stopResize);
    document.body.classList.remove('panel-resizing');
  };

  /**
   * 清理事件监听器
   */
  const cleanup = () => {
    pendingWidth = null;
    isResizing = false;
    if (resizeRafId !== null) {
      window.cancelAnimationFrame(resizeRafId);
      resizeRafId = null;
    }
    window.removeEventListener('pointermove', resize);
    window.removeEventListener('pointerup', stopResize);
    window.removeEventListener('pointercancel', stopResize);
    document.body.classList.remove('panel-resizing');
  };

  return {
    startResize,
    resizeTo: applyWidth,
    cleanup,
  };
}
