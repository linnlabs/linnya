import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createAppServerRpcPeer } from '../../../../app-server-rpc';
import { createAppServerActivityRpcGateway } from '../orchestration/createAppServerActivityRpcGateway';
import { createAppServerActivityRpcHandlers } from '../orchestration/createAppServerActivityRpcHandlers';

describe('App Server activity RPC', () => {
  it('只向 Desktop 暴露是否存在运行中命令', async () => {
    const desktopToBackend = new PassThrough();
    const backendToDesktop = new PassThrough();
    const desktop = createAppServerRpcPeer({
      input: backendToDesktop,
      output: desktopToBackend,
      handlers: new Map(),
    });
    const backend = createAppServerRpcPeer({
      input: desktopToBackend,
      output: backendToDesktop,
      handlers: createAppServerActivityRpcHandlers({ hasExecutingCommands: () => true }),
    });
    const gateway = createAppServerActivityRpcGateway(desktop);

    await expect(gateway.read()).resolves.toEqual({ hasExecutingCommands: true });

    desktop.dispose();
    backend.dispose();
    desktopToBackend.destroy();
    backendToDesktop.destroy();
  });
});
