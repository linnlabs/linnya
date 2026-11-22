import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { PluginOperationError } from '../../install/definitions/pluginOperationError';
import { selectCatalogPluginRelease } from '../functions/selectCatalogPluginRelease';
import { verifyPluginCatalog } from '../functions/verifyPluginCatalog';
import { createPluginCatalogStateStore, PLUGIN_CATALOG_STATE_FILE_NAME } from '../infrastructure/pluginCatalogStateStore';
import { fetchVerifiedPluginCatalog, MAX_PLUGIN_CATALOG_BYTES } from '../orchestration/fetchVerifiedPluginCatalog';
import { catalogPayload, catalogPlugin, catalogRuntime, createTestCatalogPublisher } from './catalogTestSupport';

const NOW = new Date('2026-11-22T00:00:00.000Z');
const publisher = createTestCatalogPublisher();
const roots: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-catalog-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function verified(payload: Record<string, unknown>) {
  return verifyPluginCatalog({ catalogText: publisher.sign(payload), trustedKeys: publisher.trustedKeys, expectedChannel: 'stable', now: NOW });
}

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PluginOperationError) return error.code;
    throw error;
  }
  throw new Error('expected rejection');
}

describe('catalog 本机高水位', () => {
  it('只前进不后退，通道互不影响；文件损坏按首次接受处理并留诊断', () => {
    const root = tempRoot();
    const diagnostics: string[] = [];
    const store = createPluginCatalogStateStore({ userPluginRoot: root, recordDiagnostic: message => diagnostics.push(message) });
    expect(store.readHighWaterMark('stable')).toBeNull();
    const second = verified(catalogPayload({ sequence: 2 }));
    store.recordAccepted(second, NOW);
    expect(store.readHighWaterMark('stable')).toEqual({ sequence: 2, digest: second.digest });
    store.recordAccepted(verified(catalogPayload({ sequence: 1 })), NOW);
    expect(store.readHighWaterMark('stable')?.sequence).toBe(2);
    expect(store.readHighWaterMark('beta')).toBeNull();
    expect(fs.readdirSync(root).filter(name => name.endsWith('.tmp'))).toEqual([]);

    fs.writeFileSync(path.join(root, PLUGIN_CATALOG_STATE_FILE_NAME), '{broken', 'utf8');
    expect(store.readHighWaterMark('stable')).toBeNull();
    expect(diagnostics[0]).toContain('无法读取');
  });
});

describe('从已验签 catalog 选择可安装版本', () => {
  const host = { pluginId: 'knowledge', appVersion: '0.3.0', rendererUiVersion: '3.6.0', platform: 'darwin', architecture: 'arm64' } as const;

  it('选择最高的兼容版本，并把运行时解析到本平台最高的满足版本', () => {
    const catalog = verified(catalogPayload({
      plugins: [
        catalogPlugin({ version: '0.2.0', requiresRuntimes: [{ id: 'qdrant', range: '^1.14' }] }),
        catalogPlugin({ version: '0.3.0', minApp: '0.4.0' }),
      ],
      runtimes: [
        catalogRuntime('1.14.1', [{ platform: 'darwin', architecture: 'arm64' }]),
        catalogRuntime('1.15.0', [{ platform: 'darwin', architecture: 'arm64' }, { platform: 'win32', architecture: 'x64' }]),
        catalogRuntime('2.0.0', [{ platform: 'darwin', architecture: 'arm64' }]),
      ],
    }));
    const selection = selectCatalogPluginRelease({ catalog, ...host });
    expect(selection).toMatchObject({ status: 'selected', entry: { version: '0.2.0' } });
    if (selection.status !== 'selected') throw new Error('not selected');
    expect(selection.runtimes).toEqual([expect.objectContaining({ id: 'qdrant', version: '1.15.0', target: expect.objectContaining({ platform: 'darwin' }) })]);
  });

  it('最高版本的运行时缺少本平台目标时退回可安装的旧版本；全部不可用时报告最高版本的原因', () => {
    const catalog = verified(catalogPayload({
      plugins: [
        catalogPlugin({ version: '0.2.0' }),
        catalogPlugin({ version: '0.3.0', requiresRuntimes: [{ id: 'qdrant', range: '^1.14' }] }),
      ],
      runtimes: [catalogRuntime('1.14.1', [{ platform: 'win32', architecture: 'x64' }])],
    }));
    expect(selectCatalogPluginRelease({ catalog, ...host })).toMatchObject({ status: 'selected', entry: { version: '0.2.0' } });

    const onlyRuntime = verified(catalogPayload({
      plugins: [catalogPlugin({ version: '0.3.0', requiresRuntimes: [{ id: 'qdrant', range: '^1.14' }] })],
      runtimes: [catalogRuntime('1.14.1', [{ platform: 'win32', architecture: 'x64' }])],
    }));
    expect(selectCatalogPluginRelease({ catalog: onlyRuntime, ...host })).toEqual({ status: 'runtime-unavailable', latestVersion: '0.3.0', runtimeId: 'qdrant' });
    expect(selectCatalogPluginRelease({ catalog: verified(catalogPayload({ plugins: [catalogPlugin({ minApp: '9.0.0' })] })), ...host }))
      .toMatchObject({ status: 'incompatible', latestVersion: '0.2.0' });
    expect(selectCatalogPluginRelease({ catalog: verified(catalogPayload({ plugins: [] })), ...host })).toEqual({ status: 'not-listed' });
  });
});

describe('拉取并验签 catalog', () => {
  const respond = (body: string, init: ResponseInit = {}) => async () => new Response(body, init);

  function base(root: string, fetchImpl: typeof fetch) {
    return {
      catalogUrl: 'https://download.linnya.com/plugins/catalog/stable.json',
      channel: 'stable' as const,
      trustedKeys: publisher.trustedKeys,
      stateStore: createPluginCatalogStateStore({ userPluginRoot: root }),
      now: () => NOW,
      fetch: fetchImpl,
    };
  }

  it('成功后前进本机高水位；随后的回放被拒绝且高水位不变', async () => {
    const root = tempRoot();
    const fresh = publisher.sign(catalogPayload({ sequence: 5 }));
    const accepted = await fetchVerifiedPluginCatalog(base(root, respond(fresh) as unknown as typeof fetch));
    expect(accepted.sequence).toBe(5);
    const store = createPluginCatalogStateStore({ userPluginRoot: root });
    expect(store.readHighWaterMark('stable')?.sequence).toBe(5);

    const replay = publisher.sign(catalogPayload({ sequence: 4 }));
    expect(await code(fetchVerifiedPluginCatalog(base(root, respond(replay) as unknown as typeof fetch)))).toBe('artifact-integrity');
    expect(store.readHighWaterMark('stable')).toEqual({ sequence: 5, digest: accepted.digest });
  });

  it('HTTP 错误、网络错误与过期 catalog 归为来源不可用；超限响应与篡改归为完整性错误', async () => {
    const root = tempRoot();
    expect(await code(fetchVerifiedPluginCatalog(base(root, respond('nope', { status: 503 }) as unknown as typeof fetch)))).toBe('source-unavailable');
    expect(await code(fetchVerifiedPluginCatalog(base(root, (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch)))).toBe('network');
    const expired = publisher.sign(catalogPayload({ issuedAt: '2026-10-01T00:00:00.000Z', expiresAt: '2026-11-01T00:00:00.000Z' }));
    expect(await code(fetchVerifiedPluginCatalog(base(root, respond(expired) as unknown as typeof fetch)))).toBe('source-unavailable');
    const huge = 'x'.repeat(MAX_PLUGIN_CATALOG_BYTES + 1);
    expect(await code(fetchVerifiedPluginCatalog(base(root, respond(huge) as unknown as typeof fetch)))).toBe('artifact-integrity');
    const forged = createTestCatalogPublisher().sign(catalogPayload());
    expect(await code(fetchVerifiedPluginCatalog(base(root, respond(forged) as unknown as typeof fetch)))).toBe('artifact-integrity');
    expect(createPluginCatalogStateStore({ userPluginRoot: root }).readHighWaterMark('stable')).toBeNull();
  });

  it('调用方取消时原样传出取消，不改写为来源错误', async () => {
    const root = tempRoot();
    const controller = new AbortController();
    const fetchImpl = ((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    })) as unknown as typeof fetch;
    const pending = fetchVerifiedPluginCatalog({ ...base(root, fetchImpl), signal: controller.signal });
    controller.abort(new DOMException('cancelled', 'AbortError'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
