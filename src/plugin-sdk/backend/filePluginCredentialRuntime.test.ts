import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createFilePluginCredentialRuntimePort } from './filePluginCredentialRuntime';

describe('file plugin credential runtime', () => {
  it('迁移旧 electron-store 明文并只写入加密文件', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'linnya-plugin-credentials-'));
    const filePath = path.join(directory, 'plugin_credentials.json');
    const legacyStore = new MemoryStore({
      pluginCredentials: { demo: { API_KEY: ' legacy-key ' } },
    });
    const protection = new PrefixProtection();

    try {
      const runtime = await createFilePluginCredentialRuntimePort({
        filePath,
        credentialProtection: protection,
        legacyStore,
      });

      await expect(runtime.read('demo', 'API_KEY')).resolves.toBe('legacy-key');
      expect(legacyStore.get('pluginCredentials')).toEqual({});
      const file = JSON.parse(await readFile(filePath, 'utf8')) as {
        credentials: Record<string, Record<string, string>>;
      };
      expect(file.credentials.demo.API_KEY).toBe('enc:legacy-key');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('单条密文失败时只将该凭据标记为不可用', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'linnya-plugin-credentials-'));
    const filePath = path.join(directory, 'plugin_credentials.json');
    const protection = new PrefixProtection();

    try {
      await import('node:fs/promises').then(({ writeFile }) => writeFile(filePath, JSON.stringify({
        version: '1.0.0',
        last_updated: new Date().toISOString(),
        credentials: { demo: { GOOD: 'enc:good', BAD: 'broken' } },
      })));
      const runtime = await createFilePluginCredentialRuntimePort({ filePath, credentialProtection: protection });

      await expect(runtime.read('demo', 'GOOD')).resolves.toBe('good');
      await expect(runtime.read('demo', 'BAD')).resolves.toBeUndefined();
      await expect(runtime.listStatus('demo', ['GOOD', 'BAD'])).resolves.toEqual([
        { key: 'GOOD', configured: true },
        { key: 'BAD', configured: false },
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

class PrefixProtection {
  async encrypt(value: string): Promise<string> {
    return `enc:${value}`;
  }

  async decrypt(value: string): Promise<string> {
    if (!value.startsWith('enc:')) throw new Error('invalid ciphertext');
    return value.slice(4);
  }
}

class MemoryStore {
  constructor(private readonly values: Record<string, unknown>) {}

  get(key: string): unknown {
    return this.values[key];
  }

  set(key: string, value: unknown): void {
    this.values[key] = value;
  }
}
