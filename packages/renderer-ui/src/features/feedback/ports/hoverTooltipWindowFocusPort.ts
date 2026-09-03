import type { InjectionKey } from 'vue';

export interface HoverTooltipWindowFocusPort {
  subscribe(listener: (focused: boolean) => void): () => void;
}

export const HOVER_TOOLTIP_WINDOW_FOCUS_PORT_KEY: InjectionKey<HoverTooltipWindowFocusPort> = Symbol(
  'HOVER_TOOLTIP_WINDOW_FOCUS_PORT_KEY',
);
