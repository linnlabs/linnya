import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../../..');
const temporary = mkdtempSync(join(tmpdir(), 'linnya-release-schema-'));
const source = join(temporary, 'source');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, stdio: 'inherit' });
let added = false;
try {
  run('git', ['worktree', 'add', '--detach', source, '9c8186a8']);
  added = true;
  // 历史 checkout 自己安装冻结依赖；不得链接当前 checkout 的 node_modules。
  run(pnpm, ['install', '--frozen-lockfile', '--ignore-scripts'], source);
  // 只编译测试需要的 Node 原生模块，不启动 Electron。
  run(pnpm, ['rebuild', 'better-sqlite3'], source);
  copyFileSync(join(here, 'seed.ts.txt'), join(source, 'packages/plugins/__tests__/releaseFixture.test.ts'));
  execFileSync(pnpm, ['exec', 'vitest', 'run', 'packages/plugins/__tests__/releaseFixture.test.ts', '--maxWorkers=1'], {
    cwd: source, stdio: 'inherit',
    env: { ...process.env, LINNYA_RELEASE_FIXTURE_OUTPUT: join(temporary, 'workspace.sqlite') },
  });
  copyFileSync(join(temporary, 'workspace.sqlite'), join(here, 'workspace.sqlite'));
} finally {
  if (added) run('git', ['worktree', 'remove', '--force', source]);
  rmSync(temporary, { recursive: true, force: true });
}
