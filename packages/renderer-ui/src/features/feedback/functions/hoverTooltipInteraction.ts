import {
  HOVER_TOOLTIP_OPEN_DELAY_MS,
  HOVER_TOOLTIP_WARM_WINDOW_MS,
} from '../definitions/hoverTooltip';
import type {
  HoverTooltipInteractionEvent,
  HoverTooltipInteractionState,
  HoverTooltipPlacement,
  HoverTooltipPosition,
  HoverTooltipRectangle,
} from '../definitions/hoverTooltip';

export const INITIAL_HOVER_TOOLTIP_INTERACTION_STATE: HoverTooltipInteractionState = Object.freeze({
  inputModality: null,
  isWindowActive: true,
});

export function reduceHoverTooltipInteractionState(
  state: HoverTooltipInteractionState,
  event: HoverTooltipInteractionEvent,
): HoverTooltipInteractionState {
  switch (event.type) {
    case 'initialize':
      return { inputModality: null, isWindowActive: event.focused };
    case 'window-blurred':
      return { inputModality: null, isWindowActive: false };
    case 'window-focused':
      // 窗口恢复时 Chromium 可能重新派发旧控件的 focusin；等待新的真实输入再决定来源。
      return { inputModality: null, isWindowActive: true };
    case 'keyboard-input':
      return { ...state, inputModality: 'keyboard' };
    case 'pointer-input':
      return { ...state, inputModality: 'pointer' };
  }
}

export function isHoverTooltipModifierOnlyKey(key: string): boolean {
  return key === 'Alt' || key === 'Control' || key === 'Meta' || key === 'Shift';
}

export function resolveHoverTooltipPosition(
  triggerRect: HoverTooltipRectangle,
  tooltipRect: Pick<HoverTooltipRectangle, 'width' | 'height'>,
  viewportWidth: number,
  placement: HoverTooltipPlacement,
  offset: number,
  viewportPadding = 8,
): HoverTooltipPosition {
  const centerLeft = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
  const maximumLeft = viewportWidth - tooltipRect.width - viewportPadding;
  const left = Math.min(maximumLeft, Math.max(viewportPadding, centerLeft));

  return {
    left,
    top: placement === 'top'
      ? triggerRect.top - tooltipRect.height - offset
      : triggerRect.bottom + offset,
  };
}

export interface HoverTooltipOpenDelayInput {
  /** 当前是否已有提示在显示（从一个目标移到另一个目标）。 */
  readonly visible: boolean;
  readonly lastHiddenAt: number;
  readonly now: number;
  readonly viaKeyboard: boolean;
}

/** 键盘聚焦、已在显示、或刚刚消失不久时立即出现；否则等待 HOVER_TOOLTIP_OPEN_DELAY_MS。 */
export function resolveHoverTooltipOpenDelay(input: HoverTooltipOpenDelayInput): number {
  if (input.visible || input.viaKeyboard) return 0;
  if (input.now - input.lastHiddenAt < HOVER_TOOLTIP_WARM_WINDOW_MS) return 0;
  return HOVER_TOOLTIP_OPEN_DELAY_MS;
}

/** 首选一侧放不下而另一侧放得下时翻到另一侧；两侧都放不下保持首选。 */
export function resolveHoverTooltipPlacement(
  triggerRect: Pick<HoverTooltipRectangle, 'top' | 'bottom'>,
  tooltipHeight: number,
  viewportHeight: number,
  preferred: HoverTooltipPlacement,
  offset: number,
  viewportPadding = 8,
): HoverTooltipPlacement {
  const fitsBelow = triggerRect.bottom + offset + tooltipHeight <= viewportHeight - viewportPadding;
  const fitsAbove = triggerRect.top - offset - tooltipHeight >= viewportPadding;
  if (preferred === 'bottom') return fitsBelow || !fitsAbove ? 'bottom' : 'top';
  return fitsAbove || !fitsBelow ? 'top' : 'bottom';
}
