import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import { createAppServerRpcPeer } from '../../../app-server-rpc';
import {
  createBackendRendererRequestRegistry,
  createBackendRendererRequestRpcGateway,
  createBackendRendererRequestRpcHandlers,
} from '..';

const OPERATION_ID = '018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d20';
const TOKEN = '0'.repeat(32);

describe('Backend Renderer request RPC', () => {
  let temporaryRoot: string | undefined;

  afterEach(async () => {
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
    temporaryRoot = undefined;
  });

  it('通过真实双向 RPC 保持 channel allowlist、参数顺序与 undefined', async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'linnya-renderer-rpc-'));
    const pair = createPair(temporaryRoot, registry => {
      registry.handle('workspace:update-project', (id, name, description) => ({
        id,
        name,
        description,
      }));
    });

    await expect(pair.gateway.listChannels()).resolves.toEqual(['workspace:update-project']);
    await expect(
      pair.gateway.invoke('workspace:update-project', ['project-1', '新名称', undefined])
    ).resolves.toEqual({
      id: 'project-1',
      name: '新名称',
      description: undefined,
    });
    expect(await readdir(temporaryRoot)).toEqual([]);
    pair.dispose();
  });

  it('50 MiB Slides 模板走外部二进制 mailbox，RPC frame 保持有界并清理精确目录', async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'linnya-renderer-mailbox-'));
    const pair = createPair(temporaryRoot, registry => {
      registry.handle('plugin:invoke', request => {
        if (typeof request !== 'object' || request === null)
          throw new Error('request payload missing');
        const payload = Reflect.get(request, 'payload');
        if (typeof payload !== 'object' || payload === null)
          throw new Error('plugin payload missing');
        const bytes = Reflect.get(payload, 'buffer');
        if (!(bytes instanceof Uint8Array)) throw new Error('binary payload missing');
        return {
          byteLength: bytes.byteLength,
          prefix: Uint8Array.from(bytes.subarray(0, 4)),
        };
      });
    });
    const bytes = new Uint8Array(50 * 1024 * 1024);
    bytes.set([1, 2, 3, 4]);

    await expect(
      pair.gateway.invoke('plugin:invoke', [
        {
          pluginId: 'slides',
          channel: 'slides:template-import',
          payload: { buffer: bytes },
        },
      ])
    ).resolves.toEqual({
      byteLength: 50 * 1024 * 1024,
      prefix: Uint8Array.from([1, 2, 3, 4]),
    });
    expect(await readdir(temporaryRoot)).toEqual([]);
    pair.dispose();
  }, 20_000);
});

function createPair(
  mailboxRoot: string,
  register: (registry: ReturnType<typeof createBackendRendererRequestRegistry>) => void
) {
  const registry = createBackendRendererRequestRegistry();
  register(registry);
  const desktopToBackend = new PassThrough();
  const backendToDesktop = new PassThrough();
  const backendPeer = createAppServerRpcPeer({
    input: desktopToBackend,
    output: backendToDesktop,
    handlers: createBackendRendererRequestRpcHandlers({ registry, mailboxRoot }),
  });
  const desktopPeer = createAppServerRpcPeer({
    input: backendToDesktop,
    output: desktopToBackend,
    handlers: new Map(),
  });
  const gateway = createBackendRendererRequestRpcGateway({
    rpc: desktopPeer,
    mailboxRoot,
    createOperationId: () => OPERATION_ID,
    createToken: () => TOKEN,
  });
  return {
    gateway,
    dispose() {
      desktopPeer.dispose();
      backendPeer.dispose();
      desktopToBackend.destroy();
      backendToDesktop.destroy();
    },
  };
}
