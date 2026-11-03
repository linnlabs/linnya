// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia';
import { expect, it } from 'vitest';
import { installCanvasWheelSuggestion } from '../orchestration/installCanvasWheelSuggestion';
import { useCanvasPreferencesStore } from '../store/canvasPreferencesStore';

it('鼠标样式滚轮仅询问一次，不自动改变行为；触控板/捏合不触发且接受后仍可改设置', () => {
  setActivePinia(createPinia()); const host = document.createElement('div'), store = useCanvasPreferencesStore(), suggestion = installCanvasWheelSuggestion(host);
  const wheel = (time: number, options: WheelEventInit) => { const event = new WheelEvent('wheel', options); Object.defineProperty(event, 'timeStamp', { value: time }); host.dispatchEvent(event); };
  for (const time of [0, 50, 100]) wheel(time, { deltaY: 100, ctrlKey: true });
  for (const time of [150, 200, 250]) wheel(time, { deltaY: 5.5, deltaX: 1 });
  expect(suggestion.state.visible.value).toBe(false);
  for (const time of [300, 350, 400]) wheel(time, { deltaY: 100 });
  expect(suggestion.state.visible.value).toBe(true); expect(store.preferences.wheelZoom).toBe(false); expect(store.preferences.wheelSuggestionSeen).toBe(true);
  suggestion.enable(); expect(store.preferences.wheelZoom).toBe(true); expect(suggestion.state.visible.value).toBe(false); suggestion.dispose();
  store.replace({ ...store.preferences, wheelZoom: false }); const second = installCanvasWheelSuggestion(host);
  for (const time of [450, 500, 550]) wheel(time, { deltaY: 100 });
  expect(second.state.visible.value).toBe(false); second.dispose();
});
