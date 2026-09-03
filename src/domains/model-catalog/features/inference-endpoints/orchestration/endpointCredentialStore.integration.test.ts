import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pathState = vi.hoisted(() => ({ credentialFilePath: '' }));

vi.mock('src/shared/utils/pathManager', () => ({
  pathManager: {
    getEndpointCredentialsConfigPath: () => pathState.credentialFilePath,
  },
}));

import type { EndpointCredentialCodec } from '../../../definitions/inferenceEndpoint';
import { EndpointCredentialStore } from './endpointCredentialStore';

const codec: EndpointCredentialCodec = {
  encrypt: async plaintext => Buffer.from(`encrypted:${plaintext}`, 'utf8').toString('base64'),
  decrypt: async ciphertext => {
    const decoded = Buffer.from(ciphertext, 'base64').toString('utf8');
    if (!decoded.startsWith('encrypted:')) throw new Error('测试密文格式无效');
    return decoded.slice('encrypted:'.length);
  },
};

describe('endpoint credential 持久化', () => {
  let temporaryRoot = '';

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'linnya-endpoint-credentials-'));
    pathState.credentialFilePath = path.join(temporaryRoot, 'endpoint_credentials.json');
  });

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  it('只写入密文，并可由新 Store 实例跨启动解密', async () => {
    const firstStore = new EndpointCredentialStore();
    firstStore.installCodec(codec);
    await firstStore.initialize();
    await firstStore.put('inference-endpoint:fixture', 'plain-secret');

    const persisted = await fs.readFile(pathState.credentialFilePath, 'utf8');
    expect(persisted).not.toContain('plain-secret');
    expect(persisted).toContain('inference-endpoint:fixture');
    expect((await fs.stat(pathState.credentialFilePath)).mode & 0o777).toBe(0o600);

    const restartedStore = new EndpointCredentialStore();
    restartedStore.installCodec(codec);
    await restartedStore.initialize();
    expect(restartedStore.resolve('inference-endpoint:fixture')).toBe('plain-secret');
  });

  it('删除 credential 后同步移除持久化密文', async () => {
    const store = new EndpointCredentialStore();
    store.installCodec(codec);
    await store.initialize();
    await store.put('inference-endpoint:fixture', 'plain-secret');
    await store.remove('inference-endpoint:fixture');

    expect(store.has('inference-endpoint:fixture')).toBe(false);
    expect(await fs.readFile(pathState.credentialFilePath, 'utf8')).not.toContain(
      'inference-endpoint:fixture'
    );
  });
});
