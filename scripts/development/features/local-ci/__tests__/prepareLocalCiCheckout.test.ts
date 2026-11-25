import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { prepareLocalCiCheckout, pruneOrphanedLocalCiCheckouts } from '../orchestration/prepareLocalCiCheckout';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function repository(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'local-ci-checkout-test-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  writeFileSync(path.join(root, 'a.txt'), '1\n');
  git('add', 'a.txt');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'initial');
  return root;
}

function checkout(root: string, keep = false) {
  const prepared = prepareLocalCiCheckout(root, { inPlace: false, keep });
  cleanups.push(() => {
    if (existsSync(prepared.root)) prepared.remove();
  });
  return prepared;
}

/** 一个已经退出的进程号：模拟被 SIGKILL 的运行。 */
function exitedPid(): number {
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  return Number(child.stdout);
}

function claimBy(prepared: { root: string }, owner: object): void {
  writeFileSync(path.join(path.dirname(prepared.root), 'owner.json'), JSON.stringify(owner));
}

it('回收进程已退出的检出，保留还在跑和要求保留的', () => {
  const root = repository();
  const running = checkout(root);
  const killed = checkout(root);
  const kept = checkout(root, true);
  claimBy(killed, { pid: exitedPid(), keep: false });
  claimBy(kept, { pid: exitedPid(), keep: true });

  expect(pruneOrphanedLocalCiCheckouts(root).map(item => path.basename(path.dirname(item)))).toEqual([
    path.basename(path.dirname(killed.root)),
  ]);
  expect(existsSync(path.dirname(killed.root))).toBe(false);
  expect(existsSync(running.root)).toBe(true);
  expect(existsSync(kept.root)).toBe(true);
});

it('没有归属记录的旧检出只在明显过期后回收', () => {
  const root = repository();
  const legacy = checkout(root);
  rmSync(path.join(path.dirname(legacy.root), 'owner.json'));

  expect(pruneOrphanedLocalCiCheckouts(root)).toEqual([]);
  expect(pruneOrphanedLocalCiCheckouts(root, Date.now() + 7 * 60 * 60 * 1000)).toHaveLength(1);
  expect(existsSync(legacy.root)).toBe(false);
});

it('工作副本检出包含暂存、未暂存、新建与删除，隔离本地依赖及证据', () => {
  const root = repository();
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args]);
  writeFileSync(path.join(root, '.gitignore'), '_dev_data\n');
  writeFileSync(path.join(root, 'binary'), Buffer.from([0, 1, 255]));
  git('add', '.');
  writeFileSync(path.join(root, 'binary'), Buffer.from([0, 2, 255]));
  rmSync(path.join(root, 'a.txt'));
  writeFileSync(path.join(root, 'new file'), 'new');
  writeFileSync(path.join(root, '_dev_data'), 'ignored');
  const before = git('status', '--porcelain');
  const prepared = prepareLocalCiCheckout(root, { inPlace: false, workingCopy: true });
  cleanups.push(prepared.remove);
  expect(prepared.clean).toBe(false);
  expect(readFileSync(path.join(prepared.root, 'binary'))).toEqual(Buffer.from([0, 2, 255]));
  expect(readFileSync(path.join(prepared.root, 'new file'), 'utf8')).toBe('new');
  expect(existsSync(path.join(prepared.root, 'a.txt'))).toBe(false);
  expect(existsSync(path.join(prepared.root, '_dev_data'))).toBe(false);
  expect(git('status', '--porcelain')).toEqual(before);
});
