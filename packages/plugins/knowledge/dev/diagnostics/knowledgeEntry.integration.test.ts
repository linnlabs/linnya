import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, it } from 'vitest';

it('原搜索帮助入口无需加载数据库或模型即可成功退出', async () => {
  const require = createRequire(import.meta.url);
  const child = spawn(
    process.execPath,
    [require.resolve('tsx/cli'), 'scripts/e2e/knowledge-base/knowledge-search.e2e.ts', '--help'],
    {
      cwd: path.resolve(import.meta.dirname, '../../../../..'),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let output = '';
  let error = '';
  child.stdout.on('data', data => {
    output += data.toString();
  });
  child.stderr.on('data', data => {
    error += data.toString();
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  expect(code, error).toBe(0);
  expect(output).toContain('--noAi');
  expect(output).toContain('qdrant-search');
}, 15000);
