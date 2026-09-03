import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  assertRequiredBundledPluginSeedSucceeded,
  BundledPluginArtifactConflictError,
  buildBundledPluginRootCandidates,
  findBundledPluginRootFromCandidates,
  listStagedBundledPluginActivationCandidates,
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
    `${options.artifactIdentity ?? `${pluginId}@${version}`}  plugin.json\n`
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

  it('fails when the same plugin version resolves to different artifact contents', () => {
    const tempRoot = makeTempRoot();
    const bundledRoot = path.join(tempRoot, 'bundled');
    const userPluginRoot = path.join(tempRoot, 'user-plugins');
    writeBundledPlugin(bundledRoot, 'mindmap', '1.0.0');
    writePluginVersionDir(path.join(userPluginRoot, 'mindmap/1.0.0'), 'mindmap', '1.0.0', {
      artifactIdentity: 'different-content',
    });

    expect(() =>
      seedBundledPlugins({
        bundledPluginRoot: bundledRoot,
        userPluginRoot,
      })
    ).toThrow(BundledPluginArtifactConflictError);
  });

  it('fails when an existing same-version artifact has no checksum identity', () => {
    const tempRoot = makeTempRoot();
    const bundledRoot = path.join(tempRoot, 'bundled');
    const userPluginRoot = path.join(tempRoot, 'user-plugins');
    writeBundledPlugin(bundledRoot, 'mindmap', '1.0.0');
    const targetDirectory = path.join(userPluginRoot, 'mindmap/1.0.0');
    writePluginVersionDir(targetDirectory, 'mindmap', '1.0.0');
    fs.rmSync(path.join(targetDirectory, 'SHA512SUMS'));

    expect(() =>
      seedBundledPlugins({
        bundledPluginRoot: bundledRoot,
        userPluginRoot,
      })
    ).toThrow(BundledPluginArtifactConflictError);
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
