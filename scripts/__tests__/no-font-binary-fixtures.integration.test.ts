import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';

const guard = path.resolve('scripts/guards/no-font-binary-fixtures.mjs');

it('拒绝新源码字体，允许忽略的构建字体，但仍拦截被强制加入Git的产物', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'source-font-boundary-'));
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    await writeFile(path.join(root, '.gitignore'), '**/dist/\n');
    await mkdir(path.join(root, 'docs'), { recursive: true });
    const source = path.join(root, 'docs/fixture.woff2');
    await writeFile(source, 'synthetic-policy-fixture');
    const check = () => spawnSync(process.execPath, [guard], { cwd: root, encoding: 'utf8' });
    const untracked = check();
    expect(untracked.status).toBe(1); expect(untracked.stderr).toContain('docs/fixture.woff2');
    await rm(source);
    const generated = 'packages/plugins/canvas/dist/render-worker/font.woff2';
    await mkdir(path.dirname(path.join(root, generated)), { recursive: true });
    await writeFile(path.join(root, generated), 'synthetic-build-output');
    expect(check().status).toBe(0);
    execFileSync('git', ['add', '--force', '--', generated], { cwd: root });
    const tracked = check();
    expect(tracked.status).toBe(1); expect(tracked.stderr).toContain(generated);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
