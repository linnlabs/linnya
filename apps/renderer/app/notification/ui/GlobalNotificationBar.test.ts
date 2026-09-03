// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createApp, nextTick, type App } from 'vue';
import GlobalNotificationBar from './GlobalNotificationBar.vue';
import { useNotificationStore } from '../store/notificationStore';

let mountedApp: App | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  mountedApp?.unmount();
  host?.remove();
  mountedApp = null;
  host = null;
});

describe('GlobalNotificationBar', () => {
  it('把 Host store 状态和布局预留宽度投影到纯展示组件', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    mountedApp = createApp(GlobalNotificationBar, { reservedTrailingWidth: 54 });
    mountedApp.use(createPinia());
    mountedApp.mount(host);
    const store = useNotificationStore();

    store.show('导出完成', 'success', 0);
    await nextTick();

    const bar = host.querySelector<HTMLElement>('.notification-bar');
    expect(bar?.style.right).toBe('74px');
    expect(bar?.classList.contains('notification-type-success')).toBe(true);
    expect(bar?.querySelector('.notification-content')?.textContent?.trim()).toBe('导出完成');
  });

  it('布局连接器卸载不会反向修改全局通知状态', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    const pinia = createPinia();
    setActivePinia(pinia);
    mountedApp = createApp(GlobalNotificationBar);
    mountedApp.use(pinia);
    mountedApp.mount(host);
    const store = useNotificationStore();
    store.show('仍由业务 owner 管理', 'info', 0);

    mountedApp.unmount();
    mountedApp = null;
    expect(store.isVisible).toBe(true);
  });
});
