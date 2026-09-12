import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

async function copyDistribution(withSources = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'linnya-cli-bundle-'));
  roots.push(root);
  const files = ['apps/linnya-cli/bin', 'apps/linnya-cli/dist'];
  if (withSources) files.push('apps/linnya-cli/build', 'apps/linnya-cli/src',
    'apps/linnya-cli/package.json', 'apps/linnya-cli/tsconfig.json', 'apps/linnya-cli/tsup.config.ts',
    'packages/schemas/src', 'pnpm-lock.yaml');
  for (const file of files) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.cp(path.join(repoRoot, file), path.join(root, file), { recursive: true });
  }
  return root;
}

async function runVersion(root: string) {
  return new Promise<{ code: number | null; output: string; error: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'apps/linnya-cli/bin/linnya.cjs'), '--version'],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let error = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { error += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, output, error }));
  });
}

const bundleSuite = process.env.LINNYA_CLI_TEST_ENTRY === 'bundle' ? describe : describe.skip;
bundleSuite('actual built CLI launcher freshness', () => {
  it('无源码、无 node_modules 的独立分发可离线启动', async () => {
    const result = await runVersion(await copyDistribution());
    expect(result.code).toBe(0);
    expect(result.output).toMatch(/bundle [a-f0-9]{64}/);
  });

  it('损坏 bundle 明确拒绝启动', async () => {
    const root = await copyDistribution();
    await fs.appendFile(path.join(root, 'apps/linnya-cli/dist/cli.cjs'), '\n// changed artifact\n');
    const result = await runVersion(root);
    expect(result.code).toBe(4);
    expect(JSON.parse(result.error)).toMatchObject({ error: { code: 'protocol_incompatible' } });
    expect(result.error).toContain('do not match');
  });

  it.each(['apps/linnya-cli/src/main.ts', 'packages/schemas/src/index.ts'])(
    '版本号不变但构建输入 %s 变化时拒绝旧 bundle', async file => {
      const root = await copyDistribution(true);
      expect((await runVersion(root)).code).toBe(0);
      await fs.appendFile(path.join(root, file), '\n// source changed after build\n');
      const result = await runVersion(root);
      expect(result.code).toBe(4);
      expect(result.error).toContain('bundle is stale');
    },
  );
});
