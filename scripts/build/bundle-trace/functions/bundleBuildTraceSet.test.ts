import { describe, expect, it } from 'vitest';

import type { BundleBuildTrace } from '../definitions/bundleBuildTrace.mjs';
import { createBundleBuildTraceSet } from './bundleBuildTraceSet.mjs';

function trace(buildTarget: string): BundleBuildTrace {
  return {
    schemaVersion: 1,
    kind: 'linnya-bundle-build-trace',
    buildTarget,
    tool: { name: 'esbuild', version: '0.25.11' },
    workingDirectory: '.',
    buildInputs: [
      {
        id: 'npm:zod@3.25.76/index.js',
        kind: 'npm-package',
        packageName: 'zod',
        packageVersion: '3.25.76',
        path: 'index.js',
      },
    ],
    outputs: [{
      externalImports: [],
      inputAttribution: 'module-contribution',
      inputs: [],
      path: 'dist/main.js',
      sha256: 'a'.repeat(64),
      size: 1,
      type: 'chunk',
    }],
  };
}

describe('bundle build trace set', () => {
  it('冻结去重后的 target、output 与 npm package 汇总', () => {
    const set = createBundleBuildTraceSet({
      identity: { platform: 'darwin', architecture: 'arm64' },
      requiredBuildTargets: ['desktop/main'],
      requiredBuildTargetPrefixes: ['plugin-mindmap/'],
      source: { revision: 'b'.repeat(40), dirty: false },
      traceFiles: [
        { fileName: 'main.json', sha256: 'c'.repeat(64), trace: trace('desktop/main') },
        {
          fileName: 'mindmap.json',
          sha256: 'd'.repeat(64),
          trace: trace('plugin-mindmap/backend'),
        },
      ],
    });

    expect(set.summary).toEqual({
      traceFileCount: 2,
      buildTargetCount: 2,
      outputCount: 2,
      npmPackageCount: 1,
    });
  });

  it('缺少核心 target 或插件 target 时 fail closed', () => {
    expect(() => createBundleBuildTraceSet({
      identity: { platform: 'win32', architecture: 'x64' },
      requiredBuildTargets: ['desktop/main'],
      requiredBuildTargetPrefixes: ['plugin-slides/'],
      source: { revision: 'b'.repeat(40), dirty: false },
      traceFiles: [
        { fileName: 'main.json', sha256: 'c'.repeat(64), trace: trace('desktop/main') },
      ],
    })).toThrow('plugin-slides/*');
  });
});
