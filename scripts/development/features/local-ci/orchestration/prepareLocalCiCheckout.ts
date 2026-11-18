import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface LocalCiCheckout {
  readonly root: string;
  readonly clean: boolean;
  readonly commit: string;
  /** 提交的 tree：按代码内容标识这次运行，内容相同的提交（rebase、改说明）可以复用结果。 */
  readonly tree: string;
  /** 工作区里未提交的路径；干净检出不包含它们。 */
  readonly uncommitted: readonly string[];
  readonly remove: () => void;
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

const CHECKOUT_PREFIX = 'linnya-ci-local-';
/** 外层临时目录里记录哪个进程在用这份检出、是否要求保留。 */
const OWNER_FILE = 'owner.json';
/** 没有归属记录的检出（加记录之前的版本创建）超过这个时间才回收；一次全量 CI 远短于此，不会删掉还在跑的运行。 */
const UNOWNED_CHECKOUT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

interface CheckoutOwner {
  readonly pid: number;
  readonly keep: boolean;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function isOrphaned(container: string, now: number): boolean {
  const ownerPath = path.join(container, OWNER_FILE);
  if (!existsSync(ownerPath)) return now - statSync(container).birthtimeMs > UNOWNED_CHECKOUT_MAX_AGE_MS;
  try {
    const owner = JSON.parse(readFileSync(ownerPath, 'utf8')) as CheckoutOwner;
    return !owner.keep && !isAlive(owner.pid);
  } catch {
    return false;
  }
}

function removeCheckout(repositoryRoot: string, root: string): void {
  execFileSync('git', ['worktree', 'remove', '--force', root], { cwd: repositoryRoot, stdio: 'ignore' });
  // mkdtemp 建的外层目录只装这一个检出，一并回收。
  rmSync(path.dirname(root), { recursive: true, force: true });
}

/**
 * 运行被强制结束（SIGKILL、agent 停掉后台任务）时来不及回收检出，每份约 1.6 GB。
 * 每次启动先回收进程已经不在、也没要求保留的检出，返回被回收的路径。
 */
export function pruneOrphanedLocalCiCheckouts(repositoryRoot: string, now = Date.now()): string[] {
  const pruned: string[] = [];
  for (const line of git(repositoryRoot, ['worktree', 'list', '--porcelain']).split('\n')) {
    if (!line.startsWith('worktree ')) continue;
    const root = line.slice('worktree '.length);
    const container = path.dirname(root);
    if (path.basename(root) !== 'checkout' || !path.basename(container).startsWith(CHECKOUT_PREFIX)) continue;
    if (!existsSync(container) || !isOrphaned(container, now)) continue;
    removeCheckout(repositoryRoot, root);
    pruned.push(root);
  }
  return pruned;
}

/**
 * CI 每次都从提交的干净检出开始：没有本地 `_dev_data`、构建产物和未提交改动。默认在系统临时目录建一个
 * detached worktree 复现这一点；`inPlace` 直接用当前目录，快但会受本地残留影响。
 */
export function prepareLocalCiCheckout(
  repositoryRoot: string,
  options: { readonly inPlace: boolean; readonly keep?: boolean },
): LocalCiCheckout {
  const commit = git(repositoryRoot, ['rev-parse', 'HEAD']);
  const tree = git(repositoryRoot, ['rev-parse', `${commit}^{tree}`]);
  const uncommitted = git(repositoryRoot, ['status', '--porcelain'])
    .split('\n')
    .filter(Boolean)
    .map(line => line.slice(3));
  if (options.inPlace) return { root: repositoryRoot, clean: false, commit, tree, uncommitted, remove: () => {} };
  const container = mkdtempSync(path.join(os.tmpdir(), CHECKOUT_PREFIX));
  const owner: CheckoutOwner = { pid: process.pid, keep: options.keep ?? false };
  writeFileSync(path.join(container, OWNER_FILE), JSON.stringify(owner));
  const root = path.join(container, 'checkout');
  git(repositoryRoot, ['worktree', 'add', '--detach', root, commit]);
  let removed = false;
  return {
    root,
    clean: true,
    commit,
    tree,
    uncommitted,
    remove: () => {
      if (removed) return;
      removed = true;
      removeCheckout(repositoryRoot, root);
    },
  };
}
