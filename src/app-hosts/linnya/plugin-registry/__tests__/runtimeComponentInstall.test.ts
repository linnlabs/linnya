import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';

import { catalogPayload, createTestCatalogPublisher } from 'src/features/plugins/catalog/__tests__/catalogTestSupport';
import { verifyPluginCatalog } from 'src/features/plugins/catalog/functions/verifyPluginCatalog';
import { createPluginCatalogStateStore } from 'src/features/plugins/catalog/infrastructure/pluginCatalogStateStore';
import { createCatalogPluginReleaseSource } from 'src/features/plugins/catalog/orchestration/createCatalogPluginReleaseSource';
import type { PluginInstallProgress } from '@app/schemas';
import type { CatalogInstallProvenance } from 'src/features/plugins/install/definitions/pluginInstall';
import { installPluginUpdateFromRemote } from 'src/features/plugins/install/orchestration/installPluginUpdate';
import { resolveInstalledRuntimeExecutable } from 'src/features/runtimes/functions/resolveInstalledRuntimeExecutable';
import { readActiveRuntimeVersion } from 'src/features/runtimes/infrastructure/runtimeComponentStore';
import { installRuntimeComponent, isRuntimeComponentCurrent } from 'src/features/runtimes/orchestration/installRuntimeComponent';

const NOW = new Date('2026-11-22T00:00:00.000Z');
const CATALOG_URL = 'https://download.linnya.com/plugins/catalog/stable.json';
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

const sha512 = (bytes: Buffer) => createHash('sha512').update(bytes).digest('hex');
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const runtimeUrl = (version: string) => `https://download.linnya.com/plugins/runtimes/qdrant/${version}/darwin-arm64.zip`;

/** 解压后真实字节数：catalog 的 unpackedSize。 */
async function unpackedSize(zip: Buffer): Promise<number> {
  const archive = await JSZip.loadAsync(zip);
  let total = 0;
  for (const entry of Object.values(archive.files)) if (!entry.dir) total += (await entry.async('nodebuffer')).byteLength;
  return total;
}

async function runtimeZip(executable = Buffer.from('#!/bin/sh\necho qdrant\n')): Promise<{ zip: Buffer; executable: Buffer }> {
  const zip = new JSZip();
  zip.file('qdrant', executable);
  zip.file('LICENSE', 'Apache-2.0');
  return { zip: await zip.generateAsync({ type: 'nodebuffer' }), executable };
}

function runtimeEntry(version: string, zip: Buffer, executable: Buffer, overrides: Record<string, unknown> = {}) {
  return {
    id: 'qdrant',
    version,
    targets: [{
      platform: 'darwin', architecture: 'arm64', artifactUrl: runtimeUrl(version),
      sha512: sha512(zip), size: zip.byteLength, unpackedSize: executable.byteLength + Buffer.byteLength('Apache-2.0'),
      executable: 'qdrant', executableSha256: sha256(executable),
      ...overrides,
    }],
  };
}

function signed(runtimes: unknown[], extra: Record<string, unknown> = {}) {
  const catalogText = publisher.sign(catalogPayload({ plugins: [], runtimes, ...extra }));
  const catalog = verifyPluginCatalog({ catalogText, trustedKeys: publisher.trustedKeys, expectedChannel: 'stable', now: NOW });
  const provenance: CatalogInstallProvenance = { keyId: catalog.keyId, digest: catalog.digest, sequence: catalog.sequence, envelope: catalog.envelope };
  return { catalog, provenance };
}

function servingFetch(routes: Record<string, Buffer>) {
  const requests: string[] = [];
  const fetcher = (async (request: RequestInfo | URL) => {
    const url = String(request);
    requests.push(url);
    const body = routes[url];
    return body ? new Response(new Uint8Array(body)) : new Response('missing', { status: 404 });
  }) as typeof fetch;
  return { fetcher, requests };
}

function resolve(runtimeRoot: string, trustedKeys = publisher.trustedKeys, laterRevocations = []) {
  return resolveInstalledRuntimeExecutable({ runtimeRoot, runtimeId: 'qdrant', platform: 'darwin', architecture: 'arm64', trustedKeys, laterRevocations });
}

describe('原生运行时组件安装与启动复核', () => {
  it('按已验签 catalog 安装、设置可执行权限并通过启动复核；同版本再次安装直接跳过', async () => {
    const runtimeRoot = tempDir('linnya-runtimes-');
    const { zip, executable } = await runtimeZip();
    const { catalog, provenance } = signed([runtimeEntry('1.14.1', zip, executable)]);
    const runtime = { id: 'qdrant', version: '1.14.1', target: catalog.runtimes[0]!.targets[0]! };
    const { fetcher, requests } = servingFetch({ [runtimeUrl('1.14.1')]: zip });
    const install = () => installRuntimeComponent({ runtimeRoot, runtime, provenance, trustedKeys: publisher.trustedKeys, fetch: fetcher });

    expect(await install()).toEqual({ status: 'installed', runtimeId: 'qdrant', version: '1.14.1', previousVersion: null });
    const resolved = await resolve(runtimeRoot);
    expect(resolved).toMatchObject({ status: 'resolved', version: '1.14.1' });
    if (resolved.status === 'resolved') expect(fs.statSync(resolved.executable).mode & 0o111).not.toBe(0);
    expect(await install()).toEqual({ status: 'current', runtimeId: 'qdrant', version: '1.14.1' });
    expect(requests).toHaveLength(1);
  });

  it('可执行文件被替换、key 移出信任环或之后被撤回时拒绝执行', async () => {
    const runtimeRoot = tempDir('linnya-runtimes-');
    const { zip, executable } = await runtimeZip();
    const { catalog, provenance } = signed([runtimeEntry('1.14.1', zip, executable)]);
    await installRuntimeComponent({
      runtimeRoot, runtime: { id: 'qdrant', version: '1.14.1', target: catalog.runtimes[0]!.targets[0]! }, provenance,
      trustedKeys: publisher.trustedKeys, fetch: servingFetch({ [runtimeUrl('1.14.1')]: zip }).fetcher,
    });
    expect((await resolve(runtimeRoot, createTestCatalogPublisher().trustedKeys)).status).toBe('rejected');
    expect(await resolve(runtimeRoot, publisher.trustedKeys, [{ kind: 'runtime', id: 'qdrant', version: '1.14.1' }] as never))
      .toEqual({ status: 'rejected', reason: 'catalog 未列出该运行时版本或已撤回' });
    fs.writeFileSync(path.join(runtimeRoot, 'qdrant', '1.14.1', 'qdrant'), 'replaced');
    expect(await resolve(runtimeRoot)).toEqual({ status: 'rejected', reason: '运行时可执行文件与 catalog 摘要不一致' });
    expect(await resolve(tempDir('linnya-runtimes-empty-'))).toEqual({ status: 'absent' });
  });

  it('大小、zip 摘要或可执行文件摘要不符时失败，现有 active 版本不变', async () => {
    const runtimeRoot = tempDir('linnya-runtimes-');
    const { zip, executable } = await runtimeZip();
    const good = signed([runtimeEntry('1.14.1', zip, executable)]);
    await installRuntimeComponent({
      runtimeRoot, runtime: { id: 'qdrant', version: '1.14.1', target: good.catalog.runtimes[0]!.targets[0]! }, provenance: good.provenance,
      trustedKeys: publisher.trustedKeys, fetch: servingFetch({ [runtimeUrl('1.14.1')]: zip }).fetcher,
    });

    const next = await runtimeZip(Buffer.from('#!/bin/sh\necho qdrant 1.15\n'));
    const cases: Array<[string, Record<string, unknown>]> = [
      ['size', { size: next.zip.byteLength + 1 }],
      ['sha512', { sha512: 'f'.repeat(128) }],
      ['executable', { executableSha256: 'e'.repeat(64) }],
    ];
    for (const [, overrides] of cases) {
      const bad = signed([runtimeEntry('1.15.0', next.zip, next.executable, overrides)], { sequence: 2 });
      await expect(installRuntimeComponent({
        runtimeRoot, runtime: { id: 'qdrant', version: '1.15.0', target: bad.catalog.runtimes[0]!.targets[0]! }, provenance: bad.provenance,
        trustedKeys: publisher.trustedKeys, fetch: servingFetch({ [runtimeUrl('1.15.0')]: next.zip }).fetcher,
      })).rejects.toMatchObject({ code: 'artifact-integrity' });
      expect(readActiveRuntimeVersion(runtimeRoot, 'qdrant')).toBe('1.14.1');
      expect(fs.existsSync(path.join(runtimeRoot, 'qdrant', '1.15.0'))).toBe(false);
    }
    expect(fs.readdirSync(path.join(runtimeRoot, 'qdrant')).filter(name => name.startsWith('.install-'))).toEqual([]);
  });

  it('升级保留上一版、清理更早版本；同版本目录内容不同则拒绝覆盖', async () => {
    const runtimeRoot = tempDir('linnya-runtimes-');
    const versions = ['1.14.1', '1.15.0', '1.16.0'];
    for (const [index, version] of versions.entries()) {
      const { zip, executable } = await runtimeZip(Buffer.from(`#!/bin/sh\necho ${version}\n`));
      const { catalog, provenance } = signed([runtimeEntry(version, zip, executable)], { sequence: index + 1 });
      await installRuntimeComponent({
        runtimeRoot, runtime: { id: 'qdrant', version, target: catalog.runtimes[0]!.targets[0]! }, provenance,
        trustedKeys: publisher.trustedKeys, fetch: servingFetch({ [runtimeUrl(version)]: zip }).fetcher,
      });
    }
    expect(readActiveRuntimeVersion(runtimeRoot, 'qdrant')).toBe('1.16.0');
    expect(fs.readdirSync(path.join(runtimeRoot, 'qdrant')).filter(name => !name.startsWith('.') && name !== 'active.json').sort()).toEqual(['1.15.0', '1.16.0']);

    const conflicting = await runtimeZip(Buffer.from('#!/bin/sh\necho different\n'));
    const { catalog, provenance } = signed([runtimeEntry('1.15.0', conflicting.zip, conflicting.executable)], { sequence: 9 });
    await expect(installRuntimeComponent({
      runtimeRoot, runtime: { id: 'qdrant', version: '1.15.0', target: catalog.runtimes[0]!.targets[0]! }, provenance,
      trustedKeys: publisher.trustedKeys, fetch: servingFetch({ [runtimeUrl('1.15.0')]: conflicting.zip }).fetcher,
    })).rejects.toMatchObject({ code: 'version-conflict' });
    expect(readActiveRuntimeVersion(runtimeRoot, 'qdrant')).toBe('1.16.0');
  });
});

describe('损坏的运行时组件可以通过重新安装修复', () => {
  async function installed() {
    const runtimeRoot = tempDir('linnya-runtimes-');
    const { zip, executable } = await runtimeZip();
    const { catalog, provenance } = signed([runtimeEntry('1.14.1', zip, executable)]);
    const install = (routes: Record<string, Buffer> = { [runtimeUrl('1.14.1')]: zip }) => installRuntimeComponent({
      runtimeRoot, runtime: { id: 'qdrant', version: '1.14.1', target: catalog.runtimes[0]!.targets[0]! }, provenance,
      trustedKeys: publisher.trustedKeys, fetch: servingFetch(routes).fetcher,
    });
    await install();
    const executablePath = path.join(runtimeRoot, 'qdrant', '1.14.1', 'qdrant');
    return { runtimeRoot, install, executablePath, executable };
  }

  it('可执行文件被删除（例如被安全软件隔离）：复核失败，重新安装下载校验后恢复', async () => {
    const { runtimeRoot, install, executablePath, executable } = await installed();
    fs.rmSync(executablePath);
    expect((await resolve(runtimeRoot)).status).toBe('rejected');
    await expect(install()).resolves.toMatchObject({ status: 'installed', version: '1.14.1' });
    expect(fs.readFileSync(executablePath)).toEqual(executable);
    expect((await resolve(runtimeRoot)).status).toBe('resolved');
    expect(fs.readdirSync(path.join(runtimeRoot, 'qdrant')).filter(name => name.startsWith('.install-'))).toEqual([]);
  });

  it('同一份发布的可执行文件被改动：按回执判定为损坏并替换，不当成版本冲突', async () => {
    const { runtimeRoot, install, executablePath, executable } = await installed();
    fs.writeFileSync(executablePath, 'tampered');
    expect((await resolve(runtimeRoot)).status).toBe('rejected');
    await expect(install()).resolves.toMatchObject({ status: 'installed' });
    expect(fs.readFileSync(executablePath)).toEqual(executable);
    expect((await resolve(runtimeRoot)).status).toBe('resolved');
  });

  it('修复时下载失败：损坏目录保持原样，不留临时目录', async () => {
    const { runtimeRoot, install, executablePath } = await installed();
    fs.rmSync(executablePath);
    await expect(install({})).rejects.toBeDefined();
    expect(fs.existsSync(path.join(runtimeRoot, 'qdrant', '1.14.1'))).toBe(true);
    expect(fs.existsSync(executablePath)).toBe(false);
    expect(readActiveRuntimeVersion(runtimeRoot, 'qdrant')).toBe('1.14.1');
    expect(fs.readdirSync(path.join(runtimeRoot, 'qdrant')).filter(name => name.startsWith('.install-'))).toEqual([]);
  });
});

describe('插件远程安装先装好所需运行时', () => {
  async function pluginZip(): Promise<Buffer> {
    const zip = new JSZip();
    zip.file('plugin.json', JSON.stringify({
      id: 'sample', version: '1.1.0', name: 'Sample', description: 'Sample plugin', developer: 'Linnya',
      details: ['Sample plugin details'], entry: { backend: './dist/backend/index.cjs' },
    }));
    zip.file('dist/backend/index.cjs', 'module.exports.backendPlugin = {};');
    zip.file('SHA512SUMS', 'sample  plugin.json\n');
    return zip.generateAsync({ type: 'nodebuffer' });
  }

  interface ScenarioOptions {
    readonly runtimeOverrides?: Record<string, unknown>;
    readonly pluginOverrides?: Record<string, unknown>;
    readonly onProgress?: (progress: PluginInstallProgress) => void;
    readonly signal?: AbortSignal;
    /** 在插件包第 index 块交付前调用；用于模拟下载中取消。 */
    readonly onPluginChunk?: (index: number) => void;
    readonly runtimeRoot?: string;
  }

  async function scenario(options: ScenarioOptions = {}) {
    const userPluginRoot = tempDir('linnya-plugins-');
    const runtimeRoot = options.runtimeRoot ?? tempDir('linnya-runtimes-');
    const plugin = await pluginZip();
    const runtime = await runtimeZip();
    const pluginUrl = 'https://download.linnya.com/plugins/artifacts/sample/1.1.0/sample-1.1.0.zip';
    const catalogText = publisher.sign(catalogPayload({
      plugins: [{
        id: 'sample', name: 'Sample', version: '1.1.0', developer: 'Linnya', description: 'Sample plugin',
        artifactUrl: pluginUrl, sha512: sha512(plugin), size: plugin.byteLength, unpackedSize: await unpackedSize(plugin), requiresRuntimes: [{ id: 'qdrant', range: '^1.14' }],
        ...options.pluginOverrides,
      }],
      runtimes: [runtimeEntry('1.14.1', runtime.zip, runtime.executable, options.runtimeOverrides)],
    }));
    const serving = servingFetch({ [CATALOG_URL]: Buffer.from(catalogText), [pluginUrl]: plugin, [runtimeUrl('1.14.1')]: runtime.zip });
    const requests = serving.requests;
    const fetcher = (async (request: RequestInfo | URL, init?: RequestInit) => {
      if (String(request) !== pluginUrl || !options.onPluginChunk) return serving.fetcher(request, init);
      requests.push(pluginUrl);
      // 分 4 块交付插件包，便于在中途取消。
      const step = Math.ceil(plugin.byteLength / 4);
      let index = 0;
      return new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          options.onPluginChunk!(index);
          const chunk = plugin.subarray(index * step, (index + 1) * step);
          index += 1;
          if (chunk.byteLength > 0) controller.enqueue(new Uint8Array(chunk));
          else controller.close();
        },
      }));
    }) as typeof fetch;
    const result = await installPluginUpdateFromRemote({
      pluginId: 'sample',
      releaseSource: createCatalogPluginReleaseSource({
        catalogUrl: CATALOG_URL, channel: 'stable', trustedKeys: publisher.trustedKeys,
        stateStore: createPluginCatalogStateStore({ userPluginRoot }), platform: 'darwin', architecture: 'arm64', now: () => NOW,
      }),
      installRuntimes: {
        pending: async runtimes => {
          const pending = [];
          for (const item of runtimes) {
            if (!(await isRuntimeComponentCurrent({ runtimeRoot, runtime: item, trustedKeys: publisher.trustedKeys }))) pending.push(item);
          }
          return pending;
        },
        install: async (item, provenance, control) => {
          await installRuntimeComponent({ runtimeRoot, runtime: item, provenance, trustedKeys: publisher.trustedKeys, fetch: fetcher, control });
        },
      },
      userPluginRoot, appVersion: '1.0.0', rendererUiVersion: '1.2.0', currentVersion: null, fetch: fetcher,
      onProgress: options.onProgress, signal: options.signal,
    });
    return { result, requests, userPluginRoot, runtimeRoot, pluginUrl, plugin, runtime };
  }

  function leftovers(directory: string): string[] {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory).filter(name => name.startsWith('.install-'));
  }

  it('先安装运行时再下载插件，两者都按同一份签名 catalog 落盘', async () => {
    const { result, requests, runtimeRoot, pluginUrl } = await scenario();
    expect(result).toMatchObject({ status: 'staged', version: '1.1.0' });
    expect(requests.indexOf(runtimeUrl('1.14.1'))).toBeLessThan(requests.indexOf(pluginUrl));
    expect((await resolve(runtimeRoot)).status).toBe('resolved');
  });

  it('运行时安装失败时不下载、不暂存插件', async () => {
    const { result, requests, userPluginRoot, pluginUrl } = await scenario({ runtimeOverrides: { sha512: 'f'.repeat(128) } });
    expect(result).toMatchObject({ status: 'failed', errorCode: 'artifact-integrity' });
    expect(requests).not.toContain(pluginUrl);
    expect(fs.existsSync(path.join(userPluginRoot, 'sample', '1.1.0'))).toBe(false);
  });

  it('先发出完整下载计划，再按运行时 → 插件依次报告下载进度与安装阶段', async () => {
    const events: PluginInstallProgress[] = [];
    const { result, plugin, runtime } = await scenario({ onProgress: event => events.push(event) });
    expect(result).toMatchObject({ status: 'staged' });
    const runtimeItem = { kind: 'runtime', id: 'qdrant', version: '1.14.1', totalBytes: runtime.zip.byteLength };
    const pluginItem = { kind: 'plugin', id: 'sample', version: '1.1.0', totalBytes: plugin.byteLength };
    expect(events[0]).toEqual({ stage: 'planned', downloads: [runtimeItem, pluginItem] });
    const stages = events.slice(1).map(event => `${event.stage}:${'item' in event ? event.item.kind : ''}`);
    expect(stages.filter((stage, index) => stage !== stages[index - 1])).toEqual([
      'downloading:runtime', 'installing:runtime', 'downloading:plugin', 'installing:plugin',
    ]);
    const runtimeProgress = events.filter(event => event.stage === 'downloading' && event.item.kind === 'runtime');
    const lastRuntimeProgress = runtimeProgress[runtimeProgress.length - 1];
    expect(lastRuntimeProgress).toMatchObject({ receivedBytes: runtime.zip.byteLength });
  });

  it('运行时已安装且校验通过时不进入计划、不重复下载', async () => {
    const first = await scenario();
    expect(first.result).toMatchObject({ status: 'staged' });
    const events: PluginInstallProgress[] = [];
    const second = await scenario({ runtimeRoot: first.runtimeRoot, onProgress: event => events.push(event) });
    expect(second.result).toMatchObject({ status: 'staged' });
    expect(second.requests).not.toContain(runtimeUrl('1.14.1'));
    expect(events[0]).toMatchObject({ stage: 'planned', downloads: [{ kind: 'plugin' }] });
  });

  it('下载插件包时取消：返回 cancelled，不留暂存与临时目录；已装好的运行时保留', async () => {
    const controller = new AbortController();
    const { result, userPluginRoot, runtimeRoot } = await scenario({
      signal: controller.signal,
      onPluginChunk: index => { if (index === 2) controller.abort(); },
    });
    expect(result).toMatchObject({ status: 'failed', errorCode: 'cancelled' });
    expect(fs.existsSync(path.join(userPluginRoot, 'sample', '1.1.0'))).toBe(false);
    expect(leftovers(path.join(userPluginRoot, 'sample'))).toEqual([]);
    expect((await resolve(runtimeRoot)).status).toBe('resolved');
  });

  it('空间预检不足时不发起任何下载，并返回需要与可用字节数', async () => {
    const { result, requests, pluginUrl } = await scenario({ pluginOverrides: { unpackedSize: 2 ** 50 } });
    expect(result).toMatchObject({ status: 'failed', errorCode: 'disk-space' });
    if (result.status === 'failed') {
      expect(result.diskSpace?.requiredBytes).toBeGreaterThan(2 ** 50);
      expect(result.diskSpace?.availableBytes).toBeLessThan(result.diskSpace!.requiredBytes);
    }
    expect(requests).not.toContain(pluginUrl);
    expect(requests).not.toContain(runtimeUrl('1.14.1'));
  });

  it('签名声明的解压后大小比实际小一个字节：判定包体不一致，不暂存', async () => {
    const plugin = await pluginZip();
    const actual = await unpackedSize(plugin);
    const { result, userPluginRoot } = await scenario({ pluginOverrides: { unpackedSize: actual - 1 } });
    expect(result).toMatchObject({ status: 'failed', errorCode: 'artifact-integrity' });
    expect(fs.existsSync(path.join(userPluginRoot, 'sample', '1.1.0'))).toBe(false);
    expect(leftovers(path.join(userPluginRoot, 'sample'))).toEqual([]);
  });
});
