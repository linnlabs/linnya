import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearBackendPluginIpcHandlersForTest,
  hasBackendPluginIpcHandler,
  invokeBackendPluginIpcHandler,
  registerBackendPluginIpcHandler,
} from './pluginIpcRuntime';

const ipcMainHandle = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcMainHandle,
  },
}));

describe('pluginIpcRuntime', () => {
  beforeEach(() => {
    clearBackendPluginIpcHandlersForTest();
    ipcMainHandle.mockClear();
  });

  it('只注册插件内部分发表，不暴露 Electron raw channel handler', async () => {
    const handler = vi.fn(async () => ({ success: true }));
    const pluginId = 'ipc-fixture';
    const channel = 'ipc-fixture:preview';

    registerBackendPluginIpcHandler(pluginId, channel, handler);

    expect(hasBackendPluginIpcHandler(pluginId, channel)).toBe(true);
    expect(ipcMainHandle).not.toHaveBeenCalled();
    await expect(invokeBackendPluginIpcHandler(pluginId, channel, {} as never, {}))
      .resolves.toEqual({ success: true });
  });
});
