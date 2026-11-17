import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { build } from 'esbuild';
import { expect, it } from 'vitest';
import { pluginWorkerSdkAliases } from '../../../../../scripts/build/plugin-worker-sdk.mjs';
import { readDiagnosticLogEnvelope } from '../../../../shared/logging/functions/diagnosticLogEnvelope';
import { DEFAULT_DIAGNOSTIC_LOG_PROJECTION_LIMITS } from '../../../../shared/logging/definitions/diagnosticLogContract';

it('Worker 日志与业务终态共用既有消息协议，无 stdout 或 Host 文件路径闭包', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'linnya-plugin-logging-'));
  let worker: Worker | undefined;
  try {
    const outfile = path.join(root, 'worker.cjs');
    const bundle = await build({
      entryPoints: [fileURLToPath(new URL('./fixtures/logging.worker.ts', import.meta.url))],
      outfile, bundle: true, platform: 'node', format: 'cjs', target: 'node24',
      metafile: true, logLevel: 'silent', tsconfig: path.resolve('tsconfig.json'),
      alias: pluginWorkerSdkAliases(process.cwd()),
    });
    expect(Object.keys(bundle.metafile.inputs).filter(file => /pathManager|runtime-paths|createDiagnosticLogFileSink|createDiagnosticLogWriter|workspaceRuntime/.test(file))).toEqual([]);
    expect(Object.values(bundle.metafile.outputs).flatMap(output => output.imports).filter(item => item.external && item.path.startsWith('@plugin/'))).toEqual([]);
    const messages: unknown[] = [];
    let stdout = ''; let stderr = '';
    worker = new Worker(outfile, { stdout: true, stderr: true, env: {} });
    const active = worker;
    active.stdout.on('data', chunk => { stdout += String(chunk); });
    active.stderr.on('data', chunk => { stderr += String(chunk); });
    await new Promise<void>((resolve, reject) => {
      active.once('error', reject);
      active.on('message', value => { messages.push(value); });
      active.once('exit', code => code === 0 ? resolve() : reject(new Error(`Worker exit ${code}`)));
    });
    expect(stdout).toBe(''); expect(stderr).toBe('');
    expect(messages).toHaveLength(5);
    expect(messages[4]).toEqual({ type: 'result', success: true });
    const records = messages.slice(0, 4).map(readDiagnosticLogEnvelope);
    expect(records.map(record => record?.record.level)).toEqual(['DEBUG', 'INFO', 'WARN', 'ERROR']);
    expect(records.every(record => record && record.record.utf8Bytes <= DEFAULT_DIAGNOSTIC_LOG_PROJECTION_LIMITS.maxRecordBytes)).toBe(true);
    expect(records[2]?.record.line).toContain('[truncated]');
  } finally {
    await worker?.terminate();
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);
