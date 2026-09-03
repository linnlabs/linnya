import { PassThrough } from 'node:stream';

import type { PluginCredentialRuntimePort } from '@linnya/plugin-host-contract/backend/pluginCredentialRuntime';
import { describe, expect, it } from 'vitest';

import { createAppServerRpcPeer } from '../../../../app-server-rpc';
import { createPluginCredentialRuntimeRpcClient } from '../orchestration/createPluginCredentialRuntimeRpcClient';
import { createPluginCredentialRuntimeRpcHandlers } from '../orchestration/createPluginCredentialRuntimeRpcHandlers';

describe('Plugin credential runtime RPC', () => {
  it('保留既有 read/list/write 语义且不会向 App Server 暴露 Store', async () => {
    const desktopPort = new MemoryPluginCredentialRuntimePort();
    const pair = createPeerPair(desktopPort);
    const client = createPluginCredentialRuntimeRpcClient(pair.backend);

    await expect(client.read('credential-fixture-plugin', 'EXTERNAL_API_KEY')).resolves.toBeUndefined();
    await expect(client.write('credential-fixture-plugin', {
      EXTERNAL_API_KEY: ' test-key ',
      OPTIONAL_API_KEY: undefined,
    })).resolves.toEqual([
      { key: 'EXTERNAL_API_KEY', configured: true },
      { key: 'OPTIONAL_API_KEY', configured: false },
    ]);
    await expect(client.read('credential-fixture-plugin', 'EXTERNAL_API_KEY')).resolves.toBe('test-key');
    await expect(client.listStatus('credential-fixture-plugin', [
      'EXTERNAL_API_KEY',
      'OPTIONAL_API_KEY',
    ])).resolves.toEqual([
      { key: 'EXTERNAL_API_KEY', configured: true },
      { key: 'OPTIONAL_API_KEY', configured: false },
    ]);

    pair.dispose();
  });
});

class MemoryPluginCredentialRuntimePort implements PluginCredentialRuntimePort {
  readonly #items = new Map<string, Map<string, string>>();

  async read(pluginId: string, key: string): Promise<string | undefined> {
    return this.#items.get(pluginId)?.get(key);
  }

  async listStatus(pluginId: string, keys: readonly string[]) {
    const values = this.#items.get(pluginId) ?? new Map<string, string>();
    return keys.map(key => ({ key, configured: values.has(key) }));
  }

  async write(
    pluginId: string,
    values: Readonly<Record<string, string | null | undefined>>,
  ) {
    const pluginValues = new Map(this.#items.get(pluginId) ?? []);
    for (const [key, value] of Object.entries(values)) {
      const trimmed = value?.trim();
      if (trimmed) pluginValues.set(key, trimmed);
      else pluginValues.delete(key);
    }
    this.#items.set(pluginId, pluginValues);
    return Object.keys(values).sort().map(key => ({
      key,
      configured: pluginValues.has(key),
    }));
  }
}

function createPeerPair(port: PluginCredentialRuntimePort) {
  const desktopToBackend = new PassThrough();
  const backendToDesktop = new PassThrough();
  const desktop = createAppServerRpcPeer({
    input: backendToDesktop,
    output: desktopToBackend,
    handlers: createPluginCredentialRuntimeRpcHandlers(port),
  });
  const backend = createAppServerRpcPeer({
    input: desktopToBackend,
    output: backendToDesktop,
    handlers: new Map(),
  });
  return {
    backend,
    dispose() {
      desktop.dispose();
      backend.dispose();
      desktopToBackend.destroy();
      backendToDesktop.destroy();
    },
  };
}
