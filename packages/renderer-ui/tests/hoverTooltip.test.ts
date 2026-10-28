// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import {
  HoverTooltip,
  HOVER_TOOLTIP_WINDOW_FOCUS_PORT_KEY,
  IconButton,
  resolveHoverTooltipPosition,
  type HoverTooltipWindowFocusPort,
} from '@linnya/renderer-ui';
import { hoverTooltipAttributes } from '../src/features/feedback/functions/hoverTooltipAttributes';
import {
  INITIAL_HOVER_TOOLTIP_INTERACTION_STATE,
  isHoverTooltipModifierOnlyKey,
  reduceHoverTooltipInteractionState,
  resolveHoverTooltipOpenDelay,
  resolveHoverTooltipPlacement,
} from '../src/features/feedback/functions/hoverTooltipInteraction';

interface MountedTooltip {
  readonly app: App;
  readonly button: HTMLButtonElement;
  readonly host: HTMLDivElement;
  readonly trigger: HTMLElement;
  readonly unmount: () => void;
}

const mountedTooltips: MountedTooltip[] = [];

function tooltipElement(): HTMLElement | null {
  return document.body.querySelector('.hover-tooltip');
}

function isTooltipPresented(): boolean {
  return tooltipElement()?.classList.contains('is-open') === true;
}

async function flushTooltipRender(): Promise<void> {
  await nextTick();
  await nextTick();
}

/** 指针悬停提示默认要等待 500ms；键盘与相邻切换不等待。 */
async function waitForOpenDelay(): Promise<void> {
  await vi.advanceTimersByTimeAsync(500);
  await flushTooltipRender();
}

async function waitForCloseDelay(): Promise<void> {
  await vi.advanceTimersByTimeAsync(90);
  await flushTooltipRender();
}

function createPointerEvent(type: string, options: {
  readonly bubbles?: boolean;
  readonly pointerType?: string;
} = {}): Event {
  const event = new Event(type, { bubbles: options.bubbles });
  Object.defineProperty(event, 'pointerType', { value: options.pointerType ?? 'mouse' });
  return event;
}

function mountTooltip(options: {
  readonly disabled?: boolean;
  readonly windowFocusPort?: HoverTooltipWindowFocusPort;
} = {}): MountedTooltip {
  const host = document.createElement('div');
  document.body.appendChild(host);

  const app = createApp({
    render: () => h(HoverTooltip, {
      disabled: options.disabled,
      text: '测试提示',
    }, {
      default: () => h('button', { type: 'button' }, '触发器'),
    }),
  });
  if (options.windowFocusPort !== undefined) {
    app.provide(HOVER_TOOLTIP_WINDOW_FOCUS_PORT_KEY, options.windowFocusPort);
  }
  app.mount(host);

  const button = host.querySelector('button');
  const trigger = host.querySelector('.tooltip-trigger');
  if (!(button instanceof HTMLButtonElement) || !(trigger instanceof HTMLElement)) {
    throw new Error('tooltip trigger not found');
  }

  return {
    app,
    button,
    host,
    trigger,
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
});

afterEach(() => {
  while (mountedTooltips.length > 0) mountedTooltips.pop()?.unmount();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('HoverTooltip 输入来源状态机', () => {
  it('窗口焦点转换会清除旧输入来源', () => {
    const pointerState = reduceHoverTooltipInteractionState(
      INITIAL_HOVER_TOOLTIP_INTERACTION_STATE,
      { type: 'pointer-input' },
    );
    expect(pointerState).toEqual({ inputModality: 'pointer', isWindowActive: true });
    expect(reduceHoverTooltipInteractionState(pointerState, { type: 'window-blurred' })).toEqual({
      inputModality: null,
      isWindowActive: false,
    });
    expect(reduceHoverTooltipInteractionState(pointerState, { type: 'window-focused' })).toEqual({
      inputModality: null,
      isWindowActive: true,
    });
  });

  it('只忽略单独按下的修饰键', () => {
    expect(isHoverTooltipModifierOnlyKey('Shift')).toBe(true);
    expect(isHoverTooltipModifierOnlyKey('Tab')).toBe(false);
  });
});

describe('HoverTooltip 定位', () => {
  it('保持上下放置与水平视口约束', () => {
    const triggerRect = { top: 40, bottom: 60, left: 4, width: 20, height: 20 };
    const tooltipRect = { width: 80, height: 24 };

    expect(resolveHoverTooltipPosition(triggerRect, tooltipRect, 300, 'bottom', 8)).toEqual({
      left: 8,
      top: 68,
    });
    expect(resolveHoverTooltipPosition(
      { ...triggerRect, left: 284 },
      tooltipRect,
      300,
      'top',
      8,
    )).toEqual({
      left: 212,
      top: 8,
    });
  });
});

describe('提示属性', () => {
  it('只有非空文字才会产生属性，落点与间距按需附带', () => {
    expect(hoverTooltipAttributes(undefined)).toEqual({});
    expect(hoverTooltipAttributes('')).toEqual({});
    expect(hoverTooltipAttributes('复制')).toEqual({ 'data-linnya-tooltip': '复制' });
    expect(hoverTooltipAttributes('复制', { placement: 'top', offset: 4 })).toEqual({
      'data-linnya-tooltip': '复制',
      'data-linnya-tooltip-placement': 'top',
      'data-linnya-tooltip-offset': 4,
    });
  });
});

describe('HoverTooltip 出现时机', () => {
  it('首次悬停等待 500ms，相邻切换与短暂离开后的回访无需等待', () => {
    const base = { visible: false, lastHiddenAt: Number.NEGATIVE_INFINITY, now: 10_000, viaKeyboard: false };
    expect(resolveHoverTooltipOpenDelay(base)).toBe(500);
    expect(resolveHoverTooltipOpenDelay({ ...base, viaKeyboard: true })).toBe(0);
    expect(resolveHoverTooltipOpenDelay({ ...base, visible: true })).toBe(0);
    expect(resolveHoverTooltipOpenDelay({ ...base, lastHiddenAt: 9_800 })).toBe(0);
    expect(resolveHoverTooltipOpenDelay({ ...base, lastHiddenAt: 9_600 })).toBe(500);
  });

  it('首选一侧放不下且另一侧放得下时翻转，两侧都放不下保持首选', () => {
    const nearBottom = { top: 560, bottom: 580 };
    expect(resolveHoverTooltipPlacement(nearBottom, 24, 600, 'bottom', 8)).toBe('top');
    expect(resolveHoverTooltipPlacement({ top: 20, bottom: 40 }, 24, 600, 'top', 8)).toBe('bottom');
    expect(resolveHoverTooltipPlacement({ top: 10, bottom: 30 }, 24, 40, 'bottom', 8)).toBe('bottom');
    expect(resolveHoverTooltipPlacement({ top: 100, bottom: 120 }, 24, 600, 'bottom', 8)).toBe('bottom');
  });
});

describe('HoverTooltip 交互来源', () => {
  it('真实指针移动 500ms 后显示，离开触发器后隐藏', async () => {
    const mounted = mountTooltip();
    mountedTooltips.push(mounted);

    mounted.button.dispatchEvent(createPointerEvent('pointermove', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(499);
    expect(isTooltipPresented()).toBe(false);
    await waitForOpenDelay();
    expect(isTooltipPresented()).toBe(true);
    expect(tooltipElement()?.textContent).toBe('测试提示');
    expect(tooltipElement()?.getAttribute('role')).toBe('tooltip');

    mounted.button.dispatchEvent(createPointerEvent('pointerout', { bubbles: true }));
    await waitForCloseDelay();
    expect(isTooltipPresented()).toBe(false);
  });

  it('延迟期间离开触发器会取消提示', async () => {
    const mounted = mountTooltip();
    mountedTooltips.push(mounted);

    mounted.button.dispatchEvent(createPointerEvent('pointermove', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(300);
    mounted.button.dispatchEvent(createPointerEvent('pointerout', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(600);
    expect(isTooltipPresented()).toBe(false);
  });

  it('鼠标产生的焦点不会被误判为键盘提示', async () => {
    const mounted = mountTooltip();
    mountedTooltips.push(mounted);

    mounted.button.dispatchEvent(createPointerEvent('pointerdown', { bubbles: true }));
    mounted.button.focus();
    await waitForOpenDelay();

    expect(document.activeElement).toBe(mounted.button);
    expect(isTooltipPresented()).toBe(false);
  });

  it('键盘导航产生的 focus-visible 焦点立即显示提示，不等待', async () => {
    const mounted = mountTooltip();
    mountedTooltips.push(mounted);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    mounted.button.focus();
    await flushTooltipRender();

    expect(isTooltipPresented()).toBe(true);
    expect(tooltipElement()?.textContent).toBe('测试提示');
  });

  it('窗口失焦后关闭提示，重新聚焦不会恢复旧提示', async () => {
    const mounted = mountTooltip();
    mountedTooltips.push(mounted);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    mounted.button.focus();
    await flushTooltipRender();
    expect(isTooltipPresented()).toBe(true);

    window.dispatchEvent(new Event('blur'));
    await flushTooltipRender();
    expect(isTooltipPresented()).toBe(false);

    window.dispatchEvent(new Event('focus'));
    mounted.button.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await flushTooltipRender();
    expect(isTooltipPresented()).toBe(false);

    mounted.button.blur();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    mounted.button.focus();
    await flushTooltipRender();
    expect(isTooltipPresented()).toBe(true);
  });

  it('通过 Host 注入的窗口焦点端口清除旧悬停状态', async () => {
    let nativeFocusListener: ((focused: boolean) => void) | null = null;
    const windowFocusPort: HoverTooltipWindowFocusPort = {
      subscribe(listener) {
        nativeFocusListener = listener;
        return () => { nativeFocusListener = null; };
      },
    };
    const mounted = mountTooltip({ windowFocusPort });
    mountedTooltips.push(mounted);
    mounted.button.dispatchEvent(createPointerEvent('pointermove', { bubbles: true }));
    await waitForOpenDelay();
    expect(isTooltipPresented()).toBe(true);

    if (nativeFocusListener === null) throw new Error('native focus listener not attached');
    nativeFocusListener(false);
    await flushTooltipRender();
    expect(isTooltipPresented()).toBe(false);

    nativeFocusListener(true);
    mounted.trigger.dispatchEvent(new Event('pointerenter'));
    await waitForOpenDelay();
    expect(isTooltipPresented()).toBe(false);
  });

  it('窗口恢复后必须有新的指针移动才能再次显示旧位置的提示', async () => {
    const mounted = mountTooltip();
    mountedTooltips.push(mounted);

    mounted.button.dispatchEvent(createPointerEvent('pointermove', { bubbles: true }));
    await waitForOpenDelay();
    expect(isTooltipPresented()).toBe(true);

    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
    mounted.trigger.dispatchEvent(new Event('pointerenter'));
    await vi.advanceTimersByTimeAsync(100);
    await flushTooltipRender();
    expect(isTooltipPresented()).toBe(false);

    // 窗口失焦已被记作“刚刚消失”，新的指针移动在 300ms 内回访无需再等待。
    mounted.button.dispatchEvent(createPointerEvent('pointermove', { bubbles: true }));
    await flushTooltipRender();
    expect(isTooltipPresented()).toBe(true);
  });

  it('焦点退出时，只要指针仍在触发器上就保持显示', async () => {
    const mounted = mountTooltip();
    mountedTooltips.push(mounted);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    mounted.button.focus();
    mounted.button.dispatchEvent(createPointerEvent('pointermove', { bubbles: true }));
    mounted.button.blur();
    await flushTooltipRender();

    expect(isTooltipPresented()).toBe(true);

    mounted.button.dispatchEvent(createPointerEvent('pointerout', { bubbles: true }));
    await waitForCloseDelay();
    expect(isTooltipPresented()).toBe(false);
  });

  it('触摸移动和 disabled 状态都不会打开只用于悬停说明的提示', async () => {
    const touchMounted = mountTooltip();
    mountedTooltips.push(touchMounted);
    touchMounted.button.dispatchEvent(createPointerEvent('pointermove', {
      bubbles: true,
      pointerType: 'touch',
    }));
    await waitForOpenDelay();
    expect(isTooltipPresented()).toBe(false);

    touchMounted.unmount();
    mountedTooltips.pop();
    const disabledMounted = mountTooltip({ disabled: true });
    mountedTooltips.push(disabledMounted);
    disabledMounted.button.dispatchEvent(createPointerEvent('pointermove', { bubbles: true }));
    await waitForOpenDelay();
    expect(isTooltipPresented()).toBe(false);
  });

  it('多个消费者共享一组 browser/native listener，并在最后卸载时释放', () => {
    let subscribeCount = 0;
    let cleanupCount = 0;
    const windowFocusPort: HoverTooltipWindowFocusPort = {
      subscribe() {
        subscribeCount += 1;
        return () => { cleanupCount += 1; };
      },
    };
    const first = mountTooltip({ windowFocusPort });
    const second = mountTooltip({ windowFocusPort });

    expect(subscribeCount).toBe(1);
    expect(document.body.querySelectorAll('.hover-tooltip')).toHaveLength(1);
    first.unmount();
    expect(cleanupCount).toBe(0);
    second.unmount();
    expect(cleanupCount).toBe(1);
    expect(tooltipElement()).toBeNull();
  });

  it('点击触发器会收起提示，指针离开前不再弹出；Esc 同样收起', async () => {
    const mounted = mountTooltip();
    mountedTooltips.push(mounted);

    mounted.button.dispatchEvent(createPointerEvent('pointermove', { bubbles: true }));
    await waitForOpenDelay();
    expect(isTooltipPresented()).toBe(true);

    mounted.button.dispatchEvent(createPointerEvent('pointerdown', { bubbles: true }));
    await flushTooltipRender();
    expect(isTooltipPresented()).toBe(false);
    mounted.button.dispatchEvent(createPointerEvent('pointermove', { bubbles: true }));
    await waitForOpenDelay();
    expect(isTooltipPresented()).toBe(false);

    mounted.button.dispatchEvent(createPointerEvent('pointerout', { bubbles: true }));
    mounted.button.dispatchEvent(createPointerEvent('pointermove', { bubbles: true }));
    await waitForOpenDelay();
    expect(isTooltipPresented()).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushTooltipRender();
    expect(isTooltipPresented()).toBe(false);
  });
});

describe('提示服务：相邻按钮之间的切换', () => {
  function mountRow(): { readonly buttons: readonly HTMLButtonElement[]; readonly unmount: () => void } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp({
      render: () => h('div', ['复制', '编辑', '删除'].map(label => h(IconButton, { label }, { default: () => '·' }))),
    });
    app.mount(host);
    const buttons = [...host.querySelectorAll('button')];
    return { buttons, unmount: () => { app.unmount(); host.remove(); } };
  }

  it('IconButton 的名称同时是提示文字，且不再带原生 title', async () => {
    const row = mountRow();
    try {
      expect(row.buttons.map(button => button.getAttribute('aria-label'))).toEqual(['复制', '编辑', '删除']);
      expect(row.buttons.every(button => !button.hasAttribute('title'))).toBe(true);
      expect(row.buttons[0].getAttribute('data-linnya-tooltip')).toBe('复制');
    } finally {
      row.unmount();
    }
  });

  it('首个提示等待 500ms；相邻按钮立即换字且气泡不消失；离开 300ms 内回访立即出现', async () => {
    const row = mountRow();
    try {
      const [copy, edit, remove] = row.buttons;
      copy.dispatchEvent(createPointerEvent('pointermove', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(200);
      expect(isTooltipPresented()).toBe(false);
      await vi.advanceTimersByTimeAsync(300);
      expect(tooltipElement()?.textContent).toBe('复制');

      copy.dispatchEvent(createPointerEvent('pointerout', { bubbles: true }));
      edit.dispatchEvent(createPointerEvent('pointermove', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(10);
      expect(isTooltipPresented()).toBe(true);
      expect(tooltipElement()?.textContent).toBe('编辑');
      await vi.advanceTimersByTimeAsync(200);
      expect(isTooltipPresented()).toBe(true);

      edit.dispatchEvent(createPointerEvent('pointerout', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(90);
      expect(isTooltipPresented()).toBe(false);
      await vi.advanceTimersByTimeAsync(150);
      remove.dispatchEvent(createPointerEvent('pointermove', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(10);
      expect(tooltipElement()?.textContent).toBe('删除');
      expect(isTooltipPresented()).toBe(true);

      remove.dispatchEvent(createPointerEvent('pointerout', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(90 + 400);
      copy.dispatchEvent(createPointerEvent('pointermove', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(300);
      expect(isTooltipPresented()).toBe(false);
      await vi.advanceTimersByTimeAsync(300);
      expect(isTooltipPresented()).toBe(true);
    } finally {
      row.unmount();
    }
  });

  it('显示期间目标被移除时提示自行收起', async () => {
    const row = mountRow();
    try {
      const [copy] = row.buttons;
      copy.dispatchEvent(createPointerEvent('pointermove', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(500);
      expect(isTooltipPresented()).toBe(true);

      copy.remove();
      await vi.advanceTimersByTimeAsync(150);
      expect(isTooltipPresented()).toBe(false);
    } finally {
      row.unmount();
    }
  });
});
