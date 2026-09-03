// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import {
  ColorPickerPanel,
  type ColorPickerOption,
} from '@linnya/renderer-ui';

type TestColorKey = 'color.red';

const COLOR: ColorPickerOption<TestColorKey> = {
  value: 'red_text',
  labelKey: 'color.red',
  label: 'Red',
  cssVar: '--test-red',
  fallbackHex: '#d44c47',
};

const mountedApps: Array<{ readonly app: App; readonly host: HTMLDivElement }> = [];

function mountColorPicker(
  props: Record<string, unknown>,
): HTMLDivElement {
  const host = document.createElement('div');
  document.body.append(host);
  const app = createApp({
    render: () => h(ColorPickerPanel, props),
  });
  app.mount(host);
  mountedApps.push({ app, host });
  return host;
}

afterEach(() => {
  while (mountedApps.length > 0) {
    const mounted = mountedApps.pop();
    mounted?.app.unmount();
    mounted?.host.remove();
  }
  document.documentElement.style.removeProperty('--test-red');
});

describe('ColorPickerPanel', () => {
  it('使用业务文案解析器，并把选择结果原样交还业务侧', async () => {
    let selected: ColorPickerOption<TestColorKey> | null = null;
    const host = mountColorPicker({
      showBackground: false,
      textColors: [COLOR],
      currentTextValue: 'red_text',
      textTitle: '文字颜色',
      clearButtonText: '清除',
      labelResolver: (key: TestColorKey) => `resolved:${key}`,
      onSelectText: (color: ColorPickerOption<TestColorKey>) => { selected = color; },
    });
    await nextTick();

    const cell = host.querySelector<HTMLButtonElement>('.shared-color-picker-panel__cell');
    expect(host.querySelector('.shared-color-picker-panel__title')?.textContent).toBe('文字颜色');
    expect(cell?.title).toBe('resolved:color.red');
    expect(cell?.classList.contains('is-current')).toBe(true);

    cell?.click();
    expect(selected).toBe(COLOR);
  });

  it('按主题解析色值标记当前颜色，主题变量缺失时仍使用回退值', async () => {
    document.documentElement.style.setProperty('--test-red', '#AABBCC');
    const themedHost = mountColorPicker({
      showBackground: false,
      showClearButton: false,
      textColors: [COLOR],
      currentTextValue: '#aabbcc',
      compareMode: 'by-resolved-hex',
    });
    await nextTick();
    expect(themedHost.querySelector('.shared-color-picker-panel__cell')?.classList.contains('is-current')).toBe(true);

    document.documentElement.style.removeProperty('--test-red');
    const fallbackHost = mountColorPicker({
      showBackground: false,
      showClearButton: false,
      textColors: [COLOR],
      currentTextValue: '#D44C47',
      compareMode: 'by-resolved-hex',
    });
    await nextTick();
    expect(fallbackHost.querySelector('.shared-color-picker-panel__cell')?.classList.contains('is-current')).toBe(true);
  });
});
