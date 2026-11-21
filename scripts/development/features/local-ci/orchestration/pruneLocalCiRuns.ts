import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  LOCAL_CI_KEEP_RUNS,
  LOCAL_CI_RECEIPT_KEEP_DAYS,
  LOCAL_CI_RUN_NAME_PATTERN,
  type LocalCiReceiptFacts,
  type LocalCiRunRecord,
} from '../definitions/localCiRetention';
import { selectLocalCiRunsToPrune } from '../functions/selectLocalCiRunsToPrune';

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/** 目录名是 UTC 时间戳（`toISOString` 把 `:` 与 `.` 换成了 `-`）。 */
export function parseLocalCiRunTime(name: string): number {
  return Date.parse(name.replace(/T(\d{2})-(\d{2})-(\d{2})$/u, 'T$1:$2:$3Z'));
}

function readReceipt(runDirectory: string): LocalCiReceiptFacts | null {
  try {
    const summary: unknown = JSON.parse(readFileSync(path.join(runDirectory, 'summary.json'), 'utf8'));
    if (typeof summary !== 'object' || summary === null) return null;
    const { tree, clean, fullRun, passed } = summary as Record<string, unknown>;
    return {
      ...(typeof tree === 'string' && { tree }),
      ...(typeof clean === 'boolean' && { clean }),
      ...(typeof fullRun === 'boolean' && { fullRun }),
      ...(typeof passed === 'boolean' && { passed }),
    };
  } catch {
    return null;
  }
}

/**
 * 需要保住回执的代码内容：本次运行的 tree，加上本仓库所有 worktree 当前 HEAD 的 tree。
 * 合入或推送 main 的门禁按 tree 在各 worktree 的回执里查找；分支已经前进、回执留在旧运行里时，
 * 这些 tree 正是接下来最可能被查的代码。读不到 worktree 信息时只保护本次运行的 tree。
 */
export function localCiProtectedTrees(repositoryRoot: string, currentTree: string): string[] {
  const trees = new Set([currentTree]);
  try {
    for (const line of git(repositoryRoot, ['worktree', 'list', '--porcelain']).split('\n')) {
      if (!line.startsWith('HEAD ')) continue;
      try {
        trees.add(git(repositoryRoot, ['rev-parse', `${line.slice('HEAD '.length)}^{tree}`]));
      } catch {
        // 已被回收的提交没有可保护的内容。
      }
    }
  } catch {
    // 只保护本次运行的 tree。
  }
  return [...trees];
}

export interface PruneLocalCiRunsOptions {
  /** `_dev_data/ci-local` 所在的目录；默认用工作区根下的该目录。 */
  readonly runsDirectory?: string;
  readonly currentTree: string;
  readonly now?: number;
  readonly keepNewest?: number;
  readonly receiptKeepDays?: number;
  /** 测试注入；默认从仓库的 worktree 列表解析。 */
  readonly protectedTrees?: readonly string[];
}

/**
 * ci:local 启动时调用：每个工作区只保留最近 20 个运行目录，但不删除受保护代码的最新通过回执，
 * 也不删除 7 天内的通过完整回执。返回被删除的目录名。
 */
export function pruneLocalCiRuns(repositoryRoot: string, options: PruneLocalCiRunsOptions): string[] {
  const runsDirectory = options.runsDirectory ?? path.join(repositoryRoot, '_dev_data/ci-local');
  if (!existsSync(runsDirectory)) return [];
  const runs: LocalCiRunRecord[] = readdirSync(runsDirectory, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && LOCAL_CI_RUN_NAME_PATTERN.test(entry.name))
    .map(entry => ({
      name: entry.name,
      startedAtMs: parseLocalCiRunTime(entry.name),
      receipt: readReceipt(path.join(runsDirectory, entry.name)),
    }));
  const doomed = selectLocalCiRunsToPrune(runs, {
    keepNewest: options.keepNewest ?? LOCAL_CI_KEEP_RUNS,
    protectedTrees: options.protectedTrees ?? localCiProtectedTrees(repositoryRoot, options.currentTree),
    now: options.now ?? Date.now(),
    receiptKeepDays: options.receiptKeepDays ?? LOCAL_CI_RECEIPT_KEEP_DAYS,
  });
  for (const name of doomed) rmSync(path.join(runsDirectory, name), { recursive: true, force: true });
  return doomed;
}
