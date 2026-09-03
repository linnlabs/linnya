import { inject, onBeforeUnmount, onMounted, readonly, shallowRef } from 'vue';
import type {
  HoverTooltipInteractionEvent,
  HoverTooltipInputModality,
} from '../definitions/hoverTooltip';
import {
  INITIAL_HOVER_TOOLTIP_INTERACTION_STATE,
  isHoverTooltipModifierOnlyKey,
  reduceHoverTooltipInteractionState,
} from '../functions/hoverTooltipInteraction';
import {
  HOVER_TOOLTIP_WINDOW_FOCUS_PORT_KEY,
  type HoverTooltipWindowFocusPort,
} from '../ports/hoverTooltipWindowFocusPort';

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

export function useHoverTooltipInteractionEnvironment() {
  const windowFocusPort = inject(HOVER_TOOLTIP_WINDOW_FOCUS_PORT_KEY, null);

  onMounted(() => {
    consumerCount += 1;
    if (consumerCount === 1) attachWindowListeners(windowFocusPort);
  });

  onBeforeUnmount(() => {
    consumerCount -= 1;
    if (consumerCount === 0) detachWindowListeners();
  });

  return {
    inputModality: readonly(inputModality),
    isWindowActive: readonly(isWindowActive),
  };
}
