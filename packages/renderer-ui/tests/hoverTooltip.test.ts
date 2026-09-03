// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import {
  HoverTooltip,
  HOVER_TOOLTIP_WINDOW_FOCUS_PORT_KEY,
  resolveHoverTooltipPosition,
  type HoverTooltipWindowFocusPort,
} from '@linnya/renderer-ui';
import {
  INITIAL_HOVER_TOOLTIP_INTERACTION_STATE,
  isHoverTooltipModifierOnlyKey,
  reduceHoverTooltipInteractionState,
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
  const tooltip = tooltipElement();
  return tooltip !== null && !tooltip.classList.contains('tooltip-fade-leave-active');
}

async function flushTooltipRender(): Promise<void> {
  await nextTick();
  await nextTick();
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
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
});

afterEach(() => {
  while (mountedTooltips.length > 0) mountedTooltips.pop()?.unmount();
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

describe('HoverTooltip 交互来源', () => {
  it('真实指针移动时显示，离开触发器后隐藏', async () => {
    const mounted = mountTooltip();
    mountedTooltips.push(mounted);

    mounted.button.dispatchEvent(createPointerEvent('pointermove', { bubbles: true }));
    await flushTooltipRender();
    expect(tooltipElement()?.textContent).toBe('测试提示');

    mounted.trigger.dispatchEvent(new Event('pointerleave'));
    await flushTooltipRender();
    expect(isTooltipPresented()).toBe(false);
  });

  it('鼠标产生的焦点不会被误判为键盘提示', async () => {
    const mounted = mountTooltip();
    mountedTooltips.push(mounted);

    mounted.button.dispatchEvent(createPointerEvent('pointerdown', { bubbles: true }));
    mounted.button.focus();
    await flushTooltipRender();

    expect(document.activeElement).toBe(mounted.button);
    expect(isTooltipPresented()).toBe(false);
  });

  it('键盘导航产生的 focus-visible 焦点会显示提示', async () => {
    const mounted = mountTooltip();
    mountedTooltips.push(mounted);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    mounted.button.focus();
    await flushTooltipRender();

    expect(tooltipElement()?.textContent).toBe('测试提示');
  });

  it('窗口失焦后关闭提示，重新聚焦不会恢复旧提示', async () => {
    const mounted = mountTooltip();
    mountedTooltips.push(mounted);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    mounted.button.focus();
    await flushTooltipRender();
    expect(tooltipElement()).not.toBeNull();

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
    expect(tooltipElement()?.textContent).toBe('测试提示');
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
    await flushTooltipRender();
    expect(tooltipElement()?.textContent).toBe('测试提示');

    if (nativeFocusListener === null) throw new Error('native focus listener not attached');
    nativeFocusListener(false);
    await flushTooltipRender();
    expect(isTooltipPresented()).toBe(false);

    nativeFocusListener(true);
    mounted.trigger.dispatchEvent(new Event('pointerenter'));
    await flushTooltipRender();
    expect(isTooltipPresented()).toBe(false);
  });

  it('窗口恢复后必须有新的指针移动才能再次显示旧位置的提示', async () => {
    const mounted = mountTooltip();
    mountedTooltips.push(mounted);

    mounted.button.dispatchEvent(createPointerEvent('pointermove', { bubbles: true }));
    await flushTooltipRender();
    expect(tooltipElement()).not.toBeNull();

    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
    mounted.trigger.dispatchEvent(new Event('pointerenter'));
    await flushTooltipRender();
    expect(isTooltipPresented()).toBe(false);

    mounted.button.dispatchEvent(createPointerEvent('pointermove', { bubbles: true }));
    await flushTooltipRender();
    expect(tooltipElement()?.textContent).toBe('测试提示');
  });

  it('焦点退出时，只要指针仍在触发器上就保持显示', async () => {
    const mounted = mountTooltip();
    mountedTooltips.push(mounted);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    mounted.button.focus();
    mounted.button.dispatchEvent(createPointerEvent('pointermove', { bubbles: true }));
    mounted.button.blur();
    await flushTooltipRender();

    expect(tooltipElement()?.textContent).toBe('测试提示');

    mounted.trigger.dispatchEvent(new Event('pointerleave'));
    await flushTooltipRender();
    expect(isTooltipPresented()).toBe(false);
  });

  it('触摸移动和 disabled 状态都不会打开只用于悬停说明的提示', async () => {
    const touchMounted = mountTooltip();
    mountedTooltips.push(touchMounted);
    touchMounted.button.dispatchEvent(createPointerEvent('pointermove', {
      bubbles: true,
      pointerType: 'touch',
    }));
    await flushTooltipRender();
    expect(isTooltipPresented()).toBe(false);

    touchMounted.unmount();
    mountedTooltips.pop();
    const disabledMounted = mountTooltip({ disabled: true });
    mountedTooltips.push(disabledMounted);
    disabledMounted.button.dispatchEvent(createPointerEvent('pointermove', { bubbles: true }));
    await flushTooltipRender();
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
    first.unmount();
    expect(cleanupCount).toBe(0);
    second.unmount();
    expect(cleanupCount).toBe(1);
  });
});
