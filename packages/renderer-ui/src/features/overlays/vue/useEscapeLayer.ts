import { onScopeDispose, toValue, watch } from 'vue';
import type { EscapeLayerOptions } from '../definitions/escapeLayer';
import { getEscapeLayerRegistry } from '../registry/escapeLayerRegistry';
import type { UnregisterEscapeLayer } from '../registry/escapeLayerRegistry';

/**
 * 让一个浮层参与 Escape 归属：多层同时打开时，Escape 只交给最后打开的那一层。
 *
 * 最上层不关闭（例如处理中禁止 Esc）时，Escape 也不会落到下面的层。
 * 本函数只管 Escape；焦点、背景 inert 与外部点击不在这里。
 */
export function useEscapeLayer(options: EscapeLayerOptions): void {
  let unregister: UnregisterEscapeLayer | null = null;

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
      unregister = getEscapeLayerRegistry(document).register({
        onEscape: (event) => options.onEscape(event),
      });
    },
    { immediate: true, flush: 'sync' },
  );

  onScopeDispose(release);
}
