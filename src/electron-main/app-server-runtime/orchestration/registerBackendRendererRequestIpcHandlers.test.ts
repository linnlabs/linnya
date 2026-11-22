import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock('../../window-manager', () => ({ getMainWindow: () => null }));

import {
  LONG_RUNNING_RENDERER_REQUEST_TIMEOUT_MS,
  registerBackendRendererRequestIpcHandlers,
} from './registerBackendRendererRequestIpcHandlers';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

async function setup(channels: readonly string[]) {
  const handlers = new Map<string, Handler>();
  type InvokeOptions = { readonly signal?: AbortSignal; readonly timeoutMs?: number };
  const invoke = vi.fn(async (_channel: string, _args: readonly unknown[], _options?: InvokeOptions) => 'ok');
  const sender = Object.assign(new EventEmitter(), { mainFrame: {} });
  const mainWindow = { isDestroyed: () => false, webContents: sender };
  await registerBackendRendererRequestIpcHandlers({
    gateway: { listChannels: async () => channels, invoke, releaseRendererSession: async () => undefined },
    ipc: { handle: (channel, handler) => handlers.set(channel, handler as Handler) },
    readMainWindow: () => mainWindow as never,
  });
  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({ sender, senderFrame: sender.mainFrame }, ...args);
  return { call, invoke, sender };
}

describe('Renderer 业务请求转发的等待上限', () => {
  it('远程安装与数据清理放宽到 1 小时；其他 channel 沿用 RPC 默认值', async () => {
    const { call, invoke } = await setup(['plugins:installFromRemote', 'plugins:cleanup-data', 'plugins:list']);
    await call('plugins:installFromRemote', 'knowledge');
    await call('plugins:cleanup-data', 'knowledge');
    await call('plugins:list');
    expect(invoke.mock.calls.map(([channel, , options]) => [channel, options?.timeoutMs])).toEqual([
      ['plugins:installFromRemote', 3_600_000],
      ['plugins:cleanup-data', 3_600_000],
      ['plugins:list', undefined],
    ]);
    expect(LONG_RUNNING_RENDERER_REQUEST_TIMEOUT_MS['plugins:installFromRemote']).toBeGreaterThan(30_000);
  });

  it('放宽上限的 channel 仍在页面导航时取消等待', async () => {
    const { call, invoke, sender } = await setup(['plugins:installFromRemote']);
    let signal: AbortSignal | undefined;
    invoke.mockImplementationOnce(async (_channel, _args, options) => {
      signal = options?.signal;
      sender.emit('did-start-navigation');
      return 'ok';
    });
    await call('plugins:installFromRemote', 'knowledge');
    expect(signal?.aborted).toBe(true);
  });
});
