import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';
import type { CanvasReceiptReader } from '../definitions/canvasReceiptWitness';
import { writeTraceJson } from './traceFiles';

/** Node只启动只读Electron CLI并保留原输出；不访问SQLite，调用独立人/CI只读入口，不借模型Shell工具提权。 */
export async function createStandaloneReceiptReader(input: {
  readonly directory: string;
  readonly hostAppRoot: string;
}): Promise<CanvasReceiptReader> {
  const entry = path.join(input.directory, 'receipt-reader.cjs');
  await build({
    entryPoints: [path.join(import.meta.dirname, 'standaloneReceiptEntry.ts')],
    outfile: entry,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron', 'better-sqlite3'],
    tsconfig: path.resolve(import.meta.dirname, '../../../../../../../tsconfig.json'),
  });
  const executable: unknown = createRequire(path.join(input.hostAppRoot, 'package.json'))(
    'electron'
  );
  if (typeof executable !== 'string') throw new Error('Formal Electron executable unavailable');
  return {
    async read({ request, directory, label }) {
      await mkdir(request.profileDirectory, { recursive: true, mode: 0o700 });
      const descriptor = path.join(directory, label + '.request.json');
      await writeTraceJson(descriptor, request);
      const result = await new Promise<{ exitCode: number; stdout: string; stderr: string }>(
        resolve => {
          const environment = { ...process.env };
          delete environment.ELECTRON_RUN_AS_NODE;
          execFile(
            executable,
            [entry, descriptor],
            {
              cwd: request.hostAppRoot,
              env: environment,
              encoding: 'utf8',
              maxBuffer: 16 * 1024 * 1024,
              timeout: 30_000,
            },
            (error, stdout, stderr) =>
              resolve({
                exitCode: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
                stdout,
                stderr,
              })
          );
        }
      );
      const stdout = path.join(directory, label + '.stdout.txt'),
        stderr = path.join(directory, label + '.stderr.txt'),
        completed = path.join(directory, label + '.completion.json');
      await writeFile(stdout, result.stdout, { flag: 'wx', mode: 0o600 });
      await writeFile(stderr, result.stderr, { flag: 'wx', mode: 0o600 });
      await writeTraceJson(completed, { exitCode: result.exitCode, completedAt: Date.now() });
      const files = [entry, descriptor, stdout, stderr, completed];
      if (result.exitCode !== 0)
        return { exitCode: result.exitCode, value: null, responseFile: null, evidenceFiles: files };
      let value: unknown;
      try {
        value = JSON.parse(result.stdout);
      } catch {
        return { exitCode: 0, value: undefined, responseFile: null, evidenceFiles: files };
      }
      const responseFile = path.join(directory, label + '.response.json');
      await writeTraceJson(responseFile, value);
      return { exitCode: 0, value, responseFile, evidenceFiles: [...files, responseFile] };
    },
  };
}
