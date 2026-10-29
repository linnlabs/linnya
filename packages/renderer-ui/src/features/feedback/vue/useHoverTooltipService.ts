import { inject, onBeforeUnmount, onMounted } from 'vue';
import { HOVER_TOOLTIP_WINDOW_FOCUS_PORT_KEY } from '../ports/hoverTooltipWindowFocusPort';
import { acquireHoverTooltipService } from './hoverTooltipService';

/**
 * 声明本组件的子树里会出现带 data-linnya-tooltip 的元素；挂载期间共享的提示服务保持运行。
 * 窗口失焦端口沿用 provide 注入（Host 提供），由第一个持有者带入。
 */
export function useHoverTooltipService(): void {
  const windowFocusPort = inject(HOVER_TOOLTIP_WINDOW_FOCUS_PORT_KEY, null);
  let release: (() => void) | null = null;

  onMounted(() => {
    release = acquireHoverTooltipService(windowFocusPort);
  });

  onBeforeUnmount(() => {
    release?.();
    release = null;
  });
}
