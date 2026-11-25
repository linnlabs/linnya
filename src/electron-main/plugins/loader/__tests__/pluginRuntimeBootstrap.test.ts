import fs from 'node:fs';
import { hash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertRequiredBundledPluginSeedSucceeded,
  buildBundledPluginRootCandidates,
  findBundledPluginRootFromCandidates,
  listStagedBundledPluginActivationCandidates,
  stageBundledPluginForExplicitInstall,
  RequiredBundledPluginSeedError,
  seedBundledPlugins,
} from '../pluginRuntimeBootstrap';
import { markPluginUserRemoved } from '../../../../features/plugins/install/functions/pluginRemovalMarker';

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-plugin-runtime-bootstrap-'));
  tempRoots.push(tempRoot);
  return tempRoot;
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeFile(filePath: string, source: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, source, 'utf8');
}

function writeBundledPlugin(
  root: string,
  pluginId: string,
  version: string,
  options: { readonly required?: boolean } = {}
): string {
  const pluginDir = path.join(root, pluginId);
  writePluginVersionDir(pluginDir, pluginId, version, options);
  return pluginDir;
}

function writePluginVersionDir(
  pluginDir: string,
  pluginId: string,
  version: string,
  options: { readonly required?: boolean; readonly artifactIdentity?: string } = {}
): void {
  writeJson(path.join(pluginDir, 'plugin.json'), {
    id: pluginId,
    version,
    name: pluginId,
    ...(options.required === true ? { required: true } : {}),
    entry: {
      backend: './dist/backend/index.cjs',
      renderer: './dist/renderer/index.js',
    },
    compat: { rendererUi: '^1.0.0' },
  });
  writeFile(path.join(pluginDir, 'dist/backend/index.cjs'), 'module.exports.backendPlugin = {};');
  writeFile(path.join(pluginDir, 'dist/renderer/index.js'), 'export const rendererPlugin = {};');
  writeFile(
    path.join(pluginDir, 'SHA512SUMS'),
    options.artifactIdentity ?? ['plugin.json', 'dist/backend/index.cjs', 'dist/renderer/index.js']
      .map(file => `${hash('sha512', fs.readFileSync(path.join(pluginDir, file)))}  ${file}\n`)
      .join('')
  );
}

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe('plugin runtime bootstrap', () => {
  it('keeps inline development isolated from stale repository bundled artifacts', () => {
    expect(
      buildBundledPluginRootCandidates({
        explicitRoot: undefined,
        includeImplicitPackagedRoots: false,
        resourcesPath: '/runtime/resources',
        appPath: '/workspace/app',
        workingDirectory: '/workspace',
      })
    ).toEqual([]);

    expect(
      buildBundledPluginRootCandidates({
        explicitRoot: '/isolated/artifact-smoke/plugins',
        includeImplicitPackagedRoots: false,
        resourcesPath: '/runtime/resources',
        appPath: '/workspace/app',
        workingDirectory: '/workspace',
      })
    ).toEqual(['/isolated/artifact-smoke/plugins']);
  });

  it('discovers packaged bundled roots only when the composition root enables them', () => {
    expect(
      buildBundledPluginRootCandidates({
        explicitRoot: undefined,
        includeImplicitPackagedRoots: true,
        resourcesPath: '/runtime/resources',
        appPath: '/runtime/app',
        workingDirectory: '/workspace',
      })
    ).toEqual([
      '/runtime/resources/plugins',
      '/runtime/resources/app/extraResources/plugins',
      '/runtime/resources/app.asar.unpacked/extraResources/plugins',
      '/workspace/extraResources/plugins',
      '/runtime/app/extraResources/plugins',
      '/extraResources/plugins',
    ]);
  });

  it('finds the first candidate that contains bundled plugin manifests', () => {
    const tempRoot = makeTempRoot();
    const missingRoot = path.join(tempRoot, 'missing');
    const bundledRoot = path.join(tempRoot, 'bundled');
    writeBundledPlugin(bundledRoot, 'mindmap', '1.0.0');

    expect(findBundledPluginRootFromCandidates([missingRoot, bundledRoot])).toBe(bundledRoot);
  });

  it('stages bundled plugins without switching active before DB lifecycle runs', () => {
    const tempRoot = makeTempRoot();
    const bundledRoot = path.join(tempRoot, 'bundled');
    const userPluginRoot = path.join(tempRoot, 'user-plugins');
    writeBundledPlugin(bundledRoot, 'mindmap', '1.0.0');

    const results = seedBundledPlugins({
      bundledPluginRoot: bundledRoot,
      userPluginRoot,
    });

    expect(results).toMatchObject([
      {
        pluginId: 'mindmap',
        version: '1.0.0',
        status: 'staged',
      },
    ]);
    expect(fs.existsSync(path.join(userPluginRoot, 'mindmap/active.json'))).toBe(false);
    expect(fs.existsSync(path.join(userPluginRoot, 'mindmap/1.0.0/plugin.json'))).toBe(true);
    expect(fs.existsSync(path.join(userPluginRoot, 'mindmap/1.0.0/dist/renderer/index.js'))).toBe(
      true
    );
    expect(
      listStagedBundledPluginActivationCandidates({
        bundledPluginRoot: bundledRoot,
        userPluginRoot,
      })
    ).toEqual([
      {
        pluginId: 'mindmap',
        version: '1.0.0',
        previousVersion: null,
        pluginDir: path.join(userPluginRoot, 'mindmap/1.0.0'),
      },
    ]);
  });

  it('stages an update for an older active bundled plugin installation', () => {
    const tempRoot = makeTempRoot();
    const bundledRoot = path.join(tempRoot, 'bundled');
    const userPluginRoot = path.join(tempRoot, 'user-plugins');
    writeBundledPlugin(bundledRoot, 'mindmap', '1.0.0');
    writeJson(path.join(userPluginRoot, 'mindmap/active.json'), {
      version: '0.9.0',
    });
    writePluginVersionDir(path.join(userPluginRoot, 'mindmap/0.9.0'), 'mindmap', '0.9.0');

    const results = seedBundledPlugins({
      bundledPluginRoot: bundledRoot,
      userPluginRoot,
    });

    expect(results).toMatchObject([
      {
        pluginId: 'mindmap',
        version: '1.0.0',
        status: 'update-staged',
      },
    ]);
    expect(
      JSON.parse(fs.readFileSync(path.join(userPluginRoot, 'mindmap/active.json'), 'utf8'))
    ).toEqual({
      version: '0.9.0',
    });
    expect(fs.existsSync(path.join(userPluginRoot, 'mindmap/1.0.0/plugin.json'))).toBe(true);
    expect(fs.existsSync(path.join(userPluginRoot, 'mindmap/0.9.0/plugin.json'))).toBe(true);
    expect(
      listStagedBundledPluginActivationCandidates({
        bundledPluginRoot: bundledRoot,
        userPluginRoot,
      })
    ).toEqual([
      {
        pluginId: 'mindmap',
        version: '1.0.0',
        previousVersion: '0.9.0',
        pluginDir: path.join(userPluginRoot, 'mindmap/1.0.0'),
      },
    ]);
  });

  it('stages a user-requested reinstall even when startup seed respects the removal marker', () => {
    const tempRoot = makeTempRoot();
    const bundledRoot = path.join(tempRoot, 'bundled');
    const userPluginRoot = path.join(tempRoot, 'user-plugins');
    writeBundledPlugin(bundledRoot, 'mindmap', '1.0.0');
    markPluginUserRemoved(userPluginRoot, 'mindmap');

    expect(seedBundledPlugins({ bundledPluginRoot: bundledRoot, userPluginRoot })).toMatchObject([
      { pluginId: 'mindmap', status: 'skipped' },
    ]);

    expect(stageBundledPluginForExplicitInstall({
      bundledPluginRoot: bundledRoot,
      userPluginRoot,
      pluginId: 'mindmap',
    })).toMatchObject({
      pluginId: 'mindmap',
      version: '1.0.0',
      previousVersion: null,
    });
    expect(fs.existsSync(path.join(userPluginRoot, 'mindmap/1.0.0/plugin.json'))).toBe(true);
  });

  it('reports a full volume when Windows maps bundled copy exhaustion to EINPROGRESS', () => {
    const root = makeTempRoot();
    const bundledPluginRoot = path.join(root, 'bundled');
    const userPluginRoot = path.join(root, 'plugins');
    writeBundledPlugin(bundledPluginRoot, 'mindmap', '1.0.0');
    const request = { bundledPluginRoot, userPluginRoot, pluginId: 'mindmap' };
    const copyError = Object.assign(new Error('Copy failed'), { code: 'EINPROGRESS' });
    const copy = vi.spyOn(fs, 'cpSync').mockImplementation((_source, temporary) => {
      writeFile(path.join(String(temporary), 'partial-copy'), 'Fixture');
      throw copyError;
    });
    const capacity = vi.spyOn(fs, 'statfsSync').mockReturnValue({
      type: 0, bsize: 4096, blocks: 100, bfree: 0, bavail: 0, files: 0, ffree: 0,
    });
    try {
      expect(() => stageBundledPluginForExplicitInstall(request)).toThrow(
        expect.objectContaining({ code: 'disk-space', cause: copyError })
      );
      expect(fs.readdirSync(path.join(userPluginRoot, 'mindmap'))).toEqual([]);
      // 同一个底层码在有空间时不能被误报成磁盘满。
      capacity.mockReturnValue({ type: 0, bsize: 4096, blocks: 100, bfree: 40, bavail: 40, files: 0, ffree: 0 });
      expect(() => stageBundledPluginForExplicitInstall(request)).toThrow(copyError);
    } finally {
      capacity.mockRestore();
      copy.mockRestore();
    }
    expect(stageBundledPluginForExplicitInstall(request).createdVersionDir).toBe(true);
  });

  it('replaces a leftover same-version directory when the plugin is not active', () => {
    const tempRoot = makeTempRoot();
    const bundledRoot = path.join(tempRoot, 'bundled');
    const userPluginRoot = path.join(tempRoot, 'user-plugins');
    const bundledDirectory = writeBundledPlugin(bundledRoot, 'mindmap', '1.0.0');
    writePluginVersionDir(path.join(userPluginRoot, 'mindmap/1.0.0'), 'mindmap', '1.0.0', {
      artifactIdentity: 'failed-attempt',
    });

    const candidate = stageBundledPluginForExplicitInstall({
      bundledPluginRoot: bundledRoot,
      userPluginRoot,
      pluginId: 'mindmap',
    });

    expect(candidate.createdVersionDir).toBe(true);
    expect(fs.readFileSync(path.join(candidate.pluginDir, 'SHA512SUMS'), 'utf8'))
      .toBe(fs.readFileSync(path.join(bundledDirectory, 'SHA512SUMS'), 'utf8'));
  });

  it('rejects damaged bundled payload before replacing an existing retry directory', () => {
    const root = makeTempRoot();
    const bundledRoot = path.join(root, 'bundled');
    const userPluginRoot = path.join(root, 'user-plugins');
    const bundledDirectory = writeBundledPlugin(bundledRoot, 'mindmap', '1.0.0');
    const renderer = path.join(bundledDirectory, 'dist/renderer/index.js');
    const original = fs.readFileSync(renderer);
    fs.writeFileSync(renderer, '// corrupt bundled renderer');
    markPluginUserRemoved(userPluginRoot, 'mindmap');
    const retryDirectory = path.join(userPluginRoot, 'mindmap/1.0.0');
    writePluginVersionDir(retryDirectory, 'mindmap', '1.0.0', { artifactIdentity: 'failed-attempt' });
    const options = { bundledPluginRoot: bundledRoot, userPluginRoot, pluginId: 'mindmap' };

    expect(() => stageBundledPluginForExplicitInstall(options)).toThrow(
      expect.objectContaining({ code: 'artifact-integrity' })
    );
    expect(fs.readFileSync(path.join(retryDirectory, 'SHA512SUMS'), 'utf8')).toBe('failed-attempt');
    fs.writeFileSync(renderer, original);
    expect(stageBundledPluginForExplicitInstall(options)).toMatchObject({ createdVersionDir: true });
    expect(fs.readFileSync(path.join(retryDirectory, 'dist/renderer/index.js'))).toEqual(original);
  });

  it('does not downgrade a newer active plugin installation', () => {
    const tempRoot = makeTempRoot();
    const bundledRoot = path.join(tempRoot, 'bundled');
    const userPluginRoot = path.join(tempRoot, 'user-plugins');
    writeBundledPlugin(bundledRoot, 'mindmap', '1.0.0');
    writeJson(path.join(userPluginRoot, 'mindmap/active.json'), {
      version: '1.1.0',
    });
    writePluginVersionDir(path.join(userPluginRoot, 'mindmap/1.1.0'), 'mindmap', '1.1.0');

    const results = seedBundledPlugins({
      bundledPluginRoot: bundledRoot,
      userPluginRoot,
    });

    expect(results).toMatchObject([
      {
        pluginId: 'mindmap',
        version: '1.0.0',
        status: 'already-active',
        reason: 'active 版本 1.1.0 高于预置版本 1.0.0',
      },
    ]);
    expect(
      JSON.parse(fs.readFileSync(path.join(userPluginRoot, 'mindmap/active.json'), 'utf8'))
    ).toEqual({
      version: '1.1.0',
    });
    expect(fs.existsSync(path.join(userPluginRoot, 'mindmap/1.0.0'))).toBe(false);
  });

  it('keeps an already staged bundled version pending when active pointer is missing', () => {
    const tempRoot = makeTempRoot();
    const bundledRoot = path.join(tempRoot, 'bundled');
    const userPluginRoot = path.join(tempRoot, 'user-plugins');
    writeBundledPlugin(bundledRoot, 'mindmap', '1.0.0');
    writePluginVersionDir(path.join(userPluginRoot, 'mindmap/1.0.0'), 'mindmap', '1.0.0');

    const results = seedBundledPlugins({
      bundledPluginRoot: bundledRoot,
      userPluginRoot,
    });

    expect(results).toMatchObject([
      {
        pluginId: 'mindmap',
        version: '1.0.0',
        status: 'staged',
      },
    ]);
    expect(fs.existsSync(path.join(userPluginRoot, 'mindmap/active.json'))).toBe(false);
  });

  it('skips only the plugin whose same version resolves to different artifact contents', () => {
    const tempRoot = makeTempRoot();
    const bundledRoot = path.join(tempRoot, 'bundled');
    const userPluginRoot = path.join(tempRoot, 'user-plugins');
    // 冲突插件排在前面，后面的随包插件仍要准备。
    writeBundledPlugin(bundledRoot, 'a-mindmap', '1.0.0');
    writeBundledPlugin(bundledRoot, 'z-slides', '2.0.0');
    const conflictDirectory = path.join(userPluginRoot, 'a-mindmap/1.0.0');
    writePluginVersionDir(conflictDirectory, 'a-mindmap', '1.0.0', { artifactIdentity: 'different-content' });
    writeJson(path.join(userPluginRoot, 'a-mindmap/active.json'), { version: '1.0.0' });

    const results = seedBundledPlugins({ bundledPluginRoot: bundledRoot, userPluginRoot });

    expect(results).toMatchObject([
      {
        pluginId: 'a-mindmap',
        version: '1.0.0',
        targetDir: conflictDirectory,
        status: 'skipped',
        conflict: true,
        reason: expect.stringContaining('同版本 artifact 冲突：SHA512SUMS 不一致'),
      },
      { pluginId: 'z-slides', version: '2.0.0', status: 'staged' },
    ]);
    expect(results[1]).not.toHaveProperty('conflict');
    // 冲突版本目录与 active 指针都保持原样，不被随包字节覆盖。
    expect(fs.readFileSync(path.join(conflictDirectory, 'SHA512SUMS'), 'utf8')).toBe('different-content');
    expect(JSON.parse(fs.readFileSync(path.join(userPluginRoot, 'a-mindmap/active.json'), 'utf8'))).toEqual({ version: '1.0.0' });
    expect(fs.existsSync(path.join(userPluginRoot, 'z-slides/2.0.0/plugin.json'))).toBe(true);
  });

  it('skips a staged update whose existing version directory has no checksum identity', () => {
    const tempRoot = makeTempRoot();
    const bundledRoot = path.join(tempRoot, 'bundled');
    const userPluginRoot = path.join(tempRoot, 'user-plugins');
    writeBundledPlugin(bundledRoot, 'mindmap', '1.1.0');
    writePluginVersionDir(path.join(userPluginRoot, 'mindmap/1.0.0'), 'mindmap', '1.0.0');
    writeJson(path.join(userPluginRoot, 'mindmap/active.json'), { version: '1.0.0' });
    const targetDirectory = path.join(userPluginRoot, 'mindmap/1.1.0');
    writePluginVersionDir(targetDirectory, 'mindmap', '1.1.0');
    fs.rmSync(path.join(targetDirectory, 'SHA512SUMS'));

    expect(seedBundledPlugins({ bundledPluginRoot: bundledRoot, userPluginRoot })).toMatchObject([
      { pluginId: 'mindmap', version: '1.1.0', status: 'skipped', conflict: true },
    ]);
    expect(fs.existsSync(path.join(targetDirectory, 'SHA512SUMS'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(userPluginRoot, 'mindmap/active.json'), 'utf8'))).toEqual({ version: '1.0.0' });
  });

  it('still blocks startup when a required bundled plugin has a same-version conflict', () => {
    const tempRoot = makeTempRoot();
    const bundledRoot = path.join(tempRoot, 'bundled');
    const userPluginRoot = path.join(tempRoot, 'user-plugins');
    writeBundledPlugin(bundledRoot, 'platform-ext', '1.0.0', { required: true });
    writePluginVersionDir(path.join(userPluginRoot, 'platform-ext/1.0.0'), 'platform-ext', '1.0.0', {
      required: true,
      artifactIdentity: 'different-content',
    });

    const results = seedBundledPlugins({ bundledPluginRoot: bundledRoot, userPluginRoot });

    expect(results).toMatchObject([{ pluginId: 'platform-ext', status: 'skipped', conflict: true }]);
    expect(() => assertRequiredBundledPluginSeedSucceeded({ bundledPluginRoot: bundledRoot, seedResults: results }))
      .toThrow(RequiredBundledPluginSeedError);
  });

  it('skips bundled seed when the user removed the plugin', () => {
    const tempRoot = makeTempRoot();
    const bundledRoot = path.join(tempRoot, 'bundled');
    const userPluginRoot = path.join(tempRoot, 'user-plugins');
    writeBundledPlugin(bundledRoot, 'mindmap', '1.0.0');
    markPluginUserRemoved(userPluginRoot, 'mindmap', 123);

    const results = seedBundledPlugins({
      bundledPluginRoot: bundledRoot,
      userPluginRoot,
    });

    expect(results).toMatchObject([
      {
        pluginId: 'mindmap',
        version: '1.0.0',
        status: 'skipped',
        reason: '用户已卸载该预置插件，跳过自动 seed',
      },
    ]);
    expect(fs.existsSync(path.join(userPluginRoot, 'mindmap/active.json'))).toBe(false);
    expect(fs.existsSync(path.join(userPluginRoot, 'mindmap/1.0.0'))).toBe(false);
  });

  it('fails fast when a required bundled plugin cannot be seeded', () => {
    const tempRoot = makeTempRoot();
    const bundledRoot = path.join(tempRoot, 'bundled');
    const userPluginRoot = path.join(tempRoot, 'user-plugins');
    writeBundledPlugin(bundledRoot, 'platform-ext', '1.0.0', { required: true });
    writeFile(path.join(userPluginRoot, 'platform-ext/1.0.0/plugin.json'), 'not-json');

    const results = seedBundledPlugins({
      bundledPluginRoot: bundledRoot,
      userPluginRoot,
    });

    expect(results).toMatchObject([
      {
        pluginId: 'platform-ext',
        status: 'skipped',
        reason: expect.stringContaining('Unexpected token'),
      },
    ]);
    expect(() =>
      assertRequiredBundledPluginSeedSucceeded({
        bundledPluginRoot: bundledRoot,
        seedResults: results,
      })
    ).toThrow(RequiredBundledPluginSeedError);
  });

  it('keeps optional bundled plugin seed failures recoverable', () => {
    const tempRoot = makeTempRoot();
    const bundledRoot = path.join(tempRoot, 'bundled');
    const userPluginRoot = path.join(tempRoot, 'user-plugins');
    writeBundledPlugin(bundledRoot, 'mindmap', '1.0.0');
    writeFile(path.join(userPluginRoot, 'mindmap/1.0.0/plugin.json'), 'not-json');

    const results = seedBundledPlugins({
      bundledPluginRoot: bundledRoot,
      userPluginRoot,
    });

    expect(results).toMatchObject([
      {
        pluginId: 'mindmap',
        status: 'skipped',
        reason: expect.stringContaining('Unexpected token'),
      },
    ]);
    expect(() =>
      assertRequiredBundledPluginSeedSucceeded({
        bundledPluginRoot: bundledRoot,
        seedResults: results,
      })
    ).not.toThrow();
  });
});
