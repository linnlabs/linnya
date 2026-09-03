import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { assertBundledPluginRootMatchesPluginIds } from './pluginBundledRootContract.mjs';

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-plugin-bundled-root-contract-'));
  tempRoots.push(tempRoot);
  return tempRoot;
}

function writeBundledManifest(root: string, directoryName: string, pluginId = directoryName): void {
  const pluginDirectory = path.join(root, directoryName);
  fs.mkdirSync(pluginDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDirectory, 'plugin.json'),
    `${JSON.stringify({ id: pluginId, version: '1.0.0', entry: { backend: './dist/backend/index.cjs' } })}\n`,
    'utf8'
  );
}

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe('plugin bundled root contract', () => {
  it('accepts an isolated root whose directories exactly match the requested release targets', () => {
    const bundledPluginRoot = makeTempRoot();
    writeBundledManifest(bundledPluginRoot, 'slides');
    writeBundledManifest(bundledPluginRoot, 'mindmap');

    expect(
      assertBundledPluginRootMatchesPluginIds({
        bundledPluginRoot,
        expectedPluginIds: ['mindmap', 'slides'],
      })
    ).toEqual(['mindmap', 'slides']);
  });

  it('rejects a stale non-target plugin directory instead of silently including it', () => {
    const bundledPluginRoot = makeTempRoot();
    writeBundledManifest(bundledPluginRoot, 'mindmap');
    writeBundledManifest(bundledPluginRoot, 'sheet');

    expect(() =>
      assertBundledPluginRootMatchesPluginIds({
        bundledPluginRoot,
        expectedPluginIds: ['mindmap'],
      })
    ).toThrow('expected=mindmap, actual=mindmap,sheet');
  });

  it('rejects a directory whose name and manifest identity disagree', () => {
    const bundledPluginRoot = makeTempRoot();
    writeBundledManifest(bundledPluginRoot, 'mindmap', 'sheet');

    expect(() =>
      assertBundledPluginRootMatchesPluginIds({
        bundledPluginRoot,
        expectedPluginIds: ['mindmap'],
      })
    ).toThrow('directory=mindmap, manifest=sheet');
  });
});
