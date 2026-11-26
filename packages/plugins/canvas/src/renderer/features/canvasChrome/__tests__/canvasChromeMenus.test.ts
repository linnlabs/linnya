import { afterEach, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import {
  CANVAS_ZOOM_LIMITS,
  CANVAS_ZOOM_STEP,
  canvasZoomMenuOptions,
  canvasZoomPreset,
} from '../functions/canvasZoomMenu';
import {
  CANVAS_SAVE_STATUS_DELAY_MS,
  useCanvasSaveStatus,
} from '../orchestration/useCanvasSaveStatus';

afterEach(() => vi.useRealTimers());

it('保存短于阈值不闪“正在保存”，超过阈值才显示，未保存的修改立即显示', async () => {
  vi.useFakeTimers();
  const saving = ref(false),
    unsaved = ref(false),
    scope = effectScope();
  const status = scope.run(() => useCanvasSaveStatus(saving, unsaved));
  expect(status?.value).toBe('saved');
  saving.value = true;
  await nextTick();
  vi.advanceTimersByTime(CANVAS_SAVE_STATUS_DELAY_MS - 1);
  expect(status?.value).toBe('saved');
  saving.value = false;
  await nextTick();
  vi.advanceTimersByTime(CANVAS_SAVE_STATUS_DELAY_MS);
  expect(status?.value).toBe('saved');
  saving.value = true;
  await nextTick();
  vi.advanceTimersByTime(CANVAS_SAVE_STATUS_DELAY_MS);
  expect(status?.value).toBe('saving');
  unsaved.value = true;
  await nextTick();
  expect(status?.value).toBe('failed');
  scope.stop();
});

it('缩放菜单先放“显示全部”，档位只在倍率恰好命中时打勾', () => {
  const options = canvasZoomMenuOptions();
  expect(options[0]).toMatchObject({ value: 'fit', shortcut: '⌘1' });
  expect(options[1]).toMatchObject({ isSeparator: true });
  expect(options.find(option => 'value' in option && option.value === 1)).toMatchObject({
    text: '100%',
    shortcut: '⌘0',
  });
  expect(canvasZoomPreset(1)).toBe(1);
  expect(canvasZoomPreset(0.5004)).toBe(0.5);
  expect(canvasZoomPreset(1.25)).toBeNull();
  expect(CANVAS_ZOOM_LIMITS.max / CANVAS_ZOOM_STEP).toBeLessThan(CANVAS_ZOOM_LIMITS.max);
});
