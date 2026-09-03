// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick, reactive, type App } from 'vue';
import { NotificationBar, type NotificationType } from '@linnya/renderer-ui';

interface MountedNotificationBar {
  readonly app: App;
  readonly host: HTMLDivElement;
  readonly state: {
    message: string;
    right: number;
    type: NotificationType;
    visible: boolean;
  };
}

const mountedBars: MountedNotificationBar[] = [];

function mountNotificationBar(options: Partial<MountedNotificationBar['state']> = {}): MountedNotificationBar {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const state = reactive({
    message: '通知内容',
    right: 20,
    type: 'info' as NotificationType,
    visible: true,
    ...options,
  });
  const app = createApp({
    render: () => h(NotificationBar, state),
  });
  app.mount(host);
  const mounted = { app, host, state };
  mountedBars.push(mounted);
  return mounted;
}

afterEach(() => {
  while (mountedBars.length > 0) {
    const mounted = mountedBars.pop();
    mounted?.app.unmount();
    mounted?.host.remove();
  }
});

describe('NotificationBar', () => {
  it.each([
    ['success', '✓'],
    ['error', '✕'],
    ['info', 'ℹ'],
    ['warning', '⚠'],
  ] as const)('保留 %s 类型的 class、图标与文本', async (type, icon) => {
    const { host } = mountNotificationBar({ type });
    await nextTick();

    const bar = host.querySelector<HTMLElement>('.notification-bar');
    expect(bar?.classList.contains(`notification-type-${type}`)).toBe(true);
    expect(bar?.querySelector('.notification-icon')?.textContent).toBe(icon);
    expect(bar?.querySelector('.notification-content')?.textContent?.trim()).toBe('通知内容');
  });

  it('由显式 props 控制显示和 Host 计算后的右侧位置', async () => {
    const { host, state } = mountNotificationBar({ right: 96, visible: false });
    await nextTick();
    expect(host.querySelector('.notification-bar')).toBeNull();

    state.visible = true;
    await nextTick();
    expect(host.querySelector<HTMLElement>('.notification-bar')?.style.right).toBe('96px');
  });
});
