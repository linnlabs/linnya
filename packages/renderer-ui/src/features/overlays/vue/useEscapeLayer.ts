import { onScopeDispose, toValue, watch } from 'vue';
import type { EscapeLayerOptions } from '../definitions/escapeLayer';
import { getOverlayStack } from '../registry/overlayStack';

/**
 * 让一个临时浮层（下拉、日期面板等）进入浮层栈：多层同时打开时，Escape 只交给最后打开的那一层；
 * 它开着时，下面的弹窗也知道上面还有一层，第一次点弹窗遮罩只关它。
 *
 * 最上层不关闭（例如处理中禁止 Esc）时，Escape 也不会落到下面的层。
 * 外部点击仍由浮层自己关闭；焦点与背景不在这里。模态浮层用 useModalOverlay。
 */
export function useEscapeLayer(options: EscapeLayerOptions): void {
  let unregister: (() => void) | null = null;

  function release(): void {
    unregister?.();
    unregister = null;
  }

  watch(
    () => toValue(options.active),
    (active) => {
      if (!active) {
        release();
        return;
      }
      if (unregister) return;
      unregister = getOverlayStack(window).register({
        onEscape: (event) => options.onEscape(event),
      });
    },
    { immediate: true, flush: 'sync' },
  );

  onScopeDispose(release);
}
