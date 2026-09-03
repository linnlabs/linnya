// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import SlidesDraftFailureLog from './SlidesDraftFailureLog.vue';

vi.mock('@linnya/renderer-ui/icons', () => ({
  ChevronIcon: { template: '<span class="mock-chevron-icon" />' },
  CopyIcon: { template: '<span class="mock-copy-icon" />' },
}));

let mountedApp: App<Element> | undefined;

afterEach(() => {
  mountedApp?.unmount();
  mountedApp = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function mountLog(log: string): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  mountedApp = createApp(SlidesDraftFailureLog, { log });
  mountedApp.mount(host);
  return host;
}

describe('SlidesDraftFailureLog', () => {
  it('默认折叠，并由标题按钮切换日志可见性', async () => {
    const host = mountLog('TS8006 at line 12');
    const toggle = host.querySelector<HTMLButtonElement>('.slides-draft-failure-log__toggle');

    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('.slides-draft-failure-log__content')).toBeNull();

    toggle?.click();
    await nextTick();

    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('.slides-draft-failure-log__content')?.textContent).toBe(
      'TS8006 at line 12',
    );
  });

  it('复制完整错误日志并展示短暂成功反馈', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const host = mountLog('Sandbox execution failed');
    const copy = host.querySelector<HTMLButtonElement>('.slides-draft-failure-log__copy');

    copy?.click();
    await Promise.resolve();
    await nextTick();

    expect(writeText).toHaveBeenCalledWith('Sandbox execution failed');
    expect(copy?.classList.contains('is-copied')).toBe(true);
    expect(copy?.title).toBe('已复制错误日志');

    vi.advanceTimersByTime(2_000);
    await nextTick();
    expect(copy?.classList.contains('is-copied')).toBe(false);
  });
});
