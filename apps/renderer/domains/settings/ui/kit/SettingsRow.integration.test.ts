// @vitest-environment jsdom

import { createApp, defineComponent, h, type App } from 'vue';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CustomSelect, CustomTextInput } from '@linnya/renderer-ui';

import SettingsRow from './SettingsRow.vue';

describe('SettingsRow control layout contract', () => {
  let app: App<Element> | undefined;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
  });

  afterEach(() => {
    app?.unmount();
    container.remove();
    app = undefined;
  });

  it('下拉和输入框无需业务 class 也进入同一个标准字段列', () => {
    app = createApp(defineComponent({
      setup() {
        return () => h('div', [
          h(SettingsRow, { label: '下拉' }, {
            default: () => h(CustomSelect, {
              modelValue: 'a',
              options: [{ value: 'a', text: 'A' }],
            }),
          }),
          h(SettingsRow, { label: '输入' }, {
            default: () => h(CustomTextInput, { modelValue: '' }),
          }),
          h(SettingsRow, { label: '组合控件', control: 'fill' }, {
            default: () => h('div', '组合内容'),
          }),
        ]);
      },
    }));
    app.mount(container);

    const rows = Array.from(container.querySelectorAll('.settings-row'));
    expect(rows[0]?.classList.contains('is-control-field')).toBe(true);
    expect(rows[1]?.classList.contains('is-control-field')).toBe(true);
    expect(rows[2]?.classList.contains('is-control-fill')).toBe(true);
  });
});
