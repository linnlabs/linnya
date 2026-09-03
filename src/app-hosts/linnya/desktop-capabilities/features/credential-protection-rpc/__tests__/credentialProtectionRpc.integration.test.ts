import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { createAppServerRpcPeer } from '../../../../app-server-rpc';
import type { DesktopCredentialProtectionPort } from '../../../definitions/desktopCredentialProtectionPort';
import {
  DESKTOP_CREDENTIAL_ENCRYPT_RPC_METHOD,
} from '../definitions/credentialProtectionRpc';
import { createDesktopCredentialProtectionRpcClient } from '../orchestration/createDesktopCredentialProtectionRpcClient';
import { createDesktopCredentialProtectionRpcHandlers } from '../orchestration/createDesktopCredentialProtectionRpcHandlers';

describe('Desktop credential protection RPC', () => {
  it('通过注册方法往返 plaintext/ciphertext，不改变业务 port', async () => {
    const electronPort: DesktopCredentialProtectionPort = {
      encrypt: vi.fn(async plaintext => `sealed:${plaintext}`),
      decrypt: vi.fn(async ciphertext => ciphertext.replace(/^sealed:/u, '')),
    };
    const pair = createPeerPair(electronPort);
    const client = createDesktopCredentialProtectionRpcClient(pair.backend);

    await expect(client.encrypt('secret-value')).resolves.toBe('sealed:secret-value');
    await expect(client.decrypt('sealed:secret-value')).resolves.toBe('secret-value');
    expect(electronPort.encrypt).toHaveBeenCalledWith('secret-value');
    expect(electronPort.decrypt).toHaveBeenCalledWith('sealed:secret-value');

    pair.dispose();
  });

  it('Desktop handler 严格拒绝错型 payload', async () => {
    const handlers = createDesktopCredentialProtectionRpcHandlers({
      encrypt: async plaintext => plaintext,
      decrypt: async ciphertext => ciphertext,
    });
    const handler = handlers.get(DESKTOP_CREDENTIAL_ENCRYPT_RPC_METHOD);
    if (!handler) throw new Error('credential encrypt handler 未注册');

    await expect(handler({ plaintext: 123 }, {
      requestId: 'invalid-payload',
      signal: new AbortController().signal,
    })).rejects.toThrow();
  });

  it('App Server client 严格拒绝错型 response', async () => {
    const client = createDesktopCredentialProtectionRpcClient({
      request: async () => ({ ciphertext: 123 }),
    });

    await expect(client.encrypt('secret-value')).rejects.toThrow();
  });
});

function createPeerPair(port: DesktopCredentialProtectionPort) {
  const desktopToBackend = new PassThrough();
  const backendToDesktop = new PassThrough();
  const desktop = createAppServerRpcPeer({
    input: backendToDesktop,
    output: desktopToBackend,
    handlers: createDesktopCredentialProtectionRpcHandlers(port),
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
