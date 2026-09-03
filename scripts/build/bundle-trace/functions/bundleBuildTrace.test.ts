import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { BundleBuildTrace } from '../definitions/bundleBuildTrace.mjs';
import {
  BUNDLE_TRACE_ROOT_ENV,
  writeDerivedBundleTrace,
  writeEsbuildBundleTrace,
  writeViteBundleTrace,
} from './bundleBuildTrace.mjs';

function writeFile(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function readTrace(tracePath: string | undefined): BundleBuildTrace {
  if (!tracePath) throw new Error('测试预期生成 bundle trace');
  return JSON.parse(fs.readFileSync(tracePath, 'utf8')) as BundleBuildTrace;
}

function sha256(contents: string): string {
  return createHash('sha256').update(contents).digest('hex');
}

describe('bundle build trace', () => {
  it('把 esbuild 输入归一化为 workspace source 与精确 npm package identity', () => {
    const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-bundle-trace-'));
    const workspaceInput = path.join(repositoryRoot, 'src', 'entry.ts');
    const packageRoot = path.join(repositoryRoot, 'node_modules', 'example-package');
    const packageInput = path.join(packageRoot, 'index.js');
    const outputPath = path.join(repositoryRoot, 'dist', 'main.cjs');
    writeFile(workspaceInput, 'export const answer = 42;\n');
    writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({
      name: 'example-package',
      version: '1.2.3',
    }));
    writeFile(packageInput, 'export const dependency = true;\n');
    writeFile(outputPath, 'compiled-output\n');
    const tracePath = writeEsbuildBundleTrace({
      buildTarget: 'desktop/main',
      environment: { [BUNDLE_TRACE_ROOT_ENV]: 'dist_release/bundle-traces' },
      metafile: {
        inputs: {
          'src/entry.ts': { bytes: 26, imports: [] },
          'node_modules/example-package/index.js': { bytes: 32, imports: [] },
        },
        outputs: {
          'dist/main.cjs': {
            bytes: Buffer.byteLength('compiled-output\n'),
            entryPoint: 'src/entry.ts',
            imports: [{ external: true, kind: 'require-call', path: 'electron' }],
            inputs: {
              'src/entry.ts': { bytesInOutput: 9 },
              'node_modules/example-package/index.js': { bytesInOutput: 7 },
            },
          },
        },
      },
      repositoryRoot,
      toolVersion: '0.25.11',
      workingDirectory: repositoryRoot,
    });
    const trace = readTrace(tracePath);

    expect(trace.buildInputs).toEqual([
      expect.objectContaining({
        id: 'npm:example-package@1.2.3:index.js',
        kind: 'npm-package',
        packageName: 'example-package',
        packageVersion: '1.2.3',
        path: 'index.js',
      }),
      expect.objectContaining({
        id: 'workspace:src/entry.ts',
        kind: 'workspace-source',
        path: 'src/entry.ts',
      }),
    ]);
    expect(trace.outputs).toEqual([
      expect.objectContaining({
        entryPoint: 'src/entry.ts',
        inputAttribution: 'module-contribution',
        path: 'dist/main.cjs',
        sha256: sha256('compiled-output\n'),
        size: Buffer.byteLength('compiled-output\n'),
      }),
    ]);
    expect(JSON.stringify(trace)).not.toContain(repositoryRoot);
  });

  it('对 Vite chunk 保留模块贡献，对 asset 明确降级为 build-wide 归因', () => {
    const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-vite-trace-'));
    const inputPath = path.join(repositoryRoot, 'src', 'renderer.ts');
    const outputDirectory = path.join(repositoryRoot, 'dist', 'renderer');
    writeFile(inputPath, 'export const renderer = true;\n');
    writeFile(path.join(outputDirectory, 'index.js'), 'renderer-output\n');
    writeFile(path.join(outputDirectory, 'style.css'), '.root{}\n');
    const trace = readTrace(writeViteBundleTrace({
      buildInputs: [inputPath],
      buildTarget: 'desktop/renderer',
      environment: { [BUNDLE_TRACE_ROOT_ENV]: 'dist_release/bundle-traces' },
      outputDirectory,
      outputs: {
        'index.js': {
          code: 'renderer-output\n',
          facadeModuleId: inputPath,
          fileName: 'index.js',
          modules: { [inputPath]: { renderedLength: 11 } },
          type: 'chunk',
        },
        'style.css': {
          fileName: 'style.css',
          source: '.root{}\n',
          type: 'asset',
        },
      },
      repositoryRoot,
      toolVersion: '6.4.1',
      workingDirectory: repositoryRoot,
    }));

    expect(trace.outputs.map(output => [output.path, output.inputAttribution])).toEqual([
      ['dist/renderer/index.js', 'module-contribution'],
      ['dist/renderer/style.css', 'build-wide'],
    ]);
    expect(trace.outputs[1]?.inputs).toEqual([{ inputId: 'workspace:src/renderer.ts' }]);
    expect(JSON.stringify(trace)).not.toContain(repositoryRoot);
  });

  it('拒绝把外置 evidence 写入会进入安装包的 dist 目录', () => {
    const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-trace-root-'));
    const inputPath = path.join(repositoryRoot, 'src', 'entry.ts');
    const outputPath = path.join(repositoryRoot, 'dist', 'main.js');
    writeFile(inputPath, 'entry\n');
    writeFile(outputPath, 'output\n');

    expect(() => writeEsbuildBundleTrace({
      buildTarget: 'desktop/main',
      environment: { [BUNDLE_TRACE_ROOT_ENV]: 'dist/bundle-traces' },
      metafile: {
        inputs: { 'src/entry.ts': { bytes: 6, imports: [] } },
        outputs: {
          'dist/main.js': {
            bytes: 7,
            imports: [],
            inputs: { 'src/entry.ts': { bytesInOutput: 5 } },
          },
        },
      },
      repositoryRoot,
      toolVersion: '0.25.11',
      workingDirectory: repositoryRoot,
    })).toThrow('不能位于会进入发布制品的目录');
  });

  it('外部 entry point 只记录文件名，不泄漏构建机绝对路径', () => {
    const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-external-entry-'));
    const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-external-source-'));
    const externalInput = path.join(externalRoot, 'generated-entry.ts');
    const outputPath = path.join(repositoryRoot, 'dist', 'generated.js');
    writeFile(externalInput, 'export const generated = true;\n');
    writeFile(outputPath, 'generated-output\n');
    const trace = readTrace(writeEsbuildBundleTrace({
      buildTarget: 'desktop/external-entry-check',
      environment: { [BUNDLE_TRACE_ROOT_ENV]: 'dist_release/bundle-traces' },
      metafile: {
        inputs: { [externalInput]: { bytes: 31, imports: [] } },
        outputs: {
          [outputPath]: {
            bytes: Buffer.byteLength('generated-output\n'),
            entryPoint: externalInput,
            imports: [],
            inputs: { [externalInput]: { bytesInOutput: 8 } },
          },
        },
      },
      repositoryRoot,
      toolVersion: '0.25.11',
      workingDirectory: repositoryRoot,
    }));

    expect(trace.outputs[0]?.entryPoint).toBe('<external-entry>/generated-entry.ts');
    expect(JSON.stringify(trace)).not.toContain(externalRoot);
  });

  it('记录最终字节码由已追踪 bundle 派生，而不把生成文件冒充为 workspace source', () => {
    const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-derived-trace-'));
    const inputPath = path.join(repositoryRoot, 'dist', 'main', 'main.cjs');
    const outputPath = path.join(repositoryRoot, 'dist', 'main', 'main.jsc');
    writeFile(inputPath, 'main bundle\n');
    writeFile(outputPath, 'main bytecode\n');
    const trace = readTrace(writeDerivedBundleTrace({
      buildTarget: 'desktop/main-bytecode',
      environment: { [BUNDLE_TRACE_ROOT_ENV]: 'dist_release/bundle-traces' },
      inputPath,
      outputPath,
      repositoryRoot,
      toolName: 'bytenode',
      toolVersion: '1.5.7',
    }));

    expect(trace.buildInputs).toEqual([
      expect.objectContaining({ kind: 'bundle-output', path: 'dist/main/main.cjs' }),
    ]);
    expect(trace.outputs).toEqual([
      expect.objectContaining({
        inputAttribution: 'derived-output',
        path: 'dist/main/main.jsc',
      }),
    ]);
  });
});
