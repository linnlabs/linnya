import { describe, expect, it, vi } from 'vitest';
import { WINDOW_FOCUS_STATE_CHANNEL } from '../../../shared/app-lifecycle/definitions/windowFocusProtocol';
import { subscribeWindowFocusState } from './system-preload';

function createIpcRendererMock() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    ipcRenderer: {
      on: (channel: typeof WINDOW_FOCUS_STATE_CHANNEL, listener: (...args: unknown[]) => void) => {
        const channelListeners = listeners.get(channel) ?? new Set();
        channelListeners.add(listener);
        listeners.set(channel, channelListeners);
      },
      removeListener: (channel: typeof WINDOW_FOCUS_STATE_CHANNEL, listener: (...args: unknown[]) => void) => {
        listeners.get(channel)?.delete(listener);
      },
    },
    emit(channel: string, value: unknown): void {
      for (const listener of listeners.get(channel) ?? []) listener({}, value);
    },
  };
}

describe('system preload window focus contract', () => {
  it('只转发合法的主窗口焦点消息，并支持精确解除订阅', () => {
    const mock = createIpcRendererMock();
    const callback = vi.fn();
    const unsubscribe = subscribeWindowFocusState(mock.ipcRenderer, callback);

    mock.emit(WINDOW_FOCUS_STATE_CHANNEL, { focused: false });
    mock.emit(WINDOW_FOCUS_STATE_CHANNEL, {
      schema_version: 1,
      kind: 'window_focus_state',
      focused: false,
    });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(false);

    unsubscribe();
    mock.emit(WINDOW_FOCUS_STATE_CHANNEL, {
      schema_version: 1,
      kind: 'window_focus_state',
      focused: true,
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
