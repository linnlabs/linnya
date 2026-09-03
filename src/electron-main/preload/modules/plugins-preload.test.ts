import { describe, expect, it, vi } from 'vitest';
import type { IpcRenderer } from 'electron';
import { buildPluginsPreloadApi } from './plugins-preload';

function createIpcRendererMock() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    ipcRenderer: {
      invoke: vi.fn(),
      on: vi.fn((channel: string, handler: (...args: unknown[]) => void) => {
        const existing = listeners.get(channel) ?? new Set();
        existing.add(handler);
        listeners.set(channel, existing);
      }),
      removeListener: vi.fn((channel: string, handler: (...args: unknown[]) => void) => {
        listeners.get(channel)?.delete(handler);
      }),
    } as unknown as IpcRenderer,
    emit(channel: string, payload: unknown): void {
      for (const listener of listeners.get(channel) ?? []) {
        listener({}, payload);
      }
    },
  };
}

describe('buildPluginsPreloadApi', () => {
  it('filters plugin push envelopes by plugin id and channel', () => {
    const mock = createIpcRendererMock();
    const api = buildPluginsPreloadApi(mock.ipcRenderer);
    const callback = vi.fn();

    const unsubscribe = api['plugin:onPush']('sheet', 'sheet-ops-appended', callback);

    mock.emit('plugin:push', { pluginId: 'slides', channel: 'sheet-ops-appended', payload: { wrong: true } });
    mock.emit('plugin:push', { pluginId: 'sheet', channel: 'other', payload: { wrong: true } });
    mock.emit('plugin:push', { pluginId: 'sheet', channel: 'sheet-ops-appended', payload: { ok: true } });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({ ok: true });

    unsubscribe();
    mock.emit('plugin:push', { pluginId: 'sheet', channel: 'sheet-ops-appended', payload: { ok: false } });
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
