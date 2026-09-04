import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');
const temporaryRoot = path.join(repositoryRoot, 'tmp', 'pdfs');
await mkdir(temporaryRoot, { recursive: true });
const temporaryDirectory = await mkdtemp(path.join(temporaryRoot, 'raster-benchmark-'));
const outputPath = path.join(temporaryDirectory, 'pdf-rasterization.mjs');

try {
  // 基准产物模拟生产 Worker：业务 TypeScript 先打成普通 JS，PDF.js 与原生 Canvas
  // 在纯 Node 进程中运行。直接用 tsx/vitest 会让其转换 PDF.js worker.mjs，虚增数百 MiB。
  await build({
    entryPoints: [path.join(scriptDirectory, 'pdf-rasterization.ts')],
    outfile: outputPath,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    external: ['pdfjs-dist', '@napi-rs/canvas'],
    logLevel: 'silent',
  });

  const requestedArgs = process.argv.slice(2);
  const syntheticScans = requestedArgs.includes('--synthetic-scans');
  let benchmarkArgs = requestedArgs;
  if (syntheticScans) {
    const fixturePath = path.join(temporaryDirectory, 'synthetic-scans.pdf');
    const pageCount = readCliValue(requestedArgs, '--pages') ?? '100';
    const generationExitCode = await runNodeBenchmark(outputPath, [
      '--write-synthetic-scans',
      fixturePath,
      '--pages',
      pageCount,
    ]);
    if (generationExitCode !== 0) {
      throw new Error(`扫描 PDF fixture 生成失败，退出码 ${generationExitCode}`);
    }
    benchmarkArgs = [
      ...requestedArgs.filter(argument => argument !== '--synthetic-scans'),
      '--input',
      fixturePath,
      '--source-label',
      'synthetic-scans',
    ];
  }

  const exitCode = await runNodeBenchmark(outputPath, benchmarkArgs);
  if (exitCode !== 0) process.exitCode = exitCode;
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

function runNodeBenchmark(entryPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--expose-gc', entryPath, ...args], {
      stdio: 'inherit',
      env: process.env,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`PDF 栅格化基准被信号 ${signal} 终止`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}

function readCliValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : undefined;
}
