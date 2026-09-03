import { describe, expect, it } from 'vitest';

import type { BundleBuildTrace } from '../../build/bundle-trace/definitions/bundleBuildTrace.mjs';
import type { BundleBuildTraceSet } from '../../build/bundle-trace/definitions/bundleBuildTraceSet.mjs';
import type { ArtifactContentBom } from '../definitions/artifactContentBom';
import { createArtifactBundleComponentMap } from './artifactBundleComponentMap';

const source = { revision: 'a'.repeat(40), dirty: false } as const;
const identity = {
  name: 'Linnya',
  version: '1.0.0',
  platform: 'darwin',
  architecture: 'arm64',
} as const;

function bundleTrace(input: {
  buildTarget: string;
  inputKind?: 'bundle-output' | 'npm-package';
  inputPath: string;
  inputSha256?: string;
  outputPath: string;
  outputSha256: string;
}): BundleBuildTrace {
  const inputId = input.inputKind === 'bundle-output'
    ? `bundle-output:${input.inputPath}:${input.inputSha256}`
    : `npm:zod@3.25.76:${input.inputPath}`;
  return {
    schemaVersion: 1,
    kind: 'linnya-bundle-build-trace',
    buildTarget: input.buildTarget,
    tool: { name: 'esbuild', version: '0.25.11' },
    workingDirectory: '.',
    buildInputs: [{
      id: inputId,
      kind: input.inputKind ?? 'npm-package',
      packageName: input.inputKind === 'bundle-output' ? undefined : 'zod',
      packageVersion: input.inputKind === 'bundle-output' ? undefined : '3.25.76',
      path: input.inputPath,
      sha256: input.inputSha256,
    }],
    outputs: [{
      externalImports: [],
      inputAttribution: input.inputKind === 'bundle-output' ? 'derived-output' : 'module-contribution',
      inputs: [{ inputId }],
      path: input.outputPath,
      sha256: input.outputSha256,
      size: 10,
      type: 'chunk',
    }],
  };
}

describe('artifact bundle component map', () => {
  it('把 Host、插件和字节码派生输出关联到真实 artifact occurrence', () => {
    const mainBundle = bundleTrace({
      buildTarget: 'desktop/main',
      inputPath: 'index.js',
      outputPath: 'dist/main/main.cjs',
      outputSha256: '1'.repeat(64),
    });
    const mainBytecode = bundleTrace({
      buildTarget: 'desktop/main-bytecode',
      inputKind: 'bundle-output',
      inputPath: 'dist/main/main.cjs',
      inputSha256: '1'.repeat(64),
      outputPath: 'dist/main/main.jsc',
      outputSha256: '2'.repeat(64),
    });
    const plugin = bundleTrace({
      buildTarget: 'plugin-slides/backend',
      inputPath: 'plugin.js',
      outputPath: 'packages/plugins/slides/dist/backend/index.cjs',
      outputSha256: '3'.repeat(64),
    });
    const traces = [
      { fileName: 'main.json', trace: mainBundle },
      { fileName: 'bytecode.json', trace: mainBytecode },
      { fileName: 'slides.json', trace: plugin },
    ];
    const traceSet: BundleBuildTraceSet = {
      schemaVersion: 1,
      kind: 'linnya-bundle-build-trace-set',
      identity: { platform: 'darwin', architecture: 'arm64' },
      source,
      traces: traces.map(({ fileName, trace }) => ({
        buildTarget: trace.buildTarget,
        fileName,
        inputCount: trace.buildInputs.length,
        npmPackageCount: trace.buildInputs.filter(buildInput => buildInput.kind === 'npm-package').length,
        outputCount: trace.outputs.length,
        sha256: 'f'.repeat(64),
        tool: trace.tool,
      })),
      summary: {
        buildTargetCount: 3,
        npmPackageCount: 1,
        outputCount: 3,
        traceFileCount: 3,
      },
      limitations: ['artifact-output-occurrences-not-yet-linked'],
    };
    const contentBom: ArtifactContentBom = {
      schemaVersion: 1,
      kind: 'linnya-desktop-artifact-content',
      identity,
      source,
      environment: {
        architecture: 'arm64',
        electronVersion: '43.4.0',
        nodeVersion: 'v24.18.0',
        platform: 'darwin',
        productionPackageLockSha256: 'e'.repeat(64),
      },
      artifacts: [],
      entries: [
        {
          type: 'file', scope: 'app-asar', category: 'application-code',
          path: 'dist/main/main.jsc', executable: false, size: 10, sha256: '2'.repeat(64),
        },
        {
          type: 'file', scope: 'app-filesystem', category: 'application-code',
          path: 'Contents/Resources/app.asar.unpacked/dist/main/main.jsc',
          executable: false, size: 10, sha256: '2'.repeat(64),
        },
        {
          type: 'file', scope: 'app-filesystem', category: 'plugin-resource',
          path: 'Contents/Resources/plugins/slides/dist/backend/index.cjs',
          executable: false, size: 10, sha256: '3'.repeat(64),
        },
      ],
      summary: {
        fileCount: 3,
        fileSize: 30,
        scopeCounts: {
          'app-asar': 1,
          'app-filesystem': 2,
          'plugin-archive': 0,
        },
        symlinkCount: 0,
        treeSha256: 'd'.repeat(64),
      },
    };
    const map = createArtifactBundleComponentMap({
      bundleTraceSet: traceSet,
      bundleTraceSetSha256: 'b'.repeat(64),
      contentBom,
      contentBomSha256: 'c'.repeat(64),
      traces,
    });

    expect(map.summary).toEqual({
      artifactOccurrenceCount: 3,
      buildTargetCount: 3,
      intermediateOutputCount: 1,
      npmPackageComponentCount: 1,
      traceOutputCount: 3,
    });
    expect(map.limitations[0].entryCount).toBe(0);
    expect(map.limitations[1].entryCount).toBe(0);
    expect(map.components[0]).toEqual({
      id: 'zod@3.25.76',
      name: 'zod',
      version: '3.25.76',
      buildTargets: ['desktop/main', 'plugin-slides/backend'],
    });
  });

  it('只在 artifact 没有稳定逻辑路径且 trace hash 唯一时接受重定位', () => {
    const sandbox = bundleTrace({
      buildTarget: 'desktop/sandbox-runner',
      inputPath: 'sandbox.ts',
      outputPath: 'dist/main/sandbox/sandboxEvaluatorProcess.cjs',
      outputSha256: '4'.repeat(64),
    });
    const traceSet: BundleBuildTraceSet = {
      schemaVersion: 1,
      kind: 'linnya-bundle-build-trace-set',
      identity: { platform: 'darwin', architecture: 'arm64' },
      source,
      traces: [{
        buildTarget: sandbox.buildTarget,
        fileName: 'sandbox.json',
        inputCount: 1,
        npmPackageCount: 1,
        outputCount: 1,
        sha256: 'f'.repeat(64),
        tool: sandbox.tool,
      }],
      summary: {
        buildTargetCount: 1,
        npmPackageCount: 1,
        outputCount: 1,
        traceFileCount: 1,
      },
      limitations: ['artifact-output-occurrences-not-yet-linked'],
    };
    const contentBom: ArtifactContentBom = {
      schemaVersion: 1,
      kind: 'linnya-desktop-artifact-content',
      identity,
      source,
      environment: {
        architecture: 'arm64',
        electronVersion: '43.4.0',
        nodeVersion: 'v24.18.0',
        platform: 'darwin',
        productionPackageLockSha256: 'e'.repeat(64),
      },
      artifacts: [],
      entries: [
        {
          type: 'file', scope: 'app-filesystem', category: 'application-code',
          path: 'Contents/Resources/sandbox-runtime/evaluator/sandboxEvaluatorProcess.cjs',
          executable: false, size: 10, sha256: '4'.repeat(64),
        },
        {
          type: 'file', scope: 'app-asar', category: 'production-dependency',
          path: 'node_modules/example/sandboxEvaluatorProcess.cjs',
          executable: false, size: 10, sha256: '4'.repeat(64),
        },
      ],
      summary: {
        fileCount: 2,
        fileSize: 20,
        scopeCounts: {
          'app-asar': 1,
          'app-filesystem': 1,
          'plugin-archive': 0,
        },
        symlinkCount: 0,
        treeSha256: 'd'.repeat(64),
      },
    };

    const map = createArtifactBundleComponentMap({
      bundleTraceSet: traceSet,
      bundleTraceSetSha256: 'b'.repeat(64),
      contentBom,
      contentBomSha256: 'c'.repeat(64),
      traces: [{ fileName: 'sandbox.json', trace: sandbox }],
    });

    expect(map.summary.artifactOccurrenceCount).toBe(1);
    expect(map.occurrences[0]?.artifactPath).toBe(
      'Contents/Resources/sandbox-runtime/evaluator/sandboxEvaluatorProcess.cjs',
    );
  });
});
