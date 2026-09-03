// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick, ref, type App } from 'vue';
import { SimpleDatePicker, TimePicker } from '@linnya/renderer-ui';

interface MountedPicker {
  readonly app: App;
  readonly host: HTMLDivElement;
}

const mountedPickers: MountedPicker[] = [];

function mountPicker(render: () => ReturnType<typeof h>): HTMLDivElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({ render });
  app.mount(host);
  mountedPickers.push({ app, host });
  return host;
}

async function waitForLeaveTransition(): Promise<void> {
  await new Promise<void>(resolve => window.setTimeout(resolve, 200));
  await nextTick();
}

afterEach(() => {
  while (mountedPickers.length > 0) {
    const mounted = mountedPickers.pop();
    mounted?.app.unmount();
    mounted?.host.remove();
  }
});

describe('SimpleDatePicker', () => {
  it('透传业务触发器 class，打开 42 格月历并在选日时保留原时间', async () => {
    const modelValue = ref(new Date(2026, 8, 10, 14, 27, 45, 321));
    const host = mountPicker(() => h(SimpleDatePicker, {
      modelValue: modelValue.value,
      classNames: { trigger: 'citation-date-trigger' },
      'onUpdate:modelValue': (value: Date | null) => { modelValue.value = value; },
    }));

    const trigger = host.querySelector('.sdp-input');
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('Date picker trigger not found');
    expect(trigger.classList).toContain('citation-date-trigger');
    trigger.click();
    await nextTick();

    const cells = Array.from(host.querySelectorAll('.sdp-cell'));
    expect(cells).toHaveLength(42);
    const day = cells.find(cell => !cell.hasAttribute('disabled') && cell.textContent?.trim() === '15');
    if (!(day instanceof HTMLButtonElement)) throw new Error('Current-month date cell not found');
    day.click();
    await nextTick();
    await waitForLeaveTransition();

    expect(modelValue.value).toEqual(new Date(2026, 8, 15, 14, 27, 45, 321));
    expect(host.querySelector('.sdp-panel')).toBeNull();
  });

  it('点击组件外部关闭面板', async () => {
    const host = mountPicker(() => h(SimpleDatePicker, { modelValue: null }));
    const trigger = host.querySelector('.sdp-input');
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('Date picker trigger not found');
    trigger.click();
    await nextTick();
    expect(host.querySelector('.sdp-panel')).not.toBeNull();

    document.body.click();
    await nextTick();
    await waitForLeaveTransition();
    expect(host.querySelector('.sdp-panel')).toBeNull();
  });

  it('按 Escape 关闭面板且不修改值', async () => {
    const modelValue = ref<Date | null>(new Date(2026, 8, 10, 14, 27));
    const host = mountPicker(() => h(SimpleDatePicker, {
      modelValue: modelValue.value,
      'onUpdate:modelValue': (value: Date | null) => { modelValue.value = value; },
    }));
    const trigger = host.querySelector('.sdp-input');
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('Date picker trigger not found');
    trigger.click();
    await nextTick();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();
    await waitForLeaveTransition();

    expect(host.querySelector('.sdp-panel')).toBeNull();
    expect(modelValue.value).toEqual(new Date(2026, 8, 10, 14, 27));
  });
});

describe('TimePicker', () => {
  it('确认时保留日期和当前时分，并清零秒和毫秒', async () => {
    const modelValue = ref<Date | null>(new Date(2026, 8, 10, 14, 27, 45, 321));
    const host = mountPicker(() => h(TimePicker, {
      modelValue: modelValue.value,
      'onUpdate:modelValue': (value: Date | null) => { modelValue.value = value; },
    }));

    const trigger = host.querySelector('.time-button');
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('Time picker trigger not found');
    expect(trigger.textContent?.trim()).toBe('14:27');
    trigger.click();
    await nextTick();

    const confirm = host.querySelector('.time-action-button.primary');
    if (!(confirm instanceof HTMLButtonElement)) throw new Error('Time picker confirm button not found');
    confirm.click();
    await nextTick();
    await waitForLeaveTransition();

    expect(modelValue.value).toEqual(new Date(2026, 8, 10, 14, 27, 0, 0));
    expect(host.querySelector('.time-popover')).toBeNull();
  });

  it('保留非五分钟整点选项，并允许 Escape 关闭且不提交', async () => {
    const updates: Array<Date | null> = [];
    const host = mountPicker(() => h(TimePicker, {
      modelValue: new Date(2026, 8, 10, 14, 27),
      'onUpdate:modelValue': (value: Date | null) => updates.push(value),
    }));
    const trigger = host.querySelector('.time-button');
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('Time picker trigger not found');
    trigger.click();
    await nextTick();

    const selectTriggers = host.querySelectorAll('.time-select-wrapper .select-trigger');
    expect(selectTriggers.item(1).textContent?.trim()).toBe('27');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();
    await waitForLeaveTransition();

    expect(host.querySelector('.time-popover')).toBeNull();
    expect(updates).toEqual([]);
  });

  it('点击组件外部关闭面板且不提交值', async () => {
    const updates: Array<Date | null> = [];
    const host = mountPicker(() => h(TimePicker, {
      modelValue: null,
      'onUpdate:modelValue': (value: Date | null) => updates.push(value),
    }));
    const trigger = host.querySelector('.time-button');
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('Time picker trigger not found');
    trigger.click();
    await nextTick();

    document.body.click();
    await nextTick();
    await waitForLeaveTransition();
    expect(host.querySelector('.time-popover')).toBeNull();
    expect(updates).toEqual([]);
  });
});
