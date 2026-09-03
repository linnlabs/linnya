import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { createAppServerRpcPeer } from '../../../../../app-server-rpc';
import type { ExternalAuthorizationBrowserPort } from '../../../definitions/providerAccountAuthorization';
import { createExternalAuthorizationBrowserRpcClient } from '../orchestration/createExternalAuthorizationBrowserRpcClient';
import { createExternalAuthorizationBrowserRpcHandlers } from '../orchestration/createExternalAuthorizationBrowserRpcHandlers';

describe('External authorization browser RPC', () => {
  it('只通过注册能力让 Desktop 打开 HTTPS OAuth URL', async () => {
    const open = vi.fn(async () => undefined);
    const pair = createPeerPair({ open });
    const client = createExternalAuthorizationBrowserRpcClient(pair.backend);
    const authorizationUrl = 'https://auth.openai.com/oauth/authorize?state=test';

    await expect(client.open(authorizationUrl)).resolves.toBeUndefined();
    expect(open).toHaveBeenCalledWith(authorizationUrl);

    pair.dispose();
  });

  it('在进入 RPC 前拒绝 file/http 等非 HTTPS URL', async () => {
    const request = vi.fn(async () => null);
    const client = createExternalAuthorizationBrowserRpcClient({ request });

    await expect(client.open('file:///tmp/credential')).rejects.toThrow('HTTPS');
    await expect(client.open('http://auth.openai.com/oauth/authorize')).rejects.toThrow('HTTPS');
    expect(request).not.toHaveBeenCalled();
  });

  it('严格拒绝非 null Desktop response', async () => {
    const client = createExternalAuthorizationBrowserRpcClient({
      request: async () => ({ opened: true }),
    });

    await expect(client.open('https://auth.openai.com/oauth/authorize')).rejects.toThrow();
  });
});

function createPeerPair(browser: ExternalAuthorizationBrowserPort) {
  const desktopToBackend = new PassThrough();
  const backendToDesktop = new PassThrough();
  const desktop = createAppServerRpcPeer({
    input: backendToDesktop,
    output: desktopToBackend,
    handlers: createExternalAuthorizationBrowserRpcHandlers(browser),
  });
  const backend = createAppServerRpcPeer({
    input: desktopToBackend,
    output: backendToDesktop,
    handlers: new Map(),
  });
  return {
    desktop,
    backend,
    dispose() {
      desktop.dispose();
      backend.dispose();
      desktopToBackend.destroy();
      backendToDesktop.destroy();
    },
  };
}
