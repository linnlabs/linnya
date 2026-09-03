// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, type App } from 'vue';
import { CustomNumberInput, type NumberInputValue } from '@linnya/renderer-ui';

const mountedApps: Array<{ readonly app: App; readonly host: HTMLDivElement }> = [];

function mountNumberInput(options: {
  readonly modelValue: NumberInputValue;
  readonly min?: number;
  readonly max?: number;
  readonly showSpinButtons?: boolean;
  readonly onUpdate?: (value: NumberInputValue) => void;
  readonly onStepUp?: () => void;
  readonly onStepDown?: () => void;
}): HTMLDivElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({
    render: () => h(CustomNumberInput, {
      modelValue: options.modelValue,
      min: options.min,
      max: options.max,
      showSpinButtons: options.showSpinButtons,
      inputClass: 'consumer-number-control',
      inputmode: 'decimal',
      'onUpdate:modelValue': options.onUpdate,
      onStepUp: options.onStepUp,
      onStepDown: options.onStepDown,
    }),
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
});

describe('CustomNumberInput', () => {
  it('保留空值并把有效小数投影为 number，同时只通过业务 class 扩展原生 input', () => {
    const updates: NumberInputValue[] = [];
    const host = mountNumberInput({
      modelValue: '',
      min: 0,
      max: 10,
      onUpdate: value => updates.push(value),
    });

    const input = host.querySelector('input');
    if (!(input instanceof HTMLInputElement)) throw new Error('CustomNumberInput control not found');
    expect(input.classList.contains('consumer-number-control')).toBe(true);
    expect(input.getAttribute('inputmode')).toBe('decimal');

    input.value = '2.75';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(updates).toEqual([2.75, '']);
  });

  it('根据 min/max 禁用对应步进方向并保持共享可访问文案和事件', () => {
    let stepUpCount = 0;
    let stepDownCount = 0;
    const host = mountNumberInput({
      modelValue: 10,
      min: 0,
      max: 10,
      showSpinButtons: true,
      onStepUp: () => { stepUpCount += 1; },
      onStepDown: () => { stepDownCount += 1; },
    });

    const up = host.querySelector('.spin-btn.up');
    const down = host.querySelector('.spin-btn.down');
    if (!(up instanceof HTMLButtonElement) || !(down instanceof HTMLButtonElement)) {
      throw new Error('CustomNumberInput spin buttons not found');
    }

    expect(up.disabled).toBe(true);
    expect(up.getAttribute('aria-label')).toBe('增加数值');
    expect(down.disabled).toBe(false);
    expect(down.getAttribute('aria-label')).toBe('减少数值');

    up.click();
    down.click();
    expect(stepUpCount).toBe(0);
    expect(stepDownCount).toBe(1);
  });
});
