import {
  HOVER_TOOLTIP_WINDOW_FOCUS_PORT_KEY,
  type HoverTooltipWindowFocusPort,
} from '@linnya/renderer-ui';
import type { App } from 'vue';

export function createElectronHoverTooltipWindowFocusPort(): HoverTooltipWindowFocusPort {
  return {
    subscribe(listener) {
      const electronApi = window.electronAPI;
      if (electronApi === undefined || typeof electronApi.onWindowFocusState !== 'function') {
        return () => undefined;
      }
      return electronApi.onWindowFocusState(listener);
    },
  };
}

export function provideHoverTooltipWindowFocus(app: App): void {
  app.provide(
    HOVER_TOOLTIP_WINDOW_FOCUS_PORT_KEY,
    createElectronHoverTooltipWindowFocusPort(),
  );
}
