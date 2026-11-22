import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';

import {
  catalogPayload,
  catalogRuntime,
  createTestCatalogPublisher,
} from 'src/features/plugins/catalog/__tests__/catalogTestSupport';
import { verifyCatalogInstallReceipt } from 'src/features/plugins/catalog/functions/verifyCatalogInstallReceipt';
import { verifyPluginCatalog } from 'src/features/plugins/catalog/functions/verifyPluginCatalog';
import { createPluginCatalogStateStore } from 'src/features/plugins/catalog/infrastructure/pluginCatalogStateStore';
import { PLUGIN_INSTALL_RECEIPTS_DIRECTORY } from 'src/features/plugins/catalog/infrastructure/pluginInstallReceiptStore';
import { createCatalogPluginReleaseSource } from 'src/features/plugins/catalog/orchestration/createCatalogPluginReleaseSource';
import { installPluginUpdateFromRemote } from 'src/features/plugins/install/orchestration/installPluginUpdate';
import { isTrustedPluginAssembly } from '../rendererApplicationSurfaceTrust';

const NOW = new Date('2026-11-22T00:00:00.000Z');
const CATALOG_URL = 'https://download.linnya.com/plugins/catalog/stable.json';
const ARTIFACT_URL = 'https://download.linnya.com/plugins/artifacts/sample/1.1.0/sample-1.1.0.zip';
const publisher = createTestCatalogPublisher();
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(directory);
  return directory;
}

async function pluginZip(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('plugin.json', JSON.stringify({
    id: 'sample',
    version: '1.1.0',
    name: 'Sample',
    description: 'Sample plugin',
    developer: 'Linnya',
    details: ['Sample plugin details'],
    entry: { backend: './dist/backend/index.cjs', renderer: './dist/renderer/index.js' },
    compat: { rendererUi: '^1.0.0' },
  }));
  zip.file('dist/backend/index.cjs', 'module.exports.backendPlugin = {};');
  zip.file('dist/renderer/index.js', 'export const rendererPlugin = {};');
  zip.file('SHA512SUMS', `${createHash('sha512').update('sample@1.1.0').digest('hex')}  plugin.json\n`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

function entry(zip: Buffer, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sample',
    name: 'Sample',
    version: '1.1.0',
    developer: 'Linnya',
    description: 'Sample plugin',
    rendererUi: '^1.0.0',
    artifactUrl: ARTIFACT_URL,
    sha512: createHash('sha512').update(zip).digest('hex'),
    size: zip.byteLength,
    // 安装只把它当解压上限：样例包远小于 64 KiB。
    unpackedSize: 64 * 1024,
    requiresRuntimes: [],
    ...overrides,
  };
}

async function setup(catalog: Record<string, unknown>, zip: Buffer) {
  const userPluginRoot = tempDir('linnya-catalog-install-');
  let artifactRequests = 0;
  const catalogText = publisher.sign(catalog);
  const fetcher = (async (request: RequestInfo | URL) => {
    const url = String(request);
    if (url === CATALOG_URL) return new Response(catalogText);
    if (url === ARTIFACT_URL) {
      artifactRequests += 1;
      return new Response(new Uint8Array(zip));
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  const stateStore = createPluginCatalogStateStore({ userPluginRoot });
  const releaseSource = createCatalogPluginReleaseSource({
    catalogUrl: CATALOG_URL,
    channel: 'stable',
    trustedKeys: publisher.trustedKeys,
    stateStore,
    platform: 'darwin',
    architecture: 'arm64',
    now: () => NOW,
  });
  const install = () => installPluginUpdateFromRemote({
    pluginId: 'sample',
    releaseSource,
    userPluginRoot,
    appVersion: '1.0.0',
    rendererUiVersion: '1.2.0',
    currentVersion: null,
    fetch: fetcher,
  });
  return { userPluginRoot, stateStore, install, artifactRequests: () => artifactRequests };
}

function admission(userPluginRoot: string, trustedKeys = publisher.trustedKeys) {
  return verifyCatalogInstallReceipt({
    pluginId: 'sample',
    version: '1.1.0',
    pluginDirectory: path.join(userPluginRoot, 'sample', '1.1.0'),
    trustedKeys,
    laterRevocations: createPluginCatalogStateStore({ userPluginRoot }).readRevocations(),
  });
}

describe('catalog-official 远程安装与来源准入', () => {
  it('按已验签 catalog 暂存版本并写回执；回执让 packaged 组合准入，移除 key 或改动目录即撤销', async () => {
    const zip = await pluginZip();
    const { userPluginRoot, install } = await setup(catalogPayload({ sequence: 3, plugins: [entry(zip)] }), zip);
    expect(await install()).toMatchObject({ status: 'staged', version: '1.1.0' });
    expect(fs.existsSync(path.join(userPluginRoot, 'sample', PLUGIN_INSTALL_RECEIPTS_DIRECTORY, '1.1.0.json'))).toBe(true);
    expect(admission(userPluginRoot)).toMatchObject({ admitted: true, keyId: publisher.keyId });

    const assembly = { pluginId: 'sample', version: '1.1.0', pluginDir: path.join(userPluginRoot, 'sample', '1.1.0'), sourceKind: 'active' as const };
    const trustInput = { packaged: true, workspaceRoot: userPluginRoot, backendDirectDirs: [], bundledPluginRoot: undefined };
    expect(isTrustedPluginAssembly(assembly, { ...trustInput, trustedCatalogKeys: publisher.trustedKeys })).toBe(true);
    expect(isTrustedPluginAssembly(assembly, { ...trustInput, trustedCatalogKeys: {} })).toBe(false);
    expect(isTrustedPluginAssembly(assembly, trustInput)).toBe(false);

    expect(admission(userPluginRoot, createTestCatalogPublisher().trustedKeys)).toMatchObject({ admitted: false });
    fs.writeFileSync(path.join(userPluginRoot, 'sample', '1.1.0', 'SHA512SUMS'), 'replaced  plugin.json\n');
    expect(admission(userPluginRoot)).toEqual({ admitted: false, reason: '版本目录与安装时不一致' });
  });

  it('之后接受的 catalog 撤回该版本时，已装版本不再准入', async () => {
    const zip = await pluginZip();
    const { userPluginRoot, stateStore, install } = await setup(catalogPayload({ sequence: 3, plugins: [entry(zip)] }), zip);
    await install();
    expect(admission(userPluginRoot).admitted).toBe(true);
    const later = verifyPluginCatalog({
      catalogText: publisher.sign(catalogPayload({ sequence: 4, plugins: [], revoked: [{ kind: 'plugin', id: 'sample', version: '1.1.0' }] })),
      trustedKeys: publisher.trustedKeys,
      expectedChannel: 'stable',
      now: NOW,
    });
    stateStore.recordAccepted(later, NOW);
    expect(admission(userPluginRoot)).toEqual({ admitted: false, reason: 'catalog 未列出该版本或已撤回' });
  });

  it('暂存后回执丢失（崩溃在两者之间）时，重装同版本走 already-staged 并补写回执', async () => {
    const zip = await pluginZip();
    const { userPluginRoot, install } = await setup(catalogPayload({ plugins: [entry(zip)] }), zip);
    await install();
    fs.rmSync(path.join(userPluginRoot, 'sample', PLUGIN_INSTALL_RECEIPTS_DIRECTORY), { recursive: true });
    expect(admission(userPluginRoot)).toEqual({ admitted: false, reason: '缺少有效的安装回执' });
    expect(await install()).toMatchObject({ status: 'skipped', reason: 'already-staged' });
    expect(admission(userPluginRoot).admitted).toBe(true);
  });

  it('zip 摘要与 catalog 不符时失败关闭：不暂存版本、不写回执', async () => {
    const zip = await pluginZip();
    const { userPluginRoot, install } = await setup(catalogPayload({ plugins: [entry(zip, { sha512: 'f'.repeat(128) })] }), zip);
    expect(await install()).toMatchObject({ status: 'failed', errorCode: 'artifact-integrity' });
    expect(fs.existsSync(path.join(userPluginRoot, 'sample', '1.1.0'))).toBe(false);
    expect(fs.existsSync(path.join(userPluginRoot, 'sample', PLUGIN_INSTALL_RECEIPTS_DIRECTORY))).toBe(false);
  });

  it('不兼容时跳过且不下载；需要原生运行时但没有可信安装途径时不安装', async () => {
    const zip = await pluginZip();
    const incompatible = await setup(catalogPayload({ plugins: [entry(zip, { minApp: '9.0.0' })] }), zip);
    expect(await incompatible.install()).toMatchObject({ status: 'skipped', reason: 'incompatible' });
    expect(incompatible.artifactRequests()).toBe(0);

    const needsRuntime = await setup(catalogPayload({
      plugins: [entry(zip, { requiresRuntimes: [{ id: 'qdrant', range: '^1.14' }] })],
      runtimes: [catalogRuntime('1.14.1', [{ platform: 'darwin', architecture: 'arm64' }])],
    }), zip);
    expect(await needsRuntime.install()).toMatchObject({ status: 'failed', errorCode: 'incompatible' });
    expect(needsRuntime.artifactRequests()).toBe(0);
  });

  it('伪造发布方签名的 catalog 在下载前被拒绝', async () => {
    const zip = await pluginZip();
    let artifactRequests = 0;
    const forgedCatalog = createTestCatalogPublisher().sign(catalogPayload({ plugins: [entry(zip)] }));
    const result = await installPluginUpdateFromRemote({
      pluginId: 'sample',
      releaseSource: createCatalogPluginReleaseSource({
        catalogUrl: CATALOG_URL, channel: 'stable', trustedKeys: publisher.trustedKeys,
        stateStore: createPluginCatalogStateStore({ userPluginRoot: tempDir('linnya-forged-state-') }),
        platform: 'darwin', architecture: 'arm64', now: () => NOW,
      }),
      userPluginRoot: tempDir('linnya-forged-root-'),
      appVersion: '1.0.0', rendererUiVersion: '1.2.0', currentVersion: null,
      fetch: (async (request: RequestInfo | URL) => {
        if (String(request) === ARTIFACT_URL) artifactRequests += 1;
        return new Response(forgedCatalog);
      }) as typeof fetch,
    });
    expect(result).toMatchObject({ status: 'failed', errorCode: 'artifact-integrity' });
    expect(artifactRequests).toBe(0);
  });
});
