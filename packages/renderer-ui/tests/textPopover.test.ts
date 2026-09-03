// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';
import { TextPopover } from '../src';

interface MountedTextPopover {
  readonly host: HTMLElement;
  readonly unmount: () => void;
}

function mountTextPopover(props: Record<string, unknown> = {}): MountedTextPopover {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({
    render() {
      return h(TextPopover, {
        content: '<strong>可信内容</strong>',
        triggerText: '详情',
        ...props,
      });
    },
  });
  app.mount(host);

  return {
    host,
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

const mountedPopovers: MountedTextPopover[] = [];

afterEach(() => {
  while (mountedPopovers.length > 0) mountedPopovers.pop()?.unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function installAnimationFrameStub(): void {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
}

describe('TextPopover 触发与生命周期', () => {
  it('点击触发器显示可信内容，点击组件外部后关闭', async () => {
    vi.useFakeTimers();
    installAnimationFrameStub();
    const mounted = mountTextPopover();
    mountedPopovers.push(mounted);
    vi.advanceTimersByTime(150);

    const trigger = mounted.host.querySelector('.popover-trigger');
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('TextPopover trigger not found');
    trigger.click();
    await nextTick();

    expect(mounted.host.querySelector('.popover-text strong')?.textContent).toBe('可信内容');

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(mounted.host.querySelector('.popover-panel')).toBeNull();
  });

  it('hover 模式允许指针从触发器移动到面板，并在离开面板时关闭', async () => {
    vi.useFakeTimers();
    installAnimationFrameStub();
    const mounted = mountTextPopover({ triggerMode: 'hover' });
    mountedPopovers.push(mounted);

    const trigger = mounted.host.querySelector('.popover-trigger');
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('TextPopover trigger not found');
    expect(trigger.title).toBe('');

    trigger.dispatchEvent(new MouseEvent('mouseenter'));
    await nextTick();
    const panel = mounted.host.querySelector('.popover-panel');
    if (!(panel instanceof HTMLDivElement)) throw new Error('TextPopover panel not found');

    trigger.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(100);
    panel.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(30);
    await nextTick();
    expect(mounted.host.querySelector('.popover-panel')).toBe(panel);

    panel.dispatchEvent(new MouseEvent('mouseleave'));
    await nextTick();
    expect(mounted.host.querySelector('.popover-panel')).toBeNull();
  });

  it('卸载时清理延迟监听和 hover 关闭计时器', async () => {
    vi.useFakeTimers();
    installAnimationFrameStub();
    const mounted = mountTextPopover({ triggerMode: 'hover' });

    const trigger = mounted.host.querySelector('.popover-trigger');
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('TextPopover trigger not found');
    trigger.dispatchEvent(new MouseEvent('mouseenter'));
    await nextTick();
    trigger.dispatchEvent(new MouseEvent('mouseleave'));

    expect(vi.getTimerCount()).toBeGreaterThan(0);
    mounted.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
