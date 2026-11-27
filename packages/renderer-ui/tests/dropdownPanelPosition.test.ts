// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { nextTick, ref } from 'vue';
import { useDropdownPanelPosition } from '../src/features/select-menu/composables/useDropdownPanelPosition';

function trigger(rect: { left: number; top: number; width: number; height: number }) {
  const element = document.createElement('button');
  element.getBoundingClientRect = () => ({
    ...rect, x: rect.left, y: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height, toJSON: () => rect,
  });
  return element;
}

async function openAt(rect: Parameters<typeof trigger>[0], minWidth: string) {
  const isOpen = ref(false);
  const { optionsPanelStyle } = useDropdownPanelPosition({
    isPortalMode: ref(true),
    isOpen,
    selectRef: ref(trigger(rect)),
    optionsRef: ref(null),
    minWidth: ref(minWidth),
    optionsMaxHeight: ref(''),
    optionsOverflow: ref(''),
  });
  isOpen.value = true;
  await nextTick();
  await nextTick();
  await nextTick();
  return optionsPanelStyle.value;
}

// 位置（翻转、收进视口）在真实 Chromium 的 tests/browser 里验证；jsdom 没有布局，这里只验宽度规则。
describe('useDropdownPanelPosition portal width', () => {
  it('keeps the trigger width when minWidth is not a pixel value', async () => {
    Object.assign(window, { innerWidth: 1400, innerHeight: 900 });
    const style = await openAt({ left: 100, top: 100, width: 60, height: 26 }, '100%');
    expect(style).toMatchObject({ position: 'fixed', width: '60px' });
  });

  it('widens to a pixel minWidth', async () => {
    Object.assign(window, { innerWidth: 1400, innerHeight: 900 });
    const style = await openAt({ left: 1166, top: 850, width: 60, height: 26 }, '300px');
    expect(style).toMatchObject({ width: '300px' });
  });

  it('never grows past the viewport', async () => {
    Object.assign(window, { innerWidth: 280, innerHeight: 900 });
    const style = await openAt({ left: 20, top: 850, width: 60, height: 26 }, '300px');
    expect(style).toMatchObject({ width: '264px' });
  });
});
