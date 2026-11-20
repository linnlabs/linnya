// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { createApp, nextTick, type App } from 'vue';
import { clearRendererPluginRegistryForTest } from '../registry';
import { loadRuntimeRendererPlugins } from '../loader/runtimeRendererPluginLoader';
import RendererPluginLoadFailureNotice from './RendererPluginLoadFailureNotice.vue';

let mountedApp: App | null = null;
let host: HTMLDivElement | null = null;
let pinia: Pinia;

const stalledEntry = {
  pluginId: 'notice-stalled-plugin',
  version: '1.0.0',
  rendererUiRange: '^3.0.0',
  entryUrl: '/@fs/plugins/notice-stalled-plugin/src/renderer/index.ts',
  cssUrls: [],
};

function syncWithStalledEntry(): Promise<void> {
  return loadRuntimeRendererPlugins({
    installHostModules: () => undefined,
    importTimeoutMs: 10,
    importEntry: () => new Promise<unknown>(() => undefined),
    rendererEntriesApi: async () => ({ success: true, data: [stalledEntry] }),
  });
}

function syncWithoutEntries(): Promise<void> {
  return loadRuntimeRendererPlugins({
    installHostModules: () => undefined,
    rendererEntriesApi: async () => ({ success: true, data: [] }),
  });
}

function mountNotice(retry: () => Promise<void>): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  mountedApp = createApp(RendererPluginLoadFailureNotice, { retry });
  mountedApp.use(pinia);
  mountedApp.mount(host);
  return host;
}

beforeEach(() => {
  pinia = createPinia();
  setActivePinia(pinia);
  clearRendererPluginRegistryForTest();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(async () => {
  mountedApp?.unmount();
  host?.remove();
  mountedApp = null;
  host = null;
  await syncWithoutEntries();
  vi.restoreAllMocks();
});

describe('RendererPluginLoadFailureNotice', () => {
  it('入口导入超时后显示失败提示，重试成功即收起', async () => {
    const retry = vi.fn(syncWithoutEntries);
    const root = mountNotice(retry);
    expect(root.querySelector('[data-testid="renderer-plugin-load-failure-notice"]')).toBeNull();

    await syncWithStalledEntry();
    await nextTick();

    const notice = root.querySelector('[data-testid="renderer-plugin-load-failure-notice"]');
    expect(notice?.textContent).toContain('插件“notice-stalled-plugin”未能加载');

    root.querySelector<HTMLButtonElement>('[data-testid="renderer-plugin-load-failure-retry"]')?.click();
    await vi.waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => {
      expect(root.querySelector('[data-testid="renderer-plugin-load-failure-notice"]')).toBeNull();
    });
  });

  it('关闭只隐藏本轮失败，新一轮失败会再次提示', async () => {
    const root = mountNotice(syncWithoutEntries);
    await syncWithStalledEntry();
    await nextTick();

    root.querySelector<HTMLButtonElement>('.renderer-plugin-load-notice__dismiss')?.click();
    await vi.waitFor(() => {
      expect(root.querySelector('[data-testid="renderer-plugin-load-failure-notice"]')).toBeNull();
    });

    await syncWithStalledEntry();
    await nextTick();
    expect(root.querySelector('[data-testid="renderer-plugin-load-failure-notice"]')).not.toBeNull();
  });
});
