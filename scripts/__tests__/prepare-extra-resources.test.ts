import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

interface PreparePluginBundlesInput {
  readonly pluginIds: readonly string[];
  readonly pluginResourceRoot: string;
  readonly resetRoot: boolean;
  readonly requireExactPluginIds: boolean;
}

interface PrepareExtraResourcesModule {
  readonly preparePluginBundles: (input: PreparePluginBundlesInput) => Promise<readonly string[]>;
}

const require = createRequire(import.meta.url);
const loadedModule: unknown = require('../build/prepare-extra-resources.cjs');

function isPrepareExtraResourcesModule(value: unknown): value is PrepareExtraResourcesModule {
  return (
    !!value &&
    typeof value === 'object' &&
    'preparePluginBundles' in value &&
    typeof value.preparePluginBundles === 'function'
  );
}

if (!isPrepareExtraResourcesModule(loadedModule)) {
  throw new Error('prepare-extra-resources.cjs must export preparePluginBundles');
}
const prepareExtraResources = loadedModule;

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-prepare-extra-resources-'));
  tempRoots.push(tempRoot);
  return tempRoot;
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

afterEach(() => {
  delete process.env.LINNYA_PLUGIN_PACKAGE_DIR;
  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe('prepare extra resources plugin bundle', () => {
  it('rebuilds an exact isolated root and removes stale non-target plugin directories', async () => {
    const tempRoot = makeTempRoot();
    const packageDirectory = path.join(tempRoot, 'plugin-package');
    const bundledPluginRoot = path.join(tempRoot, 'bundled-plugins');
    process.env.LINNYA_PLUGIN_PACKAGE_DIR = packageDirectory;

    writeFile(
      path.join(packageDirectory, 'plugin.json'),
      `${JSON.stringify({
        id: 'demo',
        version: '1.0.0',
        entry: { backend: './dist/backend/index.cjs' },
      })}\n`
    );
    writeFile(path.join(packageDirectory, 'dist/backend/index.cjs'), 'module.exports = {};\n');
    writeFile(path.join(packageDirectory, 'dist/SHA512SUMS'), 'demo  plugin.json\n');
    writeFile(path.join(bundledPluginRoot, 'sheet/plugin.json'), '{"id":"sheet"}\n');

    await expect(
      prepareExtraResources.preparePluginBundles({
        pluginIds: ['demo'],
        pluginResourceRoot: bundledPluginRoot,
        resetRoot: true,
        requireExactPluginIds: true,
      })
    ).resolves.toEqual([path.join(bundledPluginRoot, 'demo')]);

    expect(fs.readdirSync(bundledPluginRoot)).toEqual(['demo']);
    expect(fs.existsSync(path.join(bundledPluginRoot, 'demo/dist/backend/index.cjs'))).toBe(true);
    expect(fs.existsSync(path.join(bundledPluginRoot, 'sheet'))).toBe(false);
  });
});
