import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface LocalCiCheckout {
  readonly root: string;
  readonly clean: boolean;
  readonly commit: string;
  /** 工作区里未提交的路径；干净检出不包含它们。 */
  readonly uncommitted: readonly string[];
  readonly remove: () => void;
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/**
 * CI 每次都从提交的干净检出开始：没有本地 `_dev_data`、构建产物和未提交改动。默认在系统临时目录建一个
 * detached worktree 复现这一点；`inPlace` 直接用当前目录，快但会受本地残留影响。
 */
export function prepareLocalCiCheckout(repositoryRoot: string, options: { readonly inPlace: boolean }): LocalCiCheckout {
  const commit = git(repositoryRoot, ['rev-parse', 'HEAD']);
  const uncommitted = git(repositoryRoot, ['status', '--porcelain'])
    .split('\n')
    .filter(Boolean)
    .map(line => line.slice(3));
  if (options.inPlace) return { root: repositoryRoot, clean: false, commit, uncommitted, remove: () => {} };
  const root = path.join(mkdtempSync(path.join(os.tmpdir(), 'linnya-ci-local-')), 'checkout');
  git(repositoryRoot, ['worktree', 'add', '--detach', root, commit]);
  let removed = false;
  return {
    root,
    clean: true,
    commit,
    uncommitted,
    remove: () => {
      if (removed) return;
      removed = true;
      execFileSync('git', ['worktree', 'remove', '--force', root], { cwd: repositoryRoot, stdio: 'ignore' });
      // mkdtemp 建的外层目录只装这一个检出，一并回收。
      rmSync(path.dirname(root), { recursive: true, force: true });
    },
  };
}
