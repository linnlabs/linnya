import { afterEach, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import {
  CANVAS_ZOOM_LIMITS,
  CANVAS_ZOOM_STEP,
  canvasZoomMenuOptions,
  canvasZoomPreset,
} from '../functions/canvasZoomMenu';
import { placeCanvasMenu } from '../functions/placeCanvasMenu';
import {
  CANVAS_SAVE_STATUS_DELAY_MS,
  useCanvasSaveStatus,
} from '../orchestration/useCanvasSaveStatus';

afterEach(() => vi.useRealTimers());
const viewport = { width: 1000, height: 600 };

it('菜单默认在按钮下方左对齐，end 对齐按钮右边，横向收进视口', () => {
  const button = { left: 900, top: 40, right: 928, bottom: 68 };
  expect(
    placeCanvasMenu({ ...button, align: 'start' }, { width: 200, height: 160 }, viewport)
  ).toEqual({ left: 792, top: 72 });
  expect(
    placeCanvasMenu({ ...button, align: 'end' }, { width: 200, height: 160 }, viewport)
  ).toEqual({ left: 728, top: 72 });
  expect(
    placeCanvasMenu(
      { left: 2, top: 40, right: 30, bottom: 68, align: 'start' },
      { width: 200, height: 160 },
      viewport
    ).left
  ).toBe(8);
});

it('下方放不下时翻到锚点上方，上下都放不下时贴视口底边', () => {
  const nearBottom = { left: 100, top: 500, right: 100, bottom: 500, align: 'start' } as const;
  expect(placeCanvasMenu(nearBottom, { width: 180, height: 300 }, viewport).top).toBe(196);
  expect(
    placeCanvasMenu({ ...nearBottom, top: 200, bottom: 200 }, { width: 180, height: 400 }, viewport)
      .top
  ).toBe(192);
});

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
