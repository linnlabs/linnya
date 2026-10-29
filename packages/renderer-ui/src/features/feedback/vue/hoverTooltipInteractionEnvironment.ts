import { readonly, shallowRef } from 'vue';
import type {
  HoverTooltipInteractionEvent,
  HoverTooltipInputModality,
} from '../definitions/hoverTooltip';
import {
  INITIAL_HOVER_TOOLTIP_INTERACTION_STATE,
  isHoverTooltipModifierOnlyKey,
  reduceHoverTooltipInteractionState,
} from '../functions/hoverTooltipInteraction';
import type { HoverTooltipWindowFocusPort } from '../ports/hoverTooltipWindowFocusPort';

const isWindowActive = shallowRef(INITIAL_HOVER_TOOLTIP_INTERACTION_STATE.isWindowActive);
const inputModality = shallowRef<HoverTooltipInputModality>(
  INITIAL_HOVER_TOOLTIP_INTERACTION_STATE.inputModality,
);

let consumerCount = 0;
let removeNativeWindowFocusListener: (() => void) | null = null;

function applyInteractionEvent(event: HoverTooltipInteractionEvent): void {
  const nextState = reduceHoverTooltipInteractionState({
    inputModality: inputModality.value,
    isWindowActive: isWindowActive.value,
  }, event);
  inputModality.value = nextState.inputModality;
  isWindowActive.value = nextState.isWindowActive;
}

function handleWindowBlur(): void {
  applyInteractionEvent({ type: 'window-blurred' });
}

function handleWindowFocus(): void {
  applyInteractionEvent({ type: 'window-focused' });
}

function handleWindowKeydown(event: KeyboardEvent): void {
  if (isHoverTooltipModifierOnlyKey(event.key)) return;
  applyInteractionEvent({ type: 'keyboard-input' });
}

function handleWindowPointerInput(): void {
  applyInteractionEvent({ type: 'pointer-input' });
}

function handleNativeWindowFocusState(focused: boolean): void {
  applyInteractionEvent({ type: focused ? 'window-focused' : 'window-blurred' });
}

function attachWindowListeners(windowFocusPort: HoverTooltipWindowFocusPort | null): void {
  applyInteractionEvent({ type: 'initialize', focused: document.hasFocus() });
  window.addEventListener('blur', handleWindowBlur);
  window.addEventListener('focus', handleWindowFocus);
  window.addEventListener('keydown', handleWindowKeydown, true);
  window.addEventListener('pointerdown', handleWindowPointerInput, true);
  window.addEventListener('pointermove', handleWindowPointerInput, true);
  removeNativeWindowFocusListener = windowFocusPort?.subscribe(handleNativeWindowFocusState) ?? null;
}

function detachWindowListeners(): void {
  window.removeEventListener('blur', handleWindowBlur);
  window.removeEventListener('focus', handleWindowFocus);
  window.removeEventListener('keydown', handleWindowKeydown, true);
  window.removeEventListener('pointerdown', handleWindowPointerInput, true);
  window.removeEventListener('pointermove', handleWindowPointerInput, true);
  removeNativeWindowFocusListener?.();
  removeNativeWindowFocusListener = null;
}

/** 只读的输入来源与窗口活动状态；由 acquireHoverTooltipInteractionEnvironment 的持有者驱动。 */
export const hoverTooltipInteractionEnvironment = {
  inputModality: readonly(inputModality),
  isWindowActive: readonly(isWindowActive),
};

/** 多个持有者共享一组 browser / native listener，最后一个释放时才卸载。 */
export function acquireHoverTooltipInteractionEnvironment(
  windowFocusPort: HoverTooltipWindowFocusPort | null,
): () => void {
  consumerCount += 1;
  if (consumerCount === 1) attachWindowListeners(windowFocusPort);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    consumerCount -= 1;
    if (consumerCount === 0) detachWindowListeners();
  };
}
