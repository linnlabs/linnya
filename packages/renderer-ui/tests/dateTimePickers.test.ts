// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref, type App, type VNode } from 'vue';
import { Modal, MonthCalendar, SimpleDatePicker, TimePicker } from '@linnya/renderer-ui';

interface MountedPicker {
  readonly app: App;
  readonly host: HTMLDivElement;
}

const mountedPickers: MountedPicker[] = [];

function mountPicker(render: () => VNode): HTMLDivElement {
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

function require$<T extends Element>(type: new () => T, root: ParentNode, selector: string): T {
  const element = root.querySelector(selector);
  if (!(element instanceof type)) throw new Error(`${selector} not found`);
  return element;
}

function pressEscape(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
}

afterEach(() => {
  while (mountedPickers.length > 0) {
    const mounted = mountedPickers.pop();
    mounted?.app.unmount();
    mounted?.host.remove();
  }
});

describe('MonthCalendar', () => {
  it('选日、标注日期，并报告当前展示的月份', async () => {
    const selected: Date[] = [];
    const months: Date[] = [];
    const host = mountPicker(() => h(MonthCalendar, {
      modelValue: new Date(2026, 8, 10),
      minDate: new Date(2026, 8, 10),
      isMarked: (date: Date) => date.getDate() === 15,
      'onUpdate:modelValue': (value: Date) => selected.push(value),
      'onUpdate:month': (value: Date) => months.push(value),
    }));

    expect(months).toEqual([new Date(2026, 8, 1)]);
    expect(host.querySelector('[data-date="2026-09-15"]')?.classList).toContain('is-marked');
    expect(require$(HTMLButtonElement, host, '[data-date="2026-09-09"]').disabled).toBe(true);
    expect(host.querySelector('[data-date="2026-08-31"]')).toBeNull();

    require$(HTMLButtonElement, host, '[data-date="2026-09-18"]').click();
    expect(selected).toEqual([new Date(2026, 8, 18)]);

    const [, next] = host.querySelectorAll<HTMLButtonElement>('.linnya-ui-icon-button');
    next?.click();
    await nextTick();
    expect(months.at(-1)).toEqual(new Date(2026, 9, 1));
    expect(host.querySelector('[data-date="2026-10-31"]')).not.toBeNull();
  });

  it('只用来看时不能选日，仍然可以翻月', async () => {
    const host = mountPicker(() => h(MonthCalendar, { modelValue: new Date(2026, 8, 10), selectable: false }));

    expect(Array.from(host.querySelectorAll<HTMLButtonElement>('[data-date]')).every(cell => cell.disabled)).toBe(true);
    host.querySelectorAll<HTMLButtonElement>('.linnya-ui-icon-button')[0]?.click();
    await nextTick();
    expect(host.querySelector('[data-date="2026-08-01"]')).not.toBeNull();
  });

  it('展示的月份可以由外面切换，之后仍能自己翻月', async () => {
    const month = ref(new Date(2026, 8, 1));
    const host = mountPicker(() => h(MonthCalendar, {
      modelValue: null,
      month: month.value,
      'onUpdate:month': (value: Date) => { month.value = value; },
    }));
    expect(host.querySelector('[data-date="2026-09-30"]')).not.toBeNull();

    month.value = new Date(2026, 11, 1);
    await nextTick();
    expect(host.querySelector('[data-date="2026-12-31"]')).not.toBeNull();

    host.querySelectorAll<HTMLButtonElement>('.linnya-ui-icon-button')[1]?.click();
    await nextTick();
    expect(host.querySelector('[data-date="2027-01-31"]')).not.toBeNull();
    expect(month.value).toEqual(new Date(2027, 0, 1));
  });

  it('整个月历只占一个 Tab 位，方向键跨月移动', async () => {
    const host = mountPicker(() => h(MonthCalendar, { modelValue: new Date(2026, 8, 30) }));
    const stops = () => Array.from(host.querySelectorAll('.linnya-month-calendar__cell[tabindex="0"]'));
    expect(stops().map(cell => cell.getAttribute('data-date'))).toEqual(['2026-09-30']);

    stops()[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await nextTick();
    expect(stops().map(cell => cell.getAttribute('data-date'))).toEqual(['2026-10-01']);
    expect(document.activeElement).toBe(stops()[0]);
  });

  it('点标题切到月份选择，选完回到日视图', async () => {
    const host = mountPicker(() => h(MonthCalendar, { modelValue: new Date(2026, 8, 10) }));
    require$(HTMLButtonElement, host, '.linnya-month-calendar__title').click();
    await nextTick();
    host.querySelectorAll<HTMLButtonElement>('.linnya-month-calendar__month')[11]?.click();
    await nextTick();
    expect(host.querySelector('[data-date="2026-12-31"]')).not.toBeNull();
  });
});

describe('SimpleDatePicker', () => {
  it('透传业务触发器 class，面板挂在 body 上，选日保留原时间并把焦点还给触发器', async () => {
    const modelValue = ref(new Date(2026, 8, 10, 14, 27, 45, 321));
    const host = mountPicker(() => h(SimpleDatePicker, {
      modelValue: modelValue.value,
      classNames: { trigger: 'citation-date-trigger' },
      'onUpdate:modelValue': (value: Date | null) => { if (value) modelValue.value = value; },
    }));

    const trigger = require$(HTMLButtonElement, host, '.sdp-input');
    expect(trigger.classList).toContain('citation-date-trigger');
    trigger.click();
    await nextTick();
    await nextTick();

    const panel = require$(HTMLElement, document, '.sdp-panel');
    expect(host.contains(panel)).toBe(false);
    expect(panel.style.position).toBe('fixed');
    expect(panel.querySelectorAll('.linnya-month-calendar__cell')).toHaveLength(42);
    expect(document.activeElement?.getAttribute('data-date')).toBe('2026-09-10');

    require$(HTMLButtonElement, panel, '[data-date="2026-09-15"]').click();
    await waitForLeaveTransition();

    expect(modelValue.value).toEqual(new Date(2026, 8, 15, 14, 27, 45, 321));
    expect(document.querySelector('.sdp-panel')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('点面板里面不关闭，点外面关闭', async () => {
    const host = mountPicker(() => h(SimpleDatePicker, { modelValue: null }));
    require$(HTMLButtonElement, host, '.sdp-input').click();
    await nextTick();
    const panel = require$(HTMLElement, document, '.sdp-panel');

    panel.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await nextTick();
    expect(document.querySelector('.sdp-panel')).not.toBeNull();

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await waitForLeaveTransition();
    expect(document.querySelector('.sdp-panel')).toBeNull();
  });

  it('在弹窗里按 Escape 只关日期面板，不改值', async () => {
    const closeModal = vi.fn();
    const onUpdate = vi.fn();
    mountPicker(() => h(Modal, { isVisible: true, onClose: closeModal }, {
      default: () => h(SimpleDatePicker, { modelValue: new Date(2026, 8, 10), 'onUpdate:modelValue': onUpdate }),
    }));
    require$(HTMLButtonElement, document, '.sdp-input').click();
    await nextTick();

    pressEscape();
    await waitForLeaveTransition();
    expect(document.querySelector('.sdp-panel')).toBeNull();
    expect(closeModal).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();

    pressEscape();
    expect(closeModal).toHaveBeenCalledOnce();
  });
});

describe('TimePicker', () => {
  function mountTimePicker(initial: Date | null) {
    const modelValue = ref<Date | null>(initial);
    const updates: Array<Date | null> = [];
    const host = mountPicker(() => h(TimePicker, {
      modelValue: modelValue.value,
      ariaLabel: '时间',
      'onUpdate:modelValue': (value: Date | null) => {
        updates.push(value);
        modelValue.value = value;
      },
    }));
    const input = require$(HTMLInputElement, host, 'input[aria-label="时间"]');
    return {
      input,
      updates,
      async type(text: string) {
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await nextTick();
      },
      async press(key: string) {
        input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        await nextTick();
      },
    };
  }

  it('直接输入时间，回车生效：保留日期，清零秒和毫秒', async () => {
    const picker = mountTimePicker(new Date(2026, 8, 10, 14, 27, 45, 321));
    expect(picker.input.value).toBe('14:27');

    await picker.type('930');
    expect(picker.updates).toEqual([]);
    await picker.press('Enter');
    await nextTick();

    expect(picker.updates).toEqual([new Date(2026, 8, 10, 9, 30, 0, 0)]);
    expect(picker.input.value).toBe('09:30');
  });

  it('离开时生效；认不出或没有变化时退回原值，不发事件', async () => {
    const picker = mountTimePicker(new Date(2026, 8, 10, 14, 27));

    await picker.type('25:00');
    picker.input.dispatchEvent(new Event('blur'));
    await nextTick();
    expect(picker.input.value).toBe('14:27');

    await picker.type('1427');
    picker.input.dispatchEvent(new Event('blur'));
    await nextTick();
    expect(picker.input.value).toBe('14:27');
    expect(picker.updates).toEqual([]);

    await picker.type('8');
    picker.input.dispatchEvent(new Event('blur'));
    await nextTick();
    expect(picker.updates).toEqual([new Date(2026, 8, 10, 8, 0)]);
  });

  it('点开是半小时一格的列表，选中即生效', async () => {
    const picker = mountTimePicker(new Date(2026, 8, 10, 9, 0));
    picker.input.click();
    await nextTick();

    const options = Array.from(document.querySelectorAll<HTMLElement>('.linnya-time-picker__option'));
    expect(options).toHaveLength(48);
    expect(options.find(option => option.getAttribute('aria-selected') === 'true')?.textContent).toBe('09:00');

    options.find(option => option.textContent === '21:30')?.click();
    await waitForLeaveTransition();
    expect(picker.updates).toEqual([new Date(2026, 8, 10, 21, 30)]);
    expect(picker.input.value).toBe('21:30');
    expect(document.querySelector('.linnya-time-picker__panel')).toBeNull();
  });

  it('方向键打开列表并移动，回车选中', async () => {
    const picker = mountTimePicker(new Date(2026, 8, 10, 9, 0));
    await picker.press('ArrowDown');
    await picker.press('ArrowDown');
    await picker.press('ArrowDown');
    expect(document.querySelector('.linnya-time-picker__option.is-active')?.textContent).toBe('10:00');

    await picker.press('Enter');
    expect(picker.updates).toEqual([new Date(2026, 8, 10, 10, 0)]);
  });

  it('在弹窗里按 Escape 只关列表，丢弃没提交的输入', async () => {
    const closeModal = vi.fn();
    const onUpdate = vi.fn();
    mountPicker(() => h(Modal, { isVisible: true, onClose: closeModal }, {
      default: () => h(TimePicker, { modelValue: new Date(2026, 8, 10, 9, 0), 'onUpdate:modelValue': onUpdate }),
    }));
    const input = require$(HTMLInputElement, document, '.linnya-time-picker input');
    input.click();
    await nextTick();
    input.value = '1';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();

    pressEscape();
    await waitForLeaveTransition();
    expect(input.value).toBe('09:00');
    expect(document.querySelector('.linnya-time-picker__panel')).toBeNull();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(closeModal).not.toHaveBeenCalled();
  });

  it('点面板外面关闭列表', async () => {
    const picker = mountTimePicker(null);
    expect(picker.input.value).toBe('');
    picker.input.click();
    await nextTick();
    expect(document.querySelector('.linnya-time-picker__panel')).not.toBeNull();

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await waitForLeaveTransition();
    expect(document.querySelector('.linnya-time-picker__panel')).toBeNull();
    expect(picker.updates).toEqual([]);
  });
});
