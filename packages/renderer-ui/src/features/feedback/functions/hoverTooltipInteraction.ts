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
