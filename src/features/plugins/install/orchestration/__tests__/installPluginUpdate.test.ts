import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';

import { checkPluginUpdateFromRemote, installPluginUpdateFromRemote } from '../installPluginUpdate';

const latestUrl = 'https://download.linnyai.com/plugins/mindmap/latest.json';
const artifactUrl = 'https://download.linnyai.com/plugins/mindmap/mindmap-1.1.0.zip';
const rendererUiRange = '^1.0.0';
const tempRoots: string[] = [];

function makeTempRoot(): string {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-plugin-install-'));
  tempRoots.push(tempRoot);
  return tempRoot;
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function pluginArtifactIdentity(version: string, contentVariant = 'default'): string {
  return `${createHash('sha512').update(`mindmap@${version}:${contentVariant}`).digest('hex')}  plugin.json\n`;
}

function writeInstalledVersion(
  userPluginRoot: string,
  version: string,
  artifactIdentity = pluginArtifactIdentity(version)
): void {
  const versionDir = path.join(userPluginRoot, 'mindmap', version);
  writeJson(path.join(versionDir, 'plugin.json'), {
    id: 'mindmap',
    version,
    name: 'Mindmap',
    description: 'Mindmap plugin',
    developer: 'Linnya',
    details: ['Mindmap plugin details'],
    entry: {
      backend: './dist/backend/index.cjs',
      renderer: './dist/renderer/index.js',
    },
    compat: { rendererUi: rendererUiRange },
  });
  fs.mkdirSync(path.join(versionDir, 'dist/backend'), { recursive: true });
  fs.mkdirSync(path.join(versionDir, 'dist/renderer'), { recursive: true });
  fs.writeFileSync(
    path.join(versionDir, 'dist/backend/index.cjs'),
    'module.exports.backendPlugin = {};',
    'utf8'
  );
  fs.writeFileSync(
    path.join(versionDir, 'dist/renderer/index.js'),
    'export const rendererPlugin = {};',
    'utf8'
  );
  fs.writeFileSync(path.join(versionDir, 'SHA512SUMS'), artifactIdentity, 'utf8');
}

async function createPluginZip(options: {
  readonly version: string;
  readonly entryBackend?: string;
  readonly includeBackend?: boolean;
  readonly includeDetails?: boolean;
  readonly artifactIdentity?: string;
}): Promise<Buffer> {
  const entryBackend = options.entryBackend ?? './dist/backend/index.cjs';
  const zip = new JSZip();
  const manifest = {
    id: 'mindmap',
    version: options.version,
    name: 'Mindmap',
    description: 'Mindmap plugin',
    developer: 'Linnya',
    entry: {
      backend: entryBackend,
      renderer: './dist/renderer/index.js',
    },
    compat: { rendererUi: rendererUiRange },
    ...((options.includeDetails ?? true) ? { details: ['Mindmap plugin details'] } : {}),
  };
  zip.file('plugin.json', `${JSON.stringify(manifest, null, 2)}\n`);
  if (options.includeBackend ?? true) {
    zip.file('dist/backend/index.cjs', 'module.exports.backendPlugin = {};');
  }
  zip.file('dist/renderer/index.js', 'export const rendererPlugin = {};');
  zip.file('SHA512SUMS', options.artifactIdentity ?? pluginArtifactIdentity(options.version));
  return zip.generateAsync({ type: 'nodebuffer' });
}

function sha512Hex(buffer: Buffer): string {
  return createHash('sha512').update(buffer).digest('hex');
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  return bytes.buffer;
}

function createFetch(routes: ReadonlyMap<string, () => Response>): typeof fetch {
  return async (input: RequestInfo | URL): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const route = routes.get(url);
    return route ? route() : new Response('not found', { status: 404, statusText: 'Not Found' });
  };
}

function readActiveVersion(userPluginRoot: string): string {
  const active = JSON.parse(
    fs.readFileSync(path.join(userPluginRoot, 'mindmap/active.json'), 'utf8')
  ) as { version: string };
  return active.version;
}

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe('installPluginUpdateFromRemote', () => {
  it('checks remote availability without downloading the artifact', async () => {
    let artifactRequests = 0;
    const fetcher = createFetch(
      new Map([
        [
          latestUrl,
          () =>
            new Response(
              JSON.stringify({
                version: '1.1.0',
                minApp: '0.0.36',
                rendererUi: rendererUiRange,
                url: artifactUrl,
                sha512: '0'.repeat(128),
              })
            ),
        ],
        [
          artifactUrl,
          () => {
            artifactRequests += 1;
            return new Response('unexpected');
          },
        ],
      ])
    );

    const result = await checkPluginUpdateFromRemote({
      pluginId: 'mindmap',
      latestManifestUrl: latestUrl,
      appVersion: '0.0.36',
      rendererUiVersion: '1.0.0',
      currentVersion: '1.0.0',
      fetch: fetcher,
    });

    expect(result).toEqual({
      status: 'available',
      pluginId: 'mindmap',
      currentVersion: '1.0.0',
      latestVersion: '1.1.0',
      minApp: '0.0.36',
      rendererUi: rendererUiRange,
    });
    expect(artifactRequests).toBe(0);
  });

  it('reports current when the remote version is not newer', async () => {
    let artifactRequests = 0;
    const fetcher = createFetch(
      new Map([
        [
          latestUrl,
          () =>
            new Response(
              JSON.stringify({
                version: '1.1.0',
                minApp: '0.0.36',
                rendererUi: rendererUiRange,
                url: artifactUrl,
                sha512: '0'.repeat(128),
              })
            ),
        ],
        [
          artifactUrl,
          () => {
            artifactRequests += 1;
            return new Response('unexpected');
          },
        ],
      ])
    );

    const result = await checkPluginUpdateFromRemote({
      pluginId: 'mindmap',
      latestManifestUrl: latestUrl,
      appVersion: '0.0.36',
      rendererUiVersion: '1.0.0',
      currentVersion: '1.1.0',
      fetch: fetcher,
    });

    expect(result).toEqual({
      status: 'current',
      pluginId: 'mindmap',
      currentVersion: '1.1.0',
      latestVersion: '1.1.0',
    });
    expect(artifactRequests).toBe(0);
  });

  it('在商店检查和安装阶段阻止 Renderer UI major 不兼容且不下载 artifact', async () => {
    const userPluginRoot = path.join(makeTempRoot(), 'plugins');
    let artifactRequests = 0;
    const fetcher = createFetch(
      new Map([
        [
          latestUrl,
          () => new Response(JSON.stringify({
            version: '2.0.0',
            rendererUi: '^2.0.0',
            url: artifactUrl,
            sha512: '0'.repeat(128),
          })),
        ],
        [
          artifactUrl,
          () => {
            artifactRequests += 1;
            return new Response('unexpected');
          },
        ],
      ]),
    );

    const checkResult = await checkPluginUpdateFromRemote({
      pluginId: 'mindmap',
      latestManifestUrl: latestUrl,
      appVersion: '0.0.38',
      rendererUiVersion: '1.0.0',
      currentVersion: '1.1.0',
      fetch: fetcher,
    });
    const installResult = await installPluginUpdateFromRemote({
      pluginId: 'mindmap',
      latestManifestUrl: latestUrl,
      userPluginRoot,
      appVersion: '0.0.38',
      rendererUiVersion: '1.0.0',
      fetch: fetcher,
    });

    expect(checkResult).toMatchObject({
      status: 'incompatible',
      latestVersion: '2.0.0',
      detail: '当前 Renderer UI 版本 1.0.0 不满足插件要求 ^2.0.0',
    });
    expect(installResult).toMatchObject({
      status: 'skipped',
      reason: 'incompatible',
      version: '2.0.0',
      detail: '当前 Renderer UI 版本 1.0.0 不满足插件要求 ^2.0.0',
    });
    expect(artifactRequests).toBe(0);
    expect(fs.existsSync(path.join(userPluginRoot, 'mindmap/2.0.0'))).toBe(false);
  });

  it('downloads, verifies and stages a newer plugin artifact without switching active.json', async () => {
    const tempRoot = makeTempRoot();
    const userPluginRoot = path.join(tempRoot, 'plugins');
    writeInstalledVersion(userPluginRoot, '1.0.0');
    writeJson(path.join(userPluginRoot, 'mindmap/active.json'), { version: '1.0.0' });
    const zipBuffer = await createPluginZip({ version: '1.1.0' });
    const fetcher = createFetch(
      new Map([
        [
          latestUrl,
          () =>
            new Response(
              JSON.stringify({
                version: '1.1.0',
                minApp: '0.0.36',
                rendererUi: rendererUiRange,
                url: artifactUrl,
                sha512: sha512Hex(zipBuffer),
              })
            ),
        ],
        [artifactUrl, () => new Response(toArrayBuffer(zipBuffer))],
      ])
    );

    const result = await installPluginUpdateFromRemote({
      pluginId: 'mindmap',
      latestManifestUrl: latestUrl,
      userPluginRoot,
      appVersion: '0.0.36',
      rendererUiVersion: '1.0.0',
      fetch: fetcher,
    });

    expect(result).toMatchObject({
      status: 'staged',
      pluginId: 'mindmap',
      version: '1.1.0',
      previousVersion: '1.0.0',
      restartRequired: true,
    });
    expect(readActiveVersion(userPluginRoot)).toBe('1.0.0');
    expect(fs.existsSync(path.join(userPluginRoot, 'mindmap/1.1.0/plugin.json'))).toBe(true);
    expect(fs.existsSync(path.join(userPluginRoot, 'mindmap/1.1.0/dist/renderer/index.js'))).toBe(
      true
    );
  });

  it('reuses an already staged version only after its artifact identity matches', async () => {
    const tempRoot = makeTempRoot();
    const userPluginRoot = path.join(tempRoot, 'plugins');
    writeInstalledVersion(userPluginRoot, '1.0.0');
    writeInstalledVersion(userPluginRoot, '1.1.0');
    writeJson(path.join(userPluginRoot, 'mindmap/active.json'), { version: '1.0.0' });
    const zipBuffer = await createPluginZip({ version: '1.1.0' });
    let artifactRequests = 0;
    const fetcher = createFetch(
      new Map([
        [
          latestUrl,
          () =>
            new Response(
              JSON.stringify({
                version: '1.1.0',
                minApp: '0.0.36',
                rendererUi: rendererUiRange,
                url: artifactUrl,
                sha512: sha512Hex(zipBuffer),
              })
            ),
        ],
        [
          artifactUrl,
          () => {
            artifactRequests += 1;
            return new Response(toArrayBuffer(zipBuffer));
          },
        ],
      ])
    );

    const result = await installPluginUpdateFromRemote({
      pluginId: 'mindmap',
      latestManifestUrl: latestUrl,
      userPluginRoot,
      appVersion: '0.0.36',
      rendererUiVersion: '1.0.0',
      fetch: fetcher,
    });

    expect(result).toEqual({
      status: 'skipped',
      pluginId: 'mindmap',
      version: '1.1.0',
      reason: 'already-staged',
    });
    expect(artifactRequests).toBe(1);
    expect(readActiveVersion(userPluginRoot)).toBe('1.0.0');
  });

  it('rejects an already staged version whose artifact identity differs', async () => {
    const tempRoot = makeTempRoot();
    const userPluginRoot = path.join(tempRoot, 'plugins');
    writeInstalledVersion(userPluginRoot, '1.0.0');
    writeInstalledVersion(userPluginRoot, '1.1.0', pluginArtifactIdentity('1.1.0', 'old-content'));
    writeJson(path.join(userPluginRoot, 'mindmap/active.json'), { version: '1.0.0' });
    const zipBuffer = await createPluginZip({ version: '1.1.0' });
    const fetcher = createFetch(
      new Map([
        [
          latestUrl,
          () =>
            new Response(
              JSON.stringify({
                version: '1.1.0',
                minApp: '0.0.36',
                rendererUi: rendererUiRange,
                url: artifactUrl,
                sha512: sha512Hex(zipBuffer),
              })
            ),
        ],
        [artifactUrl, () => new Response(toArrayBuffer(zipBuffer))],
      ])
    );

    const result = await installPluginUpdateFromRemote({
      pluginId: 'mindmap',
      latestManifestUrl: latestUrl,
      userPluginRoot,
      appVersion: '0.0.36',
      rendererUiVersion: '1.0.0',
      fetch: fetcher,
    });

    if (result.status !== 'failed') {
      throw new Error(`expected failed result, got ${result.status}`);
    }
    expect(result.error).toContain('同版本 artifact 的 SHA512SUMS 不一致');
    expect(readActiveVersion(userPluginRoot)).toBe('1.0.0');
    expect(fs.existsSync(path.join(userPluginRoot, 'mindmap/1.1.0'))).toBe(true);
    expect(
      fs
        .readdirSync(path.join(userPluginRoot, 'mindmap'))
        .some(entry => entry.startsWith('.install-'))
    ).toBe(false);
  });

  it('aborts on sha512 mismatch and leaves active.json untouched', async () => {
    const tempRoot = makeTempRoot();
    const userPluginRoot = path.join(tempRoot, 'plugins');
    writeInstalledVersion(userPluginRoot, '1.0.0');
    writeJson(path.join(userPluginRoot, 'mindmap/active.json'), { version: '1.0.0' });
    const zipBuffer = await createPluginZip({ version: '1.1.0' });
    const fetcher = createFetch(
      new Map([
        [
          latestUrl,
          () =>
            new Response(
              JSON.stringify({
                version: '1.1.0',
                minApp: '0.0.36',
                rendererUi: rendererUiRange,
                url: artifactUrl,
                sha512: '0'.repeat(128),
              })
            ),
        ],
        [artifactUrl, () => new Response(toArrayBuffer(zipBuffer))],
      ])
    );

    const result = await installPluginUpdateFromRemote({
      pluginId: 'mindmap',
      latestManifestUrl: latestUrl,
      userPluginRoot,
      appVersion: '0.0.36',
      rendererUiVersion: '1.0.0',
      fetch: fetcher,
    });

    if (result.status !== 'failed') {
      throw new Error(`expected failed result, got ${result.status}`);
    }
    expect(result.error).toContain('sha512 不匹配');
    expect(readActiveVersion(userPluginRoot)).toBe('1.0.0');
    expect(fs.existsSync(path.join(userPluginRoot, 'mindmap/1.1.0'))).toBe(false);
    expect(
      fs
        .readdirSync(path.join(userPluginRoot, 'mindmap'))
        .some(entry => entry.startsWith('.install-'))
    ).toBe(false);
  });

  it('rejects remote versions that cannot be used as plugin version directories', async () => {
    const tempRoot = makeTempRoot();
    const userPluginRoot = path.join(tempRoot, 'plugins');
    let artifactRequests = 0;
    const fetcher = createFetch(
      new Map([
        [
          latestUrl,
          () =>
            new Response(
              JSON.stringify({
                version: '../1.1.0',
                minApp: '0.0.36',
                rendererUi: rendererUiRange,
                url: artifactUrl,
                sha512: '0'.repeat(128),
              })
            ),
        ],
        [
          artifactUrl,
          () => {
            artifactRequests += 1;
            return new Response('unexpected');
          },
        ],
      ])
    );

    const result = await installPluginUpdateFromRemote({
      pluginId: 'mindmap',
      latestManifestUrl: latestUrl,
      userPluginRoot,
      appVersion: '0.0.36',
      rendererUiVersion: '1.0.0',
      fetch: fetcher,
    });

    if (result.status !== 'failed') {
      throw new Error(`expected failed result, got ${result.status}`);
    }
    expect(result.error).toContain('latest.json version 必须是数字点分版本号');
    expect(artifactRequests).toBe(0);
    expect(fs.existsSync(path.join(userPluginRoot, 'mindmap/1.1.0'))).toBe(false);
  });

  it('skips incompatible remote versions before downloading the artifact', async () => {
    const tempRoot = makeTempRoot();
    const userPluginRoot = path.join(tempRoot, 'plugins');
    let artifactRequests = 0;
    const fetcher = createFetch(
      new Map([
        [
          latestUrl,
          () =>
            new Response(
              JSON.stringify({
                version: '1.1.0',
                minApp: '0.0.37',
                rendererUi: rendererUiRange,
                url: artifactUrl,
                sha512: '0'.repeat(128),
              })
            ),
        ],
        [
          artifactUrl,
          () => {
            artifactRequests += 1;
            return new Response('unexpected');
          },
        ],
      ])
    );

    const result = await installPluginUpdateFromRemote({
      pluginId: 'mindmap',
      latestManifestUrl: latestUrl,
      userPluginRoot,
      appVersion: '0.0.36',
      rendererUiVersion: '1.0.0',
      fetch: fetcher,
    });

    expect(result).toMatchObject({
      status: 'skipped',
      reason: 'incompatible',
      version: '1.1.0',
    });
    expect(artifactRequests).toBe(0);
    expect(fs.existsSync(path.join(userPluginRoot, 'mindmap/1.1.0'))).toBe(false);
  });

  it('returns a friendly error for stale artifact manifest schema', async () => {
    const tempRoot = makeTempRoot();
    const userPluginRoot = path.join(tempRoot, 'plugins');
    const zipBuffer = await createPluginZip({ version: '1.1.0', includeDetails: false });
    const fetcher = createFetch(
      new Map([
        [
          latestUrl,
          () =>
            new Response(
              JSON.stringify({
                version: '1.1.0',
                minApp: '0.0.36',
                rendererUi: rendererUiRange,
                url: artifactUrl,
                sha512: sha512Hex(zipBuffer),
              })
            ),
        ],
        [artifactUrl, () => new Response(toArrayBuffer(zipBuffer))],
      ])
    );

    const result = await installPluginUpdateFromRemote({
      pluginId: 'mindmap',
      latestManifestUrl: latestUrl,
      userPluginRoot,
      appVersion: '0.0.36',
      rendererUiVersion: '1.0.0',
      fetch: fetcher,
    });

    if (result.status !== 'failed') {
      throw new Error(`expected failed result, got ${result.status}`);
    }
    expect(result.error).toContain('远程插件包 manifest 不兼容或过旧');
    expect(result.error).toContain('details');
    expect(result.error).not.toContain('invalid_type');
    expect(result.error).not.toContain('"code"');
    expect(fs.existsSync(path.join(userPluginRoot, 'mindmap/1.1.0'))).toBe(false);
  });

  it('rejects artifacts whose manifest entry points outside the plugin directory', async () => {
    const tempRoot = makeTempRoot();
    const userPluginRoot = path.join(tempRoot, 'plugins');
    const zipBuffer = await createPluginZip({
      version: '1.1.0',
      entryBackend: '../outside.cjs',
      includeBackend: false,
    });
    const fetcher = createFetch(
      new Map([
        [
          latestUrl,
          () =>
            new Response(
              JSON.stringify({
                version: '1.1.0',
                minApp: '0.0.36',
                rendererUi: rendererUiRange,
                url: artifactUrl,
                sha512: sha512Hex(zipBuffer),
              })
            ),
        ],
        [artifactUrl, () => new Response(toArrayBuffer(zipBuffer))],
      ])
    );

    const result = await installPluginUpdateFromRemote({
      pluginId: 'mindmap',
      latestManifestUrl: latestUrl,
      userPluginRoot,
      appVersion: '0.0.36',
      rendererUiVersion: '1.0.0',
      fetch: fetcher,
    });

    if (result.status !== 'failed') {
      throw new Error(`expected failed result, got ${result.status}`);
    }
    expect(result.error).toContain('不能越界');
    expect(fs.existsSync(path.join(userPluginRoot, 'mindmap/1.1.0'))).toBe(false);
  });
});
