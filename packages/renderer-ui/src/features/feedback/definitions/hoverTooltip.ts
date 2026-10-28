export type HoverTooltipPlacement = 'top' | 'bottom';

/** 提示出现前的等待：避免鼠标扫过时满屏闪烁。键盘聚焦与相邻切换不等待。 */
export const HOVER_TOOLTIP_OPEN_DELAY_MS = 500;
/** 指针离开后保留的时间：从一个按钮移到相邻按钮时，提示不会先消失再出现。 */
export const HOVER_TOOLTIP_CLOSE_DELAY_MS = 90;
/** 提示刚消失后的这段时间内再次悬停，视为仍在同一排控件上，无需等待。 */
export const HOVER_TOOLTIP_WARM_WINDOW_MS = 300;
export const HOVER_TOOLTIP_DEFAULT_OFFSET = 8;

/** 任何带有该属性的元素都会获得提示；值是提示文字，空值表示没有提示。 */
export const HOVER_TOOLTIP_TEXT_ATTRIBUTE = 'data-linnya-tooltip';
export const HOVER_TOOLTIP_PLACEMENT_ATTRIBUTE = 'data-linnya-tooltip-placement';
export const HOVER_TOOLTIP_OFFSET_ATTRIBUTE = 'data-linnya-tooltip-offset';

export interface HoverTooltipProps {
  readonly text: string;
  readonly placement?: HoverTooltipPlacement;
  readonly offset?: number;
  readonly disabled?: boolean;
}

export interface HoverTooltipRectangle {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export interface HoverTooltipPosition {
  readonly top: number;
  readonly left: number;
}

export type HoverTooltipInputModality = 'keyboard' | 'pointer' | null;

export interface HoverTooltipInteractionState {
  readonly inputModality: HoverTooltipInputModality;
  readonly isWindowActive: boolean;
}

export type HoverTooltipInteractionEvent =
  | { readonly type: 'initialize'; readonly focused: boolean }
  | { readonly type: 'window-blurred' }
  | { readonly type: 'window-focused' }
  | { readonly type: 'keyboard-input' }
  | { readonly type: 'pointer-input' };
