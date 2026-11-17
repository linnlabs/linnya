import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { readDiagnosticLogEnvelope } from '../../../../shared/logging/functions/diagnosticLogEnvelope';
import { build } from 'esbuild';
import { expect, it } from 'vitest';
import { pluginWorkerSdkAliases } from '../../../../../scripts/build/plugin-worker-sdk.mjs';

it('真实普通Worker内联同一解析SDK，无Host hook、模型目录或凭据闭包', async () => {
  const cache = path.resolve('node_modules/.cache');
  await mkdir(cache, { recursive: true });
  const root = await mkdtemp(path.join(cache, 'document-parsing-worker-'));
  let worker: Worker | undefined;
  try {
    const outfile = path.join(root, 'worker.cjs');
    const bundle = await build({
      entryPoints: [fileURLToPath(new URL('./fixtures/documentParsing.worker.ts', import.meta.url))],
      outfile, bundle: true, platform: 'node', format: 'cjs', target: 'node24',
      metafile: true, logLevel: 'silent', tsconfig: path.resolve('tsconfig.json'),
      alias: pluginWorkerSdkAliases(process.cwd()),
      external: ['pdfjs-dist', '@napi-rs/canvas', 'sharp', 'better-sqlite3', 'electron', '@node-rs/jieba'],
    });
    // schemas/provider-account 只是公开 DTO；禁止的是 Host 凭据与 Provider 实现。
    expect(Object.keys(bundle.metafile.inputs).filter(file => /src\/(?:domains\/(?:model-catalog|provider-account)|.*credential-storage|.*agent-registry|.*backendHostModuleResolver|domains\/model-inference\/.*providers)/.test(file))).toEqual([]);
    expect(Object.values(bundle.metafile.outputs).flatMap(output => output.imports).filter(item => item.external && item.path.startsWith('@plugin/'))).toEqual([]);
    expect(Object.keys(bundle.metafile.inputs).filter(file => /pathManager|runtime-paths|createDiagnosticLogFileSink|createDiagnosticLogWriter/.test(file))).toEqual([]);
    const temporaryDirectory = path.join(root, 'task');
    await mkdir(temporaryDirectory);
    worker = new Worker(outfile, { env: { PATH: process.env.PATH }, workerData: temporaryDirectory });
    const active = worker;
    let result: unknown;
    const diagnosticMessages: unknown[] = [];
    await new Promise<void>((resolve, reject) => {
      active.once('error', reject);
      active.on('message', value => {
        if (readDiagnosticLogEnvelope(value)) diagnosticMessages.push(value);
        else result = value;
      });
      active.once('exit', code => code === 0 ? resolve() : reject(new Error(`Worker exit ${code}`)));
    });
    expect(result).toEqual({ count: 1, pipeline: 'text_extraction', pages: [1], text: 'Worker owns no credentials', ocr: 'Saved OCR source', uploads: 1, temporaryFiles: [] });
    expect(diagnosticMessages.length).toBeGreaterThan(2);
  } finally {
    await worker?.terminate();
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);
