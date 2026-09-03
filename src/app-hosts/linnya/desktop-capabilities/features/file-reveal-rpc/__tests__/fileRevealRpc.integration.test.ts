import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { createAppServerRpcPeer } from '../../../../app-server-rpc';
import type { DesktopFileRevealPort } from '../../../definitions/desktopFileRevealPort';
import { createDesktopFileRevealRpcClient } from '../orchestration/createDesktopFileRevealRpcClient';
import { createDesktopFileRevealRpcHandlers } from '../orchestration/createDesktopFileRevealRpcHandlers';

describe('Desktop file reveal RPC', () => {
  it('只把已准入的绝对路径投影到 Desktop port', async () => {
    const port: DesktopFileRevealPort = {
      revealInFileManager: vi.fn(async () => undefined),
    };
    const desktopToBackend = new PassThrough();
    const backendToDesktop = new PassThrough();
    const desktop = createAppServerRpcPeer({
      input: backendToDesktop,
      output: desktopToBackend,
      handlers: createDesktopFileRevealRpcHandlers(port),
    });
    const backend = createAppServerRpcPeer({
      input: desktopToBackend,
      output: backendToDesktop,
      handlers: new Map(),
    });

    const client = createDesktopFileRevealRpcClient(backend);
    await client.revealInFileManager('/tmp/conversation/result.pdf');

    expect(port.revealInFileManager).toHaveBeenCalledWith('/tmp/conversation/result.pdf');
    desktop.dispose();
    backend.dispose();
    desktopToBackend.destroy();
    backendToDesktop.destroy();
  });
});
